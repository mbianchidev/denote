use std::collections::BTreeSet;
use std::{sync::mpsc, thread, time::Duration};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::{
    catalog::{catalog_fingerprint, compatibility_error, validate_bundles, validate_catalog},
    sandbox::{current_platform, enforce_storage_quota, host_matches},
    settings::{migrate_settings, validate_settings},
    *,
};
use flate2::{Compression, write::GzEncoder};
use tar::Builder;
use tempfile::TempDir;

use crate::{db, vault};

pub(super) fn catalog() -> PluginCatalogEntry {
    serde_json::from_str::<Vec<PluginCatalogEntry>>(CATALOG_JSON)
        .expect("catalog")
        .remove(0)
}

fn package_bytes(catalog: &PluginCatalogEntry) -> Vec<u8> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    let manifest = serde_json::to_vec(&catalog.manifest).expect("manifest");
    append(&mut builder, "plugin.json", &manifest);
    append(
        &mut builder,
        &catalog.manifest.entrypoint,
        b"export default {};",
    );
    builder
        .into_inner()
        .expect("archive")
        .finish()
        .expect("gzip")
}

fn append(builder: &mut Builder<GzEncoder<Vec<u8>>>, path: &str, content: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_size(content.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, path, content)
        .expect("append");
}

pub(super) fn manager(
    catalog: PluginCatalogEntry,
    data: &TempDir,
    cache: &TempDir,
) -> PluginManager {
    fs::create_dir_all(data.path().join("plugins").join("packages")).expect("plugin packages");
    fs::create_dir_all(cache.path().join("plugin-downloads")).expect("plugin cache");
    PluginManager {
        inner: Arc::new(PluginManagerInner {
            app_data_dir: data.path().to_path_buf(),
            app_cache_dir: cache.path().to_path_buf(),
            catalog: vec![catalog],
            bundles: vec![],
            bundle_error: None,
            state: Mutex::new(PersistentPluginState::default()),
            pending_transactions: Mutex::new(BTreeMap::new()),
            preparation_lock: Mutex::new(()),
            operations: Mutex::new(HashSet::new()),
            initialization_error: Mutex::new(None),
            git_operations: Default::default(),
            _process_lock: None,
        }),
    }
}

#[test]
fn verifies_and_installs_package_without_touching_vault_content() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let vault = data.path().join("vault");
    fs::create_dir(&vault).expect("vault");
    fs::write(vault.join("note.md"), "unchanged").expect("note");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);

    manager.install_package(&catalog, &bytes).expect("install");

    assert!(
        manager
            .install_dir(&catalog)
            .join("dist/index.js")
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(vault.join("note.md")).expect("note"),
        "unchanged"
    );
}

#[test]
fn rejects_checksum_mismatch_without_partial_install() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = "0".repeat(64);
    let manager = manager(catalog.clone(), &data, &cache);

    let error = manager
        .install_package(&catalog, &bytes)
        .expect_err("checksum");

    assert!(error.to_string().contains("SHA-256"));
    assert!(!manager.install_dir(&catalog).exists());
}

#[test]
fn disable_removes_package_but_retains_plugin_data_by_default() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    manager.install_package(&catalog, &bytes).expect("install");
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state
            .storage
            .entry(catalog.manifest.id.clone())
            .or_default()
            .insert("value".to_string(), Value::String("kept".to_string()));
    }

    manager
        .disable(&catalog.manifest.id, false, false)
        .expect("disable");

    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
    assert_eq!(
        manager
            .state()
            .expect("state")
            .storage
            .get(&catalog.manifest.id)
            .and_then(|storage| storage.get("value")),
        Some(&Value::String("kept".to_string()))
    );
}

#[test]
fn catalog_version_change_disables_plugin_and_removes_old_code() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let catalog = catalog();
    let manager = manager(catalog.clone(), &data, &cache);
    let old_package = manager
        .plugin_root(&catalog.manifest.id)
        .join("0.0.9")
        .join("dist");
    fs::create_dir_all(&old_package).expect("old package");
    fs::write(old_package.join("index.js"), "old code").expect("old code");
    manager
        .state()
        .expect("state")
        .enabled
        .insert(catalog.manifest.id.clone());

    manager.reconcile_packages().expect("reconcile");

    let state = manager.state().expect("state");
    assert!(!state.enabled.contains(&catalog.manifest.id));
    assert!(state.updates_available.contains(&catalog.manifest.id));
    assert!(state.errors.contains_key(&catalog.manifest.id));
    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
}

