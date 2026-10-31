use std::{collections::BTreeSet, fs, path::PathBuf, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{
    PluginManager,
    code_commands::CodeProjectScope,
    code_intelligence::safe_code_path,
    package::sha256_file,
    tooling::{ToolDocument, ToolLaunch, ToolPoll, ToolSession},
};
use crate::{
    crypto, db,
    dialogs::{self, SelectionKind, SelectionOptions},
    error::{AppError, AppResult},
    vault,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ToolConfiguration {
    pub enabled: bool,
    pub executable: String,
    pub executable_sha256: String,
    pub arguments: Vec<String>,
    pub format: String,
    pub columns: String,
    pub stdin: bool,
    pub run_on: String,
    pub debounce_ms: u64,
    pub timeout_ms: u64,
}

impl Default for ToolConfiguration {
    fn default() -> Self {
        Self {
            enabled: false,
            executable: String::new(),
            executable_sha256: String::new(),
            arguments: vec![],
            format: "unix".into(),
            columns: "unicode".into(),
            stdin: false,
            run_on: "manual".into(),
            debounce_ms: 500,
            timeout_ms: 120_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolContext {
    pub workspace_scope: String,
    pub project_id: Option<String>,
    pub kind: String,
    pub language: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolStartRequest {
    pub paths: Vec<String>,
    pub document_path: Option<String>,
    pub input: Option<String>,
    pub trigger: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEnvironment {
    pub configured: bool,
    pub scope: CodeProjectScope,
    pub configuration: ToolConfiguration,
    pub platform: String,
    pub terminal_supported: bool,
    pub limitation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRun {
    pub run_id: String,
    pub scope: CodeProjectScope,
    pub documents: Vec<ToolDocument>,
}

struct ResolvedContext {
    vault_root: PathBuf,
    project_root: PathBuf,
    scope: CodeProjectScope,
    vault_id: String,
}

fn permission(kind: &str) -> AppResult<&'static str> {
    match kind {
        "linter" | "build" => Ok("tooling"),
        "terminal" => Ok("terminal"),
        _ => Err(AppError::Plugin("Unsupported external-tool kind.".into())),
    }
}

fn resolve_context(state: &db::AppState, context: &ToolContext) -> AppResult<ResolvedContext> {
    permission(&context.kind)?;
    if context.language.is_empty()
        || context.language.len() > 32
        || !context
            .language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'+'))
    {
        return Err(AppError::Plugin(
            "Choose a supported tool language profile.".into(),
        ));
    }
    let root = state.active_vault()?;
    if fs::canonicalize(&context.workspace_scope)? != root {
        return Err(AppError::Plugin(
            "External-tool scope expired after a vault switch.".into(),
        ));
    }
    if crypto::load_manifest(&root)?.is_some() {
        return Err(AppError::Plugin("Native linters, builds, and terminals are unavailable in encrypted vaults, including while unlocked. Denote never creates plaintext tooling mirrors or shares encryption keys.".into()));
    }
    let project_root = if let Some(id) = context.project_id.as_deref() {
        vault::resolve_project_root(&state.db_path, &root.to_string_lossy(), id)?
    } else {
        root.clone()
    };
    let relative = project_root
        .strip_prefix(&root)
        .map_err(|_| AppError::Plugin("Tool project escaped the vault.".into()))?;
    let vault_id = db::open(&state.db_path)?
        .query_row(
            "SELECT plugin_scope_id FROM vaults WHERE path = ?1",
            [root.to_string_lossy().as_ref()],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| {
            AppError::Plugin(format!(
                "Tool vault identity is unavailable. Reopen the vault: {error}"
            ))
        })?;
    Ok(ResolvedContext {
        scope: CodeProjectScope {
            project_id: context.project_id.clone(),
            root_path: relative.to_string_lossy().replace('\\', "/"),
        },
        vault_root: root,
        project_root,
        vault_id,
    })
}

fn key(plugin_id: &str, resolved: &ResolvedContext, context: &ToolContext) -> String {
    let scope = context
        .project_id
        .as_ref()
        .map(|id| format!("project:{id}"))
        .unwrap_or_else(|| format!("root:{}", resolved.scope.root_path));
    let identity =
        serde_json::json!([resolved.vault_id, scope, context.kind, context.language]).to_string();
    format!(
        "{plugin_id}:{}",
        hex::encode(Sha256::digest(identity.as_bytes()))
    )
}

fn configuration(
    manager: &PluginManager,
    plugin_id: &str,
    resolved: &ResolvedContext,
    context: &ToolContext,
) -> AppResult<Option<ToolConfiguration>> {
    let state = manager.state()?;
    let all_languages = ToolContext {
        language: "all".into(),
        ..context.clone()
    };
    state
        .tool_configurations
        .get(&key(plugin_id, resolved, context))
        .or_else(|| {
            state
                .tool_configurations
                .get(&key(plugin_id, resolved, &all_languages))
        })
        .map(|value| {
            serde_json::from_value(value.clone()).map_err(|error| {
                AppError::Plugin(format!(
                    "Saved tool configuration is invalid. Review and approve it again: {error}"
                ))
            })
        })
        .transpose()
}

fn validate_configuration(configuration: &ToolConfiguration, kind: &str) -> AppResult<()> {
    permission(kind)?;
    if (configuration.enabled && configuration.executable.is_empty())
        || configuration.executable.len() > 4096
        || configuration.executable.chars().any(char::is_control)
        || configuration.arguments.len() > 64
        || configuration
            .arguments
            .iter()
            .any(|argument| argument.len() > 8192 || argument.chars().any(char::is_control))
        || !["unix", "msvc", "eslint-json", "cargo-json"].contains(&configuration.format.as_str())
        || !["utf16", "utf8", "unicode"].contains(&configuration.columns.as_str())
        || !["manual", "save", "change"].contains(&configuration.run_on.as_str())
        || !(100..=30_000).contains(&configuration.debounce_ms)
        || !(1000..=600_000).contains(&configuration.timeout_ms)
        || (kind != "linter" && (configuration.stdin || configuration.run_on == "change"))
        || (configuration.run_on == "change" && !configuration.stdin)
        || (kind == "terminal" && configuration.run_on != "manual")
    {
        return Err(AppError::Plugin("Invalid tool configuration. Select an executable, use bounded JSON arguments, a 1-600 second timeout, and stdin for debounced linting. Builds cannot consume unsaved input.".into()));
    }
    if kind == "linter"
        && configuration.arguments.iter().any(|argument| {
            ["--fix", "--fix=true", "--write", "-w", "/fix"]
                .contains(&argument.to_lowercase().as_str())
        })
    {
        return Err(AppError::Plugin("Linters must not write files directly. Remove write/fix flags and use diagnostic fix proposals, which Denote previews before applying.".into()));
    }
    Ok(())
}

async fn background<T: Send + 'static>(
    run: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(|error| AppError::State(format!("External-tool operation failed: {error}")))?
}

#[tauri::command]
pub async fn tool_environment(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
) -> AppResult<ToolEnvironment> {
    let manager = state.inner().clone();
    background(move || {
        manager.authorize_runtime(&plugin_id, Some(permission(&context.kind)?))?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        let configuration = configuration(&manager, &plugin_id, &resolved, &context)?;
        Ok(ToolEnvironment { configured: configuration.is_some(), configuration: configuration.unwrap_or_default(),
            scope: resolved.scope, platform: super::sandbox::current_platform().into(), terminal_supported: cfg!(unix),
            limitation: if cfg!(unix) { None } else {
                Some("Embedded terminals currently support macOS and Linux. Windows PTY process-tree shutdown is not yet verified.".into())
            } })
    }).await
}

#[tauri::command]
pub async fn choose_tool_executable(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    kind: String,
) -> AppResult<Option<String>> {
    state.authorize_runtime(&plugin_id, Some(permission(&kind)?))?;
    dialogs::select(
        &app,
        SelectionKind::File,
        SelectionOptions::new("Choose an installed tool executable"),
    )
    .await?
    .map(|path| Ok(crate::paths::path_for_display(&fs::canonicalize(path)?)))
    .transpose()
}

#[tauri::command]
pub async fn save_tool_configuration(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    mut configuration: ToolConfiguration,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || {
        let _tool_access = manager.write_native_tool_access()?;
        manager.authorize_runtime(&plugin_id, Some(permission(&context.kind)?))?;
        validate_configuration(&configuration, &context.kind)?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        if !configuration.executable.is_empty() {
            let path = PathBuf::from(&configuration.executable);
            if !path.is_absolute() || !path.is_file() || path.extension().is_some_and(|extension|
                ["cmd", "bat", "ps1"].iter().any(|suffix| extension.to_string_lossy().eq_ignore_ascii_case(suffix))) {
                return Err(AppError::Plugin("Choose a native executable. For installed script tools, approve their interpreter executable and put the script path in its arguments; wrappers are not run implicitly.".into()));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if path.metadata()?.permissions().mode() & 0o111 == 0 {
                    return Err(AppError::Plugin("The selected file is not executable.".into()));
                }
            }
            let path = fs::canonicalize(path)?;
            configuration.executable_sha256 = sha256_file(&path)?;
            configuration.executable = crate::paths::path_for_display(&path);
        } else { configuration.executable_sha256.clear(); }
        manager.inner.tool_sessions.stop_plugin(Some(&plugin_id))?;
        let key = key(&plugin_id, &resolved, &context);
        let value = serde_json::to_value(configuration).map_err(|error| AppError::Plugin(error.to_string()))?;
        manager.update_state(|state| {
            if !state.tool_configurations.contains_key(&key) && state.tool_configurations.len() >= 512 {
                return Err(AppError::Plugin("Tool configuration limit reached. Clear unused plugin data.".into()));
            }
            state.tool_configurations.insert(key, value);
            if serde_json::to_vec(&state.tool_configurations).map_err(|error| AppError::Plugin(error.to_string()))?.len() > 4 * 1024 * 1024 {
                return Err(AppError::Plugin("Saved tool configurations exceed 4 MiB. Clear unused plugin data.".into()));
            }
            Ok(())
        })
    }).await
}

fn snapshot_documents(
    resolved: &ResolvedContext,
    paths: &[String],
) -> AppResult<Vec<ToolDocument>> {
    if paths.len() > 5000 || paths.iter().collect::<BTreeSet<_>>().len() != paths.len() {
        return Err(AppError::Plugin(
            "Tooling supports at most 5,000 distinct source files per run. Narrow the project."
                .into(),
        ));
    }
    let mut total = 0;
    paths.iter().map(|path| {
        let absolute = safe_code_path(&resolved.vault_root, path, false)?;
        if !absolute.starts_with(&resolved.project_root) || !absolute.is_file() {
            return Err(AppError::Plugin("Tool source does not belong to this project.".into()));
        }
        let size = absolute.metadata()?.len();
        total += size;
        if size > 4 * 1024 * 1024 || total > 64 * 1024 * 1024 {
            return Err(AppError::Plugin("Tool source snapshots exceed 4 MiB per file or 64 MiB total. Narrow the project.".into()));
        }
        Ok(ToolDocument { path: path.clone(), version: sha256_file(&absolute)? })
    }).collect()
}

#[tauri::command]
pub async fn start_tool_session(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    request: ToolStartRequest,
) -> AppResult<ToolRun> {
    let manager = state.inner().clone();
    background(move || {
        let _tool_access = manager.read_native_tool_access()?;
        let generation = manager.inner.tool_sessions.generation(&plugin_id)?;
        manager.authorize_runtime(&plugin_id, Some(permission(&context.kind)?))?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        let configuration = configuration(&manager, &plugin_id, &resolved, &context)?.unwrap_or_default();
        validate_configuration(&configuration, &context.kind)?;
        if !configuration.enabled {
            return Err(AppError::Plugin("This tool is disabled. Choose its installed executable and Save and approve before running it.".into()));
        }
        if !["manual", "save", "change"].contains(&request.trigger.as_str()) ||
            (request.trigger != "manual" && request.trigger != configuration.run_on) ||
            request.input.as_ref().is_some_and(|input| input.len() > 4 * 1024 * 1024) ||
            request.input.is_some() != configuration.stdin ||
            !(2..=500).contains(&request.rows) || !(2..=500).contains(&request.cols) {
            return Err(AppError::Plugin("Tool start does not match the approved input, trigger, or size limits.".into()));
        }
        if sha256_file(&PathBuf::from(&configuration.executable))? != configuration.executable_sha256 {
            return Err(AppError::Plugin("The tool executable changed on disk. Review and approve its executable and arguments again.".into()));
        }
        let documents = snapshot_documents(&resolved, &request.paths)?;
        let document = request.document_path.as_deref().map(|path| {
            let absolute = safe_code_path(&resolved.vault_root, path, false)?;
            if !absolute.starts_with(&resolved.project_root) || !absolute.is_file() {
                return Err(AppError::Plugin("The selected tool document is outside its project.".into()));
            }
            Ok(absolute.strip_prefix(&resolved.project_root).map_err(|error| AppError::Plugin(error.to_string()))?
                .to_string_lossy().replace('\\', "/"))
        }).transpose()?;
        if configuration.stdin && document.is_none() {
            return Err(AppError::Plugin("Open a source file before running a stdin linter.".into()));
        }
        let arguments: Vec<String> = configuration.arguments.iter().map(|argument| {
            if argument.contains("%FILE%") && document.is_none() {
                return Err(AppError::Plugin("This command uses %FILE%. Open a source file first.".into()));
            }
            Ok(argument.replace("%FILE%", document.as_deref().unwrap_or("")))
        }).collect::<AppResult<_>>()?;
        let monitor_app = app.clone();
        let monitor_context = context.clone();
        let expected_vault = resolved.vault_root.clone();
        let expected_project = resolved.project_root.clone();
        let owner = plugin_id.clone();
        let current = Arc::new(move || {
            let state = monitor_app.state::<db::AppState>();
            monitor_app.state::<PluginManager>().authorize_runtime(&owner, permission(&monitor_context.kind).ok()).is_ok() &&
                resolve_context(&state, &monitor_context).is_ok_and(|scope|
                    scope.vault_root == expected_vault && scope.project_root == expected_project)
        });
        if manager.inner.tool_sessions.generation(&plugin_id)? != generation {
            return Err(AppError::Plugin("Tool start was cancelled before execution.".into()));
        }
        let session = ToolSession::spawn(ToolLaunch {
            plugin_id: &plugin_id,
            kind: &context.kind,
            format: &configuration.format,
            language: &context.language,
            project_id: context.project_id.clone(),
            executable: &configuration.executable,
            arguments: &arguments,
            vault_root: &resolved.vault_root,
            project_root: &resolved.project_root,
            input: request.input,
            rows: request.rows,
            cols: request.cols,
            timeout: Duration::from_millis(configuration.timeout_ms),
            current,
        })?;
        let run_id = session.id.clone();
        if let Err(error) = manager.authorize_runtime(&plugin_id, Some(permission(&context.kind)?)) {
            session.stop()?;
            return Err(error);
        }
        manager.inner.tool_sessions.insert(session, generation)?;
        Ok(ToolRun { run_id, scope: resolved.scope, documents })
    }).await
}

fn bound_session(
    manager: &PluginManager,
    state: &db::AppState,
    plugin_id: &str,
    context: &ToolContext,
    run_id: &str,
) -> AppResult<Arc<ToolSession>> {
    manager.authorize_runtime(plugin_id, Some(permission(&context.kind)?))?;
    let resolved = resolve_context(state, context)?;
    let session = manager.inner.tool_sessions.get(plugin_id, run_id)?;
    if session.kind != context.kind
        || session.language != context.language
        || session.project_id != context.project_id
        || session.vault_root != resolved.vault_root
        || session.project_root != resolved.project_root
    {
        return Err(AppError::Plugin(
            "Tool run does not belong to this plugin, vault, project, language, and execution."
                .into(),
        ));
    }
    Ok(session)
}

#[tauri::command]
pub async fn poll_tool_session(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    run_id: String,
) -> AppResult<ToolPoll> {
    let manager = state.inner().clone();
    background(move || {
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        bound_session(&manager, &state, &plugin_id, &context, &run_id)?.poll()
    })
    .await
}

#[tauri::command]
pub async fn write_tool_input(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    run_id: String,
    data: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || {
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        bound_session(&manager, &state, &plugin_id, &context, &run_id)?.input(&data)
    })
    .await
}

#[tauri::command]
pub async fn resize_tool_terminal(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    run_id: String,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || {
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        bound_session(&manager, &state, &plugin_id, &context, &run_id)?.resize(rows, cols)
    })
    .await
}

#[tauri::command]
pub async fn stop_tool_session(
    state: State<'_, PluginManager>,
    plugin_id: String,
    run_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || manager.inner.tool_sessions.stop_one(&plugin_id, &run_id)).await
}

