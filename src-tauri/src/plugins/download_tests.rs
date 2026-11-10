use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::{
    catalog::{catalog_fingerprint, validate_catalog},
    package::{sha256_file, verify_artifact},
    tests::{manager, package_bytes},
    types::{CATALOG_JSON, PluginCatalogEntry},
};

#[test]
#[ignore = "requires published catalog URLs and network access"]
fn published_catalog_downloads_complete_native_lifecycle() {
    check_download_lifecycle(PackageSource::Published);
}

#[test]
#[ignore = "requires published source pins and network access"]
fn source_pinned_downloads_complete_native_lifecycle() {
    check_download_lifecycle(PackageSource::Ledger);
}

#[test]
#[ignore = "requires npm run package:plugins staging"]
fn staged_catalog_packages_complete_native_lifecycle() {
    check_download_lifecycle(PackageSource::Staged);
}

#[derive(Clone, Copy)]
enum PackageSource {
    Published,
    Ledger,
    Staged,
}

fn check_download_lifecycle(source: PackageSource) {
    let mut entries: Vec<PluginCatalogEntry> =
        serde_json::from_str(CATALOG_JSON).expect("embedded catalog");
    for entry in &mut entries {
        if matches!(source, PackageSource::Ledger) {
            entry.artifact.url = ledger_origin(entry);
        }

        fn ledger_origin(entry: &PluginCatalogEntry) -> String {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repository root")
                .join("plugins");
            for directory in std::fs::read_dir(root).expect("plugin sources") {
                let directory = directory.expect("plugin directory").path();
                if !directory.is_dir() {
                    continue;
                }
                let manifest: serde_json::Value = serde_json::from_slice(
                    &std::fs::read(directory.join("plugin.json")).expect("source manifest"),
                )
                .expect("manifest JSON");
                if manifest["id"] != entry.manifest.id {
                    continue;
                }
                let releases: Vec<serde_json::Value> = serde_json::from_slice(
                    &std::fs::read(directory.join("releases.json")).expect("release ledger"),
                )
                .expect("ledger JSON");
                let release = releases
                    .iter()
                    .find(|release| release["version"] == entry.manifest.version)
                    .expect("current immutable release");
                assert_eq!(release["sourceCommit"], entry.provenance.source_commit);
                assert_eq!(release["artifact"]["sha256"], entry.artifact.sha256);
                assert_eq!(release["artifact"]["sizeBytes"], entry.artifact.size_bytes);
                return release["artifact"]["url"]
                    .as_str()
                    .expect("immutable origin URL")
                    .to_string();
            }
            panic!("Missing source ledger for {}", entry.manifest.id);
        }
    }
    validate_catalog(&entries).expect("trusted catalog");
    for entry in entries {
        let data = TempDir::new().expect("isolated application data");
        let cache = TempDir::new().expect("isolated application cache");
        let manager = manager(entry.clone(), &data, &cache);
        let id = &entry.manifest.id;
        let vault = data.path().join("vaults/synthetic");
        let user_files: [(&str, &[u8]); 4] = [
            ("Notes.md", b"# Invented note\n\nKeep these bytes.  \n"),
            (
                ".denote/note-comments.json",
                br#"{"schemaVersion":1,"owner":"denote.note-comments","notes":{}}"#,
            ),
            (
                ".denote/credentials.dncred",
                b"synthetic opaque credential-container canary",
            ),
            ("assets/synthetic.wav", b"RIFF synthetic audio canary"),
        ];
        for (path, content) in user_files {
            let path = vault.join(path);
            std::fs::create_dir_all(path.parent().expect("synthetic parent"))
                .expect("synthetic vault folder");
            std::fs::write(path, content).expect("synthetic user content");
        }
        let assert_user_content = || {
            for (path, content) in user_files {
                assert_eq!(
                    std::fs::read(vault.join(path)).expect("user content must survive"),
                    content,
                    "{id} changed or removed {path}"
                );
            }
        };
        let initial = &manager.list().expect("default plugin state")[0];
        assert!(!initial.enabled, "{id} must be disabled by default");
        assert_eq!(initial.status, "not-installed");
        assert!(!manager.plugin_root(id).exists());
        assert!(!cache.path().join("plugin-downloads").join(id).exists());
        assert!(
            manager.prepare(id, vec![]).is_err(),
            "{id} must require its declared permissions before installation"
        );
        assert!(!manager.plugin_root(id).exists());
        assert_user_content();
        if matches!(source, PackageSource::Staged) {
            let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repository root")
                .join(".plugin-artifacts")
                .join(format!("{id}-{}.tgz", entry.manifest.version));
            let bytes = std::fs::read(&archive)
                .expect("Stage the candidate archives with npm run package:plugins first");
            verify_artifact(&entry, &bytes).expect("catalog-pinned candidate bytes");
            let loaded = manager
                .load_development_archive(&archive)
                .expect("isolated candidate archive");
            assert_eq!(loaded, *id);
            assert_eq!(
                serde_json::to_value(
                    &manager.list().expect("candidate catalog")[0]
                        .catalog
                        .manifest
                )
                .expect("candidate manifest"),
                serde_json::to_value(&entry.manifest).expect("catalog manifest")
            );
        }
        for _ in 0..2 {
            let installed = manager
                .prepare(id, entry.manifest.permissions.clone())
                .unwrap_or_else(|error| panic!("{id} at {}: {error}", entry.artifact.url));
            manager
                .commit_enable(&installed.transaction_id)
                .expect("commit downloaded package");
            assert_user_content();
            manager
                .storage_set(
                    id,
                    "synthetic-owned-record",
                    serde_json::json!({"keep": true}),
                )
                .expect("owned plugin metadata");
            assert!(
                !manager
                    .read_entrypoint(id)
                    .expect("verified entrypoint")
                    .is_empty()
            );
            assert!(manager.list().expect("plugins")[0].enabled);
            manager.disable(id, false, false).expect("disable");
            assert!(!manager.plugin_root(id).exists());
            assert!(!cache.path().join("plugin-downloads").join(id).exists());
            assert_eq!(
                manager.state().expect("retained state").storage[id]["synthetic-owned-record"],
                serde_json::json!({"keep": true})
            );
            assert_user_content();
        }

        let mut previous = entry.clone();
        previous.manifest.version = "0.0.0-synthetic".to_string();
        let bytes = package_bytes(&previous);
        previous.artifact.size_bytes = bytes.len() as u64;
        previous.artifact.sha256 = hex::encode(Sha256::digest(&bytes));
        let entrypoint_hash = manager
            .install_package(&previous, &bytes)
            .expect("synthetic previous package");
        {
            let mut state = manager.state().expect("state");
            state.enabled.insert(id.clone());
            state
                .installed_manifests
                .insert(id.clone(), previous.manifest.clone());
            state.approved_permissions.insert(
                id.clone(),
                previous.manifest.permissions.iter().cloned().collect(),
            );
            state
                .artifact_hashes
                .insert(id.clone(), previous.artifact.sha256.clone());
            state.catalog_fingerprints.insert(
                id.clone(),
                catalog_fingerprint(&previous).expect("previous fingerprint"),
            );
            state.entrypoint_hashes.insert(id.clone(), entrypoint_hash);
            if let Some(renderer) = &previous.manifest.diagram_renderer {
                let digest =
                    sha256_file(&manager.install_dir(&previous).join(&renderer.entrypoint))
                        .expect("synthetic previous renderer");
                state.diagram_renderer_hashes.insert(id.clone(), digest);
            }
        }
        manager.reconcile_packages().expect("discover update");
        assert_eq!(
            manager.list().expect("plugins")[0].status,
            "update-available"
        );
        let update = manager
            .prepare(id, entry.manifest.permissions.clone())
            .expect("download update");
        assert!(manager.install_dir(&previous).exists());
        manager
            .rollback_enable(
                &update.transaction_id,
                Some("Synthetic activation failure".into()),
            )
            .expect("rollback update");
        assert_user_content();
        assert!(manager.list().expect("plugins")[0].enabled);
        assert_eq!(
            manager.read_entrypoint(id).expect("restored entrypoint"),
            "export default {};"
        );
        assert!(!manager.install_dir(&entry).exists());
        let update = manager
            .prepare(id, entry.manifest.permissions.clone())
            .expect("retry download");
        manager
            .commit_enable(&update.transaction_id)
            .expect("commit update");
        assert!(!manager.install_dir(&previous).exists());
        assert!(manager.install_dir(&entry).exists());
        manager
            .disable(id, true, false)
            .expect("explicit data cleanup");
        assert!(!manager.plugin_root(id).exists());
        assert!(
            !manager
                .state()
                .expect("cleared state")
                .storage
                .contains_key(id)
        );
        assert_user_content();
    }
}