#[test]
fn rejects_link_entries_in_plugin_archives() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    let manifest = serde_json::to_vec(&catalog.manifest).expect("manifest");
    append(&mut builder, "plugin.json", &manifest);
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o777);
    header.set_cksum();
    builder
        .append_link(&mut header, "dist/index.js", "../../outside")
        .expect("link");
    let bytes = builder
        .into_inner()
        .expect("archive")
        .finish()
        .expect("gzip");
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);

    let error = manager
        .install_package(&catalog, &bytes)
        .expect_err("link archive");

    assert!(error.to_string().contains("cannot contain links"));
    assert!(!manager.install_dir(&catalog).exists());
}

#[test]
fn permission_changes_disable_and_remove_installed_code() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    let hash = manager.install_package(&catalog, &bytes).expect("install");
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            [PluginPermission {
                capability: "commands".to_string(),
                hosts: vec![],
                executables: BTreeMap::new(),
            }]
            .into_iter()
            .collect(),
        );
        state
            .entrypoint_hashes
            .insert(catalog.manifest.id.clone(), hash);
        state
            .artifact_hashes
            .insert(catalog.manifest.id.clone(), catalog.artifact.sha256.clone());
        state.catalog_fingerprints.insert(
            catalog.manifest.id.clone(),
            catalog_fingerprint(&catalog).expect("fingerprint"),
        );
    }

    manager.reconcile_packages().expect("reconcile");

    let state = manager.state().expect("state");
    assert!(!state.enabled.contains(&catalog.manifest.id));
    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
    assert!(
        state
            .errors
            .get(&catalog.manifest.id)
            .is_some_and(|error| error.contains("permissions changed"))
    );
}

#[test]
fn tampered_entrypoint_is_removed_during_startup_recovery() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    let hash = manager.install_package(&catalog, &bytes).expect("install");
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
        state
            .entrypoint_hashes
            .insert(catalog.manifest.id.clone(), hash);
        state
            .artifact_hashes
            .insert(catalog.manifest.id.clone(), catalog.artifact.sha256.clone());
        state.catalog_fingerprints.insert(
            catalog.manifest.id.clone(),
            catalog_fingerprint(&catalog).expect("fingerprint"),
        );
    }

    fs::write(
        manager
            .install_dir(&catalog)
            .join(&catalog.manifest.entrypoint),
        "tampered",
    )
    .expect("tamper");

    manager.reconcile_packages().expect("reconcile");

    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
    assert!(
        !manager
            .state()
            .expect("state")
            .enabled
            .contains(&catalog.manifest.id)
    );
    assert!(
        manager
            .state()
            .expect("state")
            .updates_available
            .contains(&catalog.manifest.id)
    );
}

#[test]
fn changed_artifact_digest_requires_reenable_even_when_version_is_unchanged() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    let hash = manager.install_package(&catalog, &bytes).expect("install");
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
        state
            .entrypoint_hashes
            .insert(catalog.manifest.id.clone(), hash);
        state
            .artifact_hashes
            .insert(catalog.manifest.id.clone(), "old-digest".to_string());
    }

    manager.reconcile_packages().expect("reconcile");

    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
    assert!(
        !manager
            .state()
            .expect("state")
            .enabled
            .contains(&catalog.manifest.id)
    );
}

#[test]
fn invalid_transaction_cannot_delete_arbitrary_paths() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let manager = manager(catalog(), &data, &cache);
    let sentinel = data.path().join("sentinel");
    fs::create_dir(&sentinel).expect("sentinel");
    fs::write(sentinel.join("keep.txt"), "keep").expect("keep");

    assert!(manager.rollback_enable("../../sentinel", None).is_err());
    assert!(sentinel.join("keep.txt").is_file());
}

#[test]
fn prepared_transaction_blocks_disable_until_rollback() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    let entrypoint_sha256 = manager.install_package(&catalog, &bytes).expect("install");
    manager
        .operations()
        .expect("operations")
        .insert(catalog.manifest.id.clone());
    let transaction_id = "transaction".to_string();
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
            },
        );

    assert!(manager.disable(&catalog.manifest.id, false, false).is_err());
    manager
        .rollback_enable(&transaction_id, None)
        .expect("rollback");

    assert!(!manager.plugin_root(&catalog.manifest.id).exists());
    assert!(
        !manager
            .operations()
            .expect("operations")
            .contains(&catalog.manifest.id)
    );
}

