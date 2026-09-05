use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
    time::Duration,
};

use flate2::read::GzDecoder;
use reqwest::{Url, blocking::Client, header::LOCATION, redirect::Policy};
use sha2::{Digest, Sha256};
use tar::Archive;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::types::{
    MAX_PLUGIN_ENTRYPOINT_BYTES, MAX_PLUGIN_PACKAGE_BYTES, PluginCatalogEntry, PluginManifest,
};

const PLUGIN_DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];
const MAX_PLUGIN_DOWNLOAD_REDIRECTS: usize = 4;

pub(crate) fn download_artifact(catalog: &PluginCatalogEntry) -> AppResult<Vec<u8>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Denote plugin installer")
        .redirect(Policy::none())
        .build()
        .map_err(|error| AppError::Plugin(format!("Unable to create HTTP client: {error}")))?;
    let mut url = Url::parse(&catalog.artifact.url)
        .map_err(|error| AppError::Plugin(format!("Invalid plugin download URL: {error}")))?;
    for redirects in 0..=MAX_PLUGIN_DOWNLOAD_REDIRECTS {
        validate_plugin_download_url(&url)?;
        let response = client.get(url.clone()).send().map_err(|error| {
            AppError::Plugin(format!(
                "Unable to download plugin {}: {error}",
                catalog.manifest.id
            ))
        })?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    AppError::Plugin(format!(
                        "Plugin {} download returned an invalid redirect",
                        catalog.manifest.id
                    ))
                })?;
            if redirects == MAX_PLUGIN_DOWNLOAD_REDIRECTS {
                break;
            }
            url = url.join(location).map_err(|error| {
                AppError::Plugin(format!(
                    "Plugin {} download redirect is invalid: {error}",
                    catalog.manifest.id
                ))
            })?;
            continue;
        }
        if !response.status().is_success() {
            return Err(AppError::Plugin(format!(
                "Plugin download returned HTTP {} for {}@{} at {}. The published archive must be available before installation",
                response.status(),
                catalog.manifest.id,
                catalog.manifest.version,
                catalog.artifact.url
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
        return Ok(bytes);
    }
    Err(AppError::Plugin(format!(
        "Plugin {} download exceeded the redirect limit",
        catalog.manifest.id
    )))
}

pub(crate) fn validate_plugin_download_url(url: &Url) -> AppResult<()> {
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.port().is_some()
        || !url
            .host_str()
            .is_some_and(|host| PLUGIN_DOWNLOAD_HOSTS.contains(&host))
    {
        return Err(AppError::Plugin(
            "Plugin download URL is outside the approved GitHub HTTPS hosts".to_string(),
        ));
    }
    Ok(())
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
    let manifest = read_packaged_manifest(staging)?;
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

pub(crate) fn validate_installed_package(
    expected: &PluginManifest,
    package_dir: &Path,
) -> AppResult<()> {
    let manifest = read_packaged_manifest(package_dir)?;
    let actual = serde_json::to_value(&manifest).map_err(|error| {
        AppError::Plugin(format!(
            "Unable to compare packaged plugin manifest: {error}"
        ))
    })?;
    let expected = serde_json::to_value(expected).map_err(|error| {
        AppError::Plugin(format!(
            "Unable to compare installed plugin manifest: {error}"
        ))
    })?;
    if actual != expected {
        return Err(AppError::Plugin(format!(
            "Installed manifest does not match recorded metadata for {}",
            manifest.id
        )));
    }
    let entrypoint = package_dir.join(&manifest.entrypoint);
    let metadata = fs::symlink_metadata(&entrypoint)?;
    if !metadata.is_file() || metadata.len() > MAX_PLUGIN_ENTRYPOINT_BYTES {
        return Err(AppError::Plugin(format!(
            "Plugin {} has an invalid entrypoint",
            manifest.id
        )));
    }
    Ok(())
}

pub(crate) fn read_packaged_manifest(package_dir: &Path) -> AppResult<PluginManifest> {
    serde_json::from_slice(&fs::read(package_dir.join("plugin.json"))?)
        .map_err(|error| AppError::Plugin(format!("Invalid packaged plugin manifest: {error}")))
}

pub(crate) fn remove_directory_atomically(path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Plugin("Plugin folder has no parent".to_string()))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::Plugin("Plugin folder has no name".to_string()))?
        .to_string_lossy();
    let removing = parent.join(format!(".{name}.removing-{}", Uuid::new_v4()));
    fs::rename(path, &removing)?;
    fs::remove_dir_all(removing)?;
    Ok(())
}

pub(crate) fn is_removal_backup_name(name: &str) -> bool {
    name.starts_with('.') && name.contains(".removing-")
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
