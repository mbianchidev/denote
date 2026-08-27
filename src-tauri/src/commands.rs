use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    db::AppState,
    error::{AppError, AppResult},
    models::{HistoryRevision, NoteDocument, SaveOutcome, SearchDocument, WorkspaceSnapshot},
    vault,
};

#[tauri::command]
pub fn get_last_vault(state: State<'_, AppState>) -> AppResult<Option<WorkspaceSnapshot>> {
    let Some(path) = vault::get_last_vault(&state.db_path)? else {
        return Ok(None);
    };
    let snapshot = vault::open_vault(&state.db_path, &path)?;
    state.set_active_vault(snapshot.vault_path.clone().into())?;
    Ok(Some(snapshot))
}

#[tauri::command]
pub async fn choose_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<WorkspaceSnapshot>> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose a Denote vault")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| AppError::InvalidPath(error.to_string()))?;
    let snapshot = vault::open_vault(&state.db_path, &path.to_string_lossy())?;
    state.set_active_vault(snapshot.vault_path.clone().into())?;
    Ok(Some(snapshot))
}

#[tauri::command]
pub fn refresh_vault(state: State<'_, AppState>) -> AppResult<WorkspaceSnapshot> {
    let root = state.active_vault()?;
    vault::refresh_vault(&state.db_path, &root.to_string_lossy())
}

#[tauri::command]
pub fn read_note(state: State<'_, AppState>, path: String) -> AppResult<NoteDocument> {
    let root = state.active_vault()?;
    vault::read_note(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn save_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
    reason: Option<String>,
) -> AppResult<SaveOutcome> {
    let root = state.active_vault()?;
    vault::save_note(
        &state.db_path,
        &root.to_string_lossy(),
        &path,
        &content,
        reason.as_deref().unwrap_or("autosave"),
    )
}

#[tauri::command]
pub fn create_entry(
    state: State<'_, AppState>,
    parent_path: String,
    name: String,
    directory: bool,
) -> AppResult<String> {
    let root = state.active_vault()?;
    vault::create_entry(
        &state.db_path,
        &root.to_string_lossy(),
        &parent_path,
        &name,
        directory,
    )
}

#[tauri::command]
pub fn rename_entry(
    state: State<'_, AppState>,
    path: String,
    new_name: String,
) -> AppResult<String> {
    let root = state.active_vault()?;
    vault::rename_entry(&state.db_path, &root.to_string_lossy(), &path, &new_name)
}

#[tauri::command]
pub fn trash_entry(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let root = state.active_vault()?;
    vault::trash_entry(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn restore_trash_item(state: State<'_, AppState>, item_id: i64) -> AppResult<String> {
    let root = state.active_vault()?;
    vault::restore_trash_item(&state.db_path, &root.to_string_lossy(), item_id)
}

#[tauri::command]
pub fn set_bookmark(state: State<'_, AppState>, path: String, bookmarked: bool) -> AppResult<()> {
    let root = state.active_vault()?;
    vault::set_bookmark(&state.db_path, &root.to_string_lossy(), &path, bookmarked)
}

#[tauri::command]
pub fn record_edit(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<crate::models::NoteStats> {
    let root = state.active_vault()?;
    vault::record_edit(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn set_entry_order(state: State<'_, AppState>, paths: Vec<String>) -> AppResult<()> {
    let root = state.active_vault()?;
    vault::set_entry_order(&state.db_path, &root.to_string_lossy(), &paths)
}

#[tauri::command]
pub fn list_history(state: State<'_, AppState>, path: String) -> AppResult<Vec<HistoryRevision>> {
    let root = state.active_vault()?;
    vault::list_history(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn restore_revision(
    state: State<'_, AppState>,
    path: String,
    revision_id: i64,
) -> AppResult<NoteDocument> {
    let root = state.active_vault()?;
    vault::restore_revision(&state.db_path, &root.to_string_lossy(), &path, revision_id)
}

#[tauri::command]
pub fn list_search_documents(state: State<'_, AppState>) -> AppResult<Vec<SearchDocument>> {
    let root = state.active_vault()?;
    vault::list_search_documents(&state.db_path, &root.to_string_lossy())
}

#[tauri::command]
pub fn read_image_data_url(
    state: State<'_, AppState>,
    note_path: Option<String>,
    image_source: String,
) -> AppResult<String> {
    let root = state.active_vault()?;
    vault::read_image_data_url(
        &state.db_path,
        &root.to_string_lossy(),
        note_path.as_deref(),
        &image_source,
    )
}

#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    note_path: String,
    file_name: String,
    data: Vec<u8>,
) -> AppResult<String> {
    let root = state.active_vault()?;
    vault::save_attachment(&root.to_string_lossy(), &note_path, &file_name, &data)
}