#[test]
fn read_entrypoint_rejects_changes_after_preparation() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let bytes = package_bytes(&catalog);
    catalog.artifact.size_bytes = bytes.len() as u64;
    catalog.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
    let manager = manager(catalog.clone(), &data, &cache);
    let entrypoint_sha256 = manager.install_package(&catalog, &bytes).expect("install");
    manager
        .pending_transactions()
        .expect("transactions")
        .insert(
            "transaction".to_string(),
            PreparedPluginTransaction {
                plugin_id: catalog.manifest.id.clone(),
                permissions: catalog.manifest.permissions.iter().cloned().collect(),
                artifact_sha256: catalog.artifact.sha256.clone(),
                catalog_fingerprint: catalog_fingerprint(&catalog).expect("fingerprint"),
                entrypoint_sha256: Some(entrypoint_sha256),
            },
        );
    fs::write(
        manager
            .install_dir(&catalog)
            .join(&catalog.manifest.entrypoint),
        "tampered after prepare",
    )
    .expect("tamper");

    let error = manager
        .read_entrypoint(&catalog.manifest.id)
        .expect_err("integrity");

    assert!(error.to_string().contains("integrity check failed"));
}

#[test]
fn catalog_rejects_versions_that_can_escape_install_paths() {
    let mut catalog = catalog();
    catalog.manifest.version = "../outside".to_string();

    assert!(validate_catalog(&[catalog]).is_err());
}

#[test]
fn revoked_catalog_version_is_incompatible_before_install() {
    let mut catalog = catalog();
    catalog.revoked = Some(PluginRevocation {
        reason: "Compromised artifact".to_string(),
        revoked_at: "2026-08-31T00:00:00Z".to_string(),
    });

    assert!(compatibility_error(&catalog).is_some_and(|error| error.contains("revoked")));
}

#[test]
fn catalog_rejects_mismatched_provenance() {
    let mut catalog = catalog();
    catalog.provenance.source_commit = "0".repeat(40);

    assert!(validate_catalog(&[catalog]).is_err());
}

#[test]
fn bundle_metadata_accepts_empty_candidates_and_rejects_invalid_references() {
    let catalog = catalog();
    let valid = PluginBundle {
        id: "synthetic-tools".to_string(),
        name: "Synthetic tools".to_string(),
        categories: vec!["code".to_string()],
        roles: vec![PluginBundleRole {
            id: "terminal".to_string(),
            name: "Terminal".to_string(),
            candidate_plugin_ids: vec![],
        }],
    };
    assert!(validate_bundles(std::slice::from_ref(&valid), std::slice::from_ref(&catalog)).is_ok());

    let mut invalid = valid;
    invalid.roles.push(PluginBundleRole {
        id: "terminal".to_string(),
        name: "Other terminal".to_string(),
        candidate_plugin_ids: vec!["denote.missing".to_string()],
    });
    assert!(validate_bundles(&[invalid], &[catalog]).is_err());
}

#[test]
fn embedded_bundle_metadata_is_valid_and_exposes_code_tooling_roles() {
    let catalog =
        serde_json::from_str::<Vec<PluginCatalogEntry>>(CATALOG_JSON).expect("catalog metadata");
    let bundles = serde_json::from_str::<Vec<PluginBundle>>(BUNDLES_JSON).expect("bundle metadata");

    validate_bundles(&bundles, &catalog).expect("valid bundles");
    let code_tooling = bundles
        .iter()
        .find(|bundle| bundle.id == "code-tooling")
        .expect("code tooling bundle");
    assert_eq!(code_tooling.roles.len(), 6);
    assert!(
        code_tooling
            .roles
            .iter()
            .all(|role| role.candidate_plugin_ids.is_empty())
    );
}

#[test]
fn bundle_errors_do_not_block_the_plugin_catalog() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut manager = manager(catalog(), &data, &cache);
    Arc::get_mut(&mut manager.inner)
        .expect("unique manager")
        .bundle_error = Some("Synthetic bundle error".to_string());

    assert!(manager.list().is_ok());
    assert!(manager.bundles().is_err());
}

#[test]
fn catalog_accepts_unconstrained_project_context_capability() {
    let mut catalog = catalog();
    catalog.manifest.permissions.push(PluginPermission {
        capability: "project-context".to_string(),
        hosts: vec![],
        executables: BTreeMap::new(),
    });

    assert!(validate_catalog(&[catalog]).is_ok());
}

