use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::Path,
    sync::{Arc, LazyLock},
    thread,
    time::Duration,
};

use keyring_core::{Entry, api::CredentialStore};
use reqwest::blocking::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    settings::validate_storage_key,
    types::{
        CredentialLedger, InstalledPlugin, MAX_PLUGIN_STORAGE_BYTES, MAX_PLUGIN_STORAGE_KEYS,
        MAX_PLUGIN_STORAGE_VALUE_BYTES, PluginCatalogEntry, PluginNetworkRequest,
        PluginNetworkResponse, PluginPermission, PluginProcessRequest, PluginProcessResult,
    },
};

pub(crate) const HOST_GIT_SIGNING_SECRET_PREFIX: &str = "host-git-signing.";

fn validate_plugin_secret_key(key: &str) -> AppResult<()> {
    validate_storage_key(key)?;
    if key.starts_with(HOST_GIT_SIGNING_SECRET_PREFIX) {
        return Err(AppError::Plugin(
            "Signing credentials are host-owned and unavailable to plugins.".to_string(),
        ));
    }
    Ok(())
}

impl PluginManager {
    pub(crate) fn secret_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<String>> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_plugin_secret_key(key)?;
        self.host_secret_get(plugin_id, key)
    }

    pub(super) fn host_secret_get(&self, plugin_id: &str, key: &str) -> AppResult<Option<String>> {
        let entry = keychain_entry(&self.inner.keychain_service, plugin_id, key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Plugin(format!(
                "Unable to read keychain entry for {plugin_id}: {error}"
            ))),
        }
    }

    pub(crate) fn secret_set(&self, plugin_id: &str, key: &str, value: &str) -> AppResult<()> {
        self.authorize_runtime(plugin_id, Some("secure-storage"))?;
        validate_plugin_secret_key(key)?;
        self.host_secret_set(plugin_id, key, value)
    }

    pub(super) fn host_secret_set(&self, plugin_id: &str, key: &str, value: &str) -> AppResult<()> {
        self.write_tracked_secret(plugin_id, key, || {
            keychain_entry(&self.inner.keychain_service, plugin_id, key)?
                .set_password(value)
                .map_err(|error| {
                    AppError::Plugin(format!(
                        "Unable to save keychain entry for {plugin_id}: {error}"
                    ))
                })
        })
    }

    pub(super) fn write_tracked_secret(
        &self,
        plugin_id: &str,
        key: &str,
        write: impl FnOnce() -> AppResult<()>,
    ) -> AppResult<()> {
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
        write()?;
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
        validate_plugin_secret_key(key)?;
        self.host_secret_delete(plugin_id, key)
    }

    pub(super) fn host_secret_delete(&self, plugin_id: &str, key: &str) -> AppResult<()> {
        delete_keychain_entry(&self.inner.keychain_service, plugin_id, key)?;
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
            delete_keychain_entry(&self.inner.keychain_service, plugin_id, key)?;
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
            && !permissions
                .iter()
                .any(|approved| approved.capability == permission)
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
        permissions
            .iter()
            .find(|permission| permission.capability == capability)
            .cloned()
            .ok_or_else(|| {
                AppError::Plugin(format!(
                    "Plugin {plugin_id} did not declare {capability} permission"
                ))
            })
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
        tool_access: std::sync::RwLockReadGuard<'_, ()>,
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
        run_bounded_process(self, plugin_id, request, current_dir, tool_access)
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
    manager: &PluginManager,
    plugin_id: &str,
    request: PluginProcessRequest,
    current_dir: Option<&Path>,
    tool_access: std::sync::RwLockReadGuard<'_, ()>,
) -> AppResult<PluginProcessResult> {
    use super::tooling::{ToolLaunch, ToolSession};
    const OUTPUT_LIMIT: usize = 1024 * 1024;
    let generation = manager.inner.tool_sessions.generation(plugin_id)?;
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
    let fallback = std::env::current_dir()?;
    let root = current_dir.unwrap_or(&fallback);
    let owner = plugin_id.to_string();
    let weak = Arc::downgrade(&manager.inner);
    let session = ToolSession::spawn(ToolLaunch {
        plugin_id,
        kind: "process",
        format: "process",
        language: "text",
        project_id: None,
        executable: &request.executable,
        arguments: &request.arguments,
        vault_root: root,
        project_root: root,
        input: None,
        rows: 24,
        cols: 80,
        timeout: Duration::from_secs(30),
        current: Arc::new(move || {
            weak.upgrade().is_some_and(|inner| {
                PluginManager { inner }
                    .authorize_runtime(&owner, Some("process"))
                    .is_ok()
            })
        }),
    })?;
    manager
        .inner
        .tool_sessions
        .insert(session.clone(), generation)?;
    drop(tool_access);
    let result = (|| {
        let mut stdout = String::new();
        let mut stderr = String::new();
        loop {
            let output = session.poll()?;
            for event in output.events {
                if event.stream == "stdout" {
                    stdout.push_str(&event.data);
                } else {
                    stderr.push_str(&event.data);
                }
            }
            if stdout.len() > OUTPUT_LIMIT || stderr.len() > OUTPUT_LIMIT {
                return Err(AppError::Plugin(
                    "Plugin process output exceeded 1 MiB.".into(),
                ));
            }
            if output.status != "running" {
                if let Some(error) = output.error {
                    return Err(AppError::Plugin(error));
                }
                return Ok(PluginProcessResult {
                    exit_code: output.exit_code.unwrap_or(-1),
                    stdout,
                    stderr,
                });
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    let cleanup = manager.inner.tool_sessions.stop_one(plugin_id, &session.id);
    match (result, cleanup) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => Err(AppError::Plugin(format!(
            "{error}; cleanup failed: {cleanup}"
        ))),
    }
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

pub(crate) fn keychain_entry(service: &str, plugin_id: &str, key: &str) -> AppResult<Entry> {
    static STORE: LazyLock<keyring_core::Result<Arc<CredentialStore>>> =
        LazyLock::new(create_keychain_store);
    let store = STORE.as_ref().map_err(|error| {
        AppError::Plugin(format!(
            "Unable to initialize the operating-system keychain for {plugin_id}: {error}"
        ))
    })?;
    keychain_entry_in_store(store.as_ref(), service, plugin_id, key)
}

fn create_keychain_store() -> keyring_core::Result<Arc<CredentialStore>> {
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new()?;
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new()?;
    #[cfg(all(
        unix,
        not(any(target_os = "macos", target_os = "ios", target_os = "android"))
    ))]
    let store = dbus_secret_service_keyring_store::Store::new()?;
    #[cfg(all(any(unix, windows), not(any(target_os = "ios", target_os = "android"))))]
    {
        Ok(store)
    }
    #[cfg(not(all(any(unix, windows), not(any(target_os = "ios", target_os = "android")))))]
    Err(keyring_core::Error::Invalid(
        "platform".to_string(),
        "The operating-system keychain is unavailable on this platform.".to_string(),
    ))
}

fn keychain_entry_in_store(
    store: &CredentialStore,
    service: &str,
    plugin_id: &str,
    key: &str,
) -> AppResult<Entry> {
    let mut identifier = Sha256::new();
    identifier.update(plugin_id.as_bytes());
    identifier.update([0]);
    identifier.update(key.as_bytes());
    let account = hex::encode(identifier.finalize());
    store.build(service, &account, None).map_err(|error| {
        AppError::Plugin(format!(
            "Unable to access the operating-system keychain for {plugin_id}: {error}"
        ))
    })
}

pub(crate) fn delete_keychain_entry(service: &str, plugin_id: &str, key: &str) -> AppResult<()> {
    match keychain_entry(service, plugin_id, key)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Plugin(format!(
            "Unable to delete keychain entry for {plugin_id}: {error}"
        ))),
    }
}

