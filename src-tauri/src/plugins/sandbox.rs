use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use command_group::CommandGroup;
use keyring::Entry;
use reqwest::blocking::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    catalog::has_permission,
    settings::validate_storage_key,
    types::{
        CredentialLedger, InstalledPlugin, KEYCHAIN_SERVICE_PREFIX, MAX_PLUGIN_STORAGE_BYTES,
        MAX_PLUGIN_STORAGE_KEYS, MAX_PLUGIN_STORAGE_VALUE_BYTES, PluginCatalogEntry,
        PluginNetworkRequest, PluginNetworkResponse, PluginPermission, PluginProcessRequest,
        PluginProcessResult,
    },
};

impl PluginManager {
    pub(crate) fn secret_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<String>> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        let entry = keychain_entry(plugin_id, key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Plugin(format!(
                "Unable to read keychain entry for {plugin_id}: {error}"
            ))),
        }
    }

    pub(crate) fn secret_set(&self, plugin_id: &str, key: &str, value: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        let was_tracked = self
            .state()?
            .credential_keys
            .get(plugin_id)
            .is_some_and(|keys| keys.contains(key));
        if !was_tracked {
            self.update_credential_state(|state| {
                state
                    .pending_credential_keys
                    .entry(plugin_id.to_string())
                    .or_default()
                    .insert(key.to_string());
                Ok(())
            })?;
        }
        keychain_entry(plugin_id, key)?
            .set_password(value)
            .map_err(|error| {
                AppError::Plugin(format!(
                    "Unable to save keychain entry for {plugin_id}: {error}"
                ))
            })?;
        if !was_tracked {
            self.update_credential_state(|state| {
                state
                    .credential_keys
                    .entry(plugin_id.to_string())
                    .or_default()
                    .insert(key.to_string());
                if let Some(keys) = state.pending_credential_keys.get_mut(plugin_id) {
                    keys.remove(key);
                }
                Ok(())
            })?;
        }
        Ok(())
    }

    pub(crate) fn secret_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_storage_key(key)?;
        delete_keychain_entry(plugin_id, key)?;
        self.update_credential_state(|state| {
            if let Some(keys) = state.credential_keys.get_mut(plugin_id) {
                keys.remove(key);
            }
            if let Some(keys) = state.pending_credential_keys.get_mut(plugin_id) {
                keys.remove(key);
            }
            Ok(())
        })
    }

    pub(crate) fn clear_credentials(&self, plugin_id: &str) -> AppResult<()> {
        let state = self.state()?;
        let mut keys = state
            .credential_keys
            .get(plugin_id)
            .cloned()
            .unwrap_or_default();
        keys.extend(
            state
                .pending_credential_keys
                .get(plugin_id)
                .cloned()
                .unwrap_or_default(),
        );
        drop(state);
        for key in &keys {
            delete_keychain_entry(plugin_id, key)?;
        }
        self.update_credential_state(|state| {
            state.credential_keys.remove(plugin_id);
            state.pending_credential_keys.remove(plugin_id);
            Ok(())
        })
    }

    pub(crate) fn authorize_runtime(
        &self,
        plugin_id: &str,
        permission: Option<&str>,
    ) -> AppResult<()> {
        let pending = self.pending_transactions()?;
        let prepared_permissions = pending
            .values()
            .find(|transaction| transaction.plugin_id == plugin_id)
            .map(|transaction| transaction.permissions.clone());
        drop(pending);
        let state = self.state()?;
        let permissions = if let Some(permissions) = prepared_permissions {
            permissions
        } else if state.enabled.contains(plugin_id) {
            state
                .approved_permissions
                .get(plugin_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::Plugin(format!(
                        "Plugin {plugin_id} has no approved permission record"
                    ))
                })?
        } else {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is not enabled"
            )));
        };
        if let Some(permission) = permission
            && !has_permission(self.catalog_entry(plugin_id)?, &permissions, permission)
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} lacks {permission} permission"
            )));
        }
        Ok(())
    }

    pub(crate) fn enabled_permission(
        &self,
        plugin_id: &str,
        capability: &str,
    ) -> AppResult<PluginPermission> {
        let catalog = self.catalog_entry(plugin_id)?;
        let permission = catalog
            .manifest
            .permissions
            .iter()
            .find(|permission| permission.capability == capability)
            .cloned()
            .ok_or_else(|| {
                AppError::Plugin(format!(
                    "Plugin {plugin_id} did not declare {capability} permission"
                ))
            })?;
        let state = self.state()?;
        if !state.enabled.contains(plugin_id)
            || !state
                .approved_permissions
                .get(plugin_id)
                .is_some_and(|permissions| permissions.contains(&permission))
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is not enabled with {capability} permission"
            )));
        }
        Ok(permission)
    }

    pub(crate) fn network_request(
        &self,
        plugin_id: &str,
        request: PluginNetworkRequest,
    ) -> AppResult<PluginNetworkResponse> {
        let permission = self.enabled_permission(plugin_id, "network")?;
        let url = reqwest::Url::parse(&request.url)
            .map_err(|error| AppError::Plugin(format!("Invalid plugin URL: {error}")))?;
        if url.scheme() != "https"
            || !url.host_str().is_some_and(|host| {
                permission
                    .hosts
                    .iter()
                    .any(|allowed| host_matches(host, allowed))
            })
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is not allowed to access {}",
                request.url
            )));
        }
        if request
            .body
            .as_ref()
            .is_some_and(|body| body.len() > 1024 * 1024)
        {
            return Err(AppError::Plugin(
                "Plugin network request body exceeds 1 MiB".to_string(),
            ));
        }
        let method = request
            .method
            .as_deref()
            .unwrap_or("GET")
            .parse::<reqwest::Method>()
            .map_err(|error| AppError::Plugin(format!("Invalid HTTP method: {error}")))?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("Denote plugin {plugin_id}"))
            .build()
            .map_err(|error| AppError::Plugin(format!("Unable to create HTTP client: {error}")))?;
        let mut builder = client.request(method, url);
        if let Some(headers) = request.headers {
            for (name, value) in headers {
                if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("content-length")
                {
                    return Err(AppError::Plugin(format!(
                        "Plugin-controlled {name} header is not allowed"
                    )));
                }
                builder = builder.header(name, value);
            }
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let response = builder
            .send()
            .map_err(|error| AppError::Plugin(format!("Plugin network request failed: {error}")))?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_string(), value.to_string()))
            })
            .collect();
        let mut body = Vec::new();
        response.take(5 * 1024 * 1024 + 1).read_to_end(&mut body)?;
        if body.len() > 5 * 1024 * 1024 {
            return Err(AppError::Plugin(
                "Plugin network response exceeds 5 MiB".to_string(),
            ));
        }
        let body = String::from_utf8(body).map_err(|error| {
            AppError::Plugin(format!("Plugin network response is not UTF-8: {error}"))
        })?;
        Ok(PluginNetworkResponse {
            status,
            headers,
            body,
        })
    }

    pub(crate) fn process_request(
        &self,
        plugin_id: &str,
        request: PluginProcessRequest,
        current_dir: Option<&Path>,
    ) -> AppResult<PluginProcessResult> {
        let permission = self.enabled_permission(plugin_id, "process")?;
        if !permission
            .executables
            .get(current_platform())
            .into_iter()
            .flatten()
            .any(|executable| executable == &request.executable)
        {
            return Err(AppError::Plugin(format!(
                "Plugin {plugin_id} is not allowed to run {}",
                request.executable
            )));
        }
        run_bounded_process(request, current_dir)
    }

    pub(crate) fn installed_plugin(
        &self,
        catalog: &PluginCatalogEntry,
        transaction_id: String,
    ) -> AppResult<InstalledPlugin> {
        let entrypoint = self.install_dir(catalog).join(&catalog.manifest.entrypoint);
        if !entrypoint.is_file() {
            return Err(AppError::Plugin(format!(
                "Plugin {} is not installed",
                catalog.manifest.id
            )));
        }
        Ok(InstalledPlugin {
            plugin_id: catalog.manifest.id.clone(),
            version: catalog.manifest.version.clone(),
            entrypoint: catalog.manifest.entrypoint.clone(),
            transaction_id,
        })
    }
}

