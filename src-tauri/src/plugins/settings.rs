use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    sandbox::enforce_storage_quota,
    tools::{self, ExecutableMode, ToolKind, ToolStatus},
    types::{MAX_PLUGIN_SETTINGS_BYTES, PluginManifest},
};

/// Reserved settings key that names the Git executable a user selected. It is
/// host-owned: a plugin declares it as a string setting with an empty default,
/// the user fills it in through Denote's own settings surface, and a Git
/// request can never name an executable itself.
pub(crate) const GIT_EXECUTABLE_SETTING: &str = "gitExecutablePath";
pub(crate) const GIT_EXECUTABLE_MODE_SETTING: &str = "gitExecutableMode";

/// Reserved settings key that names the GitHub CLI executable a user selected.
/// It is host-owned in exactly the same way as the Git executable: a plugin
/// declares the key, the user fills it in, and no request can name a binary.
pub(crate) const GITHUB_EXECUTABLE_SETTING: &str = "githubExecutablePath";
pub(crate) const GITHUB_EXECUTABLE_MODE_SETTING: &str = "githubExecutableMode";
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
        let manifest = self.runtime_manifest(plugin_id)?;
        let preparing = self
            .pending_transactions()?
            .values()
            .any(|transaction| transaction.plugin_id == plugin_id);
        let saved = self.state()?.settings.get(plugin_id).cloned();
        let saved_version = self.state()?.settings_versions.get(plugin_id).copied();
        let normalized = match saved.clone() {
            Some(settings) => migrate_settings(&manifest, settings, saved_version)?,
            None => validate_settings(&manifest, default_settings(&manifest))?,
        };
        let target_version = settings_schema_version(&manifest);
        if !preparing
            && (saved.as_ref() != Some(&normalized) || saved_version != Some(target_version))
        {
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
        let manifest = self.runtime_manifest(plugin_id)?;
        let settings = validate_settings(
            &manifest,
            normalize_legacy_executable_settings(&manifest, settings)?,
        )?;
        self.validate_executable_settings(plugin_id, &settings)?;
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
            state
                .settings_versions
                .insert(plugin_id.to_string(), settings_schema_version(&manifest));
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
        let manifest = self.runtime_manifest(plugin_id)?;
        let settings = migrate_settings(&manifest, settings, Some(source_version))?;
        self.validate_executable_settings(plugin_id, &settings)?;
        if serde_json::to_vec(&settings)
            .map_err(|error| AppError::Plugin(format!("Unable to size settings: {error}")))?
            .len()
            > MAX_PLUGIN_SETTINGS_BYTES
        {
            return Err(AppError::Plugin(format!(
                "Settings for {plugin_id} exceed the size limit"
            )));
        }
        let target_version = settings_schema_version(&manifest);
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

    pub(crate) fn git_executable_mode(&self, plugin_id: &str) -> AppResult<ExecutableMode> {
        let settings = self.settings(plugin_id)?;
        if settings.get(GIT_EXECUTABLE_MODE_SETTING).is_none()
            && settings
                .get(GIT_EXECUTABLE_SETTING)
                .and_then(Value::as_str)
                .is_some_and(|path| !path.trim().is_empty())
        {
            return Ok(ExecutableMode::Custom);
        }
        Ok(ExecutableMode::parse(
            settings
                .get(GIT_EXECUTABLE_MODE_SETTING)
                .and_then(Value::as_str),
            ExecutableMode::Bundled,
        ))
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

    pub(crate) fn github_executable_mode(&self, plugin_id: &str) -> AppResult<ExecutableMode> {
        let settings = self.settings(plugin_id)?;
        if settings.get(GITHUB_EXECUTABLE_MODE_SETTING).is_none()
            && settings
                .get(GITHUB_EXECUTABLE_SETTING)
                .and_then(Value::as_str)
                .is_some_and(|path| !path.trim().is_empty())
        {
            return Ok(ExecutableMode::Custom);
        }
        Ok(ExecutableMode::parse(
            settings
                .get(GITHUB_EXECUTABLE_MODE_SETTING)
                .and_then(Value::as_str),
            ExecutableMode::Disabled,
        ))
    }

    pub(crate) fn resolve_git_executable_for_plugin(
        &self,
        plugin_id: &str,
    ) -> AppResult<std::path::PathBuf> {
        let mode = self.git_executable_mode(plugin_id)?;
        let path = self.git_executable_setting(plugin_id)?;
        #[cfg(test)]
        let mode =
            if self.inner.resource_dir.as_os_str().is_empty() && mode == ExecutableMode::Bundled {
                ExecutableMode::System
            } else {
                mode
            };
        tools::resolve_git(
            &self.inner.resource_dir,
            &self.inner.app_data_dir.join("plugins").join("tools"),
            &self.inner.app_cache_dir.join("plugin-tools"),
            mode,
            path.as_deref(),
        )
    }

    pub(crate) fn resolve_github_executable_for_plugin(
        &self,
        plugin_id: &str,
    ) -> AppResult<std::path::PathBuf> {
        let mode = self.github_executable_mode(plugin_id)?;
        let path = self.github_executable_setting(plugin_id)?;
        #[cfg(test)]
        let mode =
            if self.inner.resource_dir.as_os_str().is_empty() && mode == ExecutableMode::Bundled {
                ExecutableMode::System
            } else {
                mode
            };
        tools::resolve_gh(
            &self.inner.resource_dir,
            &self.inner.app_data_dir.join("plugins").join("tools"),
            &self.inner.app_cache_dir.join("plugin-tools"),
            mode,
            path.as_deref(),
        )
    }

    pub(crate) fn tool_statuses(&self, plugin_id: &str) -> AppResult<Vec<ToolStatus>> {
        self.catalog_entry(plugin_id)?;
        let git_mode = self.git_executable_mode(plugin_id)?;
        let git_path = self.git_executable_setting(plugin_id)?;
        let github_mode = self.github_executable_mode(plugin_id)?;
        let github_path = self.github_executable_setting(plugin_id)?;
        Ok(vec![
            tools::inspect(
                &self.inner.resource_dir,
                &self.inner.app_data_dir.join("plugins").join("tools"),
                ToolKind::Git,
                git_mode,
                git_path.as_deref(),
            ),
            tools::inspect(
                &self.inner.resource_dir,
                &self.inner.app_data_dir.join("plugins").join("tools"),
                ToolKind::GitHubCli,
                github_mode,
                github_path.as_deref(),
            ),
        ])
    }

    fn validate_executable_settings(&self, plugin_id: &str, settings: &Value) -> AppResult<()> {
        if plugin_id != "denote.git" {
            return Ok(());
        }
        let git_mode = ExecutableMode::parse(
            settings
                .get(GIT_EXECUTABLE_MODE_SETTING)
                .and_then(Value::as_str),
            ExecutableMode::Bundled,
        );
        let git_path = settings.get(GIT_EXECUTABLE_SETTING).and_then(Value::as_str);
        if git_mode == ExecutableMode::Custom {
            tools::resolve_git(
                &self.inner.resource_dir,
                &self.inner.app_data_dir.join("plugins").join("tools"),
                &self.inner.app_cache_dir.join("plugin-tools"),
                git_mode,
                git_path,
            )?;
        }
        let github_mode = ExecutableMode::parse(
            settings
                .get(GITHUB_EXECUTABLE_MODE_SETTING)
                .and_then(Value::as_str),
            ExecutableMode::Disabled,
        );
        let github_path = settings
            .get(GITHUB_EXECUTABLE_SETTING)
            .and_then(Value::as_str);
        if github_mode == ExecutableMode::Custom {
            tools::resolve_gh(
                &self.inner.resource_dir,
                &self.inner.app_data_dir.join("plugins").join("tools"),
                &self.inner.app_cache_dir.join("plugin-tools"),
                github_mode,
                github_path,
            )?;
        }
        Ok(())
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
    apply_legacy_executable_modes(manifest, &mut object, current_version);
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

fn normalize_legacy_executable_settings(
    manifest: &PluginManifest,
    settings: Value,
) -> AppResult<Value> {
    let mut object = settings.as_object().cloned().ok_or_else(|| {
        AppError::Plugin(format!("Settings for {} must be an object", manifest.id))
    })?;
    apply_legacy_executable_modes(manifest, &mut object, 1);
    Ok(Value::Object(object))
}

fn apply_legacy_executable_modes(
    manifest: &PluginManifest,
    object: &mut Map<String, Value>,
    source_version: u32,
) {
    if manifest.id != "denote.git" || source_version != 1 {
        return;
    }
    if !object.contains_key(GIT_EXECUTABLE_MODE_SETTING) {
        let mode = object
            .get(GIT_EXECUTABLE_SETTING)
            .and_then(Value::as_str)
            .is_some_and(|path| !path.trim().is_empty())
            .then_some("custom")
            .unwrap_or("system");
        object.insert(
            GIT_EXECUTABLE_MODE_SETTING.to_string(),
            Value::String(mode.to_string()),
        );
    }
    if !object.contains_key(GITHUB_EXECUTABLE_MODE_SETTING) {
        let mode = object
            .get(GITHUB_EXECUTABLE_SETTING)
            .and_then(Value::as_str)
            .is_some_and(|path| !path.trim().is_empty())
            .then_some("custom")
            .unwrap_or("system");
        object.insert(
            GITHUB_EXECUTABLE_MODE_SETTING.to_string(),
            Value::String(mode.to_string()),
        );
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn git_manifest() -> PluginManifest {
        serde_json::from_str(include_str!(
            "../../../packages/plugins/denote.git/plugin.json"
        ))
        .expect("Git plugin manifest")
    }

    #[test]
    fn fresh_git_settings_use_bundled_git_and_disabled_github_cli() {
        let settings = default_settings(&git_manifest());
        assert_eq!(settings["gitExecutableMode"], "bundled");
        assert_eq!(settings["githubExecutableMode"], "disabled");
    }

    #[test]
    fn legacy_executable_paths_migrate_without_changing_their_source() {
        let manifest = git_manifest();
        let custom = migrate_settings(
            &manifest,
            serde_json::json!({
                "gitExecutablePath": "/synthetic/git",
                "githubExecutablePath": "/synthetic/gh"
            }),
            Some(1),
        )
        .expect("custom migration");
        assert_eq!(custom["gitExecutableMode"], "custom");
        assert_eq!(custom["githubExecutableMode"], "custom");

        let system =
            migrate_settings(&manifest, serde_json::json!({}), Some(1)).expect("system migration");
        assert_eq!(system["gitExecutableMode"], "system");
        assert_eq!(system["githubExecutableMode"], "system");
    }
}