#[test]
fn catalog_accepts_unconstrained_source_control_capabilities() {
    let mut catalog = catalog();
    for capability in ["source-control", "automatic-local-commit", "git"] {
        catalog.manifest.permissions.push(PluginPermission {
            capability: capability.to_string(),
            hosts: vec![],
            executables: BTreeMap::new(),
        });
    }

    assert!(validate_catalog(&[catalog]).is_ok());
}

#[test]
fn catalog_rejects_project_context_constraints() {
    let mut catalog = catalog();
    catalog.manifest.permissions.push(PluginPermission {
        capability: "project-context".to_string(),
        hosts: vec!["projects.example".to_string()],
        executables: BTreeMap::new(),
    });

    assert!(validate_catalog(&[catalog]).is_err());
}

#[test]
fn removed_catalog_entries_drop_namespaced_state() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let manager = manager(catalog(), &data, &cache);
    {
        let mut state = manager.state().expect("state");
        state
            .settings
            .insert("removed.plugin".to_string(), Value::Object(Map::new()));
        state.storage.insert(
            "removed.plugin".to_string(),
            BTreeMap::from([("key".to_string(), Value::String("value".to_string()))]),
        );
    }

    manager.reconcile_packages().expect("reconcile");

    let state = manager.state().expect("state");
    assert!(!state.settings.contains_key("removed.plugin"));
    assert!(!state.storage.contains_key("removed.plugin"));
}

#[test]
fn corrupt_state_is_quarantined_without_blocking_core_startup() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let plugins_dir = data.path().join("plugins");
    fs::create_dir_all(&plugins_dir).expect("plugins");
    fs::write(plugins_dir.join("state.json"), "{broken").expect("state");

    let manager = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());

    assert!(manager.list().is_ok());
    assert!(
        fs::read_dir(&plugins_dir)
            .expect("plugins")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("state.corrupt-"))
    );
}

#[test]
fn credential_ledger_survives_corrupt_main_state() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let plugins_dir = data.path().join("plugins");
    fs::create_dir_all(&plugins_dir).expect("plugins");
    fs::write(plugins_dir.join("state.json"), "{broken").expect("state");
    let ledger = CredentialLedger {
        credential_keys: BTreeMap::from([(
            "denote.reference".to_string(),
            BTreeSet::from(["token".to_string()]),
        )]),
        pending_credential_keys: BTreeMap::new(),
    };
    fs::write(
        plugins_dir.join("credentials.json"),
        serde_json::to_vec(&ledger).expect("ledger"),
    )
    .expect("ledger");

    let manager = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());

    assert!(
        manager
            .list()
            .expect("list")
            .first()
            .is_some_and(|plugin| plugin.has_credentials)
    );
}

#[test]
fn plugin_storage_quota_rejects_oversized_values_without_mutating_state() {
    let storage = BTreeMap::new();
    let value = Value::String("x".repeat(MAX_PLUGIN_STORAGE_VALUE_BYTES));

    assert!(enforce_storage_quota(&storage, "large", &value).is_err());
    assert!(storage.is_empty());
}

#[test]
fn retained_settings_are_normalized_against_current_schema() {
    let mut manifest = catalog().manifest;
    manifest.settings = Some(serde_json::json!({
        "properties": {
            "count": {
                "type": "number",
                "title": "Count",
                "default": 2,
                "minimum": 1,
                "maximum": 3
            }
        }
    }));

    assert!(validate_settings(&manifest, serde_json::json!({ "count": 9 })).is_err());
    assert_eq!(
        validate_settings(&manifest, serde_json::json!({})).expect("defaults"),
        serde_json::json!({ "count": 2 })
    );
}

#[test]
fn settings_migrations_rename_and_default_values() {
    let mut manifest = catalog().manifest;
    manifest.settings = Some(serde_json::json!({
        "version": 2,
        "properties": {
            "newName": {
                "type": "string",
                "title": "Name",
                "default": ""
            },
            "enabled": {
                "type": "boolean",
                "title": "Enabled",
                "default": false
            }
        },
        "migrations": [{
            "from": 1,
            "to": 2,
            "rename": { "oldName": "newName" },
            "defaults": { "enabled": true }
        }]
    }));

    assert_eq!(
        migrate_settings(&manifest, serde_json::json!({ "oldName": "kept" }), Some(1),)
            .expect("migration"),
        serde_json::json!({ "newName": "kept", "enabled": true })
    );
    assert_eq!(
        migrate_settings(&manifest, serde_json::json!({ "oldName": "legacy" }), None)
            .expect("legacy migration"),
        serde_json::json!({ "newName": "legacy", "enabled": true })
    );
}

