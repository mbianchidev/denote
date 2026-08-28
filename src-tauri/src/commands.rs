use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

use crate::{
    crypto::{self, EncryptionPhase},
    db::{self, AppState},
    error::{AppError, AppResult},
    models::{
        DocumentBatch, EncryptionSetupResult, FileEncoding, FileLineEnding, HistoryRevision,
        KnownVault, KnownVaultFileBatch, MarkdownViewMode, NoteDocument, RecoveryCodesResult,
        SaveOutcome, TagColor, WorkspaceSnapshot,
    },
    vault,
};

fn active_key(
    state: &State<'_, AppState>,
    root: &std::path::Path,
) -> AppResult<Option<Zeroizing<[u8; 32]>>> {
    let Some(manifest) = crypto::load_manifest(root)? else {
        return Ok(None);
    };
    if manifest.phase != EncryptionPhase::Encrypted {
        return Err(AppError::Crypto(
            "Vault encryption maintenance is incomplete. Lock and unlock the vault to resume."
                .to_string(),
        ));
    }
    Ok(Some(state.vault_key()?))
}

fn populate_encryption_status(
    state: &State<'_, AppState>,
    snapshot: &mut WorkspaceSnapshot,
) -> AppResult<()> {
    snapshot.encryption =
        vault::encryption_status(&snapshot.vault_path, state.vault_is_unlocked()?)?;
    Ok(())
}

fn seal_active_vault_before_switch(state: &State<'_, AppState>) -> AppResult<()> {
    let Some(root) = state.active_vault_optional()? else {
        return Ok(());
    };
    let Some(manifest) = crypto::load_manifest(&root)? else {
        return Ok(());
    };
    if manifest.phase == EncryptionPhase::Encrypted && state.vault_is_unlocked()? {
        let key = state.vault_key()?;
        vault::seal_vault_contents(&state.db_path, &root.to_string_lossy(), &key)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_last_vault(state: State<'_, AppState>) -> AppResult<Option<WorkspaceSnapshot>> {
    let _vault_access = state.write_vault_access()?;
    let Some(path) = vault::get_last_vault(&state.db_path)? else {
        return Ok(None);
    };
    let mut snapshot = vault::open_vault(&state.db_path, &path)?;
    state.set_active_vault(snapshot.vault_path.clone().into())?;
    populate_encryption_status(&state, &mut snapshot)?;
    Ok(Some(snapshot))
}

#[tauri::command]
pub fn list_known_vaults(state: State<'_, AppState>) -> AppResult<Vec<KnownVault>> {
    let _vault_access = state.read_vault_access()?;
    let connection = db::open(&state.db_path)?;
    let current = state.active_vault_optional()?;
    let mut vaults = db::list_known_vaults(&connection)?
        .into_iter()
        .map(|vault| {
            let path = std::path::Path::new(&vault.path);
            let available = path.is_dir();
            let current = current.as_deref() == Some(path);
            KnownVault {
                id: vault.id,
                name: vault.name,
                path: vault.path,
                last_opened_at: vault.last_opened_at,
                available,
                current,
                default: vault.default,
            }
        })
        .collect::<Vec<_>>();
    vaults.sort_by_key(|vault| !vault.current);
    Ok(vaults)
}

#[tauri::command]
pub fn list_known_vault_files(state: State<'_, AppState>) -> AppResult<KnownVaultFileBatch> {
    let _vault_access = state.read_vault_access()?;
    let current = state.active_vault_optional()?;
    vault::list_known_vault_files(&state.db_path, current.as_deref())
}

#[tauri::command]
pub fn open_known_vault(state: State<'_, AppState>, vault_id: i64) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.write_vault_access()?;
    let connection = db::open(&state.db_path)?;
    let path = db::known_vault_path(&connection, vault_id)?
        .ok_or_else(|| AppError::NotFound(format!("Vault {vault_id}")))?;
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        AppError::NotFound(format!("Vault folder is unavailable: {path} ({error})"))
    })?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(AppError::NotFound(format!(
            "Vault folder is unavailable or unsafe: {path}"
        )));
    }
    seal_active_vault_before_switch(&state)?;
    let mut snapshot = vault::open_vault(&state.db_path, &path)?;
    state.set_active_vault(snapshot.vault_path.clone().into())?;
    populate_encryption_status(&state, &mut snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_known_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    vault_id: i64,
    trash_files: bool,
) -> AppResult<()> {
    let _vault_access = state.write_vault_access()?;
    let mut connection = db::open(&state.db_path)?;
    let vault = db::known_vault(&connection, vault_id)?
        .ok_or_else(|| AppError::NotFound(format!("Vault {vault_id}")))?;
    if vault.default {
        return Err(AppError::InvalidData(
            "The built-in Denote Welcome vault cannot be removed".to_string(),
        ));
    }
    let path = Path::new(&vault.path);
    if state.active_vault_optional()?.as_deref() == Some(path) {
        return Err(AppError::InvalidData(
            "Switch to another vault before removing this one".to_string(),
        ));
    }
    if trash_files {
        let path = safe_vault_trash_path(&app, path)?;
        trash::delete(&path).map_err(|error| AppError::Trash(error.to_string()))?;
    }
    db::delete_known_vault(&mut connection, vault_id, &vault.path)
}

