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
        download_artifact, ensure_managed_directory, extract_archive, is_removal_backup_name,
        metadata_is_link, read_packaged_manifest, reject_symlink, remove_directory_atomically,
        sha256_file, validate_extracted_package, validate_installed_package, verify_artifact,
    },
    settings::{default_settings, migrate_settings, settings_schema_version},
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
        self.catalog_entries()?
            .into_iter()
            .map(|catalog| {
                let plugin_id = &catalog.manifest.id;
                let compatibility_error = compatibility_error(&catalog);
                let enabled = state.enabled.contains(plugin_id);
                let prepared_permissions = pending
                    .values()
                    .find(|transaction| transaction.plugin_id == *plugin_id)
                    .map(|transaction| transaction.permissions.clone());
                let runtime_manifest = prepared_permissions
                    .as_ref()
                    .map(|_| catalog.manifest.clone())
                    .or_else(|| state.installed_manifests.get(plugin_id).cloned());
                let installed = runtime_manifest
                    .as_ref()
                    .is_some_and(|manifest| self.install_dir_for_manifest(manifest).is_dir());
                let status = if initialization_error.is_some() {
                    "failed"
                } else if prepared_permissions.is_some() {
                    "installing"
                } else if enabled && installed && state.updates_available.contains(plugin_id) {
                    "update-available"
                } else if enabled && installed {
                    "enabled"
                } else if compatibility_error.is_some() {
                    "incompatible"
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
                    development: self.is_development_plugin(plugin_id)?,
                    catalog: catalog.clone(),
                    runtime_manifest: runtime_manifest.clone(),
                    status: status.to_string(),
                    enabled,
                    error: initialization_error
                        .clone()
                        .or_else(|| {
                            if enabled && installed {
                                None
                            } else {
                                compatibility_error
                            }
                        })
                        .or_else(|| state.errors.get(plugin_id).cloned()),
                    approved_permissions: prepared_permissions
                        .or_else(|| state.approved_permissions.get(plugin_id).cloned())
                        .unwrap_or_default()
                        .into_iter()
                        .collect(),
                    previously_approved: state.approved_permissions.contains_key(plugin_id),
                    settings: state
                        .settings
                        .get(plugin_id)
                        .cloned()
                        .and_then(|settings| {
                            migrate_settings(
                                runtime_manifest.as_ref().unwrap_or(&catalog.manifest),
                                settings,
                                state.settings_versions.get(plugin_id).copied(),
                            )
                            .ok()
                        })
                        .unwrap_or_else(|| {
                            default_settings(runtime_manifest.as_ref().unwrap_or(&catalog.manifest))
                        }),
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
        let catalog = self.catalog_entry(plugin_id)?;
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
        let state = self.state()?;
        let previously_enabled = state.enabled.contains(plugin_id);
        if previously_enabled && !state.updates_available.contains(plugin_id) {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is already enabled"
            )));
        }
        if previously_enabled
            && state
                .installed_manifests
                .get(plugin_id)
                .is_some_and(|manifest| manifest.version == catalog.manifest.version)
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} cannot replace an installed version without a version change"
            )));
        }
        drop(state);
        let transaction_id = Uuid::new_v4().to_string();
        self.pending_transactions()?.insert(
            transaction_id.clone(),
            PreparedPluginTransaction {
                plugin_id: plugin_id.to_string(),
                permissions: approved,
                artifact_sha256: catalog.artifact.sha256.clone(),
                catalog_fingerprint: catalog_fingerprint(&catalog)?,
                entrypoint_sha256: None,
                previously_enabled,
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
                if let Err(cleanup_error) = self.remove_installation(&catalog.manifest) {
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
        self.installed_plugin(&catalog, transaction_id.to_string())?;
        let saved_settings = self.state()?.settings.get(&plugin_id).cloned();
        let saved_version = self.state()?.settings_versions.get(&plugin_id).copied();
        let settings = match saved_settings {
            Some(settings) => migrate_settings(&catalog.manifest, settings, saved_version)?,
            None => default_settings(&catalog.manifest),
        };
        let settings_version = settings_schema_version(&catalog.manifest);
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
            state
                .installed_manifests
                .insert(plugin_id.clone(), catalog.manifest.clone());
            if self.is_development_plugin(&plugin_id)? {
                state.development_plugin_ids.insert(plugin_id.clone());
            } else {
                state.development_plugin_ids.remove(&plugin_id);
            }
            state.settings.insert(plugin_id.clone(), settings.clone());
            state
                .settings_versions
                .insert(plugin_id.clone(), settings_version);
            state.errors.remove(&plugin_id);
            Ok(())
        })?;
        transactions.remove(transaction_id);
        drop(transactions);
        self.finish_operation(&plugin_id)?;
        if let Err(error) = self.prune_plugin_versions(&catalog.manifest) {
            eprintln!("Unable to remove superseded plugin packages for {plugin_id}: {error}");
        }
        Ok(())
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
        let catalog = self.catalog_entry(&plugin_id)?;
        self.cancel_git_operations(&plugin_id);
        self.remove_installation(&catalog.manifest)?;
        self.update_state(|state| {
            if !transaction.previously_enabled {
                state.enabled.remove(&plugin_id);
                state.installed_manifests.remove(&plugin_id);
            }
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
        self.cancel_git_operations(plugin_id);
        self.remove_package(plugin_id)?;
        if clear_credentials {
            self.clear_credentials(plugin_id)?;
        }
        self.update_state(|state| {
            state.enabled.remove(plugin_id);
            state.updates_available.remove(plugin_id);
            state.entrypoint_hashes.remove(plugin_id);
            state.installed_manifests.remove(plugin_id);
            state.development_plugin_ids.remove(plugin_id);
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
        let manifest = self.runtime_manifest(plugin_id)?;
        let install_dir = self.install_dir_for_manifest(&manifest);
        let entrypoint = install_dir.join(&manifest.entrypoint);
        let canonical_root = fs::canonicalize(&install_dir)?;
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
        let bytes = match self.development_artifact_bytes(&catalog.manifest.id)? {
            Some(bytes) => bytes,
            None => download_artifact(catalog)?,
        };
        let cache_root = self.inner.app_cache_dir.join("plugin-downloads");
        ensure_managed_directory(&cache_root)?;
        let cache_dir = cache_root.join(&catalog.manifest.id);
        reject_symlink(&cache_dir)?;
        fs::create_dir_all(&cache_dir)?;
        let cache_path = cache_dir.join(format!(
            "{}-{}.tgz",
            catalog.manifest.version,
            Uuid::new_v4()
        ));
        let result = (|| {
            let mut file = AtomicWriteFile::options().open(&cache_path)?;
            file.write_all(&bytes)?;
            file.commit()?;
            Ok(fs::read(&cache_path)?)
        })();
        let cleanup = remove_managed_path(&cache_dir);
        match (result, cleanup) {
            (Ok(cached), Ok(())) => Ok(cached),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(cleanup_error)) => Err(AppError::Plugin(format!(
                "Unable to remove plugin download cache: {cleanup_error}"
            ))),
            (Err(error), Err(cleanup_error)) => Err(AppError::Plugin(format!(
                "{error}; additionally failed to remove the plugin download cache: {cleanup_error}"
            ))),
        }
    }

    pub(crate) fn remove_package(&self, plugin_id: &str) -> AppResult<()> {
        let plugin_root = self.plugin_root(plugin_id);
        let removal_error = if path_entry_exists(&plugin_root)? {
            reject_symlink(&plugin_root)
                .and_then(|_| remove_directory_atomically(&plugin_root))
                .err()
        } else {
            None
        };
        self.remove_plugin_transient_paths(plugin_id)?;
        if path_entry_exists(&plugin_root)? {
            return Err(removal_error.unwrap_or_else(|| {
                AppError::Plugin(format!(
                    "Unable to remove plugin package {}",
                    plugin_root.display()
                ))
            }));
        }
        Ok(())
    }

    fn remove_plugin_transient_paths(&self, plugin_id: &str) -> AppResult<()> {
        let cache_root = self.inner.app_cache_dir.join("plugin-downloads");
        ensure_managed_directory(&cache_root)?;
        remove_managed_path(&cache_root.join(plugin_id))?;

        let packages_dir = self.inner.app_data_dir.join("plugins").join("packages");
        ensure_managed_directory(&packages_dir)?;
        let removal_prefix = format!(".{plugin_id}.removing-");
        for entry in fs::read_dir(packages_dir)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(&removal_prefix)
            {
                remove_managed_path(&entry.path())?;
            }
        }
        Ok(())
    }

    fn remove_installation(&self, manifest: &super::types::PluginManifest) -> AppResult<()> {
        let install_dir = self.install_dir_for_manifest(manifest);
        if !install_dir.exists() {
            return Ok(());
        }
        reject_symlink(&install_dir)?;
        remove_directory_atomically(&install_dir)?;
        let plugin_root = self.plugin_root(&manifest.id);
        if plugin_root.is_dir() && fs::read_dir(&plugin_root)?.next().is_none() {
            fs::remove_dir(plugin_root)?;
        }
        Ok(())
    }

    fn prune_plugin_versions(&self, active: &super::types::PluginManifest) -> AppResult<()> {
        let plugin_root = self.plugin_root(&active.id);
        if !plugin_root.exists() {
            return Ok(());
        }
        reject_symlink(&plugin_root)?;
        for entry in fs::read_dir(&plugin_root)? {
            let path = entry?.path();
            if path == self.install_dir_for_manifest(active) {
                continue;
            }
            let metadata = fs::symlink_metadata(&path)?;
            if metadata_is_link(&metadata) || !metadata.is_dir() {
                return Err(AppError::Plugin(format!(
                    "Unsupported plugin package entry: {}",
                    path.display()
                )));
            }
            remove_directory_atomically(&path)?;
        }
        Ok(())
    }

    fn recover_installed_manifest(
        &self,
        plugin_id: &str,
    ) -> AppResult<Option<super::types::PluginManifest>> {
        if let Some(manifest) = self.state()?.installed_manifests.get(plugin_id).cloned() {
            return Ok(Some(manifest));
        }
        let approved = self
            .state()?
            .approved_permissions
            .get(plugin_id)
            .cloned()
            .unwrap_or_default();
        let expected_entrypoint_hash = self.state()?.entrypoint_hashes.get(plugin_id).cloned();
        let plugin_root = self.plugin_root(plugin_id);
        if !plugin_root.exists() {
            return Ok(None);
        }
        reject_symlink(&plugin_root)?;
        let mut candidates = Vec::new();
        for entry in fs::read_dir(&plugin_root)? {
            let path = entry?.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata_is_link(&metadata) || !metadata.is_dir() {
                continue;
            }
            let Ok(manifest) = read_packaged_manifest(&path) else {
                continue;
            };
            if manifest.id != plugin_id
                || path.file_name().and_then(|name| name.to_str())
                    != Some(manifest.version.as_str())
                || manifest
                    .permissions
                    .iter()
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    != approved
                || validate_installed_package(&manifest, &path).is_err()
            {
                continue;
            }
            let entrypoint_hash = sha256_file(&path.join(&manifest.entrypoint)).ok();
            if entrypoint_hash != expected_entrypoint_hash {
                continue;
            }
            candidates.push(manifest);
        }
        if candidates.len() != 1 {
            return Ok(None);
        }
        let manifest = candidates.remove(0);
        self.update_state(|state| {
            state
                .installed_manifests
                .insert(plugin_id.to_string(), manifest.clone());
            Ok(())
        })?;
        Ok(Some(manifest))
    }

    pub(crate) fn reconcile_packages(&self) -> AppResult<()> {
        self.remove_persisted_development_plugins()?;
        self.prune_transient_paths()?;
        let enabled = self.state()?.enabled.clone();
        let catalog_entries = self.catalog_entries()?;
        for catalog in &catalog_entries {
            let plugin_id = &catalog.manifest.id;
            let plugin_root = self.plugin_root(plugin_id);
            let requested_permissions: BTreeSet<PluginPermission> =
                catalog.manifest.permissions.iter().cloned().collect();
            let approved_permissions = self.state()?.approved_permissions.get(plugin_id).cloned();
            let artifact_hash = self.state()?.artifact_hashes.get(plugin_id).cloned();
            let entrypoint_hash = self.state()?.entrypoint_hashes.get(plugin_id).cloned();
            if enabled.contains(plugin_id) {
                let active_manifest = self.recover_installed_manifest(plugin_id)?;
                let installed_valid = active_manifest.as_ref().is_some_and(|manifest| {
                    let install_dir = self.install_dir_for_manifest(manifest);
                    let entrypoint_matches = match (
                        entrypoint_hash.as_deref(),
                        sha256_file(&install_dir.join(&manifest.entrypoint)),
                    ) {
                        (Some(expected), Ok(actual)) => actual == expected,
                        _ => false,
                    };
                    let approved_matches = approved_permissions.as_ref()
                        == Some(&manifest.permissions.iter().cloned().collect());
                    let mut installed_catalog = catalog.clone();
                    installed_catalog.manifest = manifest.clone();
                    installed_catalog.revoked = None;
                    let compatible = compatibility_error(&installed_catalog).is_none();
                    let explicitly_revoked =
                        catalog.revoked.is_some() && manifest.version == catalog.manifest.version;
                    install_dir.is_dir()
                        && validate_installed_package(manifest, &install_dir).is_ok()
                        && entrypoint_matches
                        && approved_matches
                        && compatible
                        && !explicitly_revoked
                });
                if !installed_valid {
                    if plugin_root.exists() {
                        self.remove_package(plugin_id)?;
                    }
                    self.update_state(|state| {
                        state.enabled.remove(plugin_id);
                        state.updates_available.insert(plugin_id.clone());
                        state.entrypoint_hashes.remove(plugin_id);
                        state.installed_manifests.remove(plugin_id);
                        state.errors.insert(
                            plugin_id.clone(),
                            "The installed plugin package is missing, incompatible, revoked, or failed its integrity check."
                                .to_string(),
                        );
                        Ok(())
                    })?;
                    continue;
                }
                let active_manifest = active_manifest.expect("validated installed manifest");
                let update_available = compatibility_error(catalog).is_none()
                    && (artifact_hash.as_deref() != Some(catalog.artifact.sha256.as_str())
                        || approved_permissions.as_ref() != Some(&requested_permissions));
                self.update_state(|state| {
                    if update_available {
                        state.updates_available.insert(plugin_id.clone());
                    } else {
                        state.updates_available.remove(plugin_id);
                    }
                    state.errors.remove(plugin_id);
                    Ok(())
                })?;
                self.prune_plugin_versions(&active_manifest)?;
            } else if approved_permissions.is_some() {
                if plugin_root.exists() {
                    self.remove_package(plugin_id)?;
                }
                let update_available = compatibility_error(catalog).is_none()
                    && (approved_permissions.as_ref() != Some(&requested_permissions)
                        || artifact_hash.as_deref() != Some(catalog.artifact.sha256.as_str()));
                self.update_state(|state| {
                    if update_available {
                        state.updates_available.insert(plugin_id.clone());
                    } else {
                        state.updates_available.remove(plugin_id);
                    }
                    state.entrypoint_hashes.remove(plugin_id);
                    state.installed_manifests.remove(plugin_id);
                    Ok(())
                })?;
            } else if plugin_root.exists() {
                self.remove_package(plugin_id)?;
            }
        }
        let known_ids: BTreeSet<String> = catalog_entries
            .iter()
            .map(|entry| entry.manifest.id.clone())
            .collect();
        let state_snapshot = self.state()?.clone();
        let mut orphaned_ids = BTreeSet::new();
        orphaned_ids.extend(state_snapshot.enabled.iter().cloned());
        orphaned_ids.extend(state_snapshot.development_plugin_ids.iter().cloned());
        orphaned_ids.extend(state_snapshot.updates_available.iter().cloned());
        orphaned_ids.extend(state_snapshot.approved_permissions.keys().cloned());
        orphaned_ids.extend(state_snapshot.artifact_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.catalog_fingerprints.keys().cloned());
        orphaned_ids.extend(state_snapshot.entrypoint_hashes.keys().cloned());
        orphaned_ids.extend(state_snapshot.installed_manifests.keys().cloned());
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
                state.development_plugin_ids.remove(&plugin_id);
                state.updates_available.remove(&plugin_id);
                state.approved_permissions.remove(&plugin_id);
                state.artifact_hashes.remove(&plugin_id);
                state.catalog_fingerprints.remove(&plugin_id);
                state.entrypoint_hashes.remove(&plugin_id);
                state.installed_manifests.remove(&plugin_id);
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
        let catalog_entries = self.catalog_entries()?;
        let known: BTreeSet<&str> = catalog_entries
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
                    if child_name.starts_with(".staging-")
                        || child_name.starts_with(".removing-")
                        || is_removal_backup_name(&child_name)
                    {
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

    fn remove_persisted_development_plugins(&self) -> AppResult<()> {
        let plugin_ids = self.state()?.development_plugin_ids.clone();
        for plugin_id in &plugin_ids {
            self.remove_package(plugin_id)?;
        }
        if plugin_ids.is_empty() {
            return Ok(());
        }
        self.update_state(|state| {
            for plugin_id in &plugin_ids {
                state.enabled.remove(plugin_id);
                state.development_plugin_ids.remove(plugin_id);
                state.updates_available.remove(plugin_id);
                state.approved_permissions.remove(plugin_id);
                state.artifact_hashes.remove(plugin_id);
                state.catalog_fingerprints.remove(plugin_id);
                state.entrypoint_hashes.remove(plugin_id);
                state.installed_manifests.remove(plugin_id);
                state.errors.remove(plugin_id);
            }
            Ok(())
        })
    }
}

fn remove_managed_path(path: &std::path::Path) -> AppResult<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata_is_link(&metadata) || metadata.is_file() {
        fs::remove_file(path)?;
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        return Err(AppError::Plugin(format!(
            "Unsupported plugin cleanup entry: {}",
            path.display()
        )));
    }
    Ok(())
}

fn path_entry_exists(path: &std::path::Path) -> AppResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}
