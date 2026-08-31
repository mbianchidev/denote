use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use atomic_write_file::AtomicWriteFile;
use flate2::read::GzDecoder;
use fs2::FileExt;
use keyring::Entry;
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tar::Archive;
use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

const CATALOG_JSON: &str = include_str!("../../packages/plugins/catalog.json");
const MAX_PLUGIN_PACKAGE_BYTES: usize = 25 * 1024 * 1024;
const MAX_PLUGIN_ENTRYPOINT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_PLUGIN_SETTINGS_BYTES: usize = 256 * 1024;
const MAX_PLUGIN_STORAGE_VALUE_BYTES: usize = 256 * 1024;
const MAX_PLUGIN_STORAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PLUGIN_STORAGE_KEYS: usize = 256;
const KEYCHAIN_SERVICE_PREFIX: &str = "dev.denote.plugin";
const PLUGIN_API_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPublisher {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermission {
    pub capability: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hosts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCompatibility {
    pub api_version: u32,
    pub minimum_denote_version: String,
    pub maximum_denote_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub publisher: PluginPublisher,
    pub license: String,
    pub repository: String,
    pub homepage: Option<String>,
    pub icon: String,
    pub category: String,
    pub compatibility: PluginCompatibility,
    pub permissions: Vec<PluginPermission>,
    pub entrypoint: String,
    pub documentation: String,
    pub settings: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginArtifact {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub manifest: PluginManifest,
    pub artifact: PluginArtifact,
    pub guide: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub catalog: PluginCatalogEntry,
    pub status: String,
    pub enabled: bool,
    pub error: Option<String>,
    pub approved_permissions: Vec<PluginPermission>,
    pub settings: Value,
    pub has_credentials: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub version: String,
    pub entrypoint: String,
    pub transaction_id: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistentPluginState {
    enabled: BTreeSet<String>,
    approved_permissions: BTreeMap<String, BTreeSet<PluginPermission>>,
    artifact_hashes: BTreeMap<String, String>,
    entrypoint_hashes: BTreeMap<String, String>,
    settings: BTreeMap<String, Value>,
    storage: BTreeMap<String, BTreeMap<String, Value>>,
    credential_keys: BTreeMap<String, BTreeSet<String>>,
    pending_credential_keys: BTreeMap<String, BTreeSet<String>>,
    errors: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct CredentialLedger {
    credential_keys: BTreeMap<String, BTreeSet<String>>,
    pending_credential_keys: BTreeMap<String, BTreeSet<String>>,
}

struct PluginManagerInner {
    app_data_dir: PathBuf,
    app_cache_dir: PathBuf,
    catalog: Vec<PluginCatalogEntry>,
    state: Mutex<PersistentPluginState>,
    pending_transactions: Mutex<BTreeMap<String, PreparedPluginTransaction>>,
    preparation_lock: Mutex<()>,
    operations: Mutex<HashSet<String>>,
    initialization_error: Mutex<Option<String>>,
    _process_lock: Option<fs::File>,
}

#[derive(Clone)]
pub struct PluginManager {
    inner: Arc<PluginManagerInner>,
}

struct PluginOperation {
    manager: PluginManager,
    plugin_id: String,
    retained: bool,
}

#[derive(Clone)]
struct PreparedPluginTransaction {
    plugin_id: String,
    permissions: BTreeSet<PluginPermission>,
    artifact_sha256: String,
    entrypoint_sha256: Option<String>,
}

impl Drop for PluginOperation {
    fn drop(&mut self) {
        if self.retained {
            return;
        }
        if let Ok(mut operations) = self.manager.inner.operations.lock() {
            operations.remove(&self.plugin_id);
        }
    }
}

impl PluginManager {
    pub fn new(app_data_dir: PathBuf, app_cache_dir: PathBuf) -> Self {
        let (manager, initialized) =
            match Self::try_new(app_data_dir.clone(), app_cache_dir.clone()) {
                Ok(manager) => (manager, true),
                Err(error) => {
                    eprintln!("Plugin manager started disabled: {error}");
                    (
                        Self {
                            inner: Arc::new(PluginManagerInner {
                                app_data_dir,
                                app_cache_dir,
                                catalog: vec![],
                                state: Mutex::new(PersistentPluginState::default()),
                                pending_transactions: Mutex::new(BTreeMap::new()),
                                preparation_lock: Mutex::new(()),
                                operations: Mutex::new(HashSet::new()),
                                initialization_error: Mutex::new(Some(error.to_string())),
                                _process_lock: None,
                            }),
                        },
                        false,
                    )
                }
            };
        if initialized && let Err(error) = manager.reconcile_packages() {
            eprintln!("Plugin recovery failed; plugins remain disabled: {error}");
            if let Ok(mut state) = manager.inner.state.lock() {
                state.enabled.clear();
            }
            if let Ok(mut initialization_error) = manager.inner.initialization_error.lock() {
                *initialization_error = Some(format!(
                    "Plugin recovery failed. Check application-data permissions and restart: {error}"
                ));
            }
        }
        manager
    }

    fn try_new(app_data_dir: PathBuf, app_cache_dir: PathBuf) -> AppResult<Self> {
        let catalog: Vec<PluginCatalogEntry> = serde_json::from_str(CATALOG_JSON)
            .map_err(|error| AppError::Plugin(format!("Invalid embedded catalog: {error}")))?;
        validate_catalog(&catalog)?;
        let plugins_dir = app_data_dir.join("plugins");
        ensure_managed_directory(&plugins_dir)?;
        ensure_managed_directory(&plugins_dir.join("packages"))?;
        ensure_managed_directory(&app_cache_dir.join("plugin-downloads"))?;
        let process_lock = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(plugins_dir.join(".manager.lock"))?;
        process_lock.try_lock_exclusive().map_err(|error| {
            AppError::Plugin(format!(
                "Another Denote process is managing plugins: {error}"
            ))
        })?;
        let state_path = plugins_dir.join("state.json");
        let mut state = if state_path.exists() {
            match serde_json::from_slice(&fs::read(&state_path)?) {
                Ok(state) => state,
                Err(error) => {
                    let quarantine =
                        plugins_dir.join(format!("state.corrupt-{}.json", Uuid::new_v4()));
                    if let Err(rename_error) = fs::rename(&state_path, &quarantine) {
                        eprintln!(
                            "Unable to quarantine corrupt plugin state {}: {rename_error}",
                            state_path.display()
                        );
                    } else {
                        eprintln!(
                            "Quarantined corrupt plugin state at {}: {error}",
                            quarantine.display()
                        );
                    }
                    PersistentPluginState::default()
                }
            }
        } else {
            PersistentPluginState::default()
        };
        if let Some(credential_ledger) = load_credential_ledger(&plugins_dir)? {
            for (plugin_id, keys) in credential_ledger.credential_keys {
                state
                    .credential_keys
                    .entry(plugin_id)
                    .or_default()
                    .extend(keys);
            }
            for (plugin_id, keys) in credential_ledger.pending_credential_keys {
                state
                    .pending_credential_keys
                    .entry(plugin_id)
                    .or_default()
                    .extend(keys);
            }
        }
        let manager = Self {
            inner: Arc::new(PluginManagerInner {
                app_data_dir,
                app_cache_dir,
                catalog,
                state: Mutex::new(state),
                pending_transactions: Mutex::new(BTreeMap::new()),
                preparation_lock: Mutex::new(()),
                operations: Mutex::new(HashSet::new()),
                initialization_error: Mutex::new(None),
                _process_lock: Some(process_lock),
            }),
        };
        let state_snapshot = manager.state()?.clone();
        manager.save_credential_ledger(&state_snapshot)?;
        Ok(manager)
    }

    fn list(&self) -> AppResult<Vec<PluginView>> {
        let initialization_error = self.initialization_error()?;
        if initialization_error.is_some() && self.inner.catalog.is_empty() {
            return Err(AppError::Plugin(initialization_error.unwrap_or_else(
                || "Plugin manager failed to initialize".to_string(),
            )));
        }
        let state = self.state()?.clone();
        let pending = self.pending_transactions()?.clone();
        self.inner
            .catalog
            .iter()
            .map(|catalog| {
                let plugin_id = &catalog.manifest.id;
                let compatibility_error = compatibility_error(&catalog.manifest);
                let enabled = state.enabled.contains(plugin_id);
                let installed = self.install_dir(catalog).is_dir();
                let prepared_permissions = pending
                    .values()
                    .find(|transaction| transaction.plugin_id == *plugin_id)
                    .map(|transaction| transaction.permissions.clone());
                let status = if initialization_error.is_some() {
                    "failed"
                } else if compatibility_error.is_some() {
                    "incompatible"
                } else if prepared_permissions.is_some() {
                    "installing"
                } else if enabled && installed {
                    "enabled"
                } else if enabled {
                    "failed"
                } else if installed {
                    "disabled"
                } else {
                    "not-installed"
                };
                Ok(PluginView {
                    catalog: catalog.clone(),
                    status: status.to_string(),
                    enabled,
                    error: initialization_error
                        .clone()
                        .or(compatibility_error)
                        .or_else(|| state.errors.get(plugin_id).cloned()),
                    approved_permissions: prepared_permissions
                        .or_else(|| state.approved_permissions.get(plugin_id).cloned())
                        .unwrap_or_default()
                        .into_iter()
                        .collect(),
                    settings: state
                        .settings
                        .get(plugin_id)
                        .cloned()
                        .and_then(|settings| validate_settings(&catalog.manifest, settings).ok())
                        .unwrap_or_else(|| default_settings(&catalog.manifest)),
                    has_credentials: state
                        .credential_keys
                        .get(plugin_id)
                        .is_some_and(|keys| !keys.is_empty())
                        || state
                            .pending_credential_keys
                            .get(plugin_id)
                            .is_some_and(|keys| !keys.is_empty()),
                })
            })
            .collect()
    }

    fn prepare(
        &self,
        plugin_id: &str,
        approved_permissions: Vec<PluginPermission>,
    ) -> AppResult<InstalledPlugin> {
        let _preparation = self.preparation_lock()?;
        let mut operation = self.begin_operation(plugin_id)?;
        let catalog = self.catalog_entry(plugin_id)?.clone();
        if let Some(error) = compatibility_error(&catalog.manifest) {
            return Err(AppError::Plugin(error));
        }
        let requested: BTreeSet<PluginPermission> =
            catalog.manifest.permissions.iter().cloned().collect();
        let approved: BTreeSet<PluginPermission> = approved_permissions.into_iter().collect();
        if approved != requested {
            return Err(AppError::Plugin(format!(
                "Approved permissions do not match the current manifest for {plugin_id}"
            )));
        }
        if self.state()?.enabled.contains(plugin_id) {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is already enabled"
            )));
        }
        let transaction_id = Uuid::new_v4().to_string();
        self.pending_transactions()?.insert(
            transaction_id.clone(),
            PreparedPluginTransaction {
                plugin_id: plugin_id.to_string(),
                permissions: approved,
                artifact_sha256: catalog.artifact.sha256.clone(),
                entrypoint_sha256: None,
            },
        );
        operation.retained = true;
        let result = (|| {
            let bytes = self.download_to_cache(&catalog)?;
            let entrypoint_sha256 = self.install_package(&catalog, &bytes)?;
            self.clear_error(plugin_id)?;
            let mut transactions = self.pending_transactions()?;
            let transaction = transactions
                .get_mut(&transaction_id)
                .ok_or_else(|| AppError::Plugin("Plugin preparation was cancelled".to_string()))?;
            transaction.entrypoint_sha256 = Some(entrypoint_sha256);
            drop(transactions);
            self.installed_plugin(&catalog, transaction_id.clone())
        })();
        match result {
            Ok(installed) => Ok(installed),
            Err(error) => {
                self.pending_transactions()?.remove(&transaction_id);
                if let Err(cleanup_error) = self.remove_package(plugin_id) {
                    self.finish_operation(plugin_id)?;
                    return Err(AppError::Plugin(format!(
                        "{error}; additionally failed to remove the incomplete package: {cleanup_error}"
                    )));
                }
                self.finish_operation(plugin_id)?;
                Err(error)
            }
        }
    }

    fn commit_enable(&self, transaction_id: &str) -> AppResult<()> {
        let mut transactions = self.pending_transactions()?;
        let transaction = transactions.get(transaction_id).cloned().ok_or_else(|| {
            AppError::Plugin("Plugin enablement transaction is invalid or expired".to_string())
        })?;
        let plugin_id = transaction.plugin_id;
        let catalog = self.catalog_entry(&plugin_id)?;
        self.installed_plugin(catalog, transaction_id.to_string())?;
        self.update_state(|state| {
            state.enabled.insert(plugin_id.clone());
            state
                .approved_permissions
                .insert(plugin_id.clone(), transaction.permissions);
            state
                .artifact_hashes
                .insert(plugin_id.clone(), transaction.artifact_sha256);
            state.entrypoint_hashes.insert(
                plugin_id.clone(),
                transaction.entrypoint_sha256.ok_or_else(|| {
                    AppError::Plugin("Plugin preparation is incomplete".to_string())
                })?,
            );
            state.errors.remove(&plugin_id);
            Ok(())
        })?;
        transactions.remove(transaction_id);
        drop(transactions);
        self.finish_operation(&plugin_id)
    }

    fn rollback_enable(&self, transaction_id: &str, error: Option<String>) -> AppResult<()> {
        let mut transactions = self.pending_transactions()?;
        let transaction = transactions.get(transaction_id).cloned().ok_or_else(|| {
            AppError::Plugin("Plugin enablement transaction is invalid or expired".to_string())
        })?;
        let plugin_id = transaction.plugin_id;
        self.catalog_entry(&plugin_id)?;
        self.remove_package(&plugin_id)?;
        self.update_state(|state| {
            state.enabled.remove(&plugin_id);
            if let Some(error) = error {
                state.errors.insert(plugin_id.clone(), error);
            }
            Ok(())
        })?;
        transactions.remove(transaction_id);
        drop(transactions);
        self.finish_operation(&plugin_id)
    }

    fn recover_pending_transactions(&self) -> AppResult<()> {
        let _preparation = self.preparation_lock()?;
        let transaction_ids: Vec<String> = self.pending_transactions()?.keys().cloned().collect();
        for transaction_id in transaction_ids {
            self.rollback_enable(
                &transaction_id,
                Some("Recovered an interrupted plugin enablement.".to_string()),
            )?;
        }
        Ok(())
    }

    fn disable(&self, plugin_id: &str, clear_data: bool, clear_credentials: bool) -> AppResult<()> {
        let _operation = self.begin_operation(plugin_id)?;
        self.catalog_entry(plugin_id)?;
        self.remove_package(plugin_id)?;
        if clear_credentials {
            self.clear_credentials(plugin_id)?;
        }
        self.update_state(|state| {
            state.enabled.remove(plugin_id);
            state.approved_permissions.remove(plugin_id);
            state.artifact_hashes.remove(plugin_id);
            state.entrypoint_hashes.remove(plugin_id);
            state.errors.remove(plugin_id);
            if clear_data {
                state.settings.remove(plugin_id);
                state.storage.remove(plugin_id);
            }
            Ok(())
        })
    }

    fn read_entrypoint(&self, plugin_id: &str) -> AppResult<String> {
        self.authorize_runtime(plugin_id, None)?;
        let catalog = self.catalog_entry(plugin_id)?;
        let entrypoint = self.install_dir(catalog).join(&catalog.manifest.entrypoint);
        let canonical_root = fs::canonicalize(self.install_dir(catalog))?;
        let canonical_entrypoint = fs::canonicalize(&entrypoint)?;
        if !canonical_entrypoint.starts_with(&canonical_root) {
            return Err(AppError::Plugin(format!(
                "Plugin entrypoint escapes its package: {plugin_id}"
            )));
        }
        let metadata = fs::symlink_metadata(&canonical_entrypoint)?;
        if !metadata.is_file() || metadata.len() > MAX_PLUGIN_ENTRYPOINT_BYTES {
            return Err(AppError::Plugin(format!(
                "Plugin entrypoint is invalid or too large: {plugin_id}"
            )));
        }
        let expected_hash = self.expected_entrypoint_hash(plugin_id)?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        fs::File::open(&canonical_entrypoint)?
            .take(MAX_PLUGIN_ENTRYPOINT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != metadata.len()
            || hex::encode(Sha256::digest(&bytes)) != expected_hash
        {
            return Err(AppError::Plugin(format!(
                "Plugin entrypoint integrity check failed: {plugin_id}"
            )));
        }
        String::from_utf8(bytes).map_err(|error| {
            AppError::Plugin(format!(
                "Plugin entrypoint is not valid UTF-8 for {plugin_id}: {error}"
            ))
        })
    }

    fn expected_entrypoint_hash(&self, plugin_id: &str) -> AppResult<String> {
        let pending = self.pending_transactions()?;
        let prepared_hash = pending
            .values()
            .find(|transaction| transaction.plugin_id == plugin_id)
            .and_then(|transaction| transaction.entrypoint_sha256.clone());
        drop(pending);
        if let Some(hash) = prepared_hash {
            return Ok(hash);
        }
        self.state()?
            .entrypoint_hashes
            .get(plugin_id)
            .cloned()
            .ok_or_else(|| {
                AppError::Plugin(format!(
                    "Plugin {plugin_id} has no recorded entrypoint integrity hash"
                ))
            })
    }

    fn settings(&self, plugin_id: &str) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        let saved = self.state()?.settings.get(plugin_id).cloned();
        let normalized = match saved.clone() {
            Some(saved) => validate_settings(&catalog.manifest, saved)
                .unwrap_or_else(|_| default_settings(&catalog.manifest)),
            None => default_settings(&catalog.manifest),
        };
        if saved.as_ref() != Some(&normalized) {
            self.update_state(|state| {
                state
                    .settings
                    .insert(plugin_id.to_string(), normalized.clone());
                Ok(())
            })?;
        }
        Ok(normalized)
    }

    fn set_settings(&self, plugin_id: &str, settings: Value) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        let settings = validate_settings(&catalog.manifest, settings)?;
        if serde_json::to_vec(&settings)
            .map_err(|error| AppError::Plugin(format!("Unable to size settings: {error}")))?
            .len()
            > MAX_PLUGIN_SETTINGS_BYTES
        {
            return Err(AppError::Plugin(format!(
                "Settings for {plugin_id} exceed the size limit"
            )));
        }
        self.update_state(|state| {
            state
                .settings
                .insert(plugin_id.to_string(), settings.clone());
            Ok(())
        })?;
        Ok(settings)
    }

    fn storage_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<Value>> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        Ok(self
            .state()?
            .storage
            .get(plugin_id)
            .and_then(|storage| storage.get(key).cloned()))
    }

    fn storage_set(&self, plugin_id: &str, key: &str, value: Value) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        self.update_state(|state| {
            let storage = state.storage.entry(plugin_id.to_string()).or_default();
            enforce_storage_quota(storage, key, &value)?;
            storage.insert(key.to_string(), value);
            Ok(())
        })
    }

    fn storage_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        self.update_state(|state| {
            if let Some(storage) = state.storage.get_mut(plugin_id) {
                storage.remove(key);
            }
            Ok(())
        })
    }

    fn storage_clear(&self, plugin_id: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        self.update_state(|state| {
            state.storage.remove(plugin_id);
            Ok(())
        })
    }

    fn secret_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<String>> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        let entry = keychain_entry(plugin_id, key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Plugin(format!(
                "Unable to read keychain entry for {plugin_id}: {error}"
            ))),
        }
    }

    fn secret_set(&self, plugin_id: &str, key: &str, value: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        let was_tracked = self
            .state()?
            .credential_keys
            .get(plugin_id)
            .is_some_and(|keys| keys.contains(key));
        if !was_tracked {
            self.update_credential_state(|state| {
                state
                    .pending_credential_keys
                    .entry(plugin_id.to_string())
                    .or_default()
                    .insert(key.to_string());
                Ok(())
            })?;
        }
        keychain_entry(plugin_id, key)?
            .set_password(value)
            .map_err(|error| {
                AppError::Plugin(format!(
                    "Unable to save keychain entry for {plugin_id}: {error}"
                ))
            })?;
        if !was_tracked {
            self.update_credential_state(|state| {
                state
                    .credential_keys
                    .entry(plugin_id.to_string())
                    .or_default()
                    .insert(key.to_string());
                if let Some(keys) = state.pending_credential_keys.get_mut(plugin_id) {
                    keys.remove(key);
                }
                Ok(())
            })?;
        }
        Ok(())
    }

    fn secret_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        delete_keychain_entry(plugin_id, key)?;
        self.update_credential_state(|state| {
            if let Some(keys) = state.credential_keys.get_mut(plugin_id) {
                keys.remove(key);
            }
            if let Some(keys) = state.pending_credential_keys.get_mut(plugin_id) {
                keys.remove(key);
            }
            Ok(())
        })
    }

    fn clear_credentials(&self, plugin_id: &str) -> AppResult<()> {
        let state = self.state()?;
        let mut keys = state
            .credential_keys
            .get(plugin_id)
            .cloned()
            .unwrap_or_default();
        keys.extend(
            state
                .pending_credential_keys
                .get(plugin_id)
                .cloned()
                .unwrap_or_default(),
        );
        drop(state);
        for key in &keys {
            delete_keychain_entry(plugin_id, key)?;
        }
        self.update_credential_state(|state| {
            state.credential_keys.remove(plugin_id);
            state.pending_credential_keys.remove(plugin_id);
            Ok(())
        })
    }

    fn install_package(&self, catalog: &PluginCatalogEntry, bytes: &[u8]) -> AppResult<String> {
        verify_artifact(catalog, bytes)?;
        let plugin_root = self.plugin_root(&catalog.manifest.id);
        reject_symlink(&plugin_root)?;
        fs::create_dir_all(&plugin_root)?;
        let staging = plugin_root.join(format!(".staging-{}", Uuid::new_v4()));
        fs::create_dir(&staging)?;
        let result = extract_archive(bytes, &staging).and_then(|_| {
            validate_extracted_package(catalog, &staging)?;
            let entrypoint_sha256 = sha256_file(&staging.join(&catalog.manifest.entrypoint))?;
            let target = self.install_dir(catalog);
            if target.exists() {
                remove_directory_atomically(&target)?;
            }
            fs::rename(&staging, &target)?;
            Ok(entrypoint_sha256)
        });
        if result.is_err() && staging.exists() {
            if let Err(error) = fs::remove_dir_all(&staging) {
                eprintln!(
                    "Unable to remove failed plugin staging folder {}: {error}",
                    staging.display()
                );
            }
        }
        result
    }

    fn download_to_cache(&self, catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
        let bytes = download_artifact(catalog)?;
        let cache_dir = self.inner.app_cache_dir.join("plugin-downloads");
        fs::create_dir_all(&cache_dir)?;
        let cache_path = cache_dir.join(format!(
            "{}-{}-{}.tgz",
            catalog.manifest.id,
            catalog.manifest.version,
            Uuid::new_v4()
        ));
        let mut file = AtomicWriteFile::options().open(&cache_path)?;
        file.write_all(&bytes)?;
        file.commit()?;
        let cached = fs::read(&cache_path)?;
        if let Err(error) = fs::remove_file(&cache_path) {
            eprintln!(
                "Unable to remove plugin download cache {}: {error}",
                cache_path.display()
            );
        }
        Ok(cached)
    }

    fn remove_package(&self, plugin_id: &str) -> AppResult<()> {
        let plugin_root = self.plugin_root(plugin_id);
        if !plugin_root.exists() {
            return Ok(());
        }
        reject_symlink(&plugin_root)?;
        remove_directory_atomically(&plugin_root)
    }

    fn reconcile_packages(&self) -> AppResult<()> {
        self.prune_transient_paths()?;
        let enabled = self.state()?.enabled.clone();
        for catalog in &self.inner.catalog {
            let plugin_id = &catalog.manifest.id;
            let plugin_root = self.plugin_root(plugin_id);
            let requested_permissions: BTreeSet<PluginPermission> =
                catalog.manifest.permissions.iter().cloned().collect();
            let approved_permissions = self.state()?.approved_permissions.get(plugin_id).cloned();
            let artifact_hash = self.state()?.artifact_hashes.get(plugin_id).cloned();
            let entrypoint_hash = self.state()?.entrypoint_hashes.get(plugin_id).cloned();
            if let Some(error) = compatibility_error(&catalog.manifest) {
                if plugin_root.exists() {
                    self.remove_package(plugin_id)?;
                }
                self.update_state(|state| {
                    state.enabled.remove(plugin_id);
                    state.approved_permissions.remove(plugin_id);
                    state.artifact_hashes.remove(plugin_id);
                    state.entrypoint_hashes.remove(plugin_id);
                    state.errors.insert(plugin_id.clone(), error);
                    Ok(())
                })?;
            } else if enabled.contains(plugin_id)
                && approved_permissions.as_ref() != Some(&requested_permissions)
            {
                if plugin_root.exists() {
                    self.remove_package(plugin_id)?;
                }
                self.update_state(|state| {
                    state.enabled.remove(plugin_id);
                    state.approved_permissions.remove(plugin_id);
                    state.artifact_hashes.remove(plugin_id);
                    state.entrypoint_hashes.remove(plugin_id);
                    state.errors.insert(
                        plugin_id.clone(),
                        "Plugin permissions changed. Review and approve them before enabling again."
                            .to_string(),
                    );
                    Ok(())
                })?;
            } else if enabled.contains(plugin_id) {
                let installed_entrypoint =
                    self.install_dir(catalog).join(&catalog.manifest.entrypoint);
                let entrypoint_matches = match (
                    entrypoint_hash.as_deref(),
                    sha256_file(&installed_entrypoint),
                ) {
                    (Some(expected), Ok(actual)) => actual == expected,
                    _ => false,
                };
                let installed_valid = self.install_dir(catalog).is_dir()
                    && validate_extracted_package(catalog, &self.install_dir(catalog)).is_ok()
                    && artifact_hash.as_deref() == Some(catalog.artifact.sha256.as_str())
                    && entrypoint_matches;
                if !installed_valid {
                    if plugin_root.exists() {
                        self.remove_package(plugin_id)?;
                    }
                    self.update_state(|state| {
                        state.enabled.remove(plugin_id);
                        state.approved_permissions.remove(plugin_id);
                        state.artifact_hashes.remove(plugin_id);
                        state.entrypoint_hashes.remove(plugin_id);
                        state.errors.insert(
                            plugin_id.clone(),
                            "The catalog artifact changed or the package is missing. Review permissions and enable the plugin again."
                                .to_string(),
                        );
                        Ok(())
                    })?;
                }
            } else if plugin_root.exists() {
                self.remove_package(plugin_id)?;
            }
        }
        let known_ids: BTreeSet<String> = self
            .inner
            .catalog
            .iter()
            .map(|entry| entry.manifest.id.clone())
            .collect();
        let state_snapshot = self.state()?.clone();
        let mut orphaned_ids = BTreeSet::new();
        orphaned_ids.extend(state_snapshot.enabled.iter().cloned());
        orphaned_ids.extend(state_snapshot.approved_permissions.keys().cloned());
        orphaned_ids.extend(state_snapshot.artifact_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.entrypoint_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.settings.keys().cloned());
        orphaned_ids.extend(state_snapshot.storage.keys().cloned());
        orphaned_ids.extend(state_snapshot.credential_keys.keys().cloned());
        orphaned_ids.extend(state_snapshot.pending_credential_keys.keys().cloned());
        orphaned_ids.retain(|plugin_id| !known_ids.contains(plugin_id));
        for plugin_id in orphaned_ids {
            self.clear_credentials(&plugin_id)?;
            self.update_state(|state| {
                state.enabled.remove(&plugin_id);
                state.approved_permissions.remove(&plugin_id);
                state.artifact_hashes.remove(&plugin_id);
                state.entrypoint_hashes.remove(&plugin_id);
                state.settings.remove(&plugin_id);
                state.storage.remove(&plugin_id);
                state.errors.remove(&plugin_id);
                Ok(())
            })?;
        }
        Ok(())
    }

    fn prune_transient_paths(&self) -> AppResult<()> {
        let cache_dir = self.inner.app_cache_dir.join("plugin-downloads");
        ensure_managed_directory(&cache_dir)?;
        if cache_dir.exists() {
            for entry in fs::read_dir(&cache_dir)? {
                let entry = entry?;
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path)?;
                if metadata_is_link(&metadata) || metadata.is_file() {
                    fs::remove_file(path)?;
                } else if metadata.is_dir() {
                    fs::remove_dir_all(path)?;
                } else {
                    return Err(AppError::Plugin(format!(
                        "Unsupported plugin cache entry: {}",
                        path.display()
                    )));
                }
            }
        }
        let packages_dir = self.inner.app_data_dir.join("plugins").join("packages");
        ensure_managed_directory(&packages_dir)?;
        let known: BTreeSet<&str> = self
            .inner
            .catalog
            .iter()
            .map(|entry| entry.manifest.id.as_str())
            .collect();
        for entry in fs::read_dir(&packages_dir)? {
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if metadata_is_link(&metadata) {
                fs::remove_file(path)?;
                continue;
            }
            if !known.contains(name.as_ref()) {
                if metadata.is_dir() {
                    remove_directory_atomically(&path)?;
                } else if metadata.is_file() {
                    fs::remove_file(path)?;
                } else {
                    return Err(AppError::Plugin(format!(
                        "Unsupported plugin package entry: {}",
                        path.display()
                    )));
                }
            } else if metadata.is_dir() {
                for child in fs::read_dir(&path)? {
                    let child = child?;
                    let child_path = child.path();
                    let metadata = fs::symlink_metadata(&child_path)?;
                    let child_name = child.file_name();
                    let child_name = child_name.to_string_lossy();
                    if child_name.starts_with(".staging-") || child_name.starts_with(".removing-") {
                        if metadata_is_link(&metadata) || metadata.is_file() {
                            fs::remove_file(child_path)?;
                        } else if metadata.is_dir() {
                            fs::remove_dir_all(child_path)?;
                        } else {
                            return Err(AppError::Plugin(format!(
                                "Unsupported transient plugin entry: {}",
                                child_path.display()
                            )));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn authorize_runtime(&self, plugin_id: &str, permission: Option<&str>) -> AppResult<()> {
        let pending = self.pending_transactions()?;
        let prepared_permissions = pending
            .values()
            .find(|transaction| transaction.plugin_id == plugin_id)
            .map(|transaction| transaction.permissions.clone());
        drop(pending);
        let state = self.state()?;
        let permissions = if let Some(permissions) = prepared_permissions {
            permissions
        } else if state.enabled.contains(plugin_id) {
            state
                .approved_permissions
                .get(plugin_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::Plugin(format!(
                        "Plugin {plugin_id} has no approved permission record"
                    ))
                })?
        } else {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is not enabled"
            )));
        };
        if let Some(permission) = permission
            && !has_permission(self.catalog_entry(plugin_id)?, &permissions, permission)
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} lacks {permission} permission"
            )));
        }
        Ok(())
    }

    fn installed_plugin(
        &self,
        catalog: &PluginCatalogEntry,
        transaction_id: String,
    ) -> AppResult<InstalledPlugin> {
        let entrypoint = self.install_dir(catalog).join(&catalog.manifest.entrypoint);
        if !entrypoint.is_file() {
            return Err(AppError::Plugin(format!(
                "Plugin {} is not installed",
                catalog.manifest.id
            )));
        }
        Ok(InstalledPlugin {
            plugin_id: catalog.manifest.id.clone(),
            version: catalog.manifest.version.clone(),
            entrypoint: catalog.manifest.entrypoint.clone(),
            transaction_id,
        })
    }

    fn clear_error(&self, plugin_id: &str) -> AppResult<()> {
        self.update_state(|state| {
            state.errors.remove(plugin_id);
            Ok(())
        })
    }

    fn begin_operation(&self, plugin_id: &str) -> AppResult<PluginOperation> {
        if let Some(error) = self.initialization_error()? {
            return Err(AppError::Plugin(error));
        }
        self.catalog_entry(plugin_id)?;
        let mut operations = self.operations()?;
        if !operations.insert(plugin_id.to_string()) {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} already has an operation in progress"
            )));
        }
        Ok(PluginOperation {
            manager: self.clone(),
            plugin_id: plugin_id.to_string(),
            retained: false,
        })
    }

    fn finish_operation(&self, plugin_id: &str) -> AppResult<()> {
        self.operations()?.remove(plugin_id);
        Ok(())
    }

    fn catalog_entry(&self, plugin_id: &str) -> AppResult<&PluginCatalogEntry> {
        self.inner
            .catalog
            .iter()
            .find(|entry| entry.manifest.id == plugin_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin {plugin_id}")))
    }

    fn plugin_root(&self, plugin_id: &str) -> PathBuf {
        self.inner
            .app_data_dir
            .join("plugins")
            .join("packages")
            .join(plugin_id)
    }

    fn install_dir(&self, catalog: &PluginCatalogEntry) -> PathBuf {
        self.plugin_root(&catalog.manifest.id)
            .join(&catalog.manifest.version)
    }

    fn state_path(&self) -> PathBuf {
        self.inner.app_data_dir.join("plugins").join("state.json")
    }

    fn save_state(&self, state: &PersistentPluginState) -> AppResult<()> {
        let content = serde_json::to_vec_pretty(state)
            .map_err(|error| AppError::Plugin(format!("Unable to encode plugin state: {error}")))?;
        let mut file = AtomicWriteFile::options().open(self.state_path())?;
        file.write_all(&content)?;
        file.commit()?;
        Ok(())
    }

    fn save_credential_ledger(&self, state: &PersistentPluginState) -> AppResult<()> {
        let ledger = CredentialLedger {
            credential_keys: state.credential_keys.clone(),
            pending_credential_keys: state.pending_credential_keys.clone(),
        };
        let content = serde_json::to_vec_pretty(&ledger).map_err(|error| {
            AppError::Plugin(format!(
                "Unable to encode plugin credential ledger: {error}"
            ))
        })?;
        let path = self
            .inner
            .app_data_dir
            .join("plugins")
            .join("credentials.json");
        let mut file = AtomicWriteFile::options().open(path)?;
        file.write_all(&content)?;
        file.commit()?;
        Ok(())
    }

    fn update_state<T>(
        &self,
        update: impl FnOnce(&mut PersistentPluginState) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut state = self.state()?;
        let mut candidate = state.clone();
        let result = update(&mut candidate)?;
        self.save_state(&candidate)?;
        *state = candidate;
        Ok(result)
    }

    fn update_credential_state<T>(
        &self,
        update: impl FnOnce(&mut PersistentPluginState) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut state = self.state()?;
        let mut candidate = state.clone();
        let result = update(&mut candidate)?;
        self.save_credential_ledger(&candidate)?;
        self.save_state(&candidate)?;
        *state = candidate;
        Ok(result)
    }

    fn state(&self) -> AppResult<MutexGuard<'_, PersistentPluginState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::State("Plugin state lock is poisoned".to_string()))
    }

    fn pending_transactions(
        &self,
    ) -> AppResult<MutexGuard<'_, BTreeMap<String, PreparedPluginTransaction>>> {
        self.inner
            .pending_transactions
            .lock()
            .map_err(|_| AppError::State("Plugin transaction lock is poisoned".to_string()))
    }

    fn preparation_lock(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.inner
            .preparation_lock
            .lock()
            .map_err(|_| AppError::State("Plugin preparation lock is poisoned".to_string()))
    }

    fn operations(&self) -> AppResult<MutexGuard<'_, HashSet<String>>> {
        self.inner
            .operations
            .lock()
            .map_err(|_| AppError::State("Plugin operation lock is poisoned".to_string()))
    }

    fn initialization_error(&self) -> AppResult<Option<String>> {
        self.inner
            .initialization_error
            .lock()
            .map(|error| error.clone())
            .map_err(|_| AppError::State("Plugin initialization lock is poisoned".to_string()))
    }
}