fn safe_vault_trash_path(app: &AppHandle, stored_path: &Path) -> AppResult<PathBuf> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| AppError::State(format!("Unable to resolve home folder: {error}")))?;
    let app_data = app.path().app_data_dir().map_err(|error| {
        AppError::State(format!(
            "Unable to resolve application-data folder: {error}"
        ))
    })?;
    validate_vault_trash_path(stored_path, &home, &app_data)
}

fn validate_vault_trash_path(
    stored_path: &Path,
    home_path: &Path,
    app_data_path: &Path,
) -> AppResult<PathBuf> {
    let metadata = fs::symlink_metadata(stored_path)?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Vault folder is not a regular directory: {}",
            stored_path.display()
        )));
    }
    let path = fs::canonicalize(stored_path)?;
    if path != stored_path || path.parent().is_none() || path.components().count() < 4 {
        return Err(AppError::InvalidPath(format!(
            "Vault folder cannot be moved to Trash: {}",
            stored_path.display()
        )));
    }
    let home = fs::canonicalize(home_path)?;
    let app_data = fs::canonicalize(app_data_path)?;
    if path == home || app_data.starts_with(&path) {
        return Err(AppError::InvalidPath(format!(
            "Refusing to move a system or application-data folder to Trash: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
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
    let _vault_access = state.write_vault_access()?;
    seal_active_vault_before_switch(&state)?;
    let mut snapshot = vault::open_vault(&state.db_path, &path.to_string_lossy())?;
    state.set_active_vault(snapshot.vault_path.clone().into())?;
    populate_encryption_status(&state, &mut snapshot)?;
    Ok(Some(snapshot))
}

#[tauri::command]
pub fn refresh_vault(state: State<'_, AppState>) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let mut snapshot = vault::refresh_vault(&state.db_path, &root.to_string_lossy())?;
    populate_encryption_status(&state, &mut snapshot)?;
    Ok(snapshot)
}

fn refreshed_snapshot(state: &State<'_, AppState>) -> AppResult<WorkspaceSnapshot> {
    let root = state.active_vault()?;
    let mut snapshot = vault::refresh_vault(&state.db_path, &root.to_string_lossy())?;
    populate_encryption_status(state, &mut snapshot)?;
    Ok(snapshot)
}

fn finish_pending_encryption(
    state: &State<'_, AppState>,
    root: &std::path::Path,
    manifest: &mut crypto::EncryptionManifest,
    key: &[u8; 32],
) -> AppResult<()> {
    match manifest.phase {
        EncryptionPhase::Encrypting => {
            vault::encrypt_vault_contents(&state.db_path, &root.to_string_lossy(), key)?;
            manifest.phase = EncryptionPhase::Encrypted;
            crypto::save_manifest(root, manifest)?;
        }
        EncryptionPhase::Decrypting => {
            vault::decrypt_vault_contents(&state.db_path, &root.to_string_lossy(), key)?;
            crypto::remove_manifest(root)?;
            state.clear_vault_key()?;
        }
        EncryptionPhase::Encrypted => {
            let skipped =
                vault::sweep_vault_encryption(&state.db_path, &root.to_string_lossy(), key)?;
            if skipped > 0 {
                eprintln!(
                    "Vault unlocked, but {skipped} file(s) could not be checked for encryption"
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn enable_vault_encryption(
    state: State<'_, AppState>,
    password: String,
) -> AppResult<EncryptionSetupResult> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let control_lock = vault::acquire_vault_control_lock(&root)?;
    if crypto::manifest_exists(&root) {
        return Err(AppError::Crypto(
            "Vault encryption is already enabled".to_string(),
        ));
    }
    let password = Zeroizing::new(password);
    let (mut manifest, vault_key, recovery_codes) = crypto::create_manifest(&password)?;
    crypto::save_manifest(&root, &manifest)?;
    drop(control_lock);
    let key = vault_key.copy_bytes();
    state.set_vault_key(vault_key)?;
    finish_pending_encryption(&state, &root, &mut manifest, &key)?;
    Ok(EncryptionSetupResult {
        snapshot: refreshed_snapshot(&state)?,
        recovery_codes,
    })
}

#[tauri::command]
pub fn unlock_vault_with_password(
    state: State<'_, AppState>,
    password: String,
) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let control_lock = vault::acquire_vault_control_lock(&root)?;
    let mut manifest = crypto::load_manifest(&root)?
        .ok_or_else(|| AppError::Crypto("Vault encryption is not enabled".to_string()))?;
    let password = Zeroizing::new(password);
    let vault_key = crypto::unlock_with_password(&manifest, &password)?;
    drop(control_lock);
    let key = vault_key.copy_bytes();
    state.set_vault_key(vault_key)?;
    finish_pending_encryption(&state, &root, &mut manifest, &key)?;
    refreshed_snapshot(&state)
}

#[tauri::command]
pub fn unlock_vault_with_recovery_code(
    state: State<'_, AppState>,
    recovery_code: String,
) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let control_lock = vault::acquire_vault_control_lock(&root)?;
    let mut manifest = crypto::load_manifest(&root)?
        .ok_or_else(|| AppError::Crypto("Vault encryption is not enabled".to_string()))?;
    let recovery_code = Zeroizing::new(recovery_code);
    let vault_key = crypto::unlock_with_recovery_code(&mut manifest, &recovery_code)?;
    crypto::save_manifest(&root, &manifest)?;
    drop(control_lock);
    let key = vault_key.copy_bytes();
    state.set_vault_key(vault_key)?;
    finish_pending_encryption(&state, &root, &mut manifest, &key)?;
    refreshed_snapshot(&state)
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    if let Some(manifest) = crypto::load_manifest(&root)?
        && manifest.phase == EncryptionPhase::Encrypted
    {
        let key = state.vault_key()?;
        vault::seal_vault_contents(&state.db_path, &root.to_string_lossy(), &key)?;
    }
    state.clear_vault_key()?;
    refreshed_snapshot(&state)
}

#[tauri::command]
pub fn change_vault_password(state: State<'_, AppState>, password: String) -> AppResult<()> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let _control_lock = vault::acquire_vault_control_lock(&root)?;
    let mut manifest = crypto::load_manifest(&root)?
        .ok_or_else(|| AppError::Crypto("Vault encryption is not enabled".to_string()))?;
    let key = active_key(&state, &root)?;
    let key = key.as_ref().ok_or_else(|| {
        AppError::Crypto("Unlock the vault before changing its password".to_string())
    })?;
    let password = Zeroizing::new(password);
    crypto::change_password(&mut manifest, key, &password)?;
    crypto::save_manifest(&root, &manifest)
}

#[tauri::command]
pub fn regenerate_vault_recovery_codes(
    state: State<'_, AppState>,
) -> AppResult<RecoveryCodesResult> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let _control_lock = vault::acquire_vault_control_lock(&root)?;
    let mut manifest = crypto::load_manifest(&root)?
        .ok_or_else(|| AppError::Crypto("Vault encryption is not enabled".to_string()))?;
    let key = active_key(&state, &root)?;
    let key = key.as_ref().ok_or_else(|| {
        AppError::Crypto("Unlock the vault before generating recovery codes".to_string())
    })?;
    let recovery_codes = crypto::regenerate_recovery_codes(&mut manifest, key)?;
    crypto::save_manifest(&root, &manifest)?;
    Ok(RecoveryCodesResult {
        remaining_recovery_codes: manifest.recovery.len(),
        recovery_codes,
    })
}

#[tauri::command]
pub fn disable_vault_encryption(state: State<'_, AppState>) -> AppResult<WorkspaceSnapshot> {
    let _vault_access = state.write_vault_access()?;
    let root = state.active_vault()?;
    let control_lock = vault::acquire_vault_control_lock(&root)?;
    let mut manifest = crypto::load_manifest(&root)?
        .ok_or_else(|| AppError::Crypto("Vault encryption is not enabled".to_string()))?;
    let key = active_key(&state, &root)?
        .ok_or_else(|| AppError::Crypto("Unlock the vault before decrypting it".to_string()))?;
    manifest.phase = EncryptionPhase::Decrypting;
    crypto::save_manifest(&root, &manifest)?;
    drop(control_lock);
    vault::decrypt_vault_contents(&state.db_path, &root.to_string_lossy(), &key)?;
    crypto::remove_manifest(&root)?;
    state.clear_vault_key()?;
    refreshed_snapshot(&state)
}

#[tauri::command]
pub fn copy_file_path(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let absolute_path = vault::absolute_entry_path(&root.to_string_lossy(), &path)?;
    app.clipboard()
        .write_text(absolute_path)
        .map_err(|error| AppError::Clipboard(error.to_string()))
}

#[tauri::command]
pub fn read_note(state: State<'_, AppState>, path: String) -> AppResult<NoteDocument> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::read_note(
        &state.db_path,
        &root.to_string_lossy(),
        &path,
        key.as_deref(),
    )
}

#[tauri::command]
pub fn save_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
    encoding: FileEncoding,
    line_ending: FileLineEnding,
    reason: Option<String>,
    expected_hash: Option<String>,
) -> AppResult<SaveOutcome> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::save_note(
        &state.db_path,
        &root.to_string_lossy(),
        &path,
        &content,
        encoding,
        line_ending,
        reason.as_deref().unwrap_or("autosave"),
        expected_hash.as_deref(),
        key.as_deref(),
    )
}

#[tauri::command]
pub fn create_entry(
    state: State<'_, AppState>,
    parent_path: String,
    name: String,
    directory: bool,
) -> AppResult<String> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::create_entry(
        &state.db_path,
        &root.to_string_lossy(),
        &parent_path,
        &name,
        directory,
        key.as_deref(),
    )
}

