use std::{fs, io::Read, path::Path};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    DevelopmentPluginPackage, PluginManager,
    catalog::validate_development_catalog_entry,
    package::{
        ensure_managed_directory, extract_archive, metadata_is_link, read_packaged_manifest,
        validate_extracted_package, validate_relative_path,
    },
    types::{MAX_PLUGIN_PACKAGE_BYTES, PluginArtifact, PluginCatalogEntry, PluginProvenance},
};

const MAX_DEVELOPMENT_GUIDE_BYTES: u64 = 1024 * 1024;

impl PluginManager {
    pub(crate) fn load_development_archive(&self, archive_path: &Path) -> AppResult<String> {
        let _preparation = self.preparation_lock()?;
        if let Some(error) = self.initialization_error()? {
            return Err(AppError::Plugin(error));
        }
        let metadata = fs::symlink_metadata(archive_path)?;
        if metadata_is_link(&metadata)
            || !metadata.is_file()
            || archive_path.extension().and_then(|value| value.to_str()) != Some("tgz")
            || metadata.len() == 0
            || metadata.len() > MAX_PLUGIN_PACKAGE_BYTES as u64
        {
            return Err(AppError::Plugin(
                "Development plugin archive must be a regular .tgz file within the package size limit"
                    .to_string(),
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        fs::File::open(archive_path)?
            .take(MAX_PLUGIN_PACKAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != metadata.len() {
            return Err(AppError::Plugin(
                "Development plugin archive changed while it was being read".to_string(),
            ));
        }

        let inspection_root = self
            .inner
            .app_cache_dir
            .join("plugin-development-inspection");
        ensure_managed_directory(&inspection_root)?;
        let staging = inspection_root.join(Uuid::new_v4().to_string());
        fs::create_dir(&staging)?;
        let result = (|| {
            extract_archive(&bytes, &staging)?;
            let manifest = read_packaged_manifest(&staging)?;
            validate_relative_path(&manifest.entrypoint)?;
            validate_relative_path(&manifest.documentation)?;
            validate_relative_path(&manifest.icon)?;
            let guide = read_package_text(
                &staging.join(&manifest.documentation),
                MAX_DEVELOPMENT_GUIDE_BYTES,
                "guide",
            )?;
            require_regular_package_file(&staging.join(&manifest.icon), "icon")?;
            let digest = hex::encode(Sha256::digest(&bytes));
            let catalog = PluginCatalogEntry {
                artifact: PluginArtifact {
                    url: format!(
                        "denote-development://archive/{}-{}.tgz",
                        manifest.id, manifest.version
                    ),
                    sha256: digest.clone(),
                    size_bytes: bytes.len() as u64,
                },
                provenance: PluginProvenance {
                    publisher_id: "development".to_string(),
                    source_commit: digest,
                    trusted: false,
                },
                revoked: None,
                guide,
                manifest,
            };
            validate_development_catalog_entry(&catalog)?;
            validate_extracted_package(&catalog, &staging)?;
            let plugin_id = catalog.manifest.id.clone();
            if self.state()?.enabled.contains(&plugin_id) {
                return Err(AppError::Plugin(format!(
                    "Disable {plugin_id} before loading a new development archive"
                )));
            }
            if self
                .pending_transactions()?
                .values()
                .any(|transaction| transaction.plugin_id == plugin_id)
                || self.operations()?.contains(&plugin_id)
            {
                return Err(AppError::Plugin(format!(
                    "Plugin {plugin_id} already has an operation in progress"
                )));
            }
            self.remove_package(&plugin_id)?;
            self.update_state(|state| {
                state.updates_available.remove(&plugin_id);
                state.entrypoint_hashes.remove(&plugin_id);
                state.installed_manifests.remove(&plugin_id);
                state.errors.remove(&plugin_id);
                Ok(())
            })?;
            self.development_plugins()?.insert(
                plugin_id.clone(),
                DevelopmentPluginPackage { catalog, bytes },
            );
            Ok(plugin_id)
        })();
        if let Err(error) = fs::remove_dir_all(&staging) {
            if result.is_ok() {
                return Err(AppError::Plugin(format!(
                    "Loaded the development plugin but could not remove inspection files: {error}"
                )));
            }
            eprintln!(
                "Unable to remove development plugin inspection folder {}: {error}",
                staging.display()
            );
        }
        result
    }
}

fn read_package_text(path: &Path, limit: u64, label: &str) -> AppResult<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() > limit {
        return Err(AppError::Plugin(format!(
            "Development plugin {label} is missing, unsafe, or too large"
        )));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    String::from_utf8(bytes).map_err(|error| {
        AppError::Plugin(format!(
            "Development plugin {label} is not valid UTF-8: {error}"
        ))
    })
}

fn require_regular_package_file(path: &Path, label: &str) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err(AppError::Plugin(format!(
            "Development plugin {label} is missing or unsafe"
        )));
    }
    Ok(())
}
