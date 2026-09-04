use std::{collections::BTreeMap, fs, sync::Arc};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::{
    PluginCatalogEntry, PluginManager, PluginNetworkRequest, PluginPermission,
    PluginProcessRequest, PreparedPluginTransaction,
    catalog::{catalog_fingerprint, compatibility_error, validate_catalog},
    commands::git_request_with_app_state,
    git::{PluginGitRequest, PluginGitScope},
    settings::default_settings,
    tests::{manager, package_bytes},
    types::{MAX_PLUGIN_SETTINGS_BYTES, PLUGIN_API_VERSION},
};
use crate::{crypto, db::AppState, error::AppError};

const PLUGIN_ID: &str = "denote.synthetic-emoji";

fn permission(capability: &str) -> PluginPermission {
    PluginPermission {
        capability: capability.to_string(),
        hosts: vec![],
        executables: BTreeMap::new(),
    }
}

fn catalog() -> PluginCatalogEntry {
    serde_json::from_value(json!({
        "manifest": {
            "schemaVersion": 1,
            "id": PLUGIN_ID,
            "name": "Synthetic emoji picker",
            "version": "1.0.0",
            "description": "Synthetic local emoji metadata",
            "publisher": { "name": "Denote" },
            "license": "MIT",
            "repository": "https://github.com/mbianchidev/denote",
            "icon": "icon.svg",
            "category": "editor-writing",
            "compatibility": { "apiVersion": 1, "minimumDenoteVersion": "0.1.3" },
            "permissions": [{ "capability": "emoji-picker" }],
            "entrypoint": "dist/index.js",
            "documentation": "guide.md",
            "settings": {
                "version": 1,
                "properties": {
                    "recents": { "type": "string", "title": "Recent emoji", "default": "[]" },
                    "favorites": { "type": "string", "title": "Favorite emoji", "default": "[]" },
                    "tone": { "type": "number", "title": "Skin tone", "default": 0,
                        "minimum": 0, "maximum": 5 },
                    "autocomplete": { "type": "boolean", "title": "Shortcode autocomplete", "default": true }
                }
            }
        },
        "artifact": {
            "url": format!("https://github.com/mbianchidev/denote/releases/download/v0.1.0/{PLUGIN_ID}-1.0.0.tgz"),
            "sha256": "a".repeat(64),
            "sizeBytes": 1
        },
        "provenance": { "publisherId": "denote", "sourceCommit": "b".repeat(40), "trusted": true },
        "guide": "# Synthetic emoji picker"
    }))
    .expect("synthetic catalog")
}

fn fixture(mut catalog: PluginCatalogEntry) -> (TempDir, TempDir, PluginManager) {
    let data = TempDir::new_in(env!("CARGO_MANIFEST_DIR")).expect("local test data");
    let cache = TempDir::new_in(env!("CARGO_MANIFEST_DIR")).expect("local test cache");
    let bytes = package_bytes(&catalog);
    pin_bytes(&mut catalog, &bytes);
    let manager = manager(catalog, &data, &cache);
    (data, cache, manager)
}

fn pin_bytes(catalog: &mut PluginCatalogEntry, bytes: &[u8]) {
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(bytes));
}

fn prepare_fixture(manager: &PluginManager, mut catalog: PluginCatalogEntry) -> String {
    let bytes = package_bytes(&catalog);
    pin_bytes(&mut catalog, &bytes);
    let entrypoint_sha256 = manager.install_package(&catalog, &bytes).expect("install");
    let transaction_id = uuid::Uuid::new_v4().to_string();
    manager
        .operations()
        .expect("operations")
        .insert(catalog.manifest.id.clone());
    manager
        .pending_transactions()
        .expect("transactions")
        .insert(
            transaction_id.clone(),
            PreparedPluginTransaction {
                plugin_id: catalog.manifest.id.clone(),
                permissions: catalog.manifest.permissions.iter().cloned().collect(),
                artifact_sha256: catalog.artifact.sha256.clone(),
                catalog_fingerprint: catalog_fingerprint(&catalog).expect("fingerprint"),
                entrypoint_sha256: Some(entrypoint_sha256),
                previously_enabled: false,
            },
        );
    transaction_id
}

