use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
    time::Duration,
};

use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use tar::Archive;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::types::{
    MAX_PLUGIN_ENTRYPOINT_BYTES, MAX_PLUGIN_PACKAGE_BYTES, PluginCatalogEntry, PluginManifest,
};

pub(crate) fn download_artifact(catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
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

pub(crate) fn verify_artifact(catalog: &PluginCatalogEntry, bytes: &[u8]) -> AppResult<()> {
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

pub(crate) fn sha256_file(path: &Path) -> AppResult<String> {
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

pub(crate) fn extract_archive(bytes: &[u8], staging: &Path) -> AppResult<()> {
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

pub(crate) fn validate_extracted_package(
    catalog: &PluginCatalogEntry,
    staging: &Path,
) -> AppResult<()> {
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

pub(crate) fn remove_directory_atomically(path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Plugin("Plugin folder has no parent".to_string()))?;
    let removing = parent.join(format!(".removing-{}", Uuid::new_v4()));
    fs::rename(path, &removing)?;
    fs::remove_dir_all(removing)?;
    Ok(())
}

pub(crate) fn reject_symlink(path: &Path) -> AppResult<()> {
    if path.exists() && metadata_is_link(&fs::symlink_metadata(path)?) {
        return Err(AppError::Plugin(format!(
            "Plugin path cannot be a symbolic link: {}",
            path.display()
        )));
    }
    Ok(())
}

pub(crate) fn ensure_managed_directory(path: &Path) -> AppResult<()> {
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

pub(crate) fn metadata_is_link(metadata: &fs::Metadata) -> bool {
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

pub(crate) fn validate_archive_path(path: &Path) -> AppResult<()> {
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

pub(crate) fn validate_relative_path(path: &str) -> AppResult<()> {
    validate_archive_path(Path::new(path))
}
