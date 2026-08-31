use std::collections::{BTreeSet, HashSet};

use semver::Version;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

use super::{
    package::validate_relative_path,
    sandbox::{current_platform, platform_executable_is_absolute, valid_host_pattern},
    settings::{default_settings, validate_settings},
    types::{MAX_PLUGIN_PACKAGE_BYTES, PLUGIN_API_VERSION, PluginCatalogEntry, PluginPermission},
};

pub(crate) fn validate_catalog(catalog: &[PluginCatalogEntry]) -> AppResult<()> {
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
        if !entry.provenance.trusted
            || entry.provenance.publisher_id != "denote"
            || entry.provenance.source_commit.len() != 40
            || !entry
                .provenance
                .source_commit
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || !entry.artifact.url.contains(&format!(
                "/{}/plugin-artifacts/",
                entry.provenance.source_commit
            ))
            || entry.manifest.publisher.name != "Denote"
            || entry.manifest.repository != "https://github.com/mbianchidev/denote"
        {
            return Err(AppError::Plugin(format!(
                "Invalid trusted provenance for plugin {id}"
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
        for permission in &entry.manifest.permissions {
            match permission.capability.as_str() {
                "commands" | "sidebar" | "status" | "editor-decoration" | "note-events"
                | "workspace-read" | "workspace-write" | "clipboard-read" | "clipboard-write"
                | "notifications" | "secure-storage" => {
                    if !permission.hosts.is_empty() || !permission.executables.is_empty() {
                        return Err(AppError::Plugin(format!(
                            "Unexpected permission constraints for {id}: {}",
                            permission.capability
                        )));
                    }
                }
                "network" => {
                    if permission.hosts.is_empty()
                        || permission
                            .hosts
                            .iter()
                            .any(|host| !valid_host_pattern(host))
                    {
                        return Err(AppError::Plugin(format!(
                            "Invalid network host permission for {id}"
                        )));
                    }
                }
                "process" => {
                    if permission.executables.is_empty()
                        || permission
                            .executables
                            .iter()
                            .any(|(platform, executables)| {
                                !matches!(platform.as_str(), "macos" | "linux" | "windows")
                                    || executables.is_empty()
                                    || executables.iter().any(|executable| {
                                        !platform_executable_is_absolute(platform, executable)
                                    })
                            })
                    {
                        return Err(AppError::Plugin(format!(
                            "Invalid process executable permission for {id}"
                        )));
                    }
                }
                capability => {
                    return Err(AppError::Plugin(format!(
                        "Unsupported plugin capability for {id}: {capability}"
                    )));
                }
            }
        }
        validate_settings(&entry.manifest, default_settings(&entry.manifest))?;
    }
    Ok(())
}

pub(crate) fn catalog_fingerprint(catalog: &PluginCatalogEntry) -> AppResult<String> {
    let value = serde_json::to_vec(&(
        &catalog.manifest,
        &catalog.artifact,
        &catalog.provenance,
        &catalog.revoked,
    ))
    .map_err(|error| {
        AppError::Plugin(format!(
            "Unable to encode catalog fingerprint for {}: {error}",
            catalog.manifest.id
        ))
    })?;
    Ok(hex::encode(Sha256::digest(value)))
}

pub(crate) fn has_permission(
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

pub(crate) fn compatibility_error(catalog: &PluginCatalogEntry) -> Option<String> {
    let manifest = &catalog.manifest;
    if let Some(revocation) = &catalog.revoked {
        return Some(format!(
            "Plugin {} version {} was revoked: {}",
            manifest.id, manifest.version, revocation.reason
        ));
    }
    if catalog.manifest.permissions.iter().any(|permission| {
        permission.capability == "process"
            && !permission.executables.contains_key(current_platform())
    }) {
        return Some(format!(
            "Plugin {} does not support process execution on {}.",
            manifest.id,
            current_platform()
        ));
    }
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

pub(crate) fn valid_plugin_id(value: &str) -> bool {
    value.contains('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        && !value.starts_with(['.', '-'])
        && !value.ends_with(['.', '-'])
        && !value.contains("..")
        && !value.contains("--")
}