fn enable_fixture(manager: &PluginManager, catalog: PluginCatalogEntry) {
    let transaction_id = prepare_fixture(manager, catalog);
    manager.commit_enable(&transaction_id).expect("commit");
}

fn saved_settings() -> Value {
    json!({ "recents": "[\"✨\",\"👋🏽\"]", "favorites": "[\"✨\"]", "tone": 3, "autocomplete": false })
}

#[test]
fn catalog_accepts_only_an_unconstrained_additive_api_one_emoji_permission() {
    let catalog = catalog();
    validate_catalog(std::slice::from_ref(&catalog)).expect("supported emoji permission");
    assert_eq!(PLUGIN_API_VERSION, 1);
    assert!(compatibility_error(&catalog).is_none());
    assert_eq!(
        serde_json::to_value(&catalog.manifest.permissions).expect("permissions"),
        json!([{ "capability": "emoji-picker" }])
    );

    for constrained in [
        PluginPermission {
            hosts: vec!["example.invalid".to_string()],
            ..permission("emoji-picker")
        },
        PluginPermission {
            executables: BTreeMap::from([(
                "linux".to_string(),
                vec!["/synthetic/tool".to_string()],
            )]),
            ..permission("emoji-picker")
        },
    ] {
        let mut invalid = catalog.clone();
        invalid.manifest.permissions = vec![constrained];
        let error = validate_catalog(&[invalid]).expect_err("unexpected constraints");
        assert!(
            error
                .to_string()
                .contains("Unexpected permission constraints")
        );
    }
}

#[test]
fn preparation_rejects_emoji_permission_changes_before_downloading() {
    let (_data, _cache, manager) = fixture(catalog());
    for approved in [
        vec![],
        vec![permission("workspace-write")],
        vec![permission("emoji-picker"), permission("workspace-read")],
        vec![PluginPermission {
            hosts: vec!["example.invalid".to_string()],
            ..permission("emoji-picker")
        }],
    ] {
        let error = manager
            .prepare(PLUGIN_ID, approved)
            .expect_err("approval mismatch");
        assert!(
            error
                .to_string()
                .contains("Approved permissions do not match")
        );
        assert!(!manager.plugin_root(PLUGIN_ID).exists());
        assert!(
            manager
                .pending_transactions()
                .expect("transactions")
                .is_empty()
        );
        assert!(manager.operations().expect("operations").is_empty());
    }
}

#[test]
fn development_emoji_archive_uses_the_same_permission_approval_and_installation_boundary() {
    let catalog = catalog();
    let (data, _cache, manager) = fixture(catalog.clone());
    let archive = data.path().join("synthetic-emoji.tgz");
    fs::write(&archive, package_bytes(&catalog)).expect("local archive");
    manager
        .load_development_archive(&archive)
        .expect("load archive");
    let view = manager.list().expect("plugins").remove(0);
    assert!(view.development);
    assert!(!view.catalog.provenance.trusted);
    assert_eq!(
        view.catalog.manifest.permissions,
        vec![permission("emoji-picker")]
    );
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_err()
    );

    let installed = manager
        .prepare(PLUGIN_ID, view.catalog.manifest.permissions)
        .expect("prepare local archive without downloading");
    assert_eq!(
        manager
            .read_entrypoint(PLUGIN_ID)
            .expect("verified entrypoint"),
        "export default {};"
    );
    manager
        .commit_enable(&installed.transaction_id)
        .expect("enable");
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_ok()
    );
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "workspace-write")
            .is_err()
    );
    assert!(manager.enabled_permission(PLUGIN_ID, "network").is_err());
    manager.disable(PLUGIN_ID, false, false).expect("disable");
    assert!(!manager.plugin_root(PLUGIN_ID).exists());
}

#[test]
fn emoji_permission_does_not_accept_an_unsupported_api_major() {
    let mut catalog = catalog();
    catalog.manifest.compatibility.api_version = PLUGIN_API_VERSION + 1;
    let (_data, _cache, manager) = fixture(catalog);
    let error = manager
        .prepare(PLUGIN_ID, vec![permission("emoji-picker")])
        .expect_err("incompatible API");
    assert!(error.to_string().contains("requires API version"));
    assert!(!manager.plugin_root(PLUGIN_ID).exists());
}