#[tauri::command]
pub async fn stop_tool_sessions(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || manager.inner.tool_sessions.stop_plugin(Some(&plugin_id))).await
}

#[tauri::command]
pub async fn validate_tool_documents(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: ToolContext,
    documents: Vec<ToolDocument>,
) -> AppResult<Vec<String>> {
    let manager = state.inner().clone();
    background(move || {
        manager.authorize_runtime(&plugin_id, Some("tooling"))?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        if documents.len() > 5000 {
            return Err(AppError::Plugin(
                "Too many diagnostic source versions.".into(),
            ));
        }
        let mut changed = Vec::new();
        for document in documents {
            if document.version.len() != 64
                || !document
                    .version
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(AppError::Plugin(
                    "Invalid diagnostic source version.".into(),
                ));
            }
            let path = safe_code_path(&resolved.vault_root, &document.path, true)?;
            if !path.starts_with(&resolved.project_root) {
                return Err(AppError::Plugin("Diagnostic escaped its project.".into()));
            }
            if !path.is_file() || sha256_file(&path)? != document.version {
                changed.push(document.path);
            }
        }
        Ok(changed)
    })
    .await
}

impl PluginManager {
    pub(crate) fn read_native_tool_access(&self) -> AppResult<std::sync::RwLockReadGuard<'_, ()>> {
        self.inner
            .native_tool_access
            .read()
            .map_err(|_| AppError::Plugin("Native tool startup lock failed.".into()))
    }

    pub(crate) fn quiesce_native_tools(&self) -> AppResult<std::sync::RwLockWriteGuard<'_, ()>> {
        let access = self.write_native_tool_access()?;
        let mut failures = Vec::new();
        if let Err(error) = self.inner.tool_sessions.stop_plugin(None) {
            failures.push(error.to_string());
        }
        if let Err(error) = self.inner.code_sessions.stop_plugin(None) {
            failures.push(error.to_string());
        }
        if !failures.is_empty() {
            return Err(AppError::Plugin(format!(
                "Native tools could not be stopped: {}",
                failures.join("; ")
            )));
        }
        Ok(access)
    }

    pub(crate) fn write_native_tool_access(
        &self,
    ) -> AppResult<std::sync::RwLockWriteGuard<'_, ()>> {
        self.inner
            .native_tool_access
            .write()
            .map_err(|_| AppError::Plugin("Native tool transition lock failed.".into()))
    }

    pub(crate) fn stop_all_tool_sessions(&self) {
        if let Err(error) = self.inner.tool_sessions.stop_plugin(None) {
            eprintln!("External-tool shutdown failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooling_requires_explicit_bounded_read_only_linter_configuration() {
        let mut configuration = ToolConfiguration::default();
        assert!(validate_configuration(&configuration, "linter").is_ok());
        configuration.enabled = true;
        assert!(validate_configuration(&configuration, "linter").is_err());
        configuration.executable = "/synthetic/linter".to_string();
        assert!(validate_configuration(&configuration, "linter").is_ok());
        configuration.arguments = vec!["--fix".to_string()];
        assert!(validate_configuration(&configuration, "linter").is_err());
        configuration.arguments.clear();
        configuration.run_on = "change".to_string();
        assert!(validate_configuration(&configuration, "linter").is_err());
        configuration.stdin = true;
        assert!(validate_configuration(&configuration, "linter").is_ok());
        assert!(validate_configuration(&configuration, "build").is_err());
    }

    #[test]
    fn native_starts_wait_until_an_encryption_transition_finishes() {
        let data = tempfile::TempDir::new().unwrap();
        let cache = tempfile::TempDir::new().unwrap();
        let manager = PluginManager::new(data.path().into(), cache.path().into());
        let transition = manager.quiesce_native_tools().unwrap();
        let other = manager.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _access = other.read_native_tool_access().unwrap();
            sender.send(()).unwrap();
        });
        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        drop(transition);
        receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn encrypted_tool_contexts_refuse_both_locked_and_unlocked_vaults() {
        let data = tempfile::TempDir::new().unwrap();
        let db_path = data.path().join("example.db");
        db::initialize(&db_path).unwrap();
        let root = data.path().join("example-vault");
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        db::ensure_vault(
            &db::open(&db_path).unwrap(),
            &root.to_string_lossy(),
            "Example",
        )
        .unwrap();
        let state = db::AppState::new(db_path, Some(root.clone()));
        let context = ToolContext {
            workspace_scope: root.to_string_lossy().into(),
            project_id: None,
            kind: "linter".into(),
            language: "typescript".into(),
        };
        assert!(resolve_context(&state, &context).is_ok());
        let (manifest, key, _) = crypto::create_manifest("Synthetic test passphrase only").unwrap();
        crypto::save_manifest(&root, &manifest).unwrap();
        assert!(resolve_context(&state, &context).is_err());
        state.set_vault_key(key).unwrap();
        assert!(resolve_context(&state, &context).is_err());
        state.clear_vault_key().unwrap();
        assert!(resolve_context(&state, &context).is_err());
    }
}
