use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use atomic_write_file::AtomicWriteFile;
use flate2::read::GzDecoder;
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
    pub approved_permissions: Vec<String>,
    pub settings: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub version: String,
    pub entrypoint: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistentPluginState {
    enabled: BTreeSet<String>,
    approved_permissions: BTreeMap<String, BTreeSet<String>>,
    settings: BTreeMap<String, Value>,
    storage: BTreeMap<String, BTreeMap<String, Value>>,
    credential_keys: BTreeMap<String, BTreeSet<String>>,
    errors: BTreeMap<String, String>,
}

struct PluginManagerInner {
    app_data_dir: PathBuf,
    app_cache_dir: PathBuf,
    catalog: Vec<PluginCatalogEntry>,
    state: Mutex<PersistentPluginState>,
    prepared_permissions: Mutex<BTreeMap<String, BTreeSet<String>>>,
    operations: Mutex<HashSet<String>>,
}

#[derive(Clone)]
pub struct PluginManager {
    inner: Arc<PluginManagerInner>,
}

struct PluginOperation {
    manager: PluginManager,
    plugin_id: String,
}

impl Drop for PluginOperation {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.manager.inner.operations.lock() {
            operations.remove(&self.plugin_id);
        }
    }
}

impl PluginManager {
    pub fn new(app_data_dir: PathBuf, app_cache_dir: PathBuf) -> AppResult<Self> {
        let catalog: Vec<PluginCatalogEntry> = serde_json::from_str(CATALOG_JSON)
            .map_err(|error| AppError::Plugin(format!("Invalid embedded catalog: {error}")))?;
        validate_catalog(&catalog)?;
        let plugins_dir = app_data_dir.join("plugins");
        fs::create_dir_all(&plugins_dir)?;
        fs::create_dir_all(app_cache_dir.join("plugin-downloads"))?;
        let state_path = plugins_dir.join("state.json");
        let state = if state_path.exists() {
            serde_json::from_slice(&fs::read(&state_path)?).map_err(|error| {
                AppError::Plugin(format!("Unable to read plugin state: {error}"))
            })?
        } else {
            PersistentPluginState::default()
        };
        let manager = Self {
            inner: Arc::new(PluginManagerInner {
                app_data_dir,
                app_cache_dir,
                catalog,
                state: Mutex::new(state),
                prepared_permissions: Mutex::new(BTreeMap::new()),
                operations: Mutex::new(HashSet::new()),
            }),
        };
        manager.reconcile_packages()?;
        Ok(manager)
    }