#[tauri::command]
pub fn rename_entry(
    state: State<'_, AppState>,
    path: String,
    new_name: String,
) -> AppResult<String> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::rename_entry(&state.db_path, &root.to_string_lossy(), &path, &new_name)
}

#[tauri::command]
pub fn trash_entry(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::trash_entry(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn restore_trash_item(state: State<'_, AppState>, item_id: i64) -> AppResult<String> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::restore_trash_item(&state.db_path, &root.to_string_lossy(), item_id)
}

#[tauri::command]
pub fn empty_trash(state: State<'_, AppState>) -> AppResult<usize> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::empty_trash(&state.db_path, &root.to_string_lossy())
}

#[tauri::command]
pub fn complete_exit(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let _vault_access = state.write_vault_access()?;
    if let Some(root) = state.active_vault_optional()?
        && let Some(manifest) = crypto::load_manifest(&root)?
        && manifest.phase == EncryptionPhase::Encrypted
        && state.vault_is_unlocked()?
    {
        let key = state.vault_key()?;
        vault::seal_vault_contents(&state.db_path, &root.to_string_lossy(), &key)?;
    }
    state.allow_exit();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn set_bookmark(state: State<'_, AppState>, path: String, bookmarked: bool) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::set_bookmark(&state.db_path, &root.to_string_lossy(), &path, bookmarked)
}

#[tauri::command]
pub fn record_edit(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<crate::models::NoteStats> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::record_edit(&state.db_path, &root.to_string_lossy(), &path)
}

#[tauri::command]
pub fn set_entry_order(state: State<'_, AppState>, paths: Vec<String>) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::set_entry_order(&state.db_path, &root.to_string_lossy(), &paths)
}

#[tauri::command]
pub fn set_entry_pinned(state: State<'_, AppState>, path: String, pinned: bool) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::set_entry_pinned(&state.db_path, &root.to_string_lossy(), &path, pinned)
}

#[tauri::command]
pub fn set_tag_color(
    state: State<'_, AppState>,
    tag: String,
    color: String,
) -> AppResult<TagColor> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::set_tag_color(&state.db_path, &root.to_string_lossy(), &tag, &color)
}

#[tauri::command]
pub fn set_note_view_mode(
    state: State<'_, AppState>,
    path: String,
    mode: MarkdownViewMode,
) -> AppResult<()> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    vault::set_note_view_mode(&state.db_path, &root.to_string_lossy(), &path, mode)
}

#[tauri::command]
pub fn list_history(state: State<'_, AppState>, path: String) -> AppResult<Vec<HistoryRevision>> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::list_history(
        &state.db_path,
        &root.to_string_lossy(),
        &path,
        key.as_deref(),
    )
}