#[test]
fn package_rejects_emoji_permission_or_api_changes_without_partial_installation() {
    for changed_permissions in [
        vec![],
        vec![permission("emoji-picker"), permission("workspace-write")],
        vec![
            permission("emoji-picker"),
            PluginPermission {
                hosts: vec!["example.invalid".to_string()],
                ..permission("network")
            },
        ],
    ] {
        let mut packaged = catalog();
        packaged.manifest.permissions = changed_permissions;
        let bytes = package_bytes(&packaged);
        let mut expected = catalog();
        pin_bytes(&mut expected, &bytes);
        let (_data, _cache, manager) = fixture(expected.clone());
        let error = manager
            .install_package(&expected, &bytes)
            .expect_err("manifest mismatch");
        assert!(
            error
                .to_string()
                .contains("does not match catalog metadata")
        );
        assert!(!manager.install_dir(&expected).exists());
        assert!(
            fs::read_dir(manager.plugin_root(PLUGIN_ID))
                .expect("plugin root")
                .next()
                .is_none()
        );
    }

    let mut packaged = catalog();
    packaged.manifest.compatibility.api_version = 2;
    let bytes = package_bytes(&packaged);
    let mut expected = catalog();
    pin_bytes(&mut expected, &bytes);
    let (_data, _cache, manager) = fixture(expected.clone());
    assert!(manager.install_package(&expected, &bytes).is_err());
    assert!(!manager.install_dir(&expected).exists());
}

#[test]
fn emoji_permission_never_grants_privileged_services_during_activation_or_after_enablement() {
    let catalog = catalog();
    let (_data, _cache, manager) = fixture(catalog.clone());
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_err()
    );
    let transaction_id = prepare_fixture(&manager, catalog);
    for committed in [false, true] {
        if committed {
            manager.commit_enable(&transaction_id).expect("commit");
        }
        assert_eq!(
            manager
                .enabled_permission(PLUGIN_ID, "emoji-picker")
                .expect("emoji permission"),
            permission("emoji-picker")
        );
        for capability in [
            "workspace-read",
            "workspace-write",
            "network",
            "process",
            "secure-storage",
            "clipboard-read",
            "clipboard-write",
            "git",
            "automatic-local-commit",
            "project-context",
            "note-events",
            "editor-decoration",
        ] {
            assert!(
                manager.enabled_permission(PLUGIN_ID, capability).is_err(),
                "{capability}"
            );
            assert!(
                manager
                    .authorize_runtime(PLUGIN_ID, Some(capability))
                    .is_err(),
                "{capability}"
            );
        }
        let network_error = manager
            .network_request(
                PLUGIN_ID,
                PluginNetworkRequest {
                    url: "https://example.invalid/emoji".to_string(),
                    method: None,
                    headers: None,
                    body: None,
                },
            )
            .expect_err("network remains unavailable");
        assert!(
            network_error
                .to_string()
                .contains("did not declare network")
        );
        let process_error = manager
            .process_request(
                PLUGIN_ID,
                PluginProcessRequest {
                    executable: "/synthetic/tool".to_string(),
                    arguments: vec![],
                },
                None,
            )
            .expect_err("filesystem/process remains unavailable");
        assert!(
            process_error
                .to_string()
                .contains("did not declare process")
        );
        assert!(manager.secret_get(PLUGIN_ID, "synthetic-key").is_err());
    }
}

