use std::{fs, path::PathBuf, sync::Arc};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::{
    PluginManager,
    code_intelligence::{CodeSession, CodeToolConfiguration, detect_code_root, safe_code_path},
    package::sha256_file,
};
use crate::{
    crypto, db,
    dialogs::{self, SelectionKind, SelectionOptions},
    error::{AppError, AppResult},
    vault,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeWorkspaceRequest {
    pub workspace_scope: String,
    pub project_id: Option<String>,
    pub document_path: Option<String>,
    pub language: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeProjectScope {
    pub project_id: Option<String>,
    pub root_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeToolEnvironment {
    pub scope: CodeProjectScope,
    pub language: String,
    pub lsp: CodeToolConfiguration,
    pub dap: CodeToolConfiguration,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedCodeSession {
    pub session_id: String,
    pub root_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeProtocolInvocation {
    pub operation: String,
    pub session_id: String,
    pub workspace_scope: String,
    pub method: Option<String>,
    pub params: Option<Value>,
    pub request_token: String,
    pub scope: Option<CodeProjectScope>,
    pub language: Option<String>,
}

struct ResolvedCodeContext {
    vault_root: PathBuf,
    project_root: PathBuf,
    scope: CodeProjectScope,
    vault_scope_id: String,
}

fn resolve_context(
    state: &db::AppState,
    request: &CodeWorkspaceRequest,
) -> AppResult<ResolvedCodeContext> {
    if !matches!(
        request.language.as_str(),
        "rust" | "go" | "python" | "java" | "cpp" | "typescript"
    ) {
        return Err(AppError::Plugin("Unsupported code language.".to_string()));
    }
    let root = state.active_vault()?;
    if fs::canonicalize(&request.workspace_scope)? != root {
        return Err(AppError::Plugin(
            "Code tool context expired after a vault switch.".to_string(),
        ));
    }
    if crypto::load_manifest(&root)?.is_some() {
        return Err(AppError::Plugin("Native language servers and debuggers are unavailable in encrypted vaults. Use an unencrypted code vault; Denote never creates plaintext project mirrors.".to_string()));
    }
    let project_root = match request.project_id.as_deref() {
        Some(id) => vault::resolve_project_root(&state.db_path, &root.to_string_lossy(), id)?,
        None => detect_code_root(&root, request.document_path.as_deref(), &request.language)?,
    };
    if let Some(path) = request.document_path.as_deref()
        && !safe_code_path(&root, path, false)?.starts_with(&project_root)
    {
        return Err(AppError::Plugin(
            "The source file does not belong to the selected code project.".to_string(),
        ));
    }
    let connection = db::open(&state.db_path)?;
    let vault_scope_id = connection
        .query_row(
            "SELECT plugin_scope_id FROM vaults WHERE path = ?1",
            [root.to_string_lossy().as_ref()],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| {
            AppError::Plugin(format!(
                "Vault code scope is unavailable. Reopen the vault: {error}"
            ))
        })?;
    let relative = project_root
        .strip_prefix(&root)
        .map_err(|_| AppError::Plugin("Code project escaped the vault.".to_string()))?;
    Ok(ResolvedCodeContext {
        scope: CodeProjectScope {
            project_id: request.project_id.clone(),
            root_path: relative.to_string_lossy().replace('\\', "/"),
        },
        vault_root: root,
        project_root,
        vault_scope_id,
    })
}

fn configuration_key(
    plugin_id: &str,
    context: &ResolvedCodeContext,
    language: &str,
    kind: &str,
) -> String {
    let scope_identity = context
        .scope
        .project_id
        .as_ref()
        .map(|id| format!("project:{id}"))
        .unwrap_or_else(|| format!("root:{}", context.scope.root_path));
    let identity = json!([context.vault_scope_id, scope_identity, language, kind]).to_string();
    format!(
        "{plugin_id}:{}",
        hex::encode(Sha256::digest(identity.as_bytes()))
    )
}

fn configuration(
    manager: &PluginManager,
    plugin_id: &str,
    context: &ResolvedCodeContext,
    language: &str,
    kind: &str,
) -> AppResult<CodeToolConfiguration> {
    manager
        .state()?
        .code_tool_configurations
        .get(&configuration_key(plugin_id, context, language, kind))
        .map(|value| {
            serde_json::from_value(value.clone()).map_err(|error| {
                AppError::Plugin(format!(
                    "Saved code configuration is invalid: {error}. Save and approve it again."
                ))
            })
        })
        .unwrap_or_else(|| Ok(CodeToolConfiguration::default()))
}

fn validate_configuration(
    configuration: &CodeToolConfiguration,
    kind: &str,
    language: &str,
) -> AppResult<()> {
    if !matches!(kind, "lsp" | "dap")
        || !matches!(configuration.transport.as_str(), "stdio" | "tcp" | "java")
        || (kind == "lsp" && configuration.transport != "stdio")
        || (configuration.transport == "java" && (kind != "dap" || language != "java"))
        || (configuration.enabled
            && configuration.transport != "java"
            && configuration.executable.is_empty())
        || configuration.executable.len() > 4096
        || configuration.executable.chars().any(char::is_control)
        || configuration.arguments.len() > 64
        || configuration
            .arguments
            .iter()
            .any(|argument| argument.len() > 8192 || argument.chars().any(char::is_control))
        || (configuration.enabled
            && configuration.transport == "tcp"
            && !configuration
                .arguments
                .iter()
                .any(|argument| argument.contains("%PORT%")))
        || !configuration.options.is_object()
        || !configuration.launch.is_object()
        || !configuration.attach.is_object()
        || serde_json::to_vec(&configuration.options)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len()
            > 64 * 1024
        || serde_json::to_vec(&configuration.attach)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len()
            > 64 * 1024
        || serde_json::to_vec(&configuration.launch)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len()
            > 64 * 1024
    {
        return Err(AppError::Plugin("Invalid code tool configuration. Select an executable, use bounded JSON arguments/options, and use %PORT% for a loopback TCP debugger.".to_string()));
    }
    Ok(())
}

async fn background<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppError::State(format!("Code tool background operation failed: {error}"))
        })?
}

#[tauri::command]
pub async fn code_tool_environment(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: CodeWorkspaceRequest,
) -> AppResult<CodeToolEnvironment> {
    let manager = state.inner().clone();
    background(move || {
        manager.authorize_runtime(&plugin_id, Some("code-intelligence"))?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        Ok(CodeToolEnvironment {
            lsp: configuration(&manager, &plugin_id, &resolved, &context.language, "lsp")?,
            dap: configuration(&manager, &plugin_id, &resolved, &context.language, "dap")?,
            scope: resolved.scope,
            language: context.language,
        })
    })
    .await
}

#[tauri::command]
pub async fn choose_code_tool_executable(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<Option<String>> {
    state.authorize_runtime(&plugin_id, Some("code-intelligence"))?;
    let options = SelectionOptions::new("Choose an installed code tool executable");
    let selected = dialogs::select(&app, SelectionKind::File, options).await?;
    selected
        .map(|path| {
            let path = fs::canonicalize(path)?;
            if !path.is_file() {
                return Err(AppError::Plugin(
                    "Choose a regular executable file.".to_string(),
                ));
            }
            Ok(crate::paths::path_for_display(&path))
        })
        .transpose()
}

#[tauri::command]
pub async fn save_code_tool_configuration(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: CodeWorkspaceRequest,
    kind: String,
    mut configuration: CodeToolConfiguration,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || {
        manager.authorize_runtime(&plugin_id, Some("code-intelligence"))?;
        validate_configuration(&configuration, &kind, &context.language)?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        if !configuration.executable.is_empty() {
            let path = PathBuf::from(&configuration.executable);
            if !path.is_absolute() || !path.is_file() ||
                path.extension().is_some_and(|extension|
                    ["cmd", "bat", "ps1"].iter().any(|suffix| extension.to_string_lossy().eq_ignore_ascii_case(suffix))) {
                return Err(AppError::Plugin("Choose a native executable. On Windows, choose node.exe, python.exe or java.exe and put the installed tool entrypoint in its arguments; batch and PowerShell wrappers are not executed.".to_string()));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if path.metadata()?.permissions().mode() & 0o111 == 0 {
                    return Err(AppError::Plugin("The selected code tool file is not executable.".to_string()));
                }
            }
            let path = fs::canonicalize(path)?;
            configuration.executable_sha256 = sha256_file(&path)?;
            configuration.executable = crate::paths::path_for_display(&path);
        } else { configuration.executable_sha256.clear(); }
        if let Some(session) = manager.inner.code_sessions.find(&plugin_id, &kind, &resolved.project_root, &context.language, context.project_id.as_deref())? {
            manager.inner.code_sessions.stop_one(&plugin_id, &session.id)?;
        }
        let key = configuration_key(&plugin_id, &resolved, &context.language, &kind);
        let value = serde_json::to_value(configuration).map_err(|error| AppError::Plugin(error.to_string()))?;
        manager.update_state(|state| {
            if !state.code_tool_configurations.contains_key(&key) && state.code_tool_configurations.len() >= 512 {
                return Err(AppError::Plugin("Code configuration limit reached. Clear unused plugin data before adding more projects.".to_string()));
            }
            state.code_tool_configurations.insert(key, value);
            if serde_json::to_vec(&state.code_tool_configurations).map_err(|error| AppError::Plugin(error.to_string()))?.len() > 4 * 1024 * 1024 {
                return Err(AppError::Plugin("Saved code configurations exceed 4 MiB. Clear unused plugin data before adding more.".to_string()));
            }
            Ok(())
        })
    }).await
}

#[tauri::command]
pub async fn start_code_session(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    context: CodeWorkspaceRequest,
    kind: String,
) -> AppResult<StartedCodeSession> {
    let manager = state.inner().clone();
    background(move || {
        manager.authorize_runtime(&plugin_id, Some("code-intelligence"))?;
        let state = app.state::<db::AppState>();
        let _access = state.read_vault_access()?;
        let resolved = resolve_context(&state, &context)?;
        let configuration = configuration(&manager, &plugin_id, &resolved, &context.language, &kind)?;
        validate_configuration(&configuration, &kind, &context.language)?;
        if !configuration.enabled {
            return Err(AppError::Plugin(format!("{} is disabled for this project. Choose its installed executable and use Save and approve in Code intelligence.", if kind == "dap" { "Debugging" } else { "This language integration" })));
        }
        if let Some(existing) = manager.inner.code_sessions.find(&plugin_id, &kind, &resolved.project_root, &context.language, context.project_id.as_deref())? {
            return Ok(StartedCodeSession { session_id: existing.id.clone(), root_path: resolved.scope.root_path });
        }
        if configuration.transport != "java" &&
            sha256_file(&PathBuf::from(&configuration.executable))? != configuration.executable_sha256 {
            return Err(AppError::Plugin("The code tool changed on disk. Review its executable and arguments, then Save and approve again.".to_string()));
        }
        let generation = manager.inner.code_sessions.generation(&plugin_id)?;
        let monitor_app = app.clone();
        let mut monitor_context = context.clone();
        if monitor_context.project_id.is_some() { monitor_context.document_path = None; }
        let expected_root = resolved.project_root.clone();
        let expected_vault = resolved.vault_root.clone();
        let current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || {
            let state = monitor_app.state::<db::AppState>();
            match resolve_context(&state, &monitor_context) {
                Ok(current) => current.vault_root == expected_vault && current.project_root == expected_root,
                Err(_) => false,
            }
        });
        let session = if configuration.transport == "java" {
            let server = manager.inner.code_sessions.find(&plugin_id, "lsp", &resolved.project_root, "java", context.project_id.as_deref())?
                .ok_or_else(|| AppError::Plugin("Start the Java language server first, with the maintained java-debug bundle in initialization options.".to_string()))?;
            let port = server.request("workspace/executeCommand", json!({"command": "vscode.java.startDebugSession", "arguments": []}), &uuid::Uuid::new_v4().to_string())?
                .as_u64().filter(|port| *port > 0 && *port <= u16::MAX as u64)
                .ok_or_else(|| AppError::Plugin("The Java debug extension did not return a loopback port. Install java-debug and add its jar to the Java server's bundles option.".to_string()))?;
            CodeSession::connect(&plugin_id, &configuration, &resolved.vault_root, &resolved.project_root, current, port as u16)?
        } else {
            CodeSession::spawn(&plugin_id, &kind, &configuration, &resolved.vault_root, &resolved.project_root, current)?
        };
        *session.language.lock().map_err(|_| AppError::Plugin("Code language lock failed.".to_string()))? = context.language;
        *session.project_id.lock().map_err(|_| AppError::Plugin("Code project lock failed.".to_string()))? = context.project_id;
        *session.document_path.lock().map_err(|_| AppError::Plugin("Code document lock failed.".to_string()))? = context.document_path;
        if let Err(error) = manager.authorize_runtime(&plugin_id, Some("code-intelligence")).and_then(|_| session.check_current()) {
            session.stop("Code tool start was cancelled.")?;
            return Err(error);
        }
        let started = StartedCodeSession { session_id: session.id.clone(), root_path: resolved.scope.root_path };
        manager.inner.code_sessions.insert(session, generation)?;
        Ok(started)
    }).await
}

fn permitted_method(kind: &str, operation: &str, method: &str) -> bool {
    match (kind, operation) {
        ("lsp", "request") => matches!(
            method,
            "initialize"
                | "shutdown"
                | "textDocument/completion"
                | "completionItem/resolve"
                | "textDocument/hover"
                | "textDocument/signatureHelp"
                | "textDocument/diagnostic"
                | "textDocument/formatting"
                | "textDocument/definition"
                | "textDocument/declaration"
                | "textDocument/implementation"
                | "textDocument/typeDefinition"
                | "textDocument/references"
                | "textDocument/documentSymbol"
                | "workspace/symbol"
        ),
        ("lsp", "notify") => matches!(
            method,
            "initialized"
                | "textDocument/didOpen"
                | "textDocument/didChange"
                | "textDocument/didSave"
                | "textDocument/didClose"
                | "exit"
                | "$/cancelRequest"
        ),
        ("dap", "request") => matches!(
            method,
            "initialize"
                | "launch"
                | "attach"
                | "configurationDone"
                | "setBreakpoints"
                | "setExceptionBreakpoints"
                | "continue"
                | "pause"
                | "next"
                | "stepIn"
                | "stepOut"
                | "restart"
                | "disconnect"
                | "threads"
                | "stackTrace"
                | "scopes"
                | "variables"
                | "evaluate"
                | "exceptionInfo"
        ),
        _ => false,
    }
}

fn assert_code_binding(
    actual: &CodeProjectScope,
    language: &str,
    requested: Option<&CodeProjectScope>,
    requested_language: Option<&str>,
) -> AppResult<()> {
    if requested_language != Some(language)
        || requested.is_none_or(|scope| {
            scope.project_id != actual.project_id || scope.root_path != actual.root_path
        })
    {
        return Err(AppError::Plugin(
            "Code protocol request does not belong to this language and project scope.".to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn code_protocol(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: CodeProtocolInvocation,
) -> AppResult<Value> {
    let manager = state.inner().clone();
    background(move || {
        if request.operation == "stop" {
            manager.inner.code_sessions.stop_one(&plugin_id, &request.session_id)?;
            return Ok(Value::Null);
        }
        if request.operation == "cancel" {
            manager.inner.code_sessions.cancel(&plugin_id, &request.request_token)?;
            return Ok(Value::Null);
        }
        manager.authorize_runtime(&plugin_id, Some("code-intelligence"))?;
        let session = manager.inner.code_sessions.get(&plugin_id, &request.session_id)?;
        let root_path = session.project_root.strip_prefix(&session.vault_root)
            .map_err(|_| AppError::Plugin("Code session escaped its vault.".to_string()))?.to_string_lossy().replace('\\', "/");
        assert_code_binding(&CodeProjectScope {
            project_id: session.project_id.lock().map_err(|_| AppError::Plugin("Code project lock failed.".to_string()))?.clone(),
            root_path,
        }, &session.language.lock().map_err(|_| AppError::Plugin("Code language lock failed.".to_string()))?,
            request.scope.as_ref(), request.language.as_deref())?;
        let state = app.state::<db::AppState>();
        if state.active_vault()? != session.vault_root || fs::canonicalize(request.workspace_scope)? != session.vault_root {
            return Err(AppError::Plugin("Code protocol lease expired after a vault switch.".to_string()));
        }
        if request.operation == "poll" { return Ok(json!(session.poll()?)); }
        session.check_current()?;
        let method = request.method.as_deref().unwrap_or("");
        let params = request.params.unwrap_or(Value::Null);
        if request.operation == "respond" {
            session.respond(params["id"].clone(), params["result"].clone())?;
            return Ok(Value::Null);
        }
        if !permitted_method(&session.kind, &request.operation, method) {
            return Err(AppError::Plugin("Unsupported code protocol operation; arbitrary server commands and process launches are not allowed.".to_string()));
        }
        if request.operation == "notify" {
            session.notify(method, params)?;
            Ok(Value::Null)
        } else {
            session.request(method, params, &request.request_token)
        }
    }).await
}

#[tauri::command]
pub async fn stop_code_sessions(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    background(move || manager.inner.code_sessions.stop_plugin(Some(&plugin_id))).await
}

impl PluginManager {
    pub(crate) fn stop_all_code_sessions(&self) {
        if let Err(error) = self.inner.code_sessions.stop_plugin(None) {
            eprintln!("Code tool shutdown failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::code_intelligence::CodeToolConfiguration;
    use super::*;

    #[test]
    fn protocol_calls_cannot_cross_languages_projects_or_vault_scope() {
        let scope = CodeProjectScope {
            project_id: Some("project-example".to_string()),
            root_path: "sample".to_string(),
        };
        assert!(assert_code_binding(&scope, "rust", Some(&scope), Some("rust")).is_ok());
        assert!(assert_code_binding(&scope, "rust", Some(&scope), Some("go")).is_err());
        assert!(assert_code_binding(&scope, "rust", None, Some("rust")).is_err());
        assert!(
            assert_code_binding(
                &scope,
                "rust",
                Some(&CodeProjectScope {
                    project_id: None,
                    root_path: "sample".to_string(),
                }),
                Some("rust")
            )
            .is_err()
        );
        assert!(
            assert_code_binding(
                &scope,
                "rust",
                Some(&CodeProjectScope {
                    project_id: scope.project_id.clone(),
                    root_path: "other".to_string(),
                }),
                Some("rust")
            )
            .is_err()
        );
    }

    #[test]
    fn only_explicit_bounded_local_protocol_configurations_can_be_approved() {
        let mut configuration = CodeToolConfiguration::default();
        assert!(validate_configuration(&configuration, "lsp", "rust").is_ok());
        configuration.enabled = true;
        assert!(validate_configuration(&configuration, "lsp", "rust").is_err());
        configuration.executable = "/synthetic/rust-analyzer".to_string();
        assert!(validate_configuration(&configuration, "lsp", "rust").is_ok());
        configuration.transport = "tcp".to_string();
        assert!(validate_configuration(&configuration, "lsp", "rust").is_err());
        configuration.arguments = vec!["--port".to_string(), "%PORT%".to_string()];
        assert!(validate_configuration(&configuration, "dap", "rust").is_ok());
        configuration.arguments = vec!["argument".to_string(); 65];
        assert!(validate_configuration(&configuration, "dap", "rust").is_err());
        configuration.transport = "java".to_string();
        configuration.arguments.clear();
        configuration.executable.clear();
        assert!(validate_configuration(&configuration, "dap", "java").is_ok());
        assert!(validate_configuration(&configuration, "dap", "python").is_err());
    }
}