#[tauri::command]
pub fn restore_revision(
    state: State<'_, AppState>,
    path: String,
    revision_id: i64,
) -> AppResult<NoteDocument> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::restore_revision(
        &state.db_path,
        &root.to_string_lossy(),
        &path,
        revision_id,
        key.as_deref(),
    )
}

#[tauri::command]
pub fn list_search_documents(state: State<'_, AppState>) -> AppResult<DocumentBatch> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::list_search_documents(&state.db_path, &root.to_string_lossy(), key.as_deref())
}

#[tauri::command]
pub fn list_editable_documents(state: State<'_, AppState>) -> AppResult<DocumentBatch> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::list_editable_documents(&state.db_path, &root.to_string_lossy(), key.as_deref())
}

#[tauri::command]
pub fn read_image_data_url(
    state: State<'_, AppState>,
    note_path: Option<String>,
    image_source: String,
) -> AppResult<String> {
    let _vault_access = state.read_vault_access()?;
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::read_image_data_url(
        &state.db_path,
        &root.to_string_lossy(),
        note_path.as_deref(),
        &image_source,
        key.as_deref(),
    )
}

#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    note_path: String,
    file_name: String,
    data_base64: String,
) -> AppResult<String> {
    let _vault_access = state.read_vault_access()?;
    const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
    const MAX_BASE64_BYTES: usize = MAX_ATTACHMENT_BYTES.div_ceil(3) * 4;
    if data_base64.len() > MAX_BASE64_BYTES {
        return Err(AppError::InvalidData(
            "Attachment is larger than the 25 MB limit".to_string(),
        ));
    }
    let data = STANDARD
        .decode(data_base64)
        .map_err(|error| AppError::InvalidData(format!("Invalid attachment data: {error}")))?;
    if data.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::InvalidData(
            "Attachment is larger than the 25 MB limit".to_string(),
        ));
    }
    let root = state.active_vault()?;
    let key = active_key(&state, &root)?;
    vault::save_attachment(
        &root.to_string_lossy(),
        &note_path,
        &file_name,
        &data,
        key.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn vault_trash_validation_rejects_broad_or_application_paths() {
        let directory = tempdir().expect("temp directory");
        let home = directory.path().join("home");
        let app_data = directory.path().join("application-data");
        let vault = home.join("vault");
        fs::create_dir_all(&vault).expect("vault");
        fs::create_dir_all(&app_data).expect("application data");
        let home = fs::canonicalize(home).expect("canonical home");
        let app_data = fs::canonicalize(app_data).expect("canonical application data");
        let vault = fs::canonicalize(vault).expect("canonical vault");

        assert_eq!(
            validate_vault_trash_path(&vault, &home, &app_data).expect("safe vault"),
            vault
        );
        assert!(validate_vault_trash_path(&home, &home, &app_data).is_err());
        assert!(validate_vault_trash_path(directory.path(), &home, &app_data).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn vault_trash_validation_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let home = directory.path().join("home");
        let app_data = directory.path().join("application-data");
        let target = directory.path().join("target");
        let link = directory.path().join("vault-link");
        fs::create_dir_all(&home).expect("home");
        fs::create_dir_all(&app_data).expect("application data");
        fs::create_dir_all(&target).expect("target");
        symlink(&target, &link).expect("vault symlink");
        let home = fs::canonicalize(home).expect("canonical home");
        let app_data = fs::canonicalize(app_data).expect("canonical application data");

        assert!(validate_vault_trash_path(&link, &home, &app_data).is_err());
    }
}