fn validate_catalog(catalog: &[PluginCatalogEntry]) -> AppResult<()> {
    let mut ids = HashSet::new();
    for entry in catalog {
        let id = &entry.manifest.id;
        if !valid_plugin_id(id) || !ids.insert(id) {
            return Err(AppError::Plugin(format!(
                "Invalid or duplicate plugin ID in catalog: {id}"
            )));
        }
        if Version::parse(&entry.manifest.version).is_err()
            || entry.manifest.version.contains(['/', '\\'])
        {
            return Err(AppError::Plugin(format!(
                "Invalid plugin version in catalog for {id}: {}",
                entry.manifest.version
            )));
        }
        if !entry.artifact.url.starts_with("https://")
            || entry.artifact.sha256.len() != 64
            || !entry
                .artifact
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || entry.artifact.size_bytes == 0
            || entry.artifact.size_bytes > MAX_PLUGIN_PACKAGE_BYTES as u64
        {
            return Err(AppError::Plugin(format!(
                "Invalid artifact metadata for plugin {id}"
            )));
        }
        validate_relative_path(&entry.manifest.entrypoint)?;
        validate_relative_path(&entry.manifest.documentation)?;
        validate_relative_path(&entry.manifest.icon)?;
        validate_settings(&entry.manifest, default_settings(&entry.manifest))?;
    }
    Ok(())
}

