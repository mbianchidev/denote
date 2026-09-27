use std::{collections::BTreeMap, fs};

use super::{
    sandbox::{HOST_GIT_SIGNING_SECRET_PREFIX, load_credential_ledger},
    tests::{catalog, manager},
};
use crate::error::AppError;

#[test]
fn signing_credentials_are_unavailable_to_the_plugin_secret_api() {
    let data = tempfile::tempdir().expect("data");
    let cache = tempfile::tempdir().expect("cache");
    let catalog = catalog();
    let manager = manager(catalog.clone(), &data, &cache);
    let id = &catalog.manifest.id;
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(id.clone());
        state.approved_permissions.insert(
            id.clone(),
            catalog.manifest.permissions.into_iter().collect(),
        );
    }
    let key = format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{}", "a".repeat(64));
    assert!(
        manager
            .secret_get(id, &key)
            .expect_err("host secret read")
            .to_string()
            .contains("host-owned")
    );
    assert!(manager.secret_set(id, &key, "synthetic").is_err());
    assert!(manager.secret_delete(id, &key).is_err());
}

#[test]
fn credential_journal_survives_restart_without_storing_the_password() {
    let data = tempfile::tempdir().expect("data");
    let cache = tempfile::tempdir().expect("cache");
    let catalog = catalog();
    let manager = manager(catalog.clone(), &data, &cache);
    let id = &catalog.manifest.id;
    let key = format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{}", "a".repeat(64));
    let mut mock_os_store = BTreeMap::new();
    manager
        .write_tracked_secret(id, &key, || {
            mock_os_store.insert(key.clone(), "synthetic-secret-value".to_string());
            Ok(())
        })
        .expect("save");
    drop(manager);
    let ledger = load_credential_ledger(&data.path().join("plugins"))
        .expect("ledger")
        .expect("saved ledger");
    assert!(ledger.credential_keys[id].contains(&key));
    assert_eq!(mock_os_store[&key], "synthetic-secret-value");
    for path in ["state.json", "credentials.json"] {
        let content = fs::read_to_string(data.path().join("plugins").join(path)).expect("metadata");
        assert!(
            !content.contains("synthetic-secret-value"),
            "{path} contains a password"
        );
    }
}

#[test]
fn failed_os_store_writes_remain_tracked_for_cleanup_and_are_reported() {
    let data = tempfile::tempdir().expect("data");
    let cache = tempfile::tempdir().expect("cache");
    let catalog = catalog();
    let manager = manager(catalog.clone(), &data, &cache);
    let id = &catalog.manifest.id;
    let key = format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{}", "a".repeat(64));
    let result = manager.write_tracked_secret(id, &key, || {
        Err(AppError::Plugin("Synthetic OS-store failure.".to_string()))
    });
    assert!(
        result
            .expect_err("write failure")
            .to_string()
            .contains("OS-store failure")
    );
    let ledger = load_credential_ledger(&data.path().join("plugins"))
        .expect("ledger")
        .expect("pending ledger");
    assert!(ledger.pending_credential_keys[id].contains(&key));
    assert!(
        !ledger
            .credential_keys
            .get(id)
            .is_some_and(|keys| keys.contains(&key))
    );
}
