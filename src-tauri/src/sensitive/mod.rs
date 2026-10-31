pub(crate) mod audio;
pub(crate) mod credentials;
mod private_file;
pub(crate) mod speech_engine;
pub(crate) mod speech_helper;

use tauri::{AppHandle, Manager};

use crate::{
    commands,
    db::AppState,
    error::{AppError, AppResult},
    plugins::PluginManager,
};

pub(crate) async fn scoped<T, F>(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    capability: &'static str,
    operation: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState, &std::path::Path, Option<&[u8; 32]>) -> AppResult<T> + Send + 'static,
{
    let manager = app.state::<PluginManager>().inner().clone();
    commands::run_vault_read(app, move |state, root| {
        manager.enabled_permission(&plugin_id, capability)?;
        if root != std::path::Path::new(&workspace_scope) {
            return Err(AppError::State(
                "The sensitive operation expired after a vault switch.".into(),
            ));
        }
        let key = commands::active_key(state, root)?;
        operation(state, root, key.as_deref())
    })
    .await
}

pub(crate) fn revoke_plugin(plugin_id: &str) -> AppResult<()> {
    let credentials = credentials::revoke(Some(plugin_id));
    let speech = speech_engine::cancel(Some(plugin_id), None);
    credentials.and(speech)
}

pub(crate) fn revoke_all() -> AppResult<()> {
    let credentials = credentials::revoke(None);
    let speech = speech_engine::cancel(None, None);
    credentials.and(speech)
}

pub(crate) fn invalidate_credentials() -> u64 {
    credentials::invalidate()
}
pub(crate) fn lock_credentials_before(generation: u64) -> AppResult<()> {
    credentials::lock_before(generation)
}

#[tauri::command]
pub(crate) async fn stop_sensitive_tools(plugin_id: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || revoke_plugin(&plugin_id))
        .await
        .map_err(|_| AppError::State("Unable to stop sensitive tools.".into()))?
}