fn load_credential_ledger(plugins_dir: &Path) -> AppResult<Option<CredentialLedger>> {
    let path = plugins_dir.join("credentials.json");
    if !path.exists() {
        return Ok(None);
    }
    match serde_json::from_slice(&fs::read(&path)?) {
        Ok(ledger) => Ok(Some(ledger)),
        Err(error) => {
            let quarantine =
                plugins_dir.join(format!("credentials.corrupt-{}.json", Uuid::new_v4()));
            fs::rename(&path, &quarantine)?;
            eprintln!(
                "Credential cleanup ledger was corrupt and moved to {}: {error}",
                quarantine.display()
            );
            Ok(None)
        }
    }
}

fn download_artifact(catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Denote plugin installer")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Plugin(format!("Unable to create HTTP client: {error}")))?;
    let response = client.get(&catalog.artifact.url).send().map_err(|error| {
        AppError::Plugin(format!(
            "Unable to download plugin {}: {error}",
            catalog.manifest.id
        ))
    })?;
    if !response.status().is_success() {
        return Err(AppError::Plugin(format!(
            "Plugin download returned HTTP {} for {}",
            response.status(),
            catalog.manifest.id
        )));
    }
    if response.url().scheme() != "https" {
        return Err(AppError::Plugin(format!(
            "Plugin {} download resolved to a non-HTTPS URL",
            catalog.manifest.id
        )));
    }
    if let Some(length) = response.content_length()
        && (length > MAX_PLUGIN_PACKAGE_BYTES as u64 || length != catalog.artifact.size_bytes)
    {
        return Err(AppError::Plugin(format!(
            "Plugin {} download size does not match catalog metadata",
            catalog.manifest.id
        )));
    }
    let expected_size = usize::try_from(catalog.artifact.size_bytes).map_err(|_| {
        AppError::Plugin(format!(
            "Plugin {} package size is unsupported",
            catalog.manifest.id
        ))
    })?;
    let mut bytes = Vec::with_capacity(expected_size);
    response
        .take(catalog.artifact.size_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            AppError::Plugin(format!(
                "Unable to read plugin {} download: {error}",
                catalog.manifest.id
            ))
        })?;
    if bytes.len() != expected_size {
        return Err(AppError::Plugin(format!(
            "Plugin {} download size does not match catalog metadata",
            catalog.manifest.id
        )));
    }
    Ok(bytes)
}