#[test]
fn emoji_settings_round_trip_and_stay_isolated_from_other_plugins() {
    let catalog = catalog();
    let (data, cache, mut host) = fixture(catalog.clone());
    let mut other = catalog.clone();
    other.manifest.id = "denote.synthetic-other".to_string();
    Arc::get_mut(&mut host.inner)
        .expect("unshared host")
        .catalog
        .push(other.clone());
    let other_settings =
        json!({ "recents": "[]", "favorites": "[\"🌱\"]", "tone": 1, "autocomplete": true });
    host.set_settings(&other.manifest.id, other_settings.clone())
        .expect("other settings");
    assert_eq!(
        host.settings(PLUGIN_ID).expect("defaults"),
        default_settings(&catalog.manifest)
    );
    assert_eq!(
        host.set_settings(PLUGIN_ID, saved_settings())
            .expect("save settings"),
        saved_settings()
    );
    assert_eq!(
        host.settings(&other.manifest.id).expect("other settings"),
        other_settings
    );
    assert!(
        host.set_settings("denote.unknown", saved_settings())
            .is_err()
    );
    assert!(host.enabled_permission(PLUGIN_ID, "emoji-picker").is_err());

    let persisted = fs::read(host.state_path()).expect("persisted state");
    drop(host);
    let mut restored = manager(catalog, &data, &cache);
    Arc::get_mut(&mut restored.inner)
        .expect("unshared host")
        .catalog
        .push(other.clone());
    *restored.state().expect("state") = serde_json::from_slice(&persisted).expect("restore state");
    assert_eq!(
        restored
            .settings(PLUGIN_ID)
            .expect("restored emoji settings"),
        saved_settings()
    );
    assert_eq!(
        restored
            .settings(&other.manifest.id)
            .expect("restored other settings"),
        other_settings
    );
    assert_eq!(
        restored.state().expect("state").settings_versions[PLUGIN_ID],
        1
    );
}

#[test]
fn invalid_emoji_settings_preserve_the_last_saved_values() {
    let (_data, _cache, manager) = fixture(catalog());
    manager
        .set_settings(PLUGIN_ID, saved_settings())
        .expect("valid settings");
    let original = fs::read(manager.state_path()).expect("state");
    for invalid in [
        json!({ "recents": ["✨"] }),
        json!({ "favorites": ["✨"] }),
        json!({ "tone": "3" }),
        json!({ "tone": -1 }),
        json!({ "tone": 6 }),
        json!({ "autocomplete": "false" }),
        json!({ "workspace-write": true }),
        json!({ "recents": "x".repeat(MAX_PLUGIN_SETTINGS_BYTES) }),
    ] {
        assert!(manager.set_settings(PLUGIN_ID, invalid.clone()).is_err());
        assert!(manager.import_settings(PLUGIN_ID, 1, invalid).is_err());
        assert_eq!(
            manager.settings(PLUGIN_ID).expect("unchanged settings"),
            saved_settings()
        );
        assert_eq!(fs::read(manager.state_path()).expect("state"), original);
    }
    assert!(
        manager
            .import_settings(PLUGIN_ID, 2, saved_settings())
            .is_err()
    );
    assert_eq!(
        manager
            .import_settings(PLUGIN_ID, 1, json!({}))
            .expect("reset defaults"),
        default_settings(&catalog().manifest)
    );
}

#[test]
fn emoji_disable_cleans_package_code_but_keeps_preferences_until_explicit_cleanup() {
    let catalog = catalog();
    let defaults = default_settings(&catalog.manifest);
    let (data, cache, manager) = fixture(catalog.clone());
    let vault = data.path().join("synthetic-vault");
    fs::create_dir(&vault).expect("vault");
    fs::write(vault.join("note.md"), "Synthetic note stays unchanged").expect("note");
    enable_fixture(&manager, catalog);
    manager
        .set_settings(PLUGIN_ID, saved_settings())
        .expect("settings");
    manager
        .storage_set(PLUGIN_ID, "synthetic-state", json!("kept"))
        .expect("plugin state");

    let staging = manager.plugin_root(PLUGIN_ID).join(".staging-synthetic");
    let downloads = cache.path().join("plugin-downloads").join(PLUGIN_ID);
    let backup = data
        .path()
        .join("plugins/packages")
        .join(format!(".{PLUGIN_ID}.removing-synthetic"));
    let unrelated = cache.path().join("plugin-downloads/denote.synthetic-other");
    for path in [&staging, &downloads, &backup, &unrelated] {
        fs::create_dir_all(path).expect("package residue");
        fs::write(path.join("bytes"), b"synthetic bytes").expect("residue");
    }

    manager.disable(PLUGIN_ID, false, false).expect("disable");
    assert!(!manager.plugin_root(PLUGIN_ID).exists());
    assert!(!downloads.exists());
    assert!(!backup.exists());
    assert!(unrelated.join("bytes").is_file());
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_err()
    );
    assert!(manager.read_entrypoint(PLUGIN_ID).is_err());
    assert!(manager.storage_get(PLUGIN_ID, "synthetic-state").is_err());
    assert_eq!(
        manager.settings(PLUGIN_ID).expect("retained settings"),
        saved_settings()
    );
    assert_eq!(
        manager.state().expect("state").storage[PLUGIN_ID]["synthetic-state"],
        json!("kept")
    );

    manager
        .disable(PLUGIN_ID, true, false)
        .expect("explicit data cleanup");
    assert!(
        !manager
            .state()
            .expect("state")
            .settings
            .contains_key(PLUGIN_ID)
    );
    assert!(
        !manager
            .state()
            .expect("state")
            .storage
            .contains_key(PLUGIN_ID)
    );
    assert_eq!(manager.settings(PLUGIN_ID).expect("defaults"), defaults);
    assert_eq!(
        fs::read_to_string(vault.join("note.md")).expect("note"),
        "Synthetic note stays unchanged"
    );
}