#[test]
fn wildcard_network_hosts_match_only_subdomains() {
    assert!(host_matches("api.example.com", "*.example.com"));
    assert!(!host_matches("example.com", "*.example.com"));
    assert!(!host_matches("example.org", "*.example.com"));
}

#[cfg(unix)]
#[test]
fn process_capability_runs_only_an_approved_absolute_executable() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let mut catalog = catalog();
    let permission = PluginPermission {
        capability: "process".to_string(),
        hosts: vec![],
        executables: BTreeMap::from([(
            current_platform().to_string(),
            vec!["/usr/bin/printf".to_string()],
        )]),
    };
    catalog.manifest.permissions.push(permission.clone());
    let manager = manager(catalog.clone(), &data, &cache);
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
    }

    let result = manager
        .process_request(
            &catalog.manifest.id,
            PluginProcessRequest {
                executable: "/usr/bin/printf".to_string(),
                arguments: vec!["hello".to_string()],
            },
            None,
        )
        .expect("process");

    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "hello");
    assert!(
        manager
            .process_request(
                &catalog.manifest.id,
                PluginProcessRequest {
                    executable: "/bin/sh".to_string(),
                    arguments: vec![],
                },
                None,
            )
            .is_err()
    );
}

#[cfg(unix)]
#[test]
fn process_capability_uses_an_approved_project_working_directory() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let project = data.path().join("synthetic-project");
    fs::create_dir(&project).expect("project");
    let project = fs::canonicalize(project).expect("canonical project");
    let mut catalog = catalog();
    let permission = PluginPermission {
        capability: "process".to_string(),
        hosts: vec![],
        executables: BTreeMap::from([(
            current_platform().to_string(),
            vec!["/bin/pwd".to_string()],
        )]),
    };
    catalog.manifest.permissions.push(permission);
    let manager = manager(catalog.clone(), &data, &cache);
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
    }

    let result = manager
        .process_request(
            &catalog.manifest.id,
            PluginProcessRequest {
                executable: "/bin/pwd".to_string(),
                arguments: vec![],
            },
            Some(&project),
        )
        .expect("process");

    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout.trim(), project.to_string_lossy());
}