    fn list(&self) -> AppResult<Vec<PluginView>> {
        let state = self.state()?;
        let prepared = self.prepared_permissions()?;
        self.inner
            .catalog
            .iter()
            .map(|catalog| {
                let plugin_id = &catalog.manifest.id;
                let compatibility_error = compatibility_error(&catalog.manifest);
                let enabled = state.enabled.contains(plugin_id);
                let installed = self.install_dir(catalog).is_dir();
                let status = if compatibility_error.is_some() {
                    "incompatible"
                } else if prepared.contains_key(plugin_id) {
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
                    error: compatibility_error.or_else(|| state.errors.get(plugin_id).cloned()),
                    approved_permissions: state
                        .approved_permissions
                        .get(plugin_id)
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .collect(),
                    settings: state
                        .settings
                        .get(plugin_id)
                        .cloned()
                        .unwrap_or_else(|| default_settings(&catalog.manifest)),
                })
            })
            .collect()
    }

    fn prepare(
        &self,
        plugin_id: &str,
        approved_permissions: Vec<String>,
    ) -> AppResult<InstalledPlugin> {
        let _operation = self.begin_operation(plugin_id)?;
        let catalog = self.catalog_entry(plugin_id)?.clone();
        if let Some(error) = compatibility_error(&catalog.manifest) {
            return Err(AppError::Plugin(error));
        }
        let requested = permission_tokens(&catalog.manifest)?;
        let approved: BTreeSet<String> = approved_permissions.into_iter().collect();
        if approved != requested {
            return Err(AppError::Plugin(format!(
                "Approved permissions do not match the current manifest for {plugin_id}"
            )));
        }
        if self.state()?.enabled.contains(plugin_id) {
            return self.installed_plugin(&catalog);
        }

        let bytes = self.download_to_cache(&catalog)?;
        self.install_package(&catalog, &bytes)?;
        self.prepared_permissions()?
            .insert(plugin_id.to_string(), approved);
        self.clear_error(plugin_id)?;
        self.installed_plugin(&catalog)
    }

    fn commit_enable(&self, plugin_id: &str) -> AppResult<()> {
        let permissions = self
            .prepared_permissions()?
            .remove(plugin_id)
            .ok_or_else(|| {
                AppError::Plugin(format!("Plugin {plugin_id} is not prepared for enablement"))
            })?;
        let catalog = self.catalog_entry(plugin_id)?;
        self.installed_plugin(catalog)?;
        let mut state = self.state()?;
        state.enabled.insert(plugin_id.to_string());
        state
            .approved_permissions
            .insert(plugin_id.to_string(), permissions);
        state.errors.remove(plugin_id);
        self.save_state(&state)
    }

    fn rollback_enable(&self, plugin_id: &str, error: Option<String>) -> AppResult<()> {
        self.prepared_permissions()?.remove(plugin_id);
        self.remove_package(plugin_id)?;
        let mut state = self.state()?;
        state.enabled.remove(plugin_id);
        if let Some(error) = error {
            state.errors.insert(plugin_id.to_string(), error);
        }
        self.save_state(&state)
    }

    fn disable(&self, plugin_id: &str, clear_data: bool, clear_credentials: bool) -> AppResult<()> {
        let _operation = self.begin_operation(plugin_id)?;
        self.catalog_entry(plugin_id)?;
        self.prepared_permissions()?.remove(plugin_id);
        self.remove_package(plugin_id)?;
        if clear_credentials {
            self.clear_credentials(plugin_id)?;
        }
        let mut state = self.state()?;
        state.enabled.remove(plugin_id);
        state.approved_permissions.remove(plugin_id);
        state.errors.remove(plugin_id);
        if clear_data {
            state.settings.remove(plugin_id);
            state.storage.remove(plugin_id);
        }
        self.save_state(&state)
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
        fs::read_to_string(canonical_entrypoint).map_err(AppError::from)
    }

    fn settings(&self, plugin_id: &str) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        Ok(self
            .state()?
            .settings
            .get(plugin_id)
            .cloned()
            .unwrap_or_else(|| default_settings(&catalog.manifest)))
    }

    fn set_settings(&self, plugin_id: &str, settings: Value) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        let settings = validate_settings(&catalog.manifest, settings)?;
        let mut state = self.state()?;
        state
            .settings
            .insert(plugin_id.to_string(), settings.clone());
        self.save_state(&state)?;
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
        let mut state = self.state()?;
        state
            .storage
            .entry(plugin_id.to_string())
            .or_default()
            .insert(key.to_string(), value);
        self.save_state(&state)
    }

    fn storage_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        let mut state = self.state()?;
        if let Some(storage) = state.storage.get_mut(plugin_id) {
            storage.remove(key);
        }
        self.save_state(&state)
    }

    fn storage_clear(&self, plugin_id: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        let mut state = self.state()?;
        state.storage.remove(plugin_id);
        self.save_state(&state)
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
        keychain_entry(plugin_id, key)?
            .set_password(value)
            .map_err(|error| {
                AppError::Plugin(format!(
                    "Unable to save keychain entry for {plugin_id}: {error}"
                ))
            })?;
        let mut state = self.state()?;
        state
            .credential_keys
            .entry(plugin_id.to_string())
            .or_default()
            .insert(key.to_string());
        self.save_state(&state)
    }

    fn secret_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        delete_keychain_entry(plugin_id, key)?;
        let mut state = self.state()?;
        if let Some(keys) = state.credential_keys.get_mut(plugin_id) {
            keys.remove(key);
        }
        self.save_state(&state)
    }

    fn clear_credentials(&self, plugin_id: &str) -> AppResult<()> {
        let keys = self
            .state()?
            .credential_keys
            .get(plugin_id)
            .cloned()
            .unwrap_or_default();
        for key in &keys {
            delete_keychain_entry(plugin_id, key)?;
        }
        let mut state = self.state()?;
        state.credential_keys.remove(plugin_id);
        self.save_state(&state)
    }

    fn install_package(&self, catalog: &PluginCatalogEntry, bytes: &[u8]) -> AppResult<()> {
        verify_artifact(catalog, bytes)?;
        let plugin_root = self.plugin_root(&catalog.manifest.id);
        reject_symlink(&plugin_root)?;
        fs::create_dir_all(&plugin_root)?;
        let staging = plugin_root.join(format!(".staging-{}", Uuid::new_v4()));
        fs::create_dir(&staging)?;
        let result = extract_archive(bytes, &staging).and_then(|_| {
            validate_extracted_package(catalog, &staging)?;
            let target = self.install_dir(catalog);
            if target.exists() {
                remove_directory_atomically(&target)?;
            }
            fs::rename(&staging, &target)?;
            Ok(())
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
            if let Some(error) = compatibility_error(&catalog.manifest) {
                if plugin_root.exists() {
                    self.remove_package(plugin_id)?;
                }
                let mut state = self.state()?;
                state.enabled.remove(plugin_id);
                state.errors.insert(plugin_id.clone(), error);
                self.save_state(&state)?;
            } else if enabled.contains(plugin_id) {
                if !self.install_dir(catalog).is_dir() {
                    let mut state = self.state()?;
                    state.enabled.remove(plugin_id);
                    state.errors.insert(
                        plugin_id.clone(),
                        "Enabled plugin package is missing and must be enabled again.".to_string(),
                    );
                    self.save_state(&state)?;
                }
            } else if plugin_root.exists() {
                self.remove_package(plugin_id)?;
            }
        }
        Ok(())
    }

    fn prune_transient_paths(&self) -> AppResult<()> {
        let cache_dir = self.inner.app_cache_dir.join("plugin-downloads");
        if cache_dir.exists() {
            for entry in fs::read_dir(&cache_dir)? {
                let path = entry?.path();
                if path.is_dir() {
                    fs::remove_dir_all(path)?;
                } else {
                    fs::remove_file(path)?;
                }
            }
        }
        let packages_dir = self.inner.app_data_dir.join("plugins").join("packages");
        fs::create_dir_all(&packages_dir)?;
        let known: BTreeSet<&str> = self
            .inner
            .catalog
            .iter()
            .map(|entry| entry.manifest.id.as_str())
            .collect();
        for entry in fs::read_dir(&packages_dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !known.contains(name.as_ref()) {
                if path.is_dir() {
                    remove_directory_atomically(&path)?;
                } else {
                    fs::remove_file(path)?;
                }
            } else if path.is_dir() {
                for child in fs::read_dir(&path)? {
                    let child = child?;
                    let child_name = child.file_name();
                    let child_name = child_name.to_string_lossy();
                    if child_name.starts_with(".staging-") || child_name.starts_with(".removing-") {
                        let child_path = child.path();
                        if child_path.is_dir() {
                            fs::remove_dir_all(child_path)?;
                        } else {
                            fs::remove_file(child_path)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn authorize_runtime(&self, plugin_id: &str, permission: Option<&str>) -> AppResult<()> {
        let state = self.state()?;
        let prepared = self.prepared_permissions()?;
        let permissions = if let Some(permissions) = prepared.get(plugin_id) {
            permissions
        } else if state.enabled.contains(plugin_id) {
            state.approved_permissions.get(plugin_id).ok_or_else(|| {
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
            && !has_permission(self.catalog_entry(plugin_id)?, permissions, permission)?
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} lacks {permission} permission"
            )));
        }
        Ok(())
    }

    fn installed_plugin(&self, catalog: &PluginCatalogEntry) -> AppResult<InstalledPlugin> {
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
        })
    }

    fn clear_error(&self, plugin_id: &str) -> AppResult<()> {
        let mut state = self.state()?;
        if state.errors.remove(plugin_id).is_some() {
            self.save_state(&state)?;
        }
        Ok(())
    }

    fn begin_operation(&self, plugin_id: &str) -> AppResult<PluginOperation> {
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
        })
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

    fn state(&self) -> AppResult<MutexGuard<'_, PersistentPluginState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::State("Plugin state lock is poisoned".to_string()))
    }

    fn prepared_permissions(
        &self,
    ) -> AppResult<MutexGuard<'_, BTreeMap<String, BTreeSet<String>>>> {
        self.inner.prepared_permissions.lock().map_err(|_| {
            AppError::State("Plugin prepared-permissions lock is poisoned".to_string())
        })
    }

    fn operations(&self) -> AppResult<MutexGuard<'_, HashSet<String>>> {
        self.inner
            .operations
            .lock()
            .map_err(|_| AppError::State("Plugin operation lock is poisoned".to_string()))
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
    }
    Ok(())
}

