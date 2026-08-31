use std::fs;

use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;

use crate::{
    commands,
    db::AppState,
    error::{AppError, AppResult},
    vault,
};

use super::{
    PluginManager,
    types::{
        InstalledPlugin, PluginNetworkRequest, PluginNetworkResponse, PluginPermission,
        PluginProcessRequest, PluginProcessResult, PluginTextDocument, PluginView,
    },
};

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
    state: State<'_, PluginManager>,
    app_state: State<'_, AppState>,
    plugin_id: String,
    request: PluginProcessRequest,
    project_id: Option<String>,
) -> AppResult<PluginProcessResult> {
    let current_dir = if let Some(project_id) = project_id {
        let _vault_access = app_state.read_vault_access()?;
        let root = app_state.active_vault()?;
        Some(vault::resolve_project_root(
            &app_state.db_path,
            &root.to_string_lossy(),
            &project_id,
        )?)
    } else {
        None
    };
    let manager = state.inner().clone();
    run_blocking(move || manager.process_request(&plugin_id, request, current_dir.as_deref())).await
}
