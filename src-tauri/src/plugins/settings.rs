use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    sandbox::enforce_storage_quota,
    types::{MAX_PLUGIN_SETTINGS_BYTES, PluginManifest},
};

/// Reserved settings key that names the Git executable a user selected. It is
/// host-owned: a plugin declares it as a string setting with an empty default,
/// the user fills it in through Denote's own settings surface, and a Git
/// request can never name an executable itself.
pub(crate) const GIT_EXECUTABLE_SETTING: &str = "gitExecutablePath";

/// Reserved settings key that names the GitHub CLI executable a user selected.
/// It is host-owned in exactly the same way as the Git executable: a plugin
/// declares the key, the user fills it in, and no request can name a binary.
pub(crate) const GITHUB_EXECUTABLE_SETTING: &str = "githubExecutablePath";
pub(crate) const USE_SYSTEM_GIT_SETTINGS: &str = "useSystemGitSettings";
pub(crate) const COMMIT_SIGNING_SETTING: &str = "commitSigning";
pub(crate) const GPG_SIGNING_KEY_SETTING: &str = "gpgSigningKey";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GitCommitSigningMode {
    System,
    Always,
    Never,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GitSettingsPolicy {
    pub(crate) use_system_settings: bool,
    pub(crate) signing: GitCommitSigningMode,
    pub(crate) signing_key: Option<String>,
}

impl PluginManager {
    pub(crate) fn settings(&self, plugin_id: &str) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        let saved = self.state()?.settings.get(plugin_id).cloned();
        let saved_version = self.state()?.settings_versions.get(plugin_id).copied();
        let normalized = match saved.clone() {
            Some(settings) => migrate_settings(&catalog.manifest, settings, saved_version)?,
            None => validate_settings(&catalog.manifest, default_settings(&catalog.manifest))?,
        };
        let target_version = settings_schema_version(&catalog.manifest);
        if saved.as_ref() != Some(&normalized) || saved_version != Some(target_version) {
            self.update_state(|state| {
                state
                    .settings
                    .insert(plugin_id.to_string(), normalized.clone());
                state
                    .settings_versions
                    .insert(plugin_id.to_string(), target_version);
                Ok(())
            })?;
        }
        Ok(normalized)
    }

    pub(crate) fn set_settings(&self, plugin_id: &str, settings: Value) -> AppResult<Value> {
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
            state.settings_versions.insert(
                plugin_id.to_string(),
                settings_schema_version(&catalog.manifest),
            );
            Ok(())
        })?;
        Ok(settings)
    }

    pub(crate) fn import_settings(
        &self,
        plugin_id: &str,
        source_version: u32,
        settings: Value,
    ) -> AppResult<Value> {
        let catalog = self.catalog_entry(plugin_id)?;
        let settings = migrate_settings(&catalog.manifest, settings, Some(source_version))?;
        if serde_json::to_vec(&settings)
            .map_err(|error| AppError::Plugin(format!("Unable to size settings: {error}")))?
            .len()
            > MAX_PLUGIN_SETTINGS_BYTES
        {
            return Err(AppError::Plugin(format!(
                "Settings for {plugin_id} exceed the size limit"
            )));
        }
        let target_version = settings_schema_version(&catalog.manifest);
        self.update_state(|state| {
            state
                .settings
                .insert(plugin_id.to_string(), settings.clone());
            state
                .settings_versions
                .insert(plugin_id.to_string(), target_version);
            Ok(())
        })?;
        Ok(settings)
    }

    /// Reads the reserved Git executable path from this plugin's validated
    /// persisted settings. Absent, non-string, and empty values all mean the
    /// host resolves Git from its own fixed locations, so the default of an
    /// empty string keeps ordinary installs on the pinned executable.
    pub(crate) fn git_executable_setting(&self, plugin_id: &str) -> AppResult<Option<String>> {
        let settings = self.settings(plugin_id)?;
        Ok(settings
            .get(GIT_EXECUTABLE_SETTING)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string))
    }

    /// Reads the reserved GitHub CLI path the same way, so an unset value keeps
    /// the host resolving `gh` from its own fixed locations.
    pub(crate) fn github_executable_setting(&self, plugin_id: &str) -> AppResult<Option<String>> {
        let settings = self.settings(plugin_id)?;
        Ok(settings
            .get(GITHUB_EXECUTABLE_SETTING)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string))
    }

    pub(crate) fn git_settings_policy(&self, plugin_id: &str) -> AppResult<GitSettingsPolicy> {
        let settings = self.settings(plugin_id)?;
        let use_system_settings = settings
            .get(USE_SYSTEM_GIT_SETTINGS)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let signing = match settings
            .get(COMMIT_SIGNING_SETTING)
            .and_then(Value::as_str)
            .unwrap_or("never")
        {
            "always" => GitCommitSigningMode::Always,
            "never" => GitCommitSigningMode::Never,
            _ => GitCommitSigningMode::System,
        };
        let signing_key = settings
            .get(GPG_SIGNING_KEY_SETTING)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if signing_key.as_ref().is_some_and(|value| {
            value.len() > 255 || value.starts_with('-') || value.chars().any(char::is_control)
        }) {
            return Err(AppError::Plugin(
                "The configured GPG signing key is invalid".to_string(),
            ));
        }
        Ok(GitSettingsPolicy {
            use_system_settings,
            signing,
            signing_key,
        })
    }

    pub(crate) fn storage_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<Value>> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        Ok(self
            .state()?
            .storage
            .get(plugin_id)
            .and_then(|storage| storage.get(key).cloned()))
    }

    pub(crate) fn storage_set(&self, plugin_id: &str, key: &str, value: Value) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        self.update_state(|state| {
            let storage = state.storage.entry(plugin_id.to_string()).or_default();
            enforce_storage_quota(storage, key, &value)?;
            storage.insert(key.to_string(), value);
            Ok(())
        })
    }

    pub(crate) fn storage_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        validate_storage_key(key)?;
        self.update_state(|state| {
            if let Some(storage) = state.storage.get_mut(plugin_id) {
                storage.remove(key);
            }
            Ok(())
        })
    }

    pub(crate) fn storage_clear(&self, plugin_id: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, None)?;
        self.update_state(|state| {
            state.storage.remove(plugin_id);
            Ok(())
        })
    }
}