fn download_artifact(catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Denote plugin installer")
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
    if let Some(length) = response.content_length()
        && (length > MAX_PLUGIN_PACKAGE_BYTES as u64 || length != catalog.artifact.size_bytes)
    {
        return Err(AppError::Plugin(format!(
            "Plugin {} download size does not match catalog metadata",
            catalog.manifest.id
        )));
    }
    let bytes = response.bytes().map_err(|error| {
        AppError::Plugin(format!(
            "Unable to read plugin {} download: {error}",
            catalog.manifest.id
        ))
    })?;
    if bytes.len() > MAX_PLUGIN_PACKAGE_BYTES {
        return Err(AppError::Plugin(format!(
            "Plugin {} exceeds the package size limit",
            catalog.manifest.id
        )));
    }
    Ok(bytes.to_vec())
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
    if path.exists() && fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(AppError::Plugin(format!(
            "Plugin path cannot be a symbolic link: {}",
            path.display()
        )));
    }
    Ok(())
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

fn permission_tokens(manifest: &PluginManifest) -> AppResult<BTreeSet<String>> {
    manifest
        .permissions
        .iter()
        .map(|permission| {
            serde_json::to_string(permission).map_err(|error| {
                AppError::Plugin(format!(
                    "Unable to encode {} permission: {error}",
                    permission.capability
                ))
            })
        })
        .collect()
}

