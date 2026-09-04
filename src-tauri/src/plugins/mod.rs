pub(crate) mod askpass;
mod auto_commit;
mod catalog;
mod clone;
mod commands;
mod git;
mod github;
mod lifecycle;
mod package;
mod sandbox;
mod settings;
mod tools;
mod types;

#[cfg(test)]
mod auto_commit_tests;
#[cfg(test)]
mod clone_tests;
#[cfg(test)]
mod git_tests;
#[cfg(test)]
mod tests;

pub use commands::*;
pub use tools::ToolStatus;
pub use types::*;

use catalog::{validate_bundles, validate_catalog};
use clone::CloneCleanupRegistry;
use git::GitOperationRegistry;
use package::ensure_managed_directory;
use sandbox::load_credential_ledger;

use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use atomic_write_file::AtomicWriteFile;
use fs2::FileExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

struct PluginManagerInner {
    app_data_dir: PathBuf,
    app_cache_dir: PathBuf,
    resource_dir: PathBuf,
    catalog: Vec<PluginCatalogEntry>,
    bundles: Vec<PluginBundle>,
    bundle_error: Option<String>,
    state: Mutex<PersistentPluginState>,
    pending_transactions: Mutex<BTreeMap<String, PreparedPluginTransaction>>,
    preparation_lock: Mutex<()>,
    operations: Mutex<HashSet<String>>,
    initialization_error: Mutex<Option<String>>,
    git_operations: GitOperationRegistry,
    /// Destinations of clones that failed, addressable only by opaque token.
    clone_cleanups: CloneCleanupRegistry,
    _process_lock: Option<fs::File>,
}

impl Drop for PluginManagerInner {
    fn drop(&mut self) {
        if let Some(lock) = &self._process_lock {
            let _ = lock.unlock();
        }
    }
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
    #[cfg(test)]
    pub fn new(app_data_dir: PathBuf, app_cache_dir: PathBuf) -> Self {
        Self::with_resource_dir(app_data_dir, app_cache_dir, PathBuf::new())
    }

    pub fn with_resource_dir(
        app_data_dir: PathBuf,
        app_cache_dir: PathBuf,
        resource_dir: PathBuf,
    ) -> Self {
        let (manager, initialized) = match Self::try_new(
            app_data_dir.clone(),
            app_cache_dir.clone(),
            resource_dir.clone(),
        ) {
            Ok(manager) => (manager, true),
            Err(error) => {
                eprintln!("Plugin manager started disabled: {error}");
                (
                        Self {
                            inner: Arc::new(PluginManagerInner {
                                app_data_dir,
                                app_cache_dir,
                                resource_dir,
                                catalog: vec![],
                                bundles: vec![],
                                bundle_error: Some(
                                    "Plugin bundle metadata is unavailable because the plugin manager failed to initialize."
                                        .to_string(),
                                ),
                                state: Mutex::new(PersistentPluginState::default()),
                                pending_transactions: Mutex::new(BTreeMap::new()),
                                preparation_lock: Mutex::new(()),
                                operations: Mutex::new(HashSet::new()),
                                initialization_error: Mutex::new(Some(error.to_string())),
                                git_operations: GitOperationRegistry::default(),
                                clone_cleanups: CloneCleanupRegistry::default(),
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

    fn try_new(
        app_data_dir: PathBuf,
        app_cache_dir: PathBuf,
        resource_dir: PathBuf,
    ) -> AppResult<Self> {
        let catalog: Vec<PluginCatalogEntry> = serde_json::from_str(CATALOG_JSON)
            .map_err(|error| AppError::Plugin(format!("Invalid embedded catalog: {error}")))?;
        validate_catalog(&catalog)?;
        let (bundles, bundle_error) = match serde_json::from_str::<Vec<PluginBundle>>(BUNDLES_JSON)
        {
            Ok(bundles) => match validate_bundles(&bundles, &catalog) {
                Ok(()) => (bundles, None),
                Err(error) => (
                    vec![],
                    Some(format!("Invalid embedded plugin bundles: {error}")),
                ),
            },
            Err(error) => (
                vec![],
                Some(format!("Invalid embedded plugin bundles: {error}")),
            ),
        };
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
        // Askpass material is deleted when its operation ends, so anything
        // still on disk is residue from a process that was killed. It is
        // removed here, once, only after this process holds the exclusive
        // manager lock, and never while Denote is running: a second manager
        // that loses the lock must not delete the secret a live instance is
        // currently authenticating with.
        askpass::remove_stale_material(&plugins_dir.join("git"));
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
                resource_dir,
                catalog,
                bundles,
                bundle_error,
                state: Mutex::new(state),
                pending_transactions: Mutex::new(BTreeMap::new()),
                preparation_lock: Mutex::new(()),
                operations: Mutex::new(HashSet::new()),
                initialization_error: Mutex::new(None),
                git_operations: GitOperationRegistry::default(),
                clone_cleanups: CloneCleanupRegistry::default(),
                _process_lock: Some(process_lock),
            }),
        };
        let state_snapshot = manager.state()?.clone();
        manager.save_credential_ledger(&state_snapshot)?;
        Ok(manager)
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

    pub(crate) fn bundles(&self) -> AppResult<Vec<PluginBundle>> {
        if let Some(error) = &self.inner.bundle_error {
            return Err(AppError::Plugin(error.clone()));
        }
        Ok(self.inner.bundles.clone())
    }
}