#[cfg(test)]
mod keychain_tests {
    use std::{any::Any, collections::HashMap, sync::Mutex};

    use keyring_core::api::CredentialStoreApi;

    use super::*;

    #[derive(Default)]
    struct SyntheticStore {
        entries: Mutex<Vec<(String, String)>>,
    }

    impl CredentialStoreApi for SyntheticStore {
        fn vendor(&self) -> String {
            "synthetic".to_string()
        }

        fn id(&self) -> String {
            "synthetic".to_string()
        }

        fn build(
            &self,
            service: &str,
            user: &str,
            modifiers: Option<&HashMap<&str, &str>>,
        ) -> keyring_core::Result<Entry> {
            assert!(modifiers.is_none());
            self.entries
                .lock()
                .unwrap()
                .push((service.to_string(), user.to_string()));
            Err(keyring_core::Error::NotSupportedByStore(
                "synthetic store unavailable".to_string(),
            ))
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[test]
    fn preserves_existing_keychain_service_and_hashed_account() {
        let store = SyntheticStore::default();
        let error =
            keychain_entry_in_store(&store, "synthetic.service", "denote.synthetic", "api-key")
                .unwrap_err();
        assert_eq!(
            *store.entries.lock().unwrap(),
            vec![(
                "synthetic.service".to_string(),
                "91a2160b8440e2f8256cdf443af89364d76c671910ca1f9b9e6c30ac84cdf8ba".to_string()
            )]
        );
        assert!(error.to_string().contains("denote.synthetic"));
        assert!(error.to_string().contains("synthetic store unavailable"));
    }

    #[test]
    fn keeps_plugin_and_secret_namespaces_distinct() {
        let store = SyntheticStore::default();
        for (plugin, key) in [("denote.ab", "c"), ("denote.a", "bc"), ("denote.ab", "d")] {
            assert!(keychain_entry_in_store(&store, "synthetic.service", plugin, key).is_err());
        }
        let entries = store.entries.lock().unwrap();
        assert_ne!(entries[0].1, entries[1].1);
        assert_ne!(entries[0].1, entries[2].1);
    }
}