fn has_permission(
    catalog: &PluginCatalogEntry,
    approved: &BTreeSet<String>,
    capability: &str,
) -> AppResult<bool> {
    let Some(permission) = catalog
        .manifest
        .permissions
        .iter()
        .find(|permission| permission.capability == capability)
    else {
        return Ok(false);
    };
    Ok(
        approved.contains(&serde_json::to_string(permission).map_err(|error| {
            AppError::Plugin(format!("Unable to encode {capability} permission: {error}"))
        })?),
    )
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

fn keychain_entry(plugin_id: &str, key: &str) -> AppResult<Entry> {
    Entry::new(&format!("{KEYCHAIN_SERVICE_PREFIX}.{plugin_id}"), key).map_err(|error| {
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
    approved_permissions: Vec<String>,
) -> AppResult<InstalledPlugin> {
    let manager = state.inner().clone();
    run_blocking(move || manager.prepare(&plugin_id, approved_permissions)).await
}

#[tauri::command]
pub async fn commit_plugin_enable(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.commit_enable(&plugin_id)).await
}

#[tauri::command]
pub async fn rollback_plugin_enable(
    state: State<'_, PluginManager>,
    plugin_id: String,
    error: Option<String>,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.rollback_enable(&plugin_id, error)).await
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
        PluginManager {
            inner: Arc::new(PluginManagerInner {
                app_data_dir: data.path().to_path_buf(),
                app_cache_dir: cache.path().to_path_buf(),
                catalog: vec![catalog],
                state: Mutex::new(PersistentPluginState::default()),
                prepared_permissions: Mutex::new(BTreeMap::new()),
                operations: Mutex::new(HashSet::new()),
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
}
