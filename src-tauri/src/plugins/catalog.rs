use std::collections::{BTreeSet, HashSet};

use semver::Version;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

use super::{
    package::validate_relative_path,
    sandbox::{current_platform, platform_executable_is_absolute, valid_host_pattern},
    settings::{default_settings, validate_settings},
    types::{
        MAX_PLUGIN_PACKAGE_BYTES, PLUGIN_API_VERSION, PluginBundle, PluginCatalogEntry,
        PluginPermission,
    },
};

const PLUGIN_CATEGORIES: &[&str] = &[
    "code",
    "productivity",
    "knowledge-management",
    "editor-writing",
    "diagrams-visualization",
    "collaboration",
    "accessibility",
    "security-privacy",
    "other",
];

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
                "commands"
                | "sidebar"
                | "status"
                | "editor-decoration"
                | "note-events"
                | "project-context"
                | "source-control"
                | "automatic-local-commit"
                | "workspace-read"
                | "workspace-write"
                | "clipboard-read"
                | "clipboard-write"
                | "notifications"
                | "secure-storage" => {
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

pub(crate) fn validate_bundles(
    bundles: &[PluginBundle],
    catalog: &[PluginCatalogEntry],
) -> AppResult<()> {
    let catalog_ids = catalog
        .iter()
        .map(|entry| entry.manifest.id.as_str())
        .collect::<HashSet<_>>();
    let mut bundle_ids = HashSet::new();
    let mut bundle_names = HashSet::new();
    for bundle in bundles {
        if !valid_stable_id(&bundle.id) || !bundle_ids.insert(bundle.id.as_str()) {
            return Err(AppError::Plugin(format!(
                "Invalid or duplicate plugin bundle ID: {}",
                bundle.id
            )));
        }
        let bundle_name = normalized_name(&bundle.name).ok_or_else(|| {
            AppError::Plugin(format!("Plugin bundle {} has an empty name", bundle.id))
        })?;
        if !bundle_names.insert(bundle_name) {
            return Err(AppError::Plugin(format!(
                "Duplicate plugin bundle name: {}",
                bundle.name
            )));
        }
        let mut categories = HashSet::new();
        for category in &bundle.categories {
            if !PLUGIN_CATEGORIES.contains(&category.as_str())
                || !categories.insert(category.as_str())
            {
                return Err(AppError::Plugin(format!(
                    "Invalid or duplicate category {category} in plugin bundle {}",
                    bundle.id
                )));
            }
        }
        if bundle.roles.is_empty() {
            return Err(AppError::Plugin(format!(
                "Plugin bundle {} must define at least one role",
                bundle.id
            )));
        }
        let mut role_ids = HashSet::new();
        let mut role_names = HashSet::new();
        for role in &bundle.roles {
            if !valid_stable_id(&role.id) || !role_ids.insert(role.id.as_str()) {
                return Err(AppError::Plugin(format!(
                    "Invalid or duplicate role ID {} in plugin bundle {}",
                    role.id, bundle.id
                )));
            }
            let normalized_role_name = normalized_name(&role.name).ok_or_else(|| {
                AppError::Plugin(format!(
                    "Role {} in plugin bundle {} has an empty name",
                    role.id, bundle.id
                ))
            })?;
            if !role_names.insert(normalized_role_name) {
                return Err(AppError::Plugin(format!(
                    "Duplicate role name {} in plugin bundle {}",
                    role.name, bundle.id
                )));
            }
            let mut candidates = HashSet::new();
            for candidate in &role.candidate_plugin_ids {
                if !candidates.insert(candidate.as_str()) {
                    return Err(AppError::Plugin(format!(
                        "Duplicate candidate {candidate} in plugin bundle {} role {}",
                        bundle.id, role.id
                    )));
                }
                if !catalog_ids.contains(candidate.as_str()) {
                    return Err(AppError::Plugin(format!(
                        "Unknown catalog plugin {candidate} in plugin bundle {} role {}",
                        bundle.id, role.id
                    )));
                }
            }
        }
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

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
}

fn normalized_name(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_lowercase())
}