pub(crate) fn load_credential_ledger(plugins_dir: &Path) -> AppResult<Option<CredentialLedger>> {
    let path = plugins_dir.join("credentials.json");
    if !path.exists() {
        return Ok(None);
    }
    match serde_json::from_slice(&fs::read(&path)?) {
        Ok(ledger) => Ok(Some(ledger)),
        Err(error) => {
            let quarantine =
                plugins_dir.join(format!("credentials.corrupt-{}.json", Uuid::new_v4()));
            fs::rename(&path, &quarantine)?;
            eprintln!(
                "Credential cleanup ledger was corrupt and moved to {}: {error}",
                quarantine.display()
            );
            Ok(None)
        }
    }
}

pub(crate) fn valid_host_pattern(host: &str) -> bool {
    let host = host.strip_prefix("*.").unwrap_or(host);
    !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && !host.contains("..")
}

pub(crate) fn host_matches(host: &str, pattern: &str) -> bool {
    if let Some(suffix) = pattern.strip_prefix("*.") {
        host != suffix && host.ends_with(&format!(".{suffix}"))
    } else {
        host.eq_ignore_ascii_case(pattern)
    }
}

pub(crate) fn current_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
}

pub(crate) fn platform_executable_is_absolute(platform: &str, executable: &str) -> bool {
    match platform {
        "windows" => {
            let bytes = executable.as_bytes();
            (bytes.len() > 2
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/'))
                || executable.starts_with(r"\\")
        }
        "macos" | "linux" => executable.starts_with('/'),
        _ => false,
    }
}

pub(crate) fn run_bounded_process(
    request: PluginProcessRequest,
    current_dir: Option<&Path>,
) -> AppResult<PluginProcessResult> {
    const OUTPUT_LIMIT: u64 = 1024 * 1024;
    if request.arguments.len() > 64
        || request
            .arguments
            .iter()
            .any(|argument| argument.len() > 8 * 1024 || argument.chars().any(char::is_control))
    {
        return Err(AppError::Plugin(
            "Plugin process arguments exceed safety limits".to_string(),
        ));
    }
    let mut stdout_file = tempfile::tempfile()?;
    let mut stderr_file = tempfile::tempfile()?;
    let mut command = Command::new(&request.executable);
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    command
        .args(&request.arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file.try_clone()?))
        .stderr(Stdio::from(stderr_file.try_clone()?));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                rlimit::setrlimit(rlimit::Resource::FSIZE, OUTPUT_LIMIT, OUTPUT_LIMIT)
                    .map_err(std::io::Error::other)
            });
        }
    }
    let mut child = command
        .group_spawn()
        .map_err(|error| AppError::Plugin(format!("Unable to start process: {error}")))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let (status, timed_out, output_exceeded) = loop {
        let output_exceeded = stdout_file.metadata()?.len() > OUTPUT_LIMIT
            || stderr_file.metadata()?.len() > OUTPUT_LIMIT;
        let timed_out = Instant::now() >= deadline;
        if output_exceeded || timed_out {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| AppError::Plugin(format!("Unable to stop process: {error}")))?;
            break (status, timed_out, output_exceeded);
        }
        if let Some(status) = child
            .inner()
            .try_wait()
            .map_err(|error| AppError::Plugin(format!("Unable to wait for process: {error}")))?
        {
            let _ = child.kill();
            let _ = child.wait();
            break (status, false, false);
        }
        thread::sleep(Duration::from_millis(20));
    };
    if output_exceeded {
        return Err(AppError::Plugin(
            "Plugin process output exceeded 1 MiB".to_string(),
        ));
    }
    if timed_out {
        return Err(AppError::Plugin(
            "Plugin process exceeded the 30 second timeout".to_string(),
        ));
    }
    stdout_file.seek(SeekFrom::Start(0))?;
    stderr_file.seek(SeekFrom::Start(0))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    stdout_file
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut stdout)?;
    stderr_file
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut stderr)?;
    Ok(PluginProcessResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

pub(crate) fn enforce_storage_quota(
    storage: &BTreeMap<String, Value>,
    key: &str,
    value: &Value,
) -> AppResult<()> {
    if !storage.contains_key(key) && storage.len() >= MAX_PLUGIN_STORAGE_KEYS {
        return Err(AppError::Plugin(format!(
            "Plugin storage cannot exceed {MAX_PLUGIN_STORAGE_KEYS} keys"
        )));
    }
    let value_size = serde_json::to_vec(value)
        .map_err(|error| AppError::Plugin(format!("Unable to size plugin storage: {error}")))?
        .len();
    if value_size > MAX_PLUGIN_STORAGE_VALUE_BYTES {
        return Err(AppError::Plugin(
            "Plugin storage value exceeds the 256 KiB limit".to_string(),
        ));
    }
    let existing_size = storage
        .iter()
        .filter(|(existing_key, _)| existing_key.as_str() != key)
        .try_fold(0_usize, |total, (_, existing)| {
            let size = serde_json::to_vec(existing).map_err(|error| {
                AppError::Plugin(format!("Unable to size plugin storage: {error}"))
            })?;
            total
                .checked_add(size.len())
                .ok_or_else(|| AppError::Plugin("Plugin storage size overflow".to_string()))
        })?;
    if existing_size + value_size > MAX_PLUGIN_STORAGE_BYTES {
        return Err(AppError::Plugin(
            "Plugin storage exceeds the 2 MiB per-plugin limit".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn keychain_entry(plugin_id: &str, key: &str) -> AppResult<Entry> {
    let mut identifier = Sha256::new();
    identifier.update(plugin_id.as_bytes());
    identifier.update([0]);
    identifier.update(key.as_bytes());
    let account = hex::encode(identifier.finalize());
    Entry::new(KEYCHAIN_SERVICE_PREFIX, &account).map_err(|error| {
        AppError::Plugin(format!(
            "Unable to access the operating-system keychain for {plugin_id}: {error}"
        ))
    })
}

pub(crate) fn delete_keychain_entry(plugin_id: &str, key: &str) -> AppResult<()> {
    match keychain_entry(plugin_id, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Plugin(format!(
            "Unable to delete keychain entry for {plugin_id}: {error}"
        ))),
    }
}