#[cfg(unix)]
#[test]
fn project_process_waits_for_project_root_mutations() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let db_path = data.path().join("denote.db");
    db::initialize(&db_path).expect("database");
    let vault_root = data.path().join("synthetic-vault");
    let project_root = vault_root.join("code");
    fs::create_dir_all(&project_root).expect("project");
    let vault_root = fs::canonicalize(vault_root).expect("canonical vault");
    let project_root = fs::canonicalize(project_root).expect("canonical project");
    let connection = db::open(&db_path).expect("connection");
    let vault_id = db::ensure_vault(
        &connection,
        &vault_root.to_string_lossy(),
        "Synthetic Vault",
    )
    .expect("vault record");
    let project_id =
        db::ensure_project_root(&connection, vault_id, "code", true).expect("project record");
    drop(connection);

    let mut catalog = catalog();
    catalog.manifest.permissions.push(PluginPermission {
        capability: "process".to_string(),
        hosts: vec![],
        executables: BTreeMap::from([(
            current_platform().to_string(),
            vec!["/bin/pwd".to_string()],
        )]),
    });
    let manager = manager(catalog.clone(), &data, &cache);
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
    }
    let app_state = Arc::new(db::AppState::new(db_path, Some(vault_root)));
    let worker_state = Arc::clone(&app_state);
    let worker_manager = manager.clone();
    let plugin_id = catalog.manifest.id.clone();
    let mutation_guard = app_state.write_vault_access().expect("mutation guard");
    let (started_tx, started_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        started_tx.send(()).expect("started");
        let result = super::commands::process_request_with_app_state(
            &worker_manager,
            &worker_state,
            &plugin_id,
            PluginProcessRequest {
                executable: "/bin/pwd".to_string(),
                arguments: vec![],
            },
            Some(&project_id),
        );
        result_tx.send(result).expect("result");
    });

    started_rx.recv().expect("worker started");
    assert!(matches!(
        result_rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    drop(mutation_guard);
    let result = result_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("process result")
        .expect("process");
    worker.join().expect("worker");

    assert_eq!(result.stdout.trim(), project_root.to_string_lossy());
}

#[test]
fn project_process_resolution_uses_current_path_and_rejects_stale_identity() {
    let data = TempDir::new().expect("data");
    let db_path = data.path().join("denote.db");
    db::initialize(&db_path).expect("database");
    let trusted_vault = data.path().join("trusted-vault");
    let other_vault = data.path().join("other-vault");
    fs::create_dir(&trusted_vault).expect("trusted vault");
    fs::create_dir(&other_vault).expect("other vault");
    fs::create_dir_all(trusted_vault.join("code").join("before")).expect("initial project");
    fs::create_dir_all(trusted_vault.join("code").join("after")).expect("moved project");
    let trusted_vault = fs::canonicalize(trusted_vault).expect("canonical trusted vault");
    let other_vault = fs::canonicalize(other_vault).expect("canonical other vault");
    let connection = db::open(&db_path).expect("connection");
    let trusted_vault_id = db::ensure_vault(
        &connection,
        &trusted_vault.to_string_lossy(),
        "Trusted Vault",
    )
    .expect("trusted vault record");
    let other_vault_id =
        db::ensure_vault(&connection, &other_vault.to_string_lossy(), "Other Vault")
            .expect("other vault record");
    let project_id = db::ensure_project_root(&connection, trusted_vault_id, "code/before", true)
        .expect("project");
    let other_project_id =
        db::ensure_project_root(&connection, other_vault_id, "", true).expect("other project");
    connection
        .execute(
            "UPDATE project_roots SET root_path = 'code/after' WHERE id = ?1",
            [&project_id],
        )
        .expect("move project metadata");
    drop(connection);

    assert_eq!(
        vault::resolve_project_root(&db_path, &trusted_vault.to_string_lossy(), &project_id,)
            .expect("current project path"),
        trusted_vault.join("code").join("after"),
    );
    fs::remove_dir_all(trusted_vault.join("code").join("after")).expect("remove project folder");
    let unavailable_error =
        vault::resolve_project_root(&db_path, &trusted_vault.to_string_lossy(), &project_id)
            .expect_err("unavailable project");
    assert!(unavailable_error.to_string().contains("unavailable"));
    let other_error = vault::resolve_project_root(
        &db_path,
        &trusted_vault.to_string_lossy(),
        &other_project_id,
    )
    .expect_err("other vault project");
    assert!(other_error.to_string().contains("current vault"));

    let mut connection = db::open(&db_path).expect("connection");
    db::clear_explicit_project_root(&mut connection, trusted_vault_id, &project_id)
        .expect("unmark project");
    drop(connection);
    let missing_error =
        vault::resolve_project_root(&db_path, &trusted_vault.to_string_lossy(), &project_id)
            .expect_err("unmarked project");
    assert!(missing_error.to_string().contains("no longer marked"));
}

#[cfg(unix)]
#[test]
fn project_process_resolution_rejects_a_symlinked_project_folder() {
    use std::os::unix::fs::symlink;

    let data = TempDir::new().expect("data");
    let db_path = data.path().join("denote.db");
    db::initialize(&db_path).expect("database");
    let trusted_vault = data.path().join("trusted-vault");
    let outside = data.path().join("outside");
    fs::create_dir(&trusted_vault).expect("trusted vault");
    fs::create_dir(&outside).expect("outside");
    symlink(&outside, trusted_vault.join("linked-project")).expect("project symlink");
    let trusted_vault = fs::canonicalize(trusted_vault).expect("canonical trusted vault");
    let connection = db::open(&db_path).expect("connection");
    let vault_id = db::ensure_vault(
        &connection,
        &trusted_vault.to_string_lossy(),
        "Trusted Vault",
    )
    .expect("vault record");
    let project_id = db::ensure_project_root(&connection, vault_id, "linked-project", true)
        .expect("project record");
    drop(connection);

    let error =
        vault::resolve_project_root(&db_path, &trusted_vault.to_string_lossy(), &project_id)
            .expect_err("symlinked project");
    assert!(error.to_string().contains("safe real directory"));
}

#[cfg(unix)]
#[test]
fn symlinked_cache_root_is_not_traversed_during_startup() {
    use std::os::unix::fs::symlink;

    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let outside = TempDir::new().expect("outside");
    fs::write(outside.path().join("keep.txt"), "keep").expect("keep");
    fs::create_dir_all(cache.path()).expect("cache");
    symlink(outside.path(), cache.path().join("plugin-downloads")).expect("symlink");

    let manager = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());

    assert!(outside.path().join("keep.txt").is_file());
    assert!(manager.list().is_err());
}
