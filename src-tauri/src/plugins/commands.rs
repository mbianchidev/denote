use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use zeroize::Zeroize;

use crate::{
    commands,
    crypto::{self, EncryptionPhase},
    db::AppState,
    error::{AppError, AppResult},
    models::WorkspaceSnapshot,
    vault,
};

use super::{
    PluginManager,
    auto_commit::{AutomaticCommitOutcome, AutomaticCommitRequest, AutomaticCommitTarget},
    clone::{
        CloneAttempt, PluginGitCloneCleanupOutcome, PluginGitCloneVaultOutcome,
        PluginGitCloneVaultRequest,
    },
    git::{
        GitRequestTarget, GitTransportPolicy, PluginGitRequest, PluginGitResult, PluginGitScope,
    },
    github::GitHubRepository,
    tools::{ExecutableMode, ToolKind},
    types::{
        InstalledPlugin, PluginBundle, PluginNetworkRequest, PluginNetworkResponse,
        PluginPermission, PluginProcessRequest, PluginProcessResult, PluginTextDocument,
        PluginView,
    },
};

/// What a clone returns to the renderer.
///
/// `outcome` is the only half a plugin ever sees. `snapshot` is present just
/// long enough for the host renderer to open the new vault, and the plugin
/// runtime removes it before answering the plugin.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCloneVaultResponse {
    pub outcome: PluginGitCloneVaultOutcome,
    pub snapshot: Option<WorkspaceSnapshot>,
}

async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::State(format!("Background plugin task failed: {error}")))?
}

#[tauri::command]
pub fn list_plugins(state: State<'_, PluginManager>) -> AppResult<Vec<PluginView>> {
    state.list()
}

#[tauri::command]
pub fn list_plugin_bundles(state: State<'_, PluginManager>) -> AppResult<Vec<PluginBundle>> {
    state.bundles()
}

#[tauri::command]
pub async fn prepare_plugin_enable(
    state: State<'_, PluginManager>,
    plugin_id: String,
    approved_permissions: Vec<PluginPermission>,
) -> AppResult<InstalledPlugin> {
    let manager = state.inner().clone();
    run_blocking(move || manager.prepare(&plugin_id, approved_permissions)).await
}

#[tauri::command]
pub async fn commit_plugin_enable(
    state: State<'_, PluginManager>,
    transaction_id: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.commit_enable(&transaction_id)).await
}

#[tauri::command]
pub async fn rollback_plugin_enable(
    state: State<'_, PluginManager>,
    transaction_id: String,
    error: Option<String>,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.rollback_enable(&transaction_id, error)).await
}

#[tauri::command]
pub async fn recover_plugin_transactions(state: State<'_, PluginManager>) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.recover_pending_transactions()).await
}

#[tauri::command]
pub async fn disable_plugin(
    state: State<'_, PluginManager>,
    plugin_id: String,
    clear_data: bool,
    clear_credentials: bool,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.disable(&plugin_id, clear_data, clear_credentials)).await
}

