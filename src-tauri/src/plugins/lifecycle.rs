use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
};

use atomic_write_file::AtomicWriteFile;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    PluginManager, PreparedPluginTransaction,
    catalog::{catalog_fingerprint, compatibility_error},
    package::{
        download_artifact, ensure_managed_directory, extract_archive, metadata_is_link,
        reject_symlink, remove_directory_atomically, sha256_file, validate_extracted_package,
        verify_artifact,
    },
    settings::{default_settings, migrate_settings},
    types::{
        InstalledPlugin, MAX_PLUGIN_ENTRYPOINT_BYTES, PluginCatalogEntry, PluginPermission,
        PluginView,
    },
};

impl PluginManager {
    pub(crate) fn list(&self) -> AppResult<Vec<PluginView>> {
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
                let compatibility_error = compatibility_error(catalog);
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
                } else if state.updates_available.contains(plugin_id) {
                    "update-available"
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
                        .and_then(|settings| {
                            migrate_settings(
                                &catalog.manifest,
                                settings,
                                state.settings_versions.get(plugin_id).copied(),
                            )
                            .ok()
                        })
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

    pub(crate) fn prepare(
        &self,
        plugin_id: &str,
        approved_permissions: Vec<PluginPermission>,
    ) -> AppResult<InstalledPlugin> {
        let _preparation = self.preparation_lock()?;
        let mut operation = self.begin_operation(plugin_id)?;
        let catalog = self.catalog_entry(plugin_id)?.clone();
        if let Some(error) = compatibility_error(&catalog) {
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
                catalog_fingerprint: catalog_fingerprint(&catalog)?,
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

    pub(crate) fn commit_enable(&self, transaction_id: &str) -> AppResult<()> {
        let mut transactions = self.pending_transactions()?;
        let transaction = transactions.get(transaction_id).cloned().ok_or_else(|| {
            AppError::Plugin("Plugin enablement transaction is invalid or expired".to_string())
        })?;
        let plugin_id = transaction.plugin_id;
        let catalog = self.catalog_entry(&plugin_id)?;
        self.installed_plugin(catalog, transaction_id.to_string())?;
        self.update_state(|state| {
            state.enabled.insert(plugin_id.clone());
            state.updates_available.remove(&plugin_id);
            state
                .approved_permissions
                .insert(plugin_id.clone(), transaction.permissions);
            state
                .artifact_hashes
                .insert(plugin_id.clone(), transaction.artifact_sha256);
            state
                .catalog_fingerprints
                .insert(plugin_id.clone(), transaction.catalog_fingerprint);
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

    pub(crate) fn rollback_enable(
        &self,
        transaction_id: &str,
        error: Option<String>,
    ) -> AppResult<()> {
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

    pub(crate) fn recover_pending_transactions(&self) -> AppResult<()> {
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

    pub(crate) fn disable(
        &self,
        plugin_id: &str,
        clear_data: bool,
        clear_credentials: bool,
    ) -> AppResult<()> {
        let _operation = self.begin_operation(plugin_id)?;
        self.catalog_entry(plugin_id)?;
        self.remove_package(plugin_id)?;
        if clear_credentials {
            self.clear_credentials(plugin_id)?;
        }
        self.update_state(|state| {
            state.enabled.remove(plugin_id);
            state.updates_available.remove(plugin_id);
            state.approved_permissions.remove(plugin_id);
            state.artifact_hashes.remove(plugin_id);
            state.catalog_fingerprints.remove(plugin_id);
            state.entrypoint_hashes.remove(plugin_id);
            state.errors.remove(plugin_id);
            if clear_data {
                state.settings.remove(plugin_id);
                state.settings_versions.remove(plugin_id);
                state.storage.remove(plugin_id);
            }
            Ok(())
        })
    }

    pub(crate) fn read_entrypoint(&self, plugin_id: &str) -> AppResult<String> {
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

    pub(crate) fn expected_entrypoint_hash(&self, plugin_id: &str) -> AppResult<String> {
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

    pub(crate) fn install_package(
        &self,
        catalog: &PluginCatalogEntry,
        bytes: &[u8],
    ) -> AppResult<String> {
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

    pub(crate) fn download_to_cache(&self, catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
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

    pub(crate) fn remove_package(&self, plugin_id: &str) -> AppResult<()> {
        let plugin_root = self.plugin_root(plugin_id);
        if !plugin_root.exists() {
            return Ok(());
        }
        reject_symlink(&plugin_root)?;
        remove_directory_atomically(&plugin_root)
    }

    pub(crate) fn reconcile_packages(&self) -> AppResult<()> {
        self.prune_transient_paths()?;
        let enabled = self.state()?.enabled.clone();
        for catalog in &self.inner.catalog {
            let plugin_id = &catalog.manifest.id;
            let plugin_root = self.plugin_root(plugin_id);
            let requested_permissions: BTreeSet<PluginPermission> =
                catalog.manifest.permissions.iter().cloned().collect();
            let approved_permissions = self.state()?.approved_permissions.get(plugin_id).cloned();
            let artifact_hash = self.state()?.artifact_hashes.get(plugin_id).cloned();
            let stored_catalog_fingerprint =
                self.state()?.catalog_fingerprints.get(plugin_id).cloned();
            let expected_catalog_fingerprint = catalog_fingerprint(catalog)?;
            let entrypoint_hash = self.state()?.entrypoint_hashes.get(plugin_id).cloned();
            if let Some(error) = compatibility_error(catalog) {
                if plugin_root.exists() {
                    self.remove_package(plugin_id)?;
                }
                self.update_state(|state| {
                    state.enabled.remove(plugin_id);
                    state.updates_available.remove(plugin_id);
                    state.approved_permissions.remove(plugin_id);
                    state.artifact_hashes.remove(plugin_id);
                    state.catalog_fingerprints.remove(plugin_id);
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
                    state.updates_available.insert(plugin_id.clone());
                    state.approved_permissions.remove(plugin_id);
                    state.artifact_hashes.remove(plugin_id);
                    state.catalog_fingerprints.remove(plugin_id);
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
                    && stored_catalog_fingerprint.as_deref()
                        == Some(expected_catalog_fingerprint.as_str())
                    && entrypoint_matches;
                if !installed_valid {
                    if plugin_root.exists() {
                        self.remove_package(plugin_id)?;
                    }
                    self.update_state(|state| {
                        state.enabled.remove(plugin_id);
                        state.updates_available.insert(plugin_id.clone());
                        state.approved_permissions.remove(plugin_id);
                        state.artifact_hashes.remove(plugin_id);
                        state.catalog_fingerprints.remove(plugin_id);
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
        orphaned_ids.extend(state_snapshot.updates_available.iter().cloned());
        orphaned_ids.extend(state_snapshot.approved_permissions.keys().cloned());
        orphaned_ids.extend(state_snapshot.artifact_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.catalog_fingerprints.keys().cloned());
        orphaned_ids.extend(state_snapshot.entrypoint_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.settings.keys().cloned());
        orphaned_ids.extend(state_snapshot.settings_versions.keys().cloned());
        orphaned_ids.extend(state_snapshot.storage.keys().cloned());
        orphaned_ids.extend(state_snapshot.credential_keys.keys().cloned());
        orphaned_ids.extend(state_snapshot.pending_credential_keys.keys().cloned());
        orphaned_ids.retain(|plugin_id| !known_ids.contains(plugin_id));
        for plugin_id in orphaned_ids {
            self.clear_credentials(&plugin_id)?;
            self.update_state(|state| {
                state.enabled.remove(&plugin_id);
                state.updates_available.remove(&plugin_id);
                state.approved_permissions.remove(&plugin_id);
                state.artifact_hashes.remove(&plugin_id);
                state.catalog_fingerprints.remove(&plugin_id);
                state.entrypoint_hashes.remove(&plugin_id);
                state.settings.remove(&plugin_id);
                state.settings_versions.remove(&plugin_id);
                state.storage.remove(&plugin_id);
                state.errors.remove(&plugin_id);
                Ok(())
            })?;
        }
        Ok(())
    }

    pub(crate) fn prune_transient_paths(&self) -> AppResult<()> {
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
}
