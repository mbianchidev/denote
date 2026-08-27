use tauri::State;

use crate::{
    db::AppState,
    error::AppResult,
    models::{HistoryRevision, NoteDocument, SaveOutcome, SearchDocument, WorkspaceSnapshot},
    vault,
};

#[tauri::command]
pub fn get_last_vault(state: State<'_, AppState>) -> AppResult<Option<String>> {
    vault::get_last_vault(&state.db_path)
}

#[tauri::command]
pub fn open_vault(state: State<'_, AppState>, vault_path: String) -> AppResult<WorkspaceSnapshot> {
    vault::open_vault(&state.db_path, &vault_path)
}

#[tauri::command]
pub fn refresh_vault(
    state: State<'_, AppState>,
    vault_path: String,
) -> AppResult<WorkspaceSnapshot> {
    vault::refresh_vault(&state.db_path, &vault_path)
}

#[tauri::command]
pub fn read_note(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
) -> AppResult<NoteDocument> {
    vault::read_note(&state.db_path, &vault_path, &path)
}

#[tauri::command]
pub fn save_note(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
    content: String,
    reason: Option<String>,
) -> AppResult<SaveOutcome> {
    vault::save_note(
        &state.db_path,
        &vault_path,
        &path,
        &content,
        reason.as_deref().unwrap_or("autosave"),
    )
}

#[tauri::command]
pub fn create_entry(
    state: State<'_, AppState>,
    vault_path: String,
    parent_path: String,
    name: String,
    directory: bool,
) -> AppResult<String> {
    vault::create_entry(&state.db_path, &vault_path, &parent_path, &name, directory)
}

#[tauri::command]
pub fn rename_entry(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
    new_name: String,
) -> AppResult<String> {
    vault::rename_entry(&state.db_path, &vault_path, &path, &new_name)
}

#[tauri::command]
pub fn trash_entry(state: State<'_, AppState>, vault_path: String, path: String) -> AppResult<()> {
    vault::trash_entry(&state.db_path, &vault_path, &path)
}

#[tauri::command]
pub fn restore_trash_item(
    state: State<'_, AppState>,
    vault_path: String,
    item_id: i64,
) -> AppResult<String> {
    vault::restore_trash_item(&state.db_path, &vault_path, item_id)
}

#[tauri::command]
pub fn set_bookmark(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
    bookmarked: bool,
) -> AppResult<()> {
    vault::set_bookmark(&state.db_path, &vault_path, &path, bookmarked)
}

#[tauri::command]
pub fn set_entry_order(
    state: State<'_, AppState>,
    vault_path: String,
    paths: Vec<String>,
) -> AppResult<()> {
    vault::set_entry_order(&state.db_path, &vault_path, &paths)
}

#[tauri::command]
pub fn list_history(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
) -> AppResult<Vec<HistoryRevision>> {
    vault::list_history(&state.db_path, &vault_path, &path)
}

#[tauri::command]
pub fn restore_revision(
    state: State<'_, AppState>,
    vault_path: String,
    path: String,
    revision_id: i64,
) -> AppResult<NoteDocument> {
    vault::restore_revision(&state.db_path, &vault_path, &path, revision_id)
}

#[tauri::command]
pub fn list_search_documents(
    state: State<'_, AppState>,
    vault_path: String,
) -> AppResult<Vec<SearchDocument>> {
    vault::list_search_documents(&state.db_path, &vault_path)
}

#[tauri::command]
pub fn read_image_data_url(
    vault_path: String,
    note_path: Option<String>,
    image_source: String,
) -> AppResult<String> {
    vault::read_image_data_url(&vault_path, note_path.as_deref(), &image_source)
}

#[tauri::command]
pub fn save_attachment(
    vault_path: String,
    note_path: String,
    file_name: String,
    data: Vec<u8>,
) -> AppResult<String> {
    vault::save_attachment(&vault_path, &note_path, &file_name, &data)
}