fn verify_artifact(catalog: &PluginCatalogEntry, bytes: &[u8]) -> AppResult<()> {
    if bytes.len() as u64 != catalog.artifact.size_bytes {
        return Err(AppError::Plugin(format!(
            "Plugin {} package size does not match catalog metadata",
            catalog.manifest.id
        )));
    }
    let digest = hex::encode(Sha256::digest(bytes));
    if digest != catalog.artifact.sha256.to_ascii_lowercase() {
        return Err(AppError::Plugin(format!(
            "Plugin {} failed SHA-256 verification",
            catalog.manifest.id
        )));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata_is_link(&metadata)
        || !metadata.is_file()
        || metadata.len() > MAX_PLUGIN_ENTRYPOINT_BYTES
    {
        return Err(AppError::Plugin(format!(
            "Plugin entrypoint is invalid: {}",
            path.display()
        )));
    }
    Ok(hex::encode(Sha256::digest(fs::read(path)?)))
}

fn extract_archive(bytes: &[u8], staging: &Path) -> AppResult<()> {
    let decoder = GzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(decoder);
    let mut extracted_bytes = 0_u64;
    for entry in archive
        .entries()
        .map_err(|error| AppError::Plugin(format!("Unable to read plugin package: {error}")))?
    {
        let mut entry = entry.map_err(|error| {
            AppError::Plugin(format!("Unable to read plugin package entry: {error}"))
        })?;
        let path = entry
            .path()
            .map_err(|error| AppError::Plugin(format!("Invalid plugin package path: {error}")))?;
        validate_archive_path(&path)?;
        let entry_type = entry.header().entry_type();
        if !entry_type.is_file() && !entry_type.is_dir() {
            return Err(AppError::Plugin(
                "Plugin packages cannot contain links or special files".to_string(),
            ));
        }
        extracted_bytes = extracted_bytes
            .checked_add(entry.header().size().map_err(|error| {
                AppError::Plugin(format!("Invalid plugin package entry size: {error}"))
            })?)
            .ok_or_else(|| AppError::Plugin("Plugin package size overflow".to_string()))?;
        if extracted_bytes > MAX_PLUGIN_PACKAGE_BYTES as u64 {
            return Err(AppError::Plugin(
                "Extracted plugin package exceeds the size limit".to_string(),
            ));
        }
        if !entry.unpack_in(staging).map_err(|error| {
            AppError::Plugin(format!("Unable to extract plugin package: {error}"))
        })? {
            return Err(AppError::Plugin(
                "Plugin package path escapes the staging folder".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_extracted_package(catalog: &PluginCatalogEntry, staging: &Path) -> AppResult<()> {
    let manifest_path = staging.join("plugin.json");
    let manifest: PluginManifest = serde_json::from_slice(&fs::read(&manifest_path)?)
        .map_err(|error| AppError::Plugin(format!("Invalid packaged plugin manifest: {error}")))?;
    if manifest.id != catalog.manifest.id
        || manifest.version != catalog.manifest.version
        || manifest.compatibility.api_version != catalog.manifest.compatibility.api_version
        || manifest.permissions != catalog.manifest.permissions
    {
        return Err(AppError::Plugin(format!(
            "Packaged manifest does not match catalog metadata for {}",
            catalog.manifest.id
        )));
    }
    let entrypoint = staging.join(&catalog.manifest.entrypoint);
    let metadata = fs::symlink_metadata(&entrypoint)?;
    if !metadata.is_file() || metadata.len() > MAX_PLUGIN_ENTRYPOINT_BYTES {
        return Err(AppError::Plugin(format!(
            "Plugin {} has an invalid entrypoint",
            catalog.manifest.id
        )));
    }
    Ok(())
}

fn remove_directory_atomically(path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Plugin("Plugin folder has no parent".to_string()))?;
    let removing = parent.join(format!(".removing-{}", Uuid::new_v4()));
    fs::rename(path, &removing)?;
    fs::remove_dir_all(removing)?;
    Ok(())
}

fn reject_symlink(path: &Path) -> AppResult<()> {
    if path.exists() && metadata_is_link(&fs::symlink_metadata(path)?) {
        return Err(AppError::Plugin(format!(
            "Plugin path cannot be a symbolic link: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_managed_directory(path: &Path) -> AppResult<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata_is_link(&metadata) || !metadata.is_dir() {
            return Err(AppError::Plugin(format!(
                "Plugin storage root must be a regular directory: {}",
                path.display()
            )));
        }
    } else {
        fs::create_dir_all(path)?;
        let metadata = fs::symlink_metadata(path)?;
        if metadata_is_link(&metadata) || !metadata.is_dir() {
            return Err(AppError::Plugin(format!(
                "Plugin storage root is unsafe: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn validate_archive_path(path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Plugin(format!(
            "Unsafe plugin package path: {}",
            path.display()
        )));
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> AppResult<()> {
    validate_archive_path(Path::new(path))
}

fn has_permission(
    catalog: &PluginCatalogEntry,
    approved: &BTreeSet<PluginPermission>,
    capability: &str,
) -> bool {
    let Some(permission) = catalog
        .manifest
        .permissions
        .iter()
        .find(|permission| permission.capability == capability)
    else {
        return false;
    };
    approved.contains(permission)
}

fn compatibility_error(manifest: &PluginManifest) -> Option<String> {
    if manifest.compatibility.api_version != PLUGIN_API_VERSION {
        return Some(format!(
            "Plugin {} requires API version {}, but Denote provides {}.",
            manifest.id, manifest.compatibility.api_version, PLUGIN_API_VERSION
        ));
    }
    let host = match Version::parse(env!("CARGO_PKG_VERSION")) {
        Ok(version) => version,
        Err(error) => {
            return Some(format!("Denote has an invalid host version: {error}."));
        }
    };
    let minimum = match Version::parse(&manifest.compatibility.minimum_denote_version) {
        Ok(version) => version,
        Err(error) => {
            return Some(format!(
                "Plugin {} has an invalid minimum Denote version: {error}.",
                manifest.id
            ));
        }
    };
    if host < minimum {
        return Some(format!(
            "Plugin {} requires Denote {} or newer.",
            manifest.id, manifest.compatibility.minimum_denote_version
        ));
    }
    if let Some(maximum_value) = manifest.compatibility.maximum_denote_version.as_deref() {
        let maximum = match Version::parse(maximum_value) {
            Ok(version) => version,
            Err(error) => {
                return Some(format!(
                    "Plugin {} has an invalid maximum Denote version: {error}.",
                    manifest.id
                ));
            }
        };
        if host >= maximum {
            return Some(format!(
                "Plugin {} requires a Denote version below {}.",
                manifest.id, maximum_value
            ));
        }
    }
    None
}

fn default_settings(manifest: &PluginManifest) -> Value {
    let mut defaults = Map::new();
    let Some(properties) = manifest
        .settings
        .as_ref()
        .and_then(|settings| settings.get("properties"))
        .and_then(Value::as_object)
    else {
        return Value::Object(defaults);
    };
    for (key, definition) in properties {
        if let Some(default) = definition.get("default") {
            defaults.insert(key.clone(), default.clone());
        }
    }
    Value::Object(defaults)
}

fn validate_settings(manifest: &PluginManifest, settings: Value) -> AppResult<Value> {
    let provided = settings.as_object().ok_or_else(|| {
        AppError::Plugin(format!("Settings for {} must be an object", manifest.id))
    })?;
    let Some(properties) = manifest
        .settings
        .as_ref()
        .and_then(|schema| schema.get("properties"))
        .and_then(Value::as_object)
    else {
        if provided.is_empty() {
            return Ok(Value::Object(Map::new()));
        }
        return Err(AppError::Plugin(format!(
            "Plugin {} does not define settings",
            manifest.id
        )));
    };
    if provided.keys().any(|key| !properties.contains_key(key)) {
        return Err(AppError::Plugin(format!(
            "Settings contain an unknown key for {}",
            manifest.id
        )));
    }
    let mut normalized = Map::new();
    for (key, definition) in properties {
        let value = provided
            .get(key)
            .cloned()
            .or_else(|| definition.get("default").cloned())
            .ok_or_else(|| AppError::Plugin(format!("Setting {key} has no value or default")))?;
        let valid = match definition.get("type").and_then(Value::as_str) {
            Some("boolean") => value.is_boolean(),
            Some("string") | Some("select") => value.is_string(),
            Some("number") => value.is_number(),
            _ => false,
        };
        if !valid {
            return Err(AppError::Plugin(format!(
                "Setting {key} has the wrong type for {}",
                manifest.id
            )));
        }
        if definition.get("type").and_then(Value::as_str) == Some("number")
            && let Some(number) = value.as_f64()
        {
            if definition
                .get("minimum")
                .and_then(Value::as_f64)
                .is_some_and(|minimum| number < minimum)
                || definition
                    .get("maximum")
                    .and_then(Value::as_f64)
                    .is_some_and(|maximum| number > maximum)
            {
                return Err(AppError::Plugin(format!(
                    "Setting {key} is outside the allowed range for {}",
                    manifest.id
                )));
            }
        }
        if definition.get("type").and_then(Value::as_str) == Some("select")
            && !definition
                .get("options")
                .and_then(Value::as_array)
                .is_some_and(|options| {
                    options
                        .iter()
                        .any(|option| option.get("value") == Some(&value))
                })
        {
            return Err(AppError::Plugin(format!(
                "Setting {key} is not an allowed option for {}",
                manifest.id
            )));
        }
        normalized.insert(key.clone(), value);
    }
    Ok(Value::Object(normalized))
}

fn validate_storage_key(key: &str) -> AppResult<()> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(AppError::Plugin(
            "Plugin storage keys must use 1-128 ASCII letters, numbers, dots, underscores, or hyphens"
                .to_string(),
        ));
    }
    Ok(())
}

fn enforce_storage_quota(
    storage: &BTreeMap<String, Value>,
    key: &str,
    value: &Value,
) -> AppResult<()> {
    if !storage.contains_key(key) && storage.len() >= MAX_PLUGIN_STORAGE_KEYS {
        return Err(AppError::Plugin(format!(
            "Plugin storage cannot exceed {MAX_PLUGIN_STORAGE_KEYS} keys"
        )));
    }
    let value_size = serde_json::to_vec(value)
        .map_err(|error| AppError::Plugin(format!("Unable to size plugin storage: {error}")))?
        .len();
    if value_size > MAX_PLUGIN_STORAGE_VALUE_BYTES {
        return Err(AppError::Plugin(
            "Plugin storage value exceeds the 256 KiB limit".to_string(),
        ));
    }
    let existing_size = storage
        .iter()
        .filter(|(existing_key, _)| existing_key.as_str() != key)
        .try_fold(0_usize, |total, (_, existing)| {
            let size = serde_json::to_vec(existing).map_err(|error| {
                AppError::Plugin(format!("Unable to size plugin storage: {error}"))
            })?;
            total
                .checked_add(size.len())
                .ok_or_else(|| AppError::Plugin("Plugin storage size overflow".to_string()))
        })?;
    if existing_size + value_size > MAX_PLUGIN_STORAGE_BYTES {
        return Err(AppError::Plugin(
            "Plugin storage exceeds the 2 MiB per-plugin limit".to_string(),
        ));
    }
    Ok(())
}

fn keychain_entry(plugin_id: &str, key: &str) -> AppResult<Entry> {
    let mut identifier = Sha256::new();
    identifier.update(plugin_id.as_bytes());
    identifier.update([0]);
    identifier.update(key.as_bytes());
    let account = hex::encode(identifier.finalize());
    Entry::new(KEYCHAIN_SERVICE_PREFIX, &account).map_err(|error| {
        AppError::Plugin(format!(
            "Unable to access the operating-system keychain for {plugin_id}: {error}"
        ))
    })
}

fn delete_keychain_entry(plugin_id: &str, key: &str) -> AppResult<()> {
    match keychain_entry(plugin_id, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Plugin(format!(
            "Unable to delete keychain entry for {plugin_id}: {error}"
        ))),
    }
}

fn valid_plugin_id(value: &str) -> bool {
    value.contains('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        && !value.starts_with(['.', '-'])
        && !value.ends_with(['.', '-'])
        && !value.contains("..")
        && !value.contains("--")
}

async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::State(format!("Background plugin task failed: {error}")))?
}

#[tauri::command]
pub fn list_plugins(state: State<'_, PluginManager>) -> AppResult<Vec<PluginView>> {
    state.list()
}

#[tauri::command]
pub async fn prepare_plugin_enable(
    state: State<'_, PluginManager>,
    plugin_id: String,
    approved_permissions: Vec<PluginPermission>,
) -> AppResult<InstalledPlugin> {
    let manager = state.inner().clone();
    run_blocking(move || manager.prepare(&plugin_id, approved_permissions)).await
}

#[tauri::command]
pub async fn commit_plugin_enable(
    state: State<'_, PluginManager>,
    transaction_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.commit_enable(&transaction_id)).await
}

#[tauri::command]
pub async fn rollback_plugin_enable(
    state: State<'_, PluginManager>,
    transaction_id: String,
    error: Option<String>,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.rollback_enable(&transaction_id, error)).await
}

#[tauri::command]
pub async fn recover_plugin_transactions(state: State<'_, PluginManager>) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.recover_pending_transactions()).await
}

#[tauri::command]
pub async fn disable_plugin(
    state: State<'_, PluginManager>,
    plugin_id: String,
    clear_data: bool,
    clear_credentials: bool,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.disable(&plugin_id, clear_data, clear_credentials)).await
}

#[tauri::command]
pub async fn read_plugin_entrypoint(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<String> {
    let manager = state.inner().clone();
    run_blocking(move || manager.read_entrypoint(&plugin_id)).await
}

#[tauri::command]
pub fn get_plugin_settings(state: State<'_, PluginManager>, plugin_id: String) -> AppResult<Value> {
    state.settings(&plugin_id)
}

#[tauri::command]
pub fn set_plugin_settings(
    state: State<'_, PluginManager>,
    plugin_id: String,
    settings: Value,
) -> AppResult<Value> {
    state.set_settings(&plugin_id, settings)
}

#[tauri::command]
pub fn plugin_storage_get(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<Option<Value>> {
    state.storage_get(&plugin_id, &key)
}

#[tauri::command]
pub fn plugin_storage_set(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
    value: Value,
) -> AppResult<()> {
    state.storage_set(&plugin_id, &key, value)
}

#[tauri::command]
pub fn plugin_storage_delete(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<()> {
    state.storage_delete(&plugin_id, &key)
}

#[tauri::command]
pub fn plugin_storage_clear(state: State<'_, PluginManager>, plugin_id: String) -> AppResult<()> {
    state.storage_clear(&plugin_id)
}

#[tauri::command]
pub async fn plugin_secret_get(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<Option<String>> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_get(&plugin_id, &key)).await
}

#[tauri::command]
pub async fn plugin_secret_set(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
    value: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_set(&plugin_id, &key, &value)).await
}

#[tauri::command]
pub async fn plugin_secret_delete(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_delete(&plugin_id, &key)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use tar::Builder;
    use tempfile::TempDir;

    fn catalog() -> PluginCatalogEntry {
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

    fn manager(catalog: PluginCatalogEntry, data: &TempDir, cache: &TempDir) -> PluginManager {
        fs::create_dir_all(data.path().join("plugins").join("packages")).expect("plugin packages");
        fs::create_dir_all(cache.path().join("plugin-downloads")).expect("plugin cache");
        PluginManager {
            inner: Arc::new(PluginManagerInner {
                app_data_dir: data.path().to_path_buf(),
                app_cache_dir: cache.path().to_path_buf(),
                catalog: vec![catalog],
                state: Mutex::new(PersistentPluginState::default()),
                pending_transactions: Mutex::new(BTreeMap::new()),
                preparation_lock: Mutex::new(()),
                operations: Mutex::new(HashSet::new()),
                initialization_error: Mutex::new(None),
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
}