#[test]
fn failed_emoji_activation_removes_code_and_revokes_prepared_permission() {
    let catalog = catalog();
    let (_data, _cache, manager) = fixture(catalog.clone());
    manager
        .set_settings(PLUGIN_ID, saved_settings())
        .expect("settings");
    let transaction_id = prepare_fixture(&manager, catalog);
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_ok()
    );
    manager
        .rollback_enable(
            &transaction_id,
            Some("Synthetic activation failure".to_string()),
        )
        .expect("rollback");
    assert!(!manager.plugin_root(PLUGIN_ID).exists());
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "emoji-picker")
            .is_err()
    );
    assert!(manager.read_entrypoint(PLUGIN_ID).is_err());
    assert!(
        manager
            .pending_transactions()
            .expect("transactions")
            .is_empty()
    );
    assert!(manager.operations().expect("operations").is_empty());
    assert_eq!(
        manager.settings(PLUGIN_ID).expect("retained preferences"),
        saved_settings()
    );
}

#[test]
fn emoji_permission_does_not_bypass_locked_vault_checks_for_separately_approved_git() {
    let mut catalog = catalog();
    catalog.manifest.permissions.push(permission("git"));
    let (data, _cache, manager) = fixture(catalog.clone());
    enable_fixture(&manager, catalog);
    let root = data.path().join("synthetic-locked-vault");
    fs::create_dir(&root).expect("vault");
    let root = fs::canonicalize(root).expect("canonical vault");
    let (mut manifest, key, _) =
        crypto::create_manifest("synthetic test password only").expect("manifest");
    manifest.phase = crypto::EncryptionPhase::Encrypted;
    crypto::save_manifest(&root, &manifest).expect("save encryption manifest");
    let encrypted = crypto::encrypt_file_content(&key.copy_bytes(), b"Synthetic private note")
        .expect("encrypt");
    fs::write(root.join("note.md"), &encrypted).expect("encrypted note");
    let app_state = AppState::new(data.path().join("synthetic.db"), Some(root.clone()));

    manager
        .set_settings(PLUGIN_ID, saved_settings())
        .expect("host preferences need no note access");
    let error = git_request_with_app_state(
        &manager,
        &app_state,
        PLUGIN_ID,
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
        },
        &root.to_string_lossy(),
        None,
        &uuid::Uuid::new_v4().to_string(),
    )
    .expect_err("locked vault");
    assert!(matches!(error, AppError::Locked));
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "workspace-read")
            .is_err()
    );
    assert!(
        manager
            .enabled_permission(PLUGIN_ID, "workspace-write")
            .is_err()
    );
    assert!(!app_state.vault_is_unlocked().expect("vault stays locked"));
    assert_eq!(
        fs::read(root.join("note.md")).expect("ciphertext"),
        encrypted
    );
    let persisted = fs::read_to_string(manager.state_path()).expect("plugin metadata");
    assert!(!persisted.contains("Synthetic private note"));
}
