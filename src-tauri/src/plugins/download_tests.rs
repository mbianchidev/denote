use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::{
    catalog::{catalog_fingerprint, validate_catalog},
    tests::{manager, package_bytes},
    types::{CATALOG_JSON, PluginCatalogEntry},
};

#[test]
#[ignore = "requires published catalog URLs and network access"]
fn published_catalog_downloads_complete_native_lifecycle() {
    check_download_lifecycle(false);
}

#[test]
#[ignore = "requires published source pins and network access"]
fn source_pinned_downloads_complete_native_lifecycle() {
    check_download_lifecycle(true);
}

fn check_download_lifecycle(source: bool) {
    let mut entries: Vec<PluginCatalogEntry> =
        serde_json::from_str(CATALOG_JSON).expect("embedded catalog");
    for entry in &mut entries {
        if source {
            entry.artifact.url = format!(
                "https://raw.githubusercontent.com/mbianchidev/denote/{}/plugin-artifacts/{}-{}.tgz",
                entry.provenance.source_commit, entry.manifest.id, entry.manifest.version
            );
        }
    }
    validate_catalog(&entries).expect("trusted catalog");
    for entry in entries {
        let data = TempDir::new().expect("isolated application data");
        let cache = TempDir::new().expect("isolated application cache");
        let manager = manager(entry.clone(), &data, &cache);
        let id = &entry.manifest.id;
        for _ in 0..2 {
            let installed = manager
                .prepare(id, entry.manifest.permissions.clone())
                .unwrap_or_else(|error| panic!("{id} at {}: {error}", entry.artifact.url));
            manager
                .commit_enable(&installed.transaction_id)
                .expect("commit downloaded package");
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
        manager.disable(id, false, false).expect("final disable");
        assert!(!manager.plugin_root(id).exists());
    }
}