pub(crate) fn default_settings(manifest: &PluginManifest) -> Value {
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

pub(crate) fn settings_schema_version(manifest: &PluginManifest) -> u32 {
    manifest
        .settings
        .as_ref()
        .and_then(|settings| settings.get("version"))
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(0)
}

pub(crate) fn migrate_settings(
    manifest: &PluginManifest,
    settings: Value,
    stored_version: Option<u32>,
) -> AppResult<Value> {
    let target_version = settings_schema_version(manifest);
    if target_version == 0 {
        return validate_settings(manifest, settings);
    }
    let mut current_version = stored_version.unwrap_or(1);
    if current_version > target_version {
        return Err(AppError::Plugin(format!(
            "Stored settings for {} use newer schema version {}",
            manifest.id, current_version
        )));
    }
    let mut object = settings.as_object().cloned().ok_or_else(|| {
        AppError::Plugin(format!("Settings for {} must be an object", manifest.id))
    })?;
    while current_version < target_version {
        let migration = manifest
            .settings
            .as_ref()
            .and_then(|schema| schema.get("migrations"))
            .and_then(Value::as_array)
            .and_then(|migrations| {
                migrations.iter().find(|migration| {
                    migration.get("from").and_then(Value::as_u64)
                        == Some(u64::from(current_version))
                        && migration.get("to").and_then(Value::as_u64)
                            == Some(u64::from(current_version + 1))
                })
            })
            .ok_or_else(|| {
                AppError::Plugin(format!(
                    "Plugin {} is missing settings migration {} → {}",
                    manifest.id,
                    current_version,
                    current_version + 1
                ))
            })?;
        if let Some(rename) = migration.get("rename").and_then(Value::as_object) {
            for (from, to) in rename {
                if let Some(to) = to.as_str()
                    && let Some(value) = object.remove(from)
                {
                    object.entry(to.to_string()).or_insert(value);
                }
            }
        }
        if let Some(remove) = migration.get("remove").and_then(Value::as_array) {
            for key in remove.iter().filter_map(Value::as_str) {
                object.remove(key);
            }
        }
        if let Some(defaults) = migration.get("defaults").and_then(Value::as_object) {
            for (key, value) in defaults {
                object.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        current_version += 1;
    }
    validate_settings(manifest, Value::Object(object))
}

pub(crate) fn validate_settings(manifest: &PluginManifest, settings: Value) -> AppResult<Value> {
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

pub(crate) fn validate_storage_key(key: &str) -> AppResult<()> {
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