#[tauri::command]
pub async fn read_plugin_entrypoint(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<String> {
    let manager = state.inner().clone();
    run_blocking(move || manager.read_entrypoint(&plugin_id)).await
}

#[tauri::command]
pub fn get_plugin_settings(state: State<'_, PluginManager>, plugin_id: String) -> AppResult<Value> {
    state.settings(&plugin_id)
}

#[tauri::command]
pub fn set_plugin_settings(
    state: State<'_, PluginManager>,
    plugin_id: String,
    settings: Value,
) -> AppResult<Value> {
    state.set_settings(&plugin_id, settings)
}

#[tauri::command]
pub fn import_plugin_settings(
    state: State<'_, PluginManager>,
    plugin_id: String,
    source_version: u32,
    settings: Value,
) -> AppResult<Value> {
    state.import_settings(&plugin_id, source_version, settings)
}

#[tauri::command]
pub fn get_plugin_tool_statuses(
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<Vec<super::ToolStatus>> {
    state.tool_statuses(&plugin_id)
}

#[tauri::command]
pub fn choose_plugin_executable(app: AppHandle, tool: String) -> AppResult<Option<String>> {
    let kind = match tool.as_str() {
        "git" => ToolKind::Git,
        "github-cli" => ToolKind::GitHubCli,
        _ => {
            return Err(AppError::Plugin(
                "Executable picker received an unknown tool".to_string(),
            ));
        }
    };
    let selected = app
        .dialog()
        .file()
        .set_title(match kind {
            ToolKind::Git => "Choose a Git executable",
            ToolKind::GitHubCli => "Choose a GitHub CLI executable",
        })
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| AppError::InvalidPath(error.to_string()))?;
    let value = path.to_string_lossy().into_owned();
    let status = super::tools::inspect(
        std::path::Path::new(""),
        std::path::Path::new(""),
        kind,
        ExecutableMode::Custom,
        Some(&value),
    );
    if status.validation_status != "valid" {
        return Err(AppError::Plugin(status.message));
    }
    Ok(status.resolved_path)
}

#[tauri::command]
pub fn plugin_storage_get(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<Option<Value>> {
    state.storage_get(&plugin_id, &key)
}

#[tauri::command]
pub fn plugin_storage_set(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
    value: Value,
) -> AppResult<()> {
    state.storage_set(&plugin_id, &key, value)
}

#[tauri::command]
pub fn plugin_storage_delete(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<()> {
    state.storage_delete(&plugin_id, &key)
}

#[tauri::command]
pub fn plugin_storage_clear(state: State<'_, PluginManager>, plugin_id: String) -> AppResult<()> {
    state.storage_clear(&plugin_id)
}

#[tauri::command]
pub async fn plugin_secret_get(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<Option<String>> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_get(&plugin_id, &key)).await
}

#[tauri::command]
pub async fn plugin_secret_set(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
    value: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_set(&plugin_id, &key, &value)).await
}

#[tauri::command]
pub async fn plugin_secret_delete(
    state: State<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> AppResult<()> {
    let manager = state.inner().clone();
    run_blocking(move || manager.secret_delete(&plugin_id, &key)).await
}

#[tauri::command]
pub fn authorize_plugin_capability(
    state: State<'_, PluginManager>,
    app_state: State<'_, AppState>,
    plugin_id: String,
    capability: String,
    workspace_scope: Option<String>,
) -> AppResult<()> {
    state.enabled_permission(&plugin_id, &capability)?;
    if capability.starts_with("workspace-") {
        let expected = workspace_scope.ok_or_else(|| {
            AppError::Plugin("Workspace capability lease is missing its vault scope".to_string())
        })?;
        let active = app_state.active_vault()?;
        if fs::canonicalize(expected)? != active {
            return Err(AppError::Plugin(
                "Workspace capability lease expired after a vault switch".to_string(),
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_workspace_read(
    state: State<'_, PluginManager>,
    app_state: State<'_, AppState>,
    plugin_id: String,
    workspace_scope: String,
    path: String,
    write_permission: bool,
) -> AppResult<PluginTextDocument> {
    let capability = if write_permission {
        "workspace-write"
    } else {
        "workspace-read"
    };
    state.enabled_permission(&plugin_id, capability)?;
    let _vault_access = app_state.read_vault_access()?;
    let root = app_state.active_vault()?;
    if fs::canonicalize(&workspace_scope)? != root {
        return Err(AppError::Plugin(
            "Workspace capability lease expired after a vault switch".to_string(),
        ));
    }
    let key = commands::active_key(&app_state, &root)?;
    let document = vault::read_note_without_recording(
        &app_state.db_path,
        &root.to_string_lossy(),
        &path,
        key.as_deref(),
    )?;
    Ok(PluginTextDocument {
        content: document.content,
        version: document.content_hash,
    })
}

#[tauri::command]
pub fn plugin_workspace_write(
    state: State<'_, PluginManager>,
    app_state: State<'_, AppState>,
    plugin_id: String,
    workspace_scope: String,
    path: String,
    content: String,
    version: String,
) -> AppResult<()> {
    state.enabled_permission(&plugin_id, "workspace-write")?;
    let _vault_access = app_state.read_vault_access()?;
    let root = app_state.active_vault()?;
    if fs::canonicalize(&workspace_scope)? != root {
        return Err(AppError::Plugin(
            "Workspace capability lease expired after a vault switch".to_string(),
        ));
    }
    let key = commands::active_key(&app_state, &root)?;
    let current = vault::read_note_without_recording(
        &app_state.db_path,
        &root.to_string_lossy(),
        &path,
        key.as_deref(),
    )?;
    vault::save_note(
        &app_state.db_path,
        &root.to_string_lossy(),
        &path,
        &content,
        current.encoding,
        current.line_ending,
        "plugin action",
        Some(&version),
        key.as_deref(),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_network_request(
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: PluginNetworkRequest,
) -> AppResult<PluginNetworkResponse> {
    let manager = state.inner().clone();
    run_blocking(move || manager.network_request(&plugin_id, request)).await
}

#[tauri::command]
pub async fn plugin_clipboard_read(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
) -> AppResult<String> {
    state.enabled_permission(&plugin_id, "clipboard-read")?;
    run_blocking(move || {
        app.clipboard()
            .read_text()
            .map_err(|error| AppError::Clipboard(error.to_string()))
    })
    .await
}

#[tauri::command]
pub fn plugin_clipboard_write(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    text: String,
) -> AppResult<()> {
    state.enabled_permission(&plugin_id, "clipboard-write")?;
    if text.len() > 1024 * 1024 {
        return Err(AppError::Plugin(
            "Plugin clipboard text exceeds 1 MiB".to_string(),
        ));
    }
    app.clipboard()
        .write_text(text)
        .map_err(|error| AppError::Clipboard(error.to_string()))
}

#[tauri::command]
pub fn plugin_show_notification(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    title: String,
    body: Option<String>,
) -> AppResult<()> {
    state.enabled_permission(&plugin_id, "notifications")?;
    if title.is_empty() || title.len() > 120 || body.as_ref().is_some_and(|body| body.len() > 1024)
    {
        return Err(AppError::Plugin(
            "Plugin notification exceeds safety limits".to_string(),
        ));
    }
    let mut notification = app.notification().builder().title(title);
    if let Some(body) = body {
        notification = notification.body(body);
    }
    notification
        .show()
        .map_err(|error| AppError::Plugin(format!("Unable to show plugin notification: {error}")))
}

#[tauri::command]
pub async fn plugin_process_request(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: PluginProcessRequest,
    project_id: Option<String>,
) -> AppResult<PluginProcessResult> {
    let manager = state.inner().clone();
    run_blocking(move || {
        let app_state = app.state::<AppState>();
        process_request_with_app_state(
            &manager,
            &app_state,
            &plugin_id,
            request,
            project_id.as_deref(),
        )
    })
    .await
}

pub(super) fn process_request_with_app_state(
    manager: &PluginManager,
    app_state: &AppState,
    plugin_id: &str,
    request: PluginProcessRequest,
    project_id: Option<&str>,
) -> AppResult<PluginProcessResult> {
    let _vault_access = if project_id.is_some() {
        Some(app_state.read_vault_access()?)
    } else {
        None
    };
    let current_dir = if let Some(project_id) = project_id {
        let root = app_state.active_vault()?;
        Some(vault::resolve_project_root(
            &app_state.db_path,
            &root.to_string_lossy(),
            project_id,
        )?)
    } else {
        None
    };
    manager.process_request(plugin_id, request, current_dir.as_deref())
}

#[tauri::command]
pub async fn plugin_git_request(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: PluginGitRequest,
    workspace_scope: String,
    project_id: Option<String>,
    operation_id: String,
    signing_passphrase: Option<String>,
    signing_override: Option<bool>,
) -> AppResult<PluginGitResult> {
    let manager = state.inner().clone();
    run_blocking(move || {
        let mut signing_passphrase = signing_passphrase;
        let app_state = app.state::<AppState>();
        let result = git_request_with_app_state_and_passphrase(
            &manager,
            &app_state,
            &plugin_id,
            request,
            &workspace_scope,
            project_id.as_deref(),
            &operation_id,
            signing_passphrase.as_deref(),
            signing_override,
        );
        if let Some(passphrase) = signing_passphrase.as_mut() {
            passphrase.zeroize();
        }
        result
    })
    .await
}

// Every parameter is a distinct authorisation input: plugin identity, request,
// captured scope, project identity, and operation ID. The Git executable is
// deliberately not among them; it is read from host-owned plugin settings.
#[cfg(test)]
pub(super) fn git_request_with_app_state(
    manager: &PluginManager,
    app_state: &AppState,
    plugin_id: &str,
    request: PluginGitRequest,
    workspace_scope: &str,
    project_id: Option<&str>,
    operation_id: &str,
) -> AppResult<PluginGitResult> {
    git_request_with_app_state_and_passphrase(
        manager,
        app_state,
        plugin_id,
        request,
        workspace_scope,
        project_id,
        operation_id,
        None,
        None,
    )
}

fn git_request_with_app_state_and_passphrase(
    manager: &PluginManager,
    app_state: &AppState,
    plugin_id: &str,
    request: PluginGitRequest,
    workspace_scope: &str,
    project_id: Option<&str>,
    operation_id: &str,
    signing_passphrase: Option<&str>,
    signing_override: Option<bool>,
) -> AppResult<PluginGitResult> {
    manager.enabled_permission(plugin_id, "git")?;
    let Some(scope) = request.scope() else {
        // Cancellation carries no scope so it stays callable from a concurrent
        // source-control action while an operation is still running.
        return manager.git_request_with_signing_options(
            plugin_id,
            request,
            GitRequestTarget {
                repository_root: Path::new(""),
                redacted_roots: Vec::new(),
                encrypted: false,
            },
            operation_id,
            signing_passphrase,
            signing_override,
        );
    };
    let _vault_access = app_state.read_vault_access()?;
    let root = active_vault_for_scope(app_state, workspace_scope)?;
    let encrypted = git_encryption_preflight(app_state, &root)?;
    let repository_root = match scope {
        PluginGitScope::Vault => root.clone(),
        PluginGitScope::Project => {
            let project_id = project_id.ok_or_else(|| {
                AppError::Plugin(
                    "The Git request asked for project scope without an active project".to_string(),
                )
            })?;
            vault::resolve_project_root(&app_state.db_path, &root.to_string_lossy(), project_id)?
        }
    };
    // Revalidate the captured vault scope and project identity immediately
    // before execution so a switch during the preflight cannot be used.
    let revalidated_root = active_vault_for_scope(app_state, workspace_scope)?;
    if revalidated_root != root {
        return Err(AppError::Plugin(
            "Git capability lease expired after a vault switch".to_string(),
        ));
    }
    if let PluginGitScope::Project = scope {
        let project_id = project_id.unwrap_or_default();
        let current =
            vault::resolve_project_root(&app_state.db_path, &root.to_string_lossy(), project_id)?;
        if current != repository_root {
            return Err(AppError::Plugin(
                "Git capability lease expired after the project moved".to_string(),
            ));
        }
    }
    let redacted_roots = vec![repository_root.clone(), root];
    manager.git_request_with_signing_options(
        plugin_id,
        request,
        GitRequestTarget {
            repository_root: &repository_root,
            redacted_roots,
            encrypted,
        },
        operation_id,
        signing_passphrase,
        signing_override,
    )
}

#[tauri::command]
pub async fn plugin_automatic_commit(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: AutomaticCommitRequest,
    workspace_scope: String,
    project_id: Option<String>,
    operation_id: String,
) -> AppResult<AutomaticCommitOutcome> {
    let manager = state.inner().clone();
    run_blocking(move || {
        let app_state = app.state::<AppState>();
        automatic_commit_with_app_state(
            &manager,
            &app_state,
            &plugin_id,
            request,
            &workspace_scope,
            project_id.as_deref(),
            &operation_id,
        )
    })
    .await
}

/// Runs one standing automatic commit. The host, not a plugin, decides which
/// repository it applies to: the scope is the active project when one is
/// marked and the vault otherwise, and both are revalidated immediately before
/// execution.
pub(super) fn automatic_commit_with_app_state(
    manager: &PluginManager,
    app_state: &AppState,
    plugin_id: &str,
    request: AutomaticCommitRequest,
    workspace_scope: &str,
    project_id: Option<&str>,
    operation_id: &str,
) -> AppResult<AutomaticCommitOutcome> {
    manager.enabled_permission(plugin_id, "git")?;
    manager.enabled_permission(plugin_id, "automatic-local-commit")?;
    let _vault_access = app_state.read_vault_access()?;
    let root = active_vault_for_scope(app_state, workspace_scope)?;
    // A locked vault, unfinished encryption maintenance, or a sweep that could
    // not verify every file is a reason to wait for the next interval rather
    // than to force a commit through.
    let encrypted = match git_encryption_preflight(app_state, &root) {
        Ok(encrypted) => encrypted,
        Err(error) => return Ok(AutomaticCommitOutcome::skipped(error.to_string())),
    };
    let repository_root = match project_id {
        Some(project_id) => {
            vault::resolve_project_root(&app_state.db_path, &root.to_string_lossy(), project_id)?
        }
        None => root.clone(),
    };
    let revalidated_root = active_vault_for_scope(app_state, workspace_scope)?;
    if revalidated_root != root {
        return Err(AppError::Plugin(
            "Automatic commit scope expired after a vault switch".to_string(),
        ));
    }
    if let Some(project_id) = project_id {
        let current =
            vault::resolve_project_root(&app_state.db_path, &root.to_string_lossy(), project_id)?;
        if current != repository_root {
            return Err(AppError::Plugin(
                "Automatic commit scope expired after the project moved".to_string(),
            ));
        }
    }
    let redacted_roots = vec![repository_root.clone(), root];
    manager.automatic_commit(
        plugin_id,
        request,
        AutomaticCommitTarget {
            repository_root: &repository_root,
            redacted_roots,
            encrypted,
        },
        operation_id,
    )
}

fn active_vault_for_scope(app_state: &AppState, workspace_scope: &str) -> AppResult<PathBuf> {
    let root = app_state.active_vault()?;
    if fs::canonicalize(workspace_scope)? != root {
        return Err(AppError::Plugin(
            "Git capability lease expired after a vault switch".to_string(),
        ));
    }
    Ok(root)
}

/// Encrypted vaults must be fully sealed and unlocked before Git inspects or
/// mutates the worktree, so plaintext is never staged. The key is used only for
/// the sweep and never reaches the plugin or the Git transport.
fn git_encryption_preflight(app_state: &AppState, root: &Path) -> AppResult<bool> {
    let Some(manifest) = crypto::load_manifest(root)? else {
        return Ok(false);
    };
    if manifest.phase != EncryptionPhase::Encrypted {
        return Err(AppError::Crypto(
            "Vault encryption maintenance is incomplete. Lock and unlock the vault to resume."
                .to_string(),
        ));
    }
    let key = app_state.vault_key()?;
    let skipped = vault::sweep_vault_encryption(&app_state.db_path, &root.to_string_lossy(), &key)?;
    if skipped > 0 {
        return Err(AppError::Crypto(format!(
            "{skipped} vault file(s) could not be verified as encrypted. Resolve them before running Git."
        )));
    }
    Ok(true)
}

// ---------------------------------------------------------------------------
// GitHub adapter and cloning
// ---------------------------------------------------------------------------

/// Lists repositories through the host's own GitHub CLI adapter.
///
/// The Git permission is required because this is the same authority that runs
/// remote operations. The vault scope is revalidated so a listing cannot be
/// started under a lease that a vault switch has already invalidated, and only
/// bounded metadata is returned. The caller's operation ID makes the listing
/// cancellable while it runs, exactly like a Git command.
#[tauri::command]
pub async fn plugin_github_list_repositories(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    limit: u32,
    workspace_scope: String,
    operation_id: String,
) -> AppResult<Vec<GitHubRepository>> {
    let manager = state.inner().clone();
    run_blocking(move || {
        let app_state = app.state::<AppState>();
        manager.enabled_permission(&plugin_id, "git")?;
        let _vault_access = app_state.read_vault_access()?;
        active_vault_for_scope(&app_state, &workspace_scope)?;
        manager.list_github_repositories(&plugin_id, limit, &operation_id)
    })
    .await
}

/// Clones a repository into a folder the user picks, then opens it as a vault.
///
/// The chooser, the destination, the credentials, and the vault registration
/// are all host-owned. A plugin supplies a URL, an authentication mode, and an
/// optional branch, and never learns where the vault is.
#[tauri::command]
pub async fn plugin_git_clone_vault(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    request: PluginGitCloneVaultRequest,
    workspace_scope: String,
    operation_id: String,
) -> AppResult<PluginCloneVaultResponse> {
    let manager = state.inner().clone();
    manager.enabled_permission(&plugin_id, "git")?;
    {
        let app_state = app.state::<AppState>();
        let _vault_access = app_state.read_vault_access()?;
        active_vault_for_scope(&app_state, &workspace_scope)?;
    }
    let selected = app
        .dialog()
        .file()
        .set_title("Choose an empty folder for the cloned vault")
        .blocking_pick_folder();
    // Cancelling the chooser is an ordinary outcome, not a failure.
    let Some(selected) = selected else {
        return Ok(PluginCloneVaultResponse {
            outcome: PluginGitCloneVaultOutcome::Cancelled,
            snapshot: None,
        });
    };
    let destination = selected
        .into_path()
        .map_err(|error| AppError::InvalidPath(error.to_string()))?;
    let cloning = {
        let manager = manager.clone();
        let plugin_id = plugin_id.clone();
        let destination = destination.clone();
        run_blocking(move || {
            manager.clone_into_destination(
                &plugin_id,
                &request,
                &destination,
                &operation_id,
                GitTransportPolicy::RemoteOnly,
            )
        })
        .await?
    };
    let clone = match cloning {
        CloneAttempt::Failed {
            message,
            cleanup_token,
        } => {
            return Ok(PluginCloneVaultResponse {
                outcome: PluginGitCloneVaultOutcome::Failed {
                    message,
                    cleanup_token,
                },
                snapshot: None,
            });
        }
        CloneAttempt::Cloned(clone) => clone,
    };
    // Registration happens only now, after the checkout passed every
    // validation, so a half-finished clone never becomes a known vault.
    let app_state = app.state::<AppState>();
    let _vault_access = app_state.write_vault_access()?;
    commands::seal_active_vault_before_switch(&app_state)?;
    let mut snapshot = vault::open_vault(&app_state.db_path, &clone.path.to_string_lossy())?;
    app_state.set_active_vault(snapshot.vault_path.clone().into())?;
    commands::populate_encryption_status(&app_state, &mut snapshot)?;
    Ok(PluginCloneVaultResponse {
        outcome: PluginGitCloneVaultOutcome::Cloned {
            label: clone.label,
            remote_url: clone.remote_url,
            branch: clone.branch,
            default_branch: clone.default_branch,
            upstream: clone.upstream,
        },
        // The snapshot is for the host renderer only. The runtime strips it
        // before anything is returned to the plugin.
        snapshot: Some(snapshot),
    })
}

/// Deletes the destination of a clone that failed, named only by its opaque
/// token. The active vault, and anything containing it, is protected here as
/// well as in the registry, so a token can never reach a live vault.
#[tauri::command]
pub async fn plugin_git_clean_failed_clone(
    app: AppHandle,
    state: State<'_, PluginManager>,
    plugin_id: String,
    cleanup_token: String,
    workspace_scope: String,
) -> AppResult<PluginGitCloneCleanupOutcome> {
    let manager = state.inner().clone();
    run_blocking(move || {
        let app_state = app.state::<AppState>();
        let _vault_access = app_state.read_vault_access()?;
        let root = active_vault_for_scope(&app_state, &workspace_scope)?;
        manager.clean_failed_clone(&plugin_id, &cleanup_token, &[root])
    })
    .await
}
