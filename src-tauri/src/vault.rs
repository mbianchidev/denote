use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use base64::{Engine, engine::general_purpose::STANDARD};
use fs2::FileExt as Fs2FileExt;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    crypto, db,
    error::{AppError, AppResult},
    models::{
        DocumentBatch, FileEncoding, FileKind, FileLineEnding, FileNode, HistoryRevision,
        KnownVaultFile, KnownVaultFileBatch, LinkRewriteBatch, MAX_SESSION_PANES, MarkdownViewMode,
        NoteDocument, ProjectConfiguration, ProjectRoot, ProjectWorkspace, SaveOutcome,
        SearchDocument, TabGroup, TabSessionState, TabSessionTab, TagColor, TrashItem,
        WelcomePagePreference, WorkspaceSnapshot,
    },
};

const MAX_EDIT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_SEARCH_BYTES: u64 = 10 * 1024 * 1024;
const MAX_SEARCH_AGGREGATE_BYTES: usize = 64 * 1024 * 1024;
const MAX_EDITABLE_AGGREGATE_BYTES: usize = 256 * 1024 * 1024;
const MAX_LINK_REWRITE_BYTES: u64 = 1024 * 1024;
const MAX_LINK_REWRITE_AGGREGATE_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_GLOBAL_FILE_ENTRIES: usize = 25_000;
const CLIPBOARD_FILE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_TAB_SESSION_TABS: usize = 100;
const MAX_TAB_SESSION_GROUPS: usize = 50;
const DEFAULT_WELCOME_PAGE: &str = ".denote.md";
const LEGACY_GUIDE_WELCOME_PAGE: &str = "Welcome.md";

pub fn get_last_vault(db_path: &Path) -> AppResult<Option<String>> {
    let connection = db::open(db_path)?;
    let path = db::get_last_vault(&connection)?;
    Ok(path.filter(|value| Path::new(value).is_dir()))
}

pub fn open_vault(db_path: &Path, vault_path: &str) -> AppResult<WorkspaceSnapshot> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, vault_name) = ensure_vault(&connection, &root)?;
    db::set_last_vault(&connection, &path_to_string(&root))?;
    snapshot(&mut connection, vault_id, &root, vault_name)
}

pub fn open_cached_vault(db_path: &Path, vault_path: &str) -> AppResult<WorkspaceSnapshot> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, vault_name) = ensure_vault(&connection, &root)?;
    db::set_last_vault(&connection, &path_to_string(&root))?;
    cached_snapshot(&mut connection, vault_id, &root, vault_name)
}

pub fn refresh_vault(db_path: &Path, vault_path: &str) -> AppResult<WorkspaceSnapshot> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, vault_name) = ensure_vault(&connection, &root)?;
    snapshot(&mut connection, vault_id, &root, vault_name)
}

pub fn encryption_status(
    vault_path: &str,
    unlocked: bool,
) -> AppResult<crate::models::EncryptionStatus> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let Some(manifest) = crypto::load_manifest(&root)? else {
        return Ok(Default::default());
    };
    Ok(crate::models::EncryptionStatus {
        enabled: true,
        unlocked: unlocked && manifest.phase == crypto::EncryptionPhase::Encrypted,
        phase: Some(manifest.phase),
        remaining_recovery_codes: manifest.recovery.len(),
    })
}

pub fn absolute_entry_path(vault_path: &str, relative_path: &str) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let path = existing_entry(&root, relative_path)?;
    Ok(path_to_string(&path))
}

pub fn stage_clipboard_file(
    vault_path: &str,
    relative_path: &str,
    content: &str,
    encoding: FileEncoding,
    line_ending: FileLineEnding,
    app_cache_dir: &Path,
) -> AppResult<PathBuf> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let source = existing_entry(&root, relative_path)?;
    if !source.is_file() {
        return Err(AppError::UnsupportedFile(format!(
            "{relative_path} is not a regular file"
        )));
    }
    let bytes = encode_file_content(content, encoding, line_ending)?;
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(
            "File is larger than the 25 MB attachment-copy limit".to_string(),
        ));
    }
    let cache_root = prepare_clipboard_cache_root(app_cache_dir)?;
    prune_stale_clipboard_files_in_root(&cache_root)?;
    let staging = cache_root.join(Uuid::new_v4().to_string());
    create_private_directory(&staging)?;
    let destination = staging.join(
        source
            .file_name()
            .ok_or_else(|| AppError::InvalidPath(relative_path.to_string()))?,
    );
    let write_result = write_private_file(&destination, &bytes);
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(destination)
}

pub fn prune_stale_clipboard_files(app_cache_dir: &Path) -> AppResult<()> {
    let cache_root = prepare_clipboard_cache_root(app_cache_dir)?;
    prune_stale_clipboard_files_in_root(&cache_root)
}

fn prune_stale_clipboard_files_in_root(cache_root: &Path) -> AppResult<()> {
    let cutoff = SystemTime::now()
        .checked_sub(CLIPBOARD_FILE_MAX_AGE)
        .unwrap_or(UNIX_EPOCH);
    for entry in fs::read_dir(cache_root)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata_is_link(&metadata) {
            fs::remove_file(entry.path())?;
            continue;
        }
        if metadata.is_dir() && metadata.modified().unwrap_or(UNIX_EPOCH) < cutoff {
            fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}

pub fn remove_other_clipboard_files(cache_root: &Path, keep: &Path) -> AppResult<()> {
    validate_clipboard_cache_root(cache_root)?;
    for entry in fs::read_dir(cache_root)? {
        let entry = entry?;
        let path = entry.path();
        if path == keep {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)?;
        if metadata_is_link(&metadata) {
            fs::remove_file(path)?;
        } else if metadata.is_dir() {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

pub fn remove_staged_clipboard_file(staged: &Path) -> AppResult<()> {
    let parent = staged
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path_to_string(staged)))?;
    let cache_root = parent
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path_to_string(staged)))?;
    validate_clipboard_cache_root(cache_root)?;
    let metadata = fs::symlink_metadata(parent)?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(AppError::InvalidPath(path_to_string(parent)));
    }
    fs::remove_dir_all(parent)?;
    Ok(())
}

fn prepare_clipboard_cache_root(app_cache_dir: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(app_cache_dir)?;
    let app_cache_dir = fs::canonicalize(app_cache_dir)?;
    let cache_root = app_cache_dir.join("clipboard-files");
    match fs::symlink_metadata(&cache_root) {
        Ok(metadata) => {
            if metadata_is_link(&metadata) || !metadata.is_dir() {
                return Err(AppError::InvalidPath(format!(
                    "Clipboard cache is not a regular directory: {}",
                    cache_root.display()
                )));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_private_directory(&cache_root)?;
        }
        Err(error) => return Err(error.into()),
    }
    validate_clipboard_cache_root(&cache_root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&cache_root, fs::Permissions::from_mode(0o700))?;
    }
    Ok(cache_root)
}

fn validate_clipboard_cache_root(cache_root: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(cache_root)?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Clipboard cache is not a regular directory: {}",
            cache_root.display()
        )));
    }
    Ok(())
}

fn create_private_directory(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700).create(path)?;
    }
    #[cfg(not(unix))]
    fs::create_dir(path)?;
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

pub fn encrypt_vault_contents(
    db_path: &Path,
    vault_path: &str,
    vault_key: &[u8; 32],
) -> AppResult<()> {
    transform_vault_encryption_with_mode(db_path, vault_path, vault_key, true, true, true)?;
    Ok(())
}

pub fn decrypt_vault_contents(
    db_path: &Path,
    vault_path: &str,
    vault_key: &[u8; 32],
) -> AppResult<()> {
    transform_vault_encryption_with_mode(db_path, vault_path, vault_key, false, true, false)?;
    Ok(())
}

pub fn seal_vault_contents(
    db_path: &Path,
    vault_path: &str,
    vault_key: &[u8; 32],
) -> AppResult<()> {
    transform_vault_encryption_with_mode(db_path, vault_path, vault_key, true, true, false)?;
    Ok(())
}

pub fn sweep_vault_encryption(
    db_path: &Path,
    vault_path: &str,
    vault_key: &[u8; 32],
) -> AppResult<usize> {
    transform_vault_encryption_with_mode(db_path, vault_path, vault_key, true, false, false)
}

fn transform_vault_encryption_with_mode(
    db_path: &Path,
    vault_path: &str,
    vault_key: &[u8; 32],
    encrypting: bool,
    strict: bool,
    scrub_history_residue: bool,
) -> AppResult<usize> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let walker = WalkDir::new(&root).follow_links(false).into_iter();
    let mut skipped_files = 0;
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                let error = AppError::Io(
                    error
                        .into_io_error()
                        .unwrap_or_else(|| std::io::Error::other("Unable to scan vault")),
                );
                if strict {
                    return Err(error);
                }
                skipped_files += 1;
                eprintln!("Skipping unreadable file during encryption sweep: {error}");
                continue;
            }
        };
        if !entry.file_type().is_file() || is_encryption_control_file(&root, entry.path()) {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) if strict => return Err(error.into()),
            Err(error) => {
                skipped_files += 1;
                eprintln!(
                    "Skipping unreadable file metadata during encryption sweep: {}: {error}",
                    path_to_string(entry.path())
                );
                continue;
            }
        };
        if metadata_is_link(&metadata) {
            continue;
        }
        let encrypted = match file_is_encrypted(entry.path()) {
            Ok(encrypted) => encrypted,
            Err(error) if strict => return Err(error),
            Err(error) => {
                skipped_files += 1;
                eprintln!(
                    "Skipping unreadable file during encryption sweep: {}: {error}",
                    path_to_string(entry.path())
                );
                continue;
            }
        };
        if encrypting != encrypted {
            if let Err(error) = transform_file_encryption(entry.path(), vault_key, encrypting) {
                if strict {
                    return Err(error);
                }
                skipped_files += 1;
                eprintln!(
                    "Unable to encrypt file during unlock sweep: {}: {error}",
                    path_to_string(entry.path())
                );
            }
        }
    }

    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let mut last_id = 0;
    loop {
        let rows = db::history_rows_after(&connection, vault_id, last_id, 100)?;
        if rows.is_empty() {
            break;
        }
        let transaction = connection.transaction()?;
        for row in rows {
            last_id = row.id;
            if encrypting && !row.is_encrypted {
                db::update_history_storage(
                    &transaction,
                    row.id,
                    &crypto::encrypt_history_content(vault_key, &row.content)?,
                    true,
                )?;
            } else if !encrypting && row.is_encrypted {
                db::update_history_storage(
                    &transaction,
                    row.id,
                    &crypto::decrypt_history_content(vault_key, &row.content)?,
                    false,
                )?;
            }
        }
        transaction.commit()?;
    }
    if scrub_history_residue {
        db::scrub_deleted_content(&connection)?;
    }
    Ok(skipped_files)
}

pub fn read_note(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteDocument> {
    read_note_impl(db_path, vault_path, relative_path, vault_key, true)
}

pub fn read_note_without_recording(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteDocument> {
    read_note_impl(db_path, vault_path, relative_path, vault_key, false)
}

fn read_note_impl(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    vault_key: Option<&[u8; 32]>,
    record_open: bool,
) -> AppResult<NoteDocument> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let path = existing_entry(&root, relative_path)?;
    if !path.is_file() {
        return Err(AppError::UnsupportedFile(format!(
            "{relative_path} is not a regular file"
        )));
    }
    if file_plaintext_len(&path)? > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(format!(
            "{relative_path} is larger than 25 MB"
        )));
    }
    let bytes = read_plain_file(&path, vault_key)?;
    let (content, encoding, line_ending) = decode_file_content(&bytes);

    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if record_open {
        db::record_open(&connection, vault_id, relative_path)?;
    }
    let stats = db::get_stats(&connection, vault_id, relative_path)?;
    Ok(NoteDocument {
        path: relative_path.to_string(),
        content_hash: hash_bytes(&bytes),
        content,
        encoding,
        line_ending,
        stats,
    })
}

pub fn save_note(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    content: &str,
    encoding: FileEncoding,
    line_ending: FileLineEnding,
    reason: &str,
    expected_hash: Option<&str>,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<SaveOutcome> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let path = existing_entry(&root, relative_path)?;
    if !path.is_file() {
        return Err(AppError::UnsupportedFile(format!(
            "{relative_path} is not a regular file"
        )));
    }
    let next_bytes = encode_file_content(content, encoding, line_ending)?;
    if next_bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(
            "File is larger than the 25 MB save limit".to_string(),
        ));
    }
    if file_plaintext_len(&path)? > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(
            "Existing file is larger than the 25 MB edit limit".to_string(),
        ));
    }

    let _note_lock = acquire_note_lock(&root, relative_path)?;
    let previous_bytes = read_plain_file(&path, vault_key)?;
    let previous_hash = hash_bytes(&previous_bytes);
    let (previous_content, previous_encoding, previous_line_ending) =
        decode_file_content(&previous_bytes);
    if let Some(expected_hash) = expected_hash
        && expected_hash != previous_hash
    {
        return Err(AppError::Conflict(format!(
            "{relative_path} changed on disk. Reopen it before saving."
        )));
    }
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if previous_bytes == next_bytes {
        return Ok(SaveOutcome {
            path: relative_path.to_string(),
            changed: false,
            saved_at: db::now(),
            content_hash: previous_hash,
            history_count: db::history_count(&connection, vault_id, relative_path)?,
            stats: db::get_stats(&connection, vault_id, relative_path)?,
        });
    }

    let (history_content, history_encrypted) =
        encode_history_at_rest(&root, &previous_content, vault_key)?;
    let history_transaction = connection.transaction()?;
    db::push_history(
        &history_transaction,
        vault_id,
        relative_path,
        &history_content,
        &previous_hash,
        previous_encoding,
        previous_line_ending,
        history_encrypted,
        reason,
    )?;
    history_transaction.commit()?;
    let stored_bytes = encode_file_at_rest(&root, &next_bytes, vault_key)?;
    atomic_write(&path, &stored_bytes)?;
    let save_transaction = connection.transaction()?;
    db::record_save(&save_transaction, vault_id, relative_path)?;
    save_transaction.commit()?;

    let saved_at = db::now();
    Ok(SaveOutcome {
        path: relative_path.to_string(),
        changed: true,
        saved_at,
        content_hash: hash_bytes(&next_bytes),
        history_count: db::history_count(&connection, vault_id, relative_path)?,
        stats: db::get_stats(&connection, vault_id, relative_path)?,
    })
}

pub fn create_entry(
    db_path: &Path,
    vault_path: &str,
    parent_path: &str,
    name: &str,
    directory: bool,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<FileNode> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let parent = if parent_path.is_empty() {
        root.clone()
    } else {
        existing_entry(&root, parent_path)?
    };
    if !parent.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{parent_path} is not a folder"
        )));
    }
    let safe_name = validate_name(name)?;
    let destination = parent.join(safe_name);
    ensure_no_symlinks(&root, &destination, true)?;
    if destination.exists() {
        return Err(AppError::InvalidPath(format!("{name} already exists")));
    }
    if directory {
        fs::create_dir(&destination)?;
    } else {
        let stored_bytes = encode_file_at_rest(&root, &[], vault_key)?;
        create_file_no_replace(&destination, &stored_bytes)?;
    }
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let stats = db::stats_map(&connection, vault_id)?;
    let placements = db::entry_placement_map(&connection, vault_id)?;
    let node = scan_path(&root, &destination, &stats, &placements, 0)?;
    update_cached_tree(&mut connection, vault_id, |tree| {
        refresh_cached_tree_metadata(tree, &stats, &placements);
        insert_cached_node(tree, node.clone())
    });
    Ok(node)
}

pub fn duplicate_file(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<FileNode> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let source = existing_entry(&root, relative_path)?;
    if !source.is_file() {
        return Err(AppError::UnsupportedFile(format!(
            "{relative_path} is not a regular file"
        )));
    }
    if file_plaintext_len(&source)? > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(format!(
            "{relative_path} is larger than 25 MB"
        )));
    }
    let plaintext = read_plain_file(&source, vault_key)?;
    let stored_bytes = encode_file_at_rest(&root, &plaintext, vault_key)?;
    let destination = available_duplicate_path(&source)?;
    ensure_no_symlinks(&root, &destination, true)?;
    create_file_no_replace(&destination, &stored_bytes)?;

    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let stats = db::stats_map(&connection, vault_id)?;
    let placements = db::entry_placement_map(&connection, vault_id)?;
    let node = scan_path(&root, &destination, &stats, &placements, 0)?;
    update_cached_tree(&mut connection, vault_id, |tree| {
        refresh_cached_tree_metadata(tree, &stats, &placements);
        insert_cached_node(tree, node.clone())
    });
    Ok(node)
}

pub fn rename_entry(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    new_name: &str,
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let source = existing_entry(&root, relative_path)?;
    let is_directory = source.is_dir();
    let safe_name = validate_name(new_name)?;
    let parent = source
        .parent()
        .ok_or_else(|| AppError::InvalidPath(relative_path.to_string()))?;
    let destination = parent.join(safe_name);
    if destination.exists() {
        return Err(AppError::InvalidPath(format!("{new_name} already exists")));
    }
    let new_relative = relative_string(&root, &destination)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let operation_id = db::begin_file_operation(
        &connection,
        vault_id,
        "rename",
        relative_path,
        &new_relative,
        None,
        is_directory,
    )?;
    if let Err(error) = rename_no_replace(&source, &destination) {
        db::cancel_file_operation(&connection, &operation_id)?;
        return Err(error.into());
    }
    if let Err(error) = db::rename_metadata(
        &mut connection,
        vault_id,
        relative_path,
        &new_relative,
        is_directory,
        Some(&operation_id),
    ) {
        return Err(rollback_operation(
            &connection,
            &operation_id,
            &destination,
            &source,
            error,
        ));
    }
    if let Err(error) = reconcile_workspace_children(&connection, vault_id, &root) {
        eprintln!("Unable to refresh project workspace children after rename: {error}");
    }
    Ok(new_relative)
}

pub fn move_entry(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    target_parent_path: &str,
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let source = existing_entry(&root, relative_path)?;
    let is_directory = source.is_dir();
    let target_parent = if target_parent_path.is_empty() {
        root.clone()
    } else {
        existing_entry(&root, target_parent_path)?
    };
    if !target_parent.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{target_parent_path} is not a folder"
        )));
    }
    if source.is_dir() && target_parent.starts_with(&source) {
        return Err(AppError::InvalidPath(
            "A folder cannot be moved into itself".to_string(),
        ));
    }
    let file_name = source
        .file_name()
        .ok_or_else(|| AppError::InvalidPath(relative_path.to_string()))?;
    let destination = target_parent.join(file_name);
    if destination == source {
        return Ok(relative_path.to_string());
    }
    ensure_no_symlinks(&root, &destination, true)?;
    if destination.exists() {
        return Err(AppError::InvalidPath(format!(
            "{} already exists in the target folder",
            file_name.to_string_lossy()
        )));
    }
    let new_relative = relative_string(&root, &destination)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let operation_id = db::begin_file_operation(
        &connection,
        vault_id,
        "rename",
        relative_path,
        &new_relative,
        None,
        is_directory,
    )?;
    if let Err(error) = rename_no_replace(&source, &destination) {
        db::cancel_file_operation(&connection, &operation_id)?;
        return Err(error.into());
    }
    if let Err(error) = db::rename_metadata(
        &mut connection,
        vault_id,
        relative_path,
        &new_relative,
        is_directory,
        Some(&operation_id),
    ) {
        return Err(rollback_operation(
            &connection,
            &operation_id,
            &destination,
            &source,
            error,
        ));
    }
    if let Err(error) = reconcile_workspace_children(&connection, vault_id, &root) {
        eprintln!("Unable to refresh project workspace children after move: {error}");
    }
    Ok(new_relative)
}

pub fn trash_entry(db_path: &Path, vault_path: &str, relative_path: &str) -> AppResult<TrashItem> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let source = existing_entry(&root, relative_path)?;
    let is_directory = source.is_dir();
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidPath(relative_path.to_string()))?;
    let trash_directory = root
        .join(".denote")
        .join("trash")
        .join(Uuid::new_v4().to_string());
    ensure_no_symlinks(&root, &trash_directory, true)?;
    fs::create_dir_all(&trash_directory)?;
    let destination = trash_directory.join(name);
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let trash_relative = relative_internal_string(&root, &destination)?;
    let operation_id = db::begin_file_operation(
        &connection,
        vault_id,
        "trash",
        relative_path,
        &trash_relative,
        None,
        is_directory,
    )?;
    if let Err(error) = fs::rename(&source, &destination) {
        db::cancel_file_operation(&connection, &operation_id)?;
        return Err(error.into());
    }
    let item_id = match db::trash_metadata(
        &mut connection,
        vault_id,
        relative_path,
        &trash_relative,
        is_directory,
        Some(&operation_id),
    ) {
        Ok(item_id) => item_id,
        Err(error) => {
            return Err(rollback_operation(
                &connection,
                &operation_id,
                &destination,
                &source,
                error,
            ));
        }
    };
    let item = db::trash_item(&connection, vault_id, item_id)?
        .ok_or_else(|| AppError::NotFound(format!("Trash item {item_id}")))?;
    update_cached_tree(&mut connection, vault_id, |tree| {
        remove_cached_path(tree, relative_path);
        true
    });
    Ok(item)
}

pub fn restore_trash_item(db_path: &Path, vault_path: &str, item_id: i64) -> AppResult<FileNode> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, true)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let (original_path, trash_path, _) = db::trash_path(&connection, vault_id, item_id)?
        .ok_or_else(|| AppError::NotFound(format!("Trash item {item_id}")))?;
    let source = internal_entry(&root, &trash_path)?;
    let mut restored_destination = None;
    for _ in 0..100 {
        let destination = available_restore_path(&root, &original_path)?;
        ensure_no_symlinks(&root, &destination, true)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let restored_relative = relative_string(&root, &destination)?;
        let operation_id = db::begin_file_operation(
            &connection,
            vault_id,
            "restore",
            &trash_path,
            &restored_relative,
            Some(item_id),
            source.is_dir(),
        )?;
        match rename_no_replace(&source, &destination) {
            Ok(()) => {
                restored_destination = Some((destination, restored_relative, operation_id));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                db::cancel_file_operation(&connection, &operation_id)?;
            }
            Err(error) => {
                db::cancel_file_operation(&connection, &operation_id)?;
                return Err(error.into());
            }
        }
    }
    let (destination, restored_relative, operation_id) = restored_destination.ok_or_else(|| {
        AppError::Conflict("Unable to find a free restore destination".to_string())
    })?;
    if let Err(error) = db::restore_metadata(
        &mut connection,
        vault_id,
        item_id,
        &trash_path,
        &restored_relative,
        Some(&operation_id),
    ) {
        return Err(rollback_operation(
            &connection,
            &operation_id,
            &destination,
            &source,
            error,
        ));
    }
    if let Some(parent) = source.parent() {
        let _ = fs::remove_dir(parent);
    }
    if let Err(error) = reconcile_workspace_children(&connection, vault_id, &root) {
        eprintln!("Unable to refresh project workspace children after restore: {error}");
    }
    let stats = db::stats_map(&connection, vault_id)?;
    let placements = db::entry_placement_map(&connection, vault_id)?;
    let node = scan_path(&root, &destination, &stats, &placements, 0)?;
    update_cached_tree(&mut connection, vault_id, |tree| {
        refresh_cached_tree_metadata(tree, &stats, &placements);
        insert_cached_node(tree, node.clone())
    });
    Ok(node)
}

pub fn empty_trash(db_path: &Path, vault_path: &str) -> AppResult<usize> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let items = db::list_trash(&connection, vault_id)?;
    let mut removed = 0;
    for item in items {
        let Some((_, trash_path, is_directory)) = db::trash_path(&connection, vault_id, item.id)?
        else {
            continue;
        };
        ensure_trash_item_path(&trash_path)?;
        let relative = normalized_relative(&trash_path, true)?;
        let path = root.join(relative);
        ensure_no_symlinks(&root, &path, true)?;
        if path.exists() {
            if is_directory {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }
        db::purge_trash_metadata(&mut connection, vault_id, item.id, &trash_path)?;
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
        removed += 1;
    }
    Ok(removed)
}

pub fn set_bookmark(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    bookmarked: bool,
) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_bookmark(&connection, vault_id, relative_path, bookmarked)
}

pub fn set_tag_color(
    db_path: &Path,
    vault_path: &str,
    tag: &str,
    color: &str,
) -> AppResult<TagColor> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let tag = normalize_tag(tag)?;
    let color = normalize_tag_color(color)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_tag_color(&connection, vault_id, &tag, &color)?;
    Ok(TagColor { tag, color })
}

pub fn set_vault_markdown_view_mode(
    db_path: &Path,
    vault_path: &str,
    mode: MarkdownViewMode,
) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_vault_markdown_view_mode(&mut connection, vault_id, mode)
}

pub fn set_restore_tabs(db_path: &Path, vault_path: &str, enabled: bool) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_restore_tabs(&connection, vault_id, enabled)
}

pub fn set_welcome_page_path(
    db_path: &Path,
    vault_path: &str,
    relative_path: Option<&str>,
) -> AppResult<WelcomePagePreference> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if let Some(relative_path) = relative_path {
        let path = existing_entry(&root, relative_path)?;
        if !path.is_file() || kind_for_path(&path) != FileKind::Markdown {
            return Err(AppError::UnsupportedFile(
                "Only Markdown files can be used as a vault welcome page".to_string(),
            ));
        }
    }
    db::set_welcome_page_path(&connection, vault_id, relative_path)?;
    welcome_page_preference(
        &connection,
        vault_id,
        &root,
        db::is_default_vault(&connection, &path_to_string(&root))?,
    )
}

pub fn mark_project_root(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
) -> AppResult<ProjectConfiguration> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let root_path = validated_project_root_path(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::ensure_project_root(&connection, vault_id, &root_path, true)?;
    if root_path.is_empty() {
        db::dismiss_git_project_suggestion(&connection, vault_id)?;
    }
    project_configuration(&connection, vault_id, &root)
}

pub fn unmark_project_root(
    db_path: &Path,
    vault_path: &str,
    project_root_id: &str,
) -> AppResult<ProjectConfiguration> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if !db::clear_explicit_project_root(&mut connection, vault_id, project_root_id)? {
        return Err(AppError::NotFound(format!(
            "Project root {project_root_id}"
        )));
    }
    project_configuration(&connection, vault_id, &root)
}

pub fn mark_project_workspace(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
) -> AppResult<ProjectConfiguration> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let root_path = validated_project_root_path(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::ensure_project_workspace(&connection, vault_id, &root_path)?;
    if root_path.is_empty() {
        db::dismiss_git_project_suggestion(&connection, vault_id)?;
    }
    reconcile_workspace_children(&connection, vault_id, &root)?;
    project_configuration(&connection, vault_id, &root)
}

pub fn unmark_project_workspace(
    db_path: &Path,
    vault_path: &str,
    workspace_id: &str,
) -> AppResult<ProjectConfiguration> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if !db::delete_project_workspace(&mut connection, vault_id, workspace_id)? {
        return Err(AppError::NotFound(format!(
            "Project workspace {workspace_id}"
        )));
    }
    project_configuration(&connection, vault_id, &root)
}

pub fn dismiss_git_project_suggestion(
    db_path: &Path,
    vault_path: &str,
) -> AppResult<ProjectConfiguration> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::dismiss_git_project_suggestion(&connection, vault_id)?;
    project_configuration(&connection, vault_id, &root)
}

pub(crate) fn resolve_project_root(
    db_path: &Path,
    vault_path: &str,
    project_root_id: &str,
) -> AppResult<PathBuf> {
    let root = canonical_vault(vault_path)
        .map_err(|_| AppError::Plugin("The current vault is unavailable".to_string()))?;
    let _vault_lock = acquire_vault_lock(&root, false).map_err(|_| {
        AppError::Plugin("Unable to verify the selected project folder".to_string())
    })?;
    let connection = db::open(db_path)?;
    let Some((project_vault_path, root_path)) =
        db::project_root_location(&connection, project_root_id)?
    else {
        return Err(AppError::Plugin(
            "The selected project is no longer marked or does not exist".to_string(),
        ));
    };
    if project_vault_path != path_to_string(&root) {
        return Err(AppError::Plugin(
            "The selected project does not belong to the current vault".to_string(),
        ));
    }
    let project_root = if root_path.is_empty() {
        root
    } else {
        existing_entry(&root, &root_path).map_err(|_| {
            AppError::Plugin(
                "The selected project folder is unavailable or is not a safe real directory"
                    .to_string(),
            )
        })?
    };
    if !project_root.is_dir() {
        return Err(AppError::Plugin(
            "The selected project folder is unavailable or is not a safe real directory"
                .to_string(),
        ));
    }
    Ok(project_root)
}

pub fn save_tab_session(
    db_path: &Path,
    vault_path: &str,
    session: &TabSessionState,
) -> AppResult<()> {
    validate_tab_session(session)?;
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::save_tab_session(&mut connection, vault_id, session)
}

pub fn record_edit(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
) -> AppResult<crate::models::NoteStats> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::record_edit(&connection, vault_id, relative_path)?;
    db::get_stats(&connection, vault_id, relative_path)
}

pub fn set_entry_order(db_path: &Path, vault_path: &str, paths: &[String]) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let mut parent = None;
    let mut unique_paths = HashSet::new();
    for path in paths {
        if !unique_paths.insert(path) {
            return Err(AppError::InvalidData(format!(
                "Duplicate path in custom order: {path}"
            )));
        }
        let entry = existing_entry(&root, path)?;
        let entry_parent = entry
            .parent()
            .ok_or_else(|| AppError::InvalidPath(path.to_string()))?;
        if parent
            .as_ref()
            .is_some_and(|expected: &PathBuf| expected != entry_parent)
        {
            return Err(AppError::InvalidData(
                "Custom ordering can only include entries from one folder".to_string(),
            ));
        }
        parent = Some(entry_parent.to_path_buf());
    }
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_entry_order(&mut connection, vault_id, paths)
}

pub fn set_entry_pinned(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    pinned: bool,
) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_entry_pinned(&connection, vault_id, relative_path, pinned)
}

pub fn list_history(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<Vec<HistoryRevision>> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::list_history(&connection, vault_id, relative_path)?
        .into_iter()
        .map(|stored| {
            let content = decode_history_at_rest(&stored.content, stored.is_encrypted, vault_key)?;
            Ok(HistoryRevision {
                id: stored.id,
                created_at: stored.created_at,
                reason: stored.reason,
                preview: history_preview(&content),
                byte_count: history_byte_count(&content, stored.encoding),
                encoding: stored.encoding,
                line_ending: stored.line_ending,
            })
        })
        .collect()
}

pub fn restore_revision(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    revision_id: i64,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteDocument> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let path = existing_entry(&root, relative_path)?;
    if file_plaintext_len(&path)? > MAX_EDIT_BYTES {
        return Err(AppError::InvalidData(
            "File is larger than the 25 MB edit limit".to_string(),
        ));
    }
    let _note_lock = acquire_note_lock(&root, relative_path)?;
    let current_bytes = read_plain_file(&path, vault_key)?;
    let current_hash = hash_bytes(&current_bytes);
    let (current_content, current_encoding, current_line_ending) =
        decode_file_content(&current_bytes);
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let stored_revision = db::history_content(&connection, vault_id, relative_path, revision_id)?
        .ok_or_else(|| AppError::NotFound(format!("Revision {revision_id}")))?;
    let restored = decode_history_at_rest(
        &stored_revision.content,
        stored_revision.is_encrypted,
        vault_key,
    )?;
    let restored_encoding = stored_revision.encoding;
    let restored_line_ending = stored_revision.line_ending;
    let restored_bytes = encode_file_content(&restored, restored_encoding, restored_line_ending)?;
    let (history_content, history_encrypted) =
        encode_history_at_rest(&root, &current_content, vault_key)?;
    let history_transaction = connection.transaction()?;
    db::push_history(
        &history_transaction,
        vault_id,
        relative_path,
        &history_content,
        &current_hash,
        current_encoding,
        current_line_ending,
        history_encrypted,
        "before restore",
    )?;
    history_transaction.commit()?;
    let stored_bytes = encode_file_at_rest(&root, &restored_bytes, vault_key)?;
    atomic_write(&path, &stored_bytes)?;
    let save_transaction = connection.transaction()?;
    db::record_save(&save_transaction, vault_id, relative_path)?;
    save_transaction.commit()?;
    Ok(NoteDocument {
        path: relative_path.to_string(),
        content_hash: hash_bytes(&restored_bytes),
        content: restored,
        encoding: restored_encoding,
        line_ending: restored_line_ending,
        stats: db::get_stats(&connection, vault_id, relative_path)?,
    })
}

pub fn list_known_vault_files(
    db_path: &Path,
    active_vault: Option<&Path>,
) -> AppResult<KnownVaultFileBatch> {
    let connection = db::open(db_path)?;
    let vaults = db::list_all_known_vaults(&connection)?;
    let active_vault = active_vault.map(fs::canonicalize).transpose()?;
    let mut files = Vec::new();
    let mut skipped_vault_count = 0;
    let mut skipped_entry_count = 0;
    let mut truncated = false;

    'vaults: for vault in vaults {
        let stored_metadata = match fs::symlink_metadata(&vault.path) {
            Ok(metadata) => metadata,
            Err(error) => {
                skipped_vault_count += 1;
                eprintln!("Skipping unavailable vault {}: {error}", vault.path);
                continue;
            }
        };
        if metadata_is_link(&stored_metadata) || !stored_metadata.is_dir() {
            skipped_vault_count += 1;
            eprintln!(
                "Skipping non-regular global-search vault root: {}",
                vault.path
            );
            continue;
        }
        let root = match canonical_vault(&vault.path) {
            Ok(root) => root,
            Err(error) => {
                skipped_vault_count += 1;
                eprintln!("Skipping unavailable vault {}: {error}", vault.path);
                continue;
            }
        };
        let current = active_vault.as_deref() == Some(root.as_path());
        let walker = WalkDir::new(&root)
            .follow_links(false)
            .max_depth(65)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !entry.file_type().is_dir()
                    || !entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(".denote")
            });
        for entry in walker {
            if files.len() >= MAX_GLOBAL_FILE_ENTRIES {
                truncated = true;
                break 'vaults;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    skipped_entry_count += 1;
                    eprintln!("Skipping unreadable global-search entry: {error}");
                    continue;
                }
            };
            if entry.depth() == 0 || !entry.file_type().is_file() {
                continue;
            }
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                Err(error) => {
                    skipped_entry_count += 1;
                    eprintln!(
                        "Skipping unreadable global-search metadata {}: {error}",
                        entry.path().display()
                    );
                    continue;
                }
            };
            if metadata_is_link(&metadata) {
                continue;
            }
            let relative = match relative_string(&root, entry.path()) {
                Ok(relative) => relative,
                Err(error) => {
                    skipped_entry_count += 1;
                    eprintln!(
                        "Skipping invalid global-search path {}: {error}",
                        entry.path().display()
                    );
                    continue;
                }
            };
            files.push(KnownVaultFile {
                vault_id: vault.id,
                vault_name: vault.name.clone(),
                path: relative,
                file_name: entry.file_name().to_string_lossy().into_owned(),
                current,
                default: vault.default,
            });
        }
    }
    files.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
            .then_with(|| {
                left.vault_name
                    .to_lowercase()
                    .cmp(&right.vault_name.to_lowercase())
            })
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(KnownVaultFileBatch {
        files,
        skipped_vault_count,
        skipped_entry_count,
        truncated,
    })
}

pub fn list_search_documents(
    db_path: &Path,
    vault_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<DocumentBatch> {
    list_documents(
        db_path,
        vault_path,
        MAX_SEARCH_BYTES,
        MAX_SEARCH_AGGREGATE_BYTES,
        false,
        vault_key,
    )
    .map(|(batch, _)| batch)
}

pub fn list_editable_documents(
    db_path: &Path,
    vault_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<DocumentBatch> {
    list_documents(
        db_path,
        vault_path,
        MAX_EDIT_BYTES,
        MAX_EDITABLE_AGGREGATE_BYTES,
        false,
        vault_key,
    )
    .map(|(batch, _)| batch)
}

pub fn list_link_rewrite_documents(
    db_path: &Path,
    vault_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<LinkRewriteBatch> {
    let (batch, available_paths) = list_documents(
        db_path,
        vault_path,
        MAX_LINK_REWRITE_BYTES,
        MAX_LINK_REWRITE_AGGREGATE_BYTES,
        true,
        vault_key,
    )?;
    Ok(LinkRewriteBatch {
        documents: batch.documents,
        available_paths,
        skipped_count: batch.skipped_count,
        truncated: batch.truncated,
    })
}

fn list_documents(
    db_path: &Path,
    vault_path: &str,
    max_bytes: u64,
    max_aggregate_bytes: usize,
    markdown_only: bool,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<(DocumentBatch, Vec<String>)> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let stats = db::stats_map(&connection, vault_id)?;
    let mut documents = Vec::new();
    let mut skipped_count = 0;
    let mut loaded_bytes: usize = 0;
    let mut truncated = false;
    let mut available_paths = Vec::new();

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_dir()
                || !entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(".denote")
        });
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping unreadable vault entry: {error}");
                continue;
            }
        };
        if entry.path() == root {
            continue;
        }
        let relative = match relative_internal_string(&root, entry.path()) {
            Ok(relative) => relative,
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping invalid vault entry: {error}");
                continue;
            }
        };
        if is_internal_relative_path(&relative) {
            continue;
        }
        let symlink_metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping unreadable vault metadata for {relative}: {error}");
                continue;
            }
        };
        if metadata_is_link(&symlink_metadata) || !entry.file_type().is_file() {
            continue;
        }
        available_paths.push(relative.clone());
        let kind = kind_for_path(entry.path());
        if markdown_only
            && (kind != FileKind::Markdown
                || entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("mdx")))
        {
            continue;
        }
        if markdown_only && truncated {
            continue;
        }
        let plaintext_len = match file_plaintext_len(entry.path()) {
            Ok(length) => length,
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping unreadable file length for {relative}: {error}");
                continue;
            }
        };
        if plaintext_len > max_bytes {
            skipped_count += 1;
            continue;
        }
        let bytes = match read_plain_file(entry.path(), vault_key) {
            Ok(bytes) => bytes,
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping unreadable file {relative}: {error}");
                continue;
            }
        };
        if bytes.len() as u64 > max_bytes {
            skipped_count += 1;
            continue;
        }
        let (content, encoding, line_ending) = decode_file_content(&bytes);
        if markdown_only && encoding != FileEncoding::Utf8 {
            skipped_count += 1;
            continue;
        }
        if loaded_bytes.saturating_add(content.len()) > max_aggregate_bytes {
            truncated = true;
            if markdown_only {
                continue;
            }
            break;
        }
        loaded_bytes += content.len();
        let (tags, title) = if encoding == FileEncoding::Utf8 {
            let title = if kind == FileKind::Markdown {
                document_title(&relative, &content)
            } else {
                title_from_file_path(&relative)
            };
            (extract_tags(&content), title)
        } else {
            (Vec::new(), title_from_file_path(&relative))
        };
        let stored = stats.get(&relative).cloned().unwrap_or_default();
        documents.push(SearchDocument {
            path: relative.clone(),
            title,
            tags,
            content_hash: hash_bytes(&bytes),
            content,
            encoding,
            line_ending,
            kind,
            bookmarked: stored.bookmarked,
            last_opened_at: stored.last_opened_at,
        });
    }
    Ok((
        DocumentBatch {
            documents,
            skipped_count,
            truncated,
        },
        available_paths,
    ))
}

pub fn read_image_data_url(
    _db_path: &Path,
    vault_path: &str,
    note_path: Option<&str>,
    image_source: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let image_path = resolve_image_source(&root, note_path, image_source)?;
    if file_plaintext_len(&image_path)? > MAX_IMAGE_BYTES {
        return Err(AppError::InvalidData(
            "Image is larger than the 25 MB preview limit".to_string(),
        ));
    }
    let kind = kind_for_path(&image_path);
    if kind != FileKind::Image {
        return Err(AppError::UnsupportedFile(image_source.to_string()));
    }
    let mime = mime_guess::from_path(&image_path).first_or_octet_stream();
    let encoded = STANDARD.encode(read_plain_file(&image_path, vault_key)?);
    Ok(format!("data:{mime};base64,{encoded}"))
}

pub fn save_attachment(
    vault_path: &str,
    note_path: &str,
    file_name: &str,
    data: &[u8],
    vault_key: Option<&[u8; 32]>,
) -> AppResult<String> {
    if data.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::InvalidData(
            "Attachment is larger than the 25 MB limit".to_string(),
        ));
    }
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let note = existing_entry(&root, note_path)?;
    let parent = note
        .parent()
        .ok_or_else(|| AppError::InvalidPath(note_path.to_string()))?;
    let safe_name = validate_name(file_name)?;
    let kind = kind_for_path(Path::new(safe_name));
    if kind != FileKind::Image {
        return Err(AppError::UnsupportedFile(file_name.to_string()));
    }
    let attachments = parent.join("assets");
    ensure_no_symlinks(&root, &attachments, true)?;
    fs::create_dir_all(&attachments)?;
    let destination = available_named_path(&attachments, safe_name)?;
    ensure_no_symlinks(&root, &destination, true)?;
    let stored_bytes = encode_file_at_rest(&root, data, vault_key)?;
    atomic_write(&destination, &stored_bytes)?;
    let relative_to_note = destination
        .strip_prefix(parent)
        .map_err(|_| AppError::InvalidPath(file_name.to_string()))?;
    Ok(path_to_forward_slashes(relative_to_note))
}

fn snapshot(
    connection: &mut Connection,
    vault_id: i64,
    root: &Path,
    vault_name: String,
) -> AppResult<WorkspaceSnapshot> {
    reconcile_pending_operations(connection, vault_id, root)?;
    let refresh_generation = db::begin_workspace_tree_refresh(connection, vault_id)?;
    let stats = db::stats_map(connection, vault_id)?;
    let placements = db::entry_placement_map(connection, vault_id)?;
    let tree = scan_directory(root, root, &stats, &placements, 0)?;
    match db::set_workspace_tree_cache_if_current(connection, vault_id, refresh_generation, &tree) {
        Ok(true) => {}
        Ok(false) => eprintln!("Skipped a stale vault tree cache write"),
        Err(error) => eprintln!("Unable to cache the vault tree: {error}"),
    }
    snapshot_with_tree(connection, vault_id, root, vault_name, tree, false)
}

fn cached_snapshot(
    connection: &mut Connection,
    vault_id: i64,
    root: &Path,
    vault_name: String,
) -> AppResult<WorkspaceSnapshot> {
    if !db::pending_file_operations(connection, vault_id)?.is_empty() {
        return snapshot(connection, vault_id, root, vault_name);
    }
    let cached = match db::workspace_tree_cache(connection, vault_id) {
        Ok(cached) => cached,
        Err(error) => {
            eprintln!("Discarding an invalid vault tree cache: {error}");
            db::clear_workspace_tree_cache(connection, vault_id)?;
            None
        }
    };
    let Some(mut tree) = cached else {
        return snapshot(connection, vault_id, root, vault_name);
    };
    let stats = db::stats_map(connection, vault_id)?;
    let placements = db::entry_placement_map(connection, vault_id)?;
    refresh_cached_tree_metadata(&mut tree, &stats, &placements);
    snapshot_with_tree(connection, vault_id, root, vault_name, tree, true)
}

fn snapshot_with_tree(
    connection: &mut Connection,
    vault_id: i64,
    root: &Path,
    vault_name: String,
    tree: Vec<FileNode>,
    from_cache: bool,
) -> AppResult<WorkspaceSnapshot> {
    let tag_colors = db::list_tag_colors(connection, vault_id)?;
    let markdown_view_mode = db::get_vault_markdown_view_mode(connection, vault_id)?;
    let restore_tabs = db::get_restore_tabs(connection, vault_id)?;
    let tab_session = if restore_tabs {
        match db::get_tab_session(connection, vault_id) {
            Ok(Some(session)) => match validate_tab_session(&session) {
                Ok(()) => Some(session),
                Err(error) => {
                    eprintln!("Discarding an invalid saved tab session: {error}");
                    db::clear_tab_session(connection, vault_id)?;
                    None
                }
            },
            Ok(None) => None,
            Err(error) => {
                eprintln!("Discarding an invalid saved tab session: {error}");
                db::clear_tab_session(connection, vault_id)?;
                None
            }
        }
    } else {
        None
    };
    let (mut bookmarks, mut recent) = db::note_lists(connection, vault_id)?;
    bookmarks.retain(|item| existing_entry(root, &item.path).is_ok());
    recent.retain(|item| existing_entry(root, &item.path).is_ok());
    let mut trash = Vec::new();
    for item in db::list_trash(connection, vault_id)? {
        if let Some((_, trash_path, _)) = db::trash_path(connection, vault_id, item.id)? {
            match internal_entry(root, &trash_path) {
                Ok(_) => trash.push(item),
                Err(AppError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                    db::purge_trash_metadata(connection, vault_id, item.id, &trash_path)?;
                }
                Err(error) => return Err(error),
            }
        }
    }
    let vault_path = path_to_string(root);
    let default = db::is_default_vault(connection, &vault_path)?;
    let welcome_page = welcome_page_preference(connection, vault_id, root, default)?;
    reconcile_workspace_children(connection, vault_id, root)?;
    let project_configuration = project_configuration(connection, vault_id, root)?;
    Ok(WorkspaceSnapshot {
        vault_path,
        vault_name,
        default,
        tree,
        bookmarks,
        recent,
        trash,
        tag_colors,
        markdown_view_mode,
        restore_tabs,
        tab_session,
        welcome_page,
        project_roots: project_configuration.project_roots,
        project_workspaces: project_configuration.project_workspaces,
        suggest_git_project: project_configuration.suggest_git_project,
        from_cache,
        encryption: Default::default(),
    })
}

fn project_roots(
    connection: &Connection,
    vault_id: i64,
    root: &Path,
) -> AppResult<Vec<ProjectRoot>> {
    Ok(db::list_project_roots(connection, vault_id)?
        .into_iter()
        .map(|record| ProjectRoot {
            available: project_root_available(root, &record.root_path),
            id: record.id,
            root_path: record.root_path,
            explicit: record.is_explicit,
            workspace_id: record.workspace_id,
        })
        .collect())
}

fn project_workspaces(
    connection: &Connection,
    vault_id: i64,
    root: &Path,
) -> AppResult<Vec<ProjectWorkspace>> {
    Ok(db::list_project_workspaces(connection, vault_id)?
        .into_iter()
        .map(|record| ProjectWorkspace {
            available: project_root_available(root, &record.root_path),
            id: record.id,
            root_path: record.root_path,
        })
        .collect())
}

fn project_configuration(
    connection: &Connection,
    vault_id: i64,
    root: &Path,
) -> AppResult<ProjectConfiguration> {
    let project_roots = project_roots(connection, vault_id, root)?;
    let project_workspaces = project_workspaces(connection, vault_id, root)?;
    let root_is_explicit = project_roots
        .iter()
        .any(|project| project.root_path.is_empty() && project.explicit);
    let root_is_workspace = project_workspaces
        .iter()
        .any(|workspace| workspace.root_path.is_empty());
    let suggest_git_project = !root_is_explicit
        && !root_is_workspace
        && !db::git_project_suggestion_dismissed(connection, vault_id)?
        && safe_git_marker_exists(root);
    Ok(ProjectConfiguration {
        project_roots,
        project_workspaces,
        suggest_git_project,
    })
}

fn reconcile_workspace_children(
    connection: &Connection,
    vault_id: i64,
    root: &Path,
) -> AppResult<()> {
    for workspace in db::list_project_workspaces(connection, vault_id)? {
        let workspace_path = if workspace.root_path.is_empty() {
            root.to_path_buf()
        } else {
            match existing_entry(root, &workspace.root_path) {
                Ok(path) if path.is_dir() => path,
                Ok(_) | Err(_) => continue,
            }
        };
        for entry in fs::read_dir(workspace_path)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.eq_ignore_ascii_case(".denote") || name.eq_ignore_ascii_case(".git") {
                continue;
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata_is_link(&metadata) || !metadata.is_dir() {
                continue;
            }
            ensure_no_symlinks(root, &path, false)?;
            let root_path = relative_string(root, &fs::canonicalize(path)?)?;
            let project_id = db::ensure_project_root(connection, vault_id, &root_path, false)?;
            db::associate_workspace_child(connection, &workspace.id, &project_id)?;
        }
    }
    Ok(())
}

fn safe_git_marker_exists(root: &Path) -> bool {
    let marker = root.join(".git");
    match fs::symlink_metadata(marker) {
        Ok(metadata) => !metadata_is_link(&metadata) && (metadata.is_file() || metadata.is_dir()),
        Err(_) => false,
    }
}

fn project_root_available(root: &Path, root_path: &str) -> bool {
    if root_path.is_empty() {
        return root.is_dir();
    }
    existing_entry(root, root_path)
        .map(|path| path.is_dir())
        .unwrap_or(false)
}

fn welcome_page_preference(
    connection: &Connection,
    vault_id: i64,
    root: &Path,
    default: bool,
) -> AppResult<WelcomePagePreference> {
    let custom_path = db::get_welcome_page_path(connection, vault_id)?;
    let effective_path = custom_path.clone().or_else(|| {
        if welcome_candidate_exists(root, DEFAULT_WELCOME_PAGE) {
            Some(DEFAULT_WELCOME_PAGE.to_string())
        } else if default && welcome_candidate_exists(root, LEGACY_GUIDE_WELCOME_PAGE) {
            Some(LEGACY_GUIDE_WELCOME_PAGE.to_string())
        } else {
            None
        }
    });
    Ok(WelcomePagePreference {
        custom_path,
        effective_path,
    })
}

fn welcome_candidate_exists(root: &Path, relative_path: &str) -> bool {
    match fs::symlink_metadata(root.join(relative_path)) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

fn validate_tab_session(session: &TabSessionState) -> AppResult<()> {
    if session.tabs.len() > MAX_TAB_SESSION_TABS || session.groups.len() > MAX_TAB_SESSION_GROUPS {
        return Err(AppError::InvalidData(
            "Saved tab session exceeds the supported size".to_string(),
        ));
    }
    validate_tab_session_pane(
        &session.tabs,
        &session.groups,
        session.active_path.as_deref(),
    )?;
    let Some(panes) = session.panes.as_ref() else {
        if session.layout.is_some() || session.focused_pane_id.is_some() {
            return Err(AppError::InvalidData(
                "Saved tab session has a pane layout without panes".to_string(),
            ));
        }
        return Ok(());
    };
    if panes.is_empty() || panes.len() > MAX_SESSION_PANES {
        return Err(AppError::InvalidData(
            "Saved tab session has an unsupported pane count".to_string(),
        ));
    }
    let mut pane_ids = HashSet::new();
    let mut session_paths = HashSet::new();
    let mut group_count = 0;
    let mut tab_count = 0;
    for pane in panes {
        if pane.id.is_empty() || pane.id.len() > 64 || !pane_ids.insert(pane.id.as_str()) {
            return Err(AppError::InvalidData(
                "Saved tab session contains an invalid pane".to_string(),
            ));
        }
        for tab in &pane.tabs {
            if !session_paths.insert(tab.path.as_str()) {
                return Err(AppError::InvalidData(
                    "Saved tab session opens one file in more than one pane".to_string(),
                ));
            }
        }
        tab_count += pane.tabs.len();
        group_count += pane.groups.len();
        validate_tab_session_pane(&pane.tabs, &pane.groups, pane.active_path.as_deref())?;
    }
    if tab_count > MAX_TAB_SESSION_TABS || group_count > MAX_TAB_SESSION_GROUPS {
        return Err(AppError::InvalidData(
            "Saved tab session exceeds the supported size".to_string(),
        ));
    }
    if session
        .focused_pane_id
        .as_deref()
        .is_some_and(|pane_id| !pane_ids.contains(pane_id))
    {
        return Err(AppError::InvalidData(
            "Saved tab session focuses an unknown pane".to_string(),
        ));
    }
    if let Some(layout) = session.layout.as_ref() {
        if !layout.kind.supports_pane_count(panes.len())
            || layout.sizes.len() != layout.kind.size_count(panes.len())
            || layout
                .sizes
                .iter()
                .any(|size| !size.is_finite() || *size <= 0.0)
        {
            return Err(AppError::InvalidData(
                "Saved tab session has an invalid pane layout".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_tab_session_pane(
    tabs: &[TabSessionTab],
    groups: &[TabGroup],
    active_path: Option<&str>,
) -> AppResult<()> {
    if tabs.len() > MAX_TAB_SESSION_TABS || groups.len() > MAX_TAB_SESSION_GROUPS {
        return Err(AppError::InvalidData(
            "Saved tab session exceeds the supported size".to_string(),
        ));
    }
    let mut group_ids = HashSet::new();
    for group in groups {
        if group.id.is_empty()
            || group.id.len() > 64
            || group.name.trim().is_empty()
            || group.name.chars().count() > 64
            || !group_ids.insert(group.id.as_str())
        {
            return Err(AppError::InvalidData(
                "Saved tab session contains an invalid group".to_string(),
            ));
        }
    }
    let mut paths = HashSet::new();
    for tab in tabs {
        let _ = normalized_relative(&tab.path, false)?;
        if !paths.insert(tab.path.as_str())
            || tab
                .group_id
                .as_deref()
                .is_some_and(|group_id| !group_ids.contains(group_id))
        {
            return Err(AppError::InvalidData(
                "Saved tab session contains an invalid tab".to_string(),
            ));
        }
    }
    if active_path.is_some_and(|path| !paths.contains(path)) {
        return Err(AppError::InvalidData(
            "Saved tab session has an invalid active file".to_string(),
        ));
    }
    Ok(())
}

fn normalize_tag(tag: &str) -> AppResult<String> {
    let tag = tag.trim().strip_prefix('#').unwrap_or(tag.trim());
    let normalized = tag
        .nfc()
        .collect::<String>()
        .to_lowercase()
        .nfc()
        .collect::<String>();
    if normalized.is_empty()
        || normalized.chars().count() > 128
        || !normalized.chars().all(|character| {
            character.is_alphanumeric()
                || is_combining_mark(character)
                || matches!(character, '_' | '/' | '-')
        })
    {
        return Err(AppError::InvalidData(format!("Invalid tag: {tag}")));
    }
    Ok(normalized)
}

fn normalize_tag_color(color: &str) -> AppResult<String> {
    let color = color.trim();
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..]
            .bytes()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::InvalidData(format!("Invalid tag color: {color}")));
    }
    Ok(color.to_ascii_lowercase())
}

fn reconcile_pending_operations(
    connection: &mut Connection,
    vault_id: i64,
    root: &Path,
) -> AppResult<()> {
    for operation in db::pending_file_operations(connection, vault_id)? {
        let source = root.join(normalized_relative(&operation.source_path, true)?);
        let destination = root.join(normalized_relative(&operation.destination_path, true)?);
        ensure_no_symlinks(root, &source, true)?;
        ensure_no_symlinks(root, &destination, true)?;
        match (source.exists(), destination.exists()) {
            (true, false) => {
                db::cancel_file_operation(connection, &operation.id)?;
            }
            (false, true) => match operation.kind.as_str() {
                "rename" => db::rename_metadata(
                    connection,
                    vault_id,
                    &operation.source_path,
                    &operation.destination_path,
                    operation.is_directory,
                    Some(&operation.id),
                )?,
                "trash" => {
                    db::trash_metadata(
                        connection,
                        vault_id,
                        &operation.source_path,
                        &operation.destination_path,
                        operation.is_directory,
                        Some(&operation.id),
                    )?;
                }
                "restore" => {
                    let item_id = operation.item_id.ok_or_else(|| {
                        AppError::InvalidData(format!(
                            "Restore journal {} is missing its trash item",
                            operation.id
                        ))
                    })?;
                    db::restore_metadata(
                        connection,
                        vault_id,
                        item_id,
                        &operation.source_path,
                        &operation.destination_path,
                        Some(&operation.id),
                    )?;
                }
                kind => {
                    eprintln!(
                        "Discarding unknown Denote recovery operation {} ({kind})",
                        operation.id
                    );
                    db::cancel_file_operation(connection, &operation.id)?;
                }
            },
            state => {
                eprintln!(
                    "Discarding ambiguous Denote recovery operation {} ({}): source/destination state is {state:?}",
                    operation.id, operation.kind
                );
                db::cancel_file_operation(connection, &operation.id)?;
            }
        }
    }
    Ok(())
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    stats: &HashMap<String, crate::models::NoteStats>,
    placements: &HashMap<String, db::EntryPlacement>,
    depth: usize,
) -> AppResult<Vec<FileNode>> {
    if depth > 64 {
        return Err(AppError::InvalidData(
            "Vault nesting exceeds 64 folders".to_string(),
        ));
    }
    let mut nodes = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if metadata_is_link(&fs::symlink_metadata(&path)?)
            || entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(".denote")
        {
            continue;
        }
        nodes.push(scan_path(root, &path, stats, placements, depth)?);
    }
    sort_file_nodes(&mut nodes);
    Ok(nodes)
}

fn scan_path(
    root: &Path,
    path: &Path,
    stats: &HashMap<String, crate::models::NoteStats>,
    placements: &HashMap<String, db::EntryPlacement>,
    depth: usize,
) -> AppResult<FileNode> {
    let relative = relative_string(root, path)?;
    let metadata = fs::metadata(path)?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as i64);
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::InvalidPath(relative.clone()))?;
    let placement = placements.get(&relative);
    let pinned = placement.map(|placement| placement.pinned).unwrap_or(false);
    let position = placement.map(|placement| placement.position);
    if metadata.is_dir() {
        Ok(FileNode {
            path: relative,
            name,
            kind: FileKind::Folder,
            children: scan_directory(root, path, stats, placements, depth + 1)?,
            size: 0,
            modified_at,
            bookmarked: false,
            pinned,
            position,
        })
    } else {
        Ok(FileNode {
            path: relative.clone(),
            name,
            kind: kind_for_path(path),
            children: Vec::new(),
            size: metadata.len(),
            modified_at,
            bookmarked: stats
                .get(&relative)
                .map(|value| value.bookmarked)
                .unwrap_or(false),
            pinned,
            position,
        })
    }
}

fn update_cached_tree(
    connection: &mut Connection,
    vault_id: i64,
    update: impl FnOnce(&mut Vec<FileNode>) -> bool,
) {
    let mut tree = match db::workspace_tree_cache(connection, vault_id) {
        Ok(Some(tree)) => tree,
        Ok(None) => return,
        Err(error) => {
            eprintln!("Unable to read the vault tree cache after a file mutation: {error}");
            return;
        }
    };
    if !update(&mut tree) {
        if let Err(error) = db::clear_workspace_tree_cache(connection, vault_id) {
            eprintln!("Unable to clear a stale vault tree cache: {error}");
        }
        return;
    }
    if let Err(error) = db::set_workspace_tree_cache(connection, vault_id, &tree) {
        eprintln!("Unable to update the vault tree cache after a file mutation: {error}");
    }
}

fn remove_cached_path(nodes: &mut Vec<FileNode>, path: &str) {
    nodes.retain(|node| node.path != path && !node.path.starts_with(&format!("{path}/")));
    for node in nodes {
        if node.kind == FileKind::Folder {
            remove_cached_path(&mut node.children, path);
        }
    }
}

fn insert_cached_node(nodes: &mut Vec<FileNode>, node: FileNode) -> bool {
    let parent_path = node.path.rsplit_once('/').map(|(parent, _)| parent);
    if let Some(parent_path) = parent_path {
        if let Some(parent) = find_cached_node_mut(nodes, parent_path)
            && parent.kind == FileKind::Folder
        {
            insert_cached_sibling(&mut parent.children, node);
            return true;
        }
        return false;
    }
    insert_cached_sibling(nodes, node);
    true
}

fn find_cached_node_mut<'a>(nodes: &'a mut [FileNode], path: &str) -> Option<&'a mut FileNode> {
    for node in nodes {
        if node.path == path {
            return Some(node);
        }
        if node.kind == FileKind::Folder
            && let Some(found) = find_cached_node_mut(&mut node.children, path)
        {
            return Some(found);
        }
    }
    None
}

fn insert_cached_sibling(nodes: &mut Vec<FileNode>, node: FileNode) {
    nodes.retain(|candidate| candidate.path != node.path);
    let insertion_index = nodes
        .iter()
        .position(|candidate| compare_cached_nodes(&node, candidate).is_lt())
        .unwrap_or(nodes.len());
    nodes.insert(insertion_index, node);
}

fn compare_cached_nodes(left: &FileNode, right: &FileNode) -> std::cmp::Ordering {
    right
        .pinned
        .cmp(&left.pinned)
        .then_with(|| {
            left.position
                .unwrap_or(i64::MAX)
                .cmp(&right.position.unwrap_or(i64::MAX))
        })
        .then_with(|| {
            matches!(right.kind, FileKind::Folder).cmp(&matches!(left.kind, FileKind::Folder))
        })
        .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
}

fn refresh_cached_tree_metadata(
    nodes: &mut Vec<FileNode>,
    stats: &HashMap<String, crate::models::NoteStats>,
    placements: &HashMap<String, db::EntryPlacement>,
) {
    for node in nodes.iter_mut() {
        let placement = placements.get(&node.path);
        node.pinned = placement.map(|placement| placement.pinned).unwrap_or(false);
        node.position = placement.map(|placement| placement.position);
        if node.kind == FileKind::Folder {
            node.bookmarked = false;
            refresh_cached_tree_metadata(&mut node.children, stats, placements);
        } else {
            node.bookmarked = stats
                .get(&node.path)
                .map(|value| value.bookmarked)
                .unwrap_or(false);
        }
    }
    sort_file_nodes(nodes);
}

fn sort_file_nodes(nodes: &mut [FileNode]) {
    nodes.sort_by(compare_cached_nodes);
}

fn ensure_vault(connection: &Connection, root: &Path) -> AppResult<(i64, String)> {
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Vault")
        .to_string();
    let id = db::ensure_vault(connection, &path_to_string(root), &name)?;
    Ok((id, name))
}

fn canonical_vault(path: &str) -> AppResult<PathBuf> {
    let root = fs::canonicalize(path)?;
    if !root.is_dir() {
        return Err(AppError::InvalidPath(format!("{path} is not a folder")));
    }
    Ok(root)
}

fn existing_entry(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let relative = normalized_relative(relative_path, false)?;
    let candidate = root.join(relative);
    ensure_no_symlinks(root, &candidate, false)?;
    let candidate = fs::canonicalize(candidate)?;
    if !candidate.starts_with(root) {
        return Err(AppError::InvalidPath(relative_path.to_string()));
    }
    Ok(candidate)
}

fn validated_project_root_path(root: &Path, relative_path: &str) -> AppResult<String> {
    if relative_path.is_empty() {
        return Ok(String::new());
    }
    let candidate = existing_entry(root, relative_path)?;
    if !candidate.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{relative_path} is not a folder"
        )));
    }
    relative_string(root, &candidate)
}

fn is_encryption_control_file(root: &Path, path: &Path) -> bool {
    path == crypto::manifest_path(root) || path.starts_with(root.join(".denote").join("locks"))
}

fn internal_entry(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let relative = normalized_relative(relative_path, true)?;
    let candidate = root.join(relative);
    ensure_no_symlinks(root, &candidate, false)?;
    let candidate = fs::canonicalize(candidate)?;
    if !candidate.starts_with(root) {
        return Err(AppError::InvalidPath(relative_path.to_string()));
    }
    Ok(candidate)
}

fn normalized_relative(path: &str, allow_internal: bool) -> AppResult<PathBuf> {
    if path.is_empty() {
        return Err(AppError::InvalidPath("Path is empty".to_string()));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(AppError::InvalidPath(path.to_string()));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(value) => {
                if !allow_internal && value.to_string_lossy().eq_ignore_ascii_case(".denote") {
                    return Err(AppError::InvalidPath(path.to_string()));
                }
            }
            _ => return Err(AppError::InvalidPath(path.to_string())),
        }
    }
    Ok(candidate.to_path_buf())
}

fn relative_string(root: &Path, path: &Path) -> AppResult<String> {
    let relative = relative_internal_string(root, path)?;
    if is_internal_relative_path(&relative) {
        return Err(AppError::InvalidPath(relative));
    }
    Ok(relative)
}

fn relative_internal_string(root: &Path, path: &Path) -> AppResult<String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidPath(path_to_string(path)))?;
    Ok(path_to_forward_slashes(relative))
}

fn path_to_forward_slashes(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn validate_name(name: &str) -> AppResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.eq_ignore_ascii_case(".denote")
    {
        return Err(AppError::InvalidPath(name.to_string()));
    }
    Ok(trimmed)
}

fn available_duplicate_path(source: &Path) -> AppResult<PathBuf> {
    let parent = source
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path_to_string(source)))?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidPath(path_to_string(source)))?;
    let extension = source.extension().and_then(|value| value.to_str());
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);

    for index in 1..=1_000 {
        let suffix = if index == 1 {
            " copy".to_string()
        } else {
            format!(" copy {index}")
        };
        let candidate_name = extension
            .map(|extension| format!("{stem}{suffix}.{extension}"))
            .unwrap_or_else(|| format!("{file_name}{suffix}"));
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::Conflict(format!(
        "Unable to choose a duplicate name for {file_name}"
    )))
}

fn kind_for_path(path: &Path) -> FileKind {
    if path.is_dir() {
        return FileKind::Folder;
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown" | "mdx") => FileKind::Markdown,
        Some("txt") => FileKind::Text,
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif") => FileKind::Image,
        _ => FileKind::File,
    }
}

fn is_internal_relative_path(path: &str) -> bool {
    path.split('/')
        .next()
        .is_some_and(|component| component.eq_ignore_ascii_case(".denote"))
}

fn ensure_trash_item_path(path: &str) -> AppResult<()> {
    let components = path.split('/').collect::<Vec<_>>();
    if components.len() < 4
        || !components[0].eq_ignore_ascii_case(".denote")
        || !components[1].eq_ignore_ascii_case("trash")
    {
        return Err(AppError::InvalidPath(path.to_string()));
    }
    Ok(())
}

fn document_title(path: &str, content: &str) -> String {
    content
        .lines()
        .find_map(|line| {
            line.strip_prefix("# ")
                .map(str::trim)
                .filter(|title| !title.is_empty())
        })
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(path)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(path)
                .to_string()
        })
}

fn title_from_file_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn decode_file_content(bytes: &[u8]) -> (String, FileEncoding, FileLineEnding) {
    match String::from_utf8(bytes.to_vec()) {
        Ok(content) => {
            normalize_utf8_content(content).unwrap_or_else(|| encode_binary_content(bytes))
        }
        Err(_) => encode_binary_content(bytes),
    }
}

fn read_plain_file(path: &Path, vault_key: Option<&[u8; 32]>) -> AppResult<Vec<u8>> {
    let stored = fs::read(path)?;
    if crypto::is_encrypted_file(&stored) {
        let key = vault_key.ok_or(AppError::Locked)?;
        crypto::decrypt_file_content(key, &stored)
    } else {
        Ok(stored)
    }
}

fn encode_file_at_rest(
    root: &Path,
    plaintext: &[u8],
    vault_key: Option<&[u8; 32]>,
) -> AppResult<Vec<u8>> {
    if crypto::manifest_exists(root) {
        let key = vault_key.ok_or(AppError::Locked)?;
        crypto::encrypt_file_content(key, plaintext)
    } else {
        Ok(plaintext.to_vec())
    }
}

fn encode_history_at_rest(
    root: &Path,
    content: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<(String, bool)> {
    if crypto::manifest_exists(root) {
        let key = vault_key.ok_or(AppError::Locked)?;
        Ok((crypto::encrypt_history_content(key, content)?, true))
    } else {
        Ok((content.to_string(), false))
    }
}

fn decode_history_at_rest(
    content: &str,
    is_encrypted: bool,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<String> {
    if is_encrypted {
        let key = vault_key.ok_or(AppError::Locked)?;
        crypto::decrypt_history_content(key, content)
    } else {
        Ok(content.to_string())
    }
}

fn history_preview(content: &str) -> String {
    let compact = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    compact.chars().take(180).collect()
}

fn history_byte_count(content: &str, encoding: FileEncoding) -> usize {
    match encoding {
        FileEncoding::Utf8 => content.len(),
        FileEncoding::Base64 => {
            let encoded_length = content
                .chars()
                .filter(|value| !value.is_whitespace())
                .count();
            encoded_length.saturating_mul(3) / 4
        }
    }
}

fn encode_file_content(
    content: &str,
    encoding: FileEncoding,
    line_ending: FileLineEnding,
) -> AppResult<Vec<u8>> {
    match encoding {
        FileEncoding::Utf8 => {
            let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
            let encoded = match line_ending {
                FileLineEnding::Lf => normalized,
                FileLineEnding::Crlf => normalized.replace('\n', "\r\n"),
                FileLineEnding::Cr => normalized.replace('\n', "\r"),
            };
            Ok(encoded.into_bytes())
        }
        FileEncoding::Base64 => {
            let compact = content
                .chars()
                .filter(|value| !value.is_whitespace())
                .collect::<String>();
            STANDARD.decode(compact).map_err(|error| {
                AppError::InvalidData(format!("Binary Base64 content is invalid: {error}"))
            })
        }
    }
}

fn normalize_utf8_content(content: String) -> Option<(String, FileEncoding, FileLineEnding)> {
    let without_crlf = content.replace("\r\n", "");
    let has_crlf = content.contains("\r\n");
    let has_cr = without_crlf.contains('\r');
    let has_lf = without_crlf.contains('\n');
    if [has_crlf, has_cr, has_lf]
        .into_iter()
        .filter(|value| *value)
        .count()
        > 1
    {
        return None;
    }
    let line_ending = if has_crlf {
        FileLineEnding::Crlf
    } else if has_cr {
        FileLineEnding::Cr
    } else {
        FileLineEnding::Lf
    };
    Some((
        content.replace("\r\n", "\n").replace('\r', "\n"),
        FileEncoding::Utf8,
        line_ending,
    ))
}

fn encode_binary_content(bytes: &[u8]) -> (String, FileEncoding, FileLineEnding) {
    let encoded = STANDARD.encode(bytes);
    let content = encoded
        .as_bytes()
        .chunks(76)
        .map(|chunk| String::from_utf8_lossy(chunk))
        .collect::<Vec<_>>()
        .join("\n");
    (content, FileEncoding::Base64, FileLineEnding::Lf)
}

fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    let mut fence: Option<(char, usize)> = None;
    let mut inline_code_ticks = 0;
    for line in content.lines() {
        let marker = (inline_code_ticks == 0)
            .then(|| markdown_fence_marker(line))
            .flatten();
        if let Some((character, length)) = fence {
            if marker.is_some_and(|candidate| candidate.0 == character && candidate.1 >= length) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = marker {
            fence = Some(marker);
            continue;
        }
        if inline_code_ticks == 0 && (line.starts_with("    ") || line.starts_with('\t')) {
            continue;
        }
        let chars = line.chars().collect::<Vec<_>>();
        let mut index = 0;
        while index < chars.len() {
            if chars[index] == '`' {
                let mut end = index + 1;
                while end < chars.len() && chars[end] == '`' {
                    end += 1;
                }
                let ticks = end - index;
                if inline_code_ticks == 0 {
                    inline_code_ticks = ticks;
                } else if inline_code_ticks == ticks {
                    inline_code_ticks = 0;
                }
                index = end;
                continue;
            }
            if inline_code_ticks > 0 || chars[index] != '#' || !is_tag_boundary(&chars, index) {
                index += 1;
                continue;
            }
            let mut end = index + 1;
            while end < chars.len() && is_tag_character(chars[end]) {
                end += 1;
            }
            if end > index + 1 {
                let tag = chars[index + 1..end].iter().collect::<String>();
                if let Ok(tag) = normalize_tag(&tag) {
                    tags.insert(tag);
                }
                index = end;
            } else {
                index += 1;
            }
        }
    }
    let mut tags = tags.into_iter().collect::<Vec<_>>();
    tags.sort();
    tags
}

fn markdown_fence_marker(line: &str) -> Option<(char, usize)> {
    let indent = line
        .bytes()
        .take_while(|character| *character == b' ')
        .count();
    if indent > 3 {
        return None;
    }
    let remainder = &line[indent..];
    let character = remainder.chars().next()?;
    if !matches!(character, '`' | '~') {
        return None;
    }
    let length = remainder
        .chars()
        .take_while(|candidate| *candidate == character)
        .count();
    (length >= 3).then_some((character, length))
}

fn is_tag_character(character: char) -> bool {
    character.is_alphanumeric()
        || is_combining_mark(character)
        || matches!(character, '_' | '-' | '/')
}

fn is_tag_boundary(characters: &[char], index: usize) -> bool {
    if index == 0 {
        return true;
    }
    let previous = characters[index - 1];
    if previous.is_whitespace() || matches!(previous, '(' | '[' | '{' | '"' | '\'' | '*' | '~') {
        return true;
    }
    if previous != '_' {
        return false;
    }
    let mut cursor = index - 1;
    while cursor > 0 && characters[cursor] == '_' {
        cursor -= 1;
    }
    characters[cursor] == '_'
        || characters[cursor].is_whitespace()
        || matches!(characters[cursor], '(' | '[' | '{' | '"' | '\'' | '*' | '~')
}

fn resolve_image_source(
    root: &Path,
    note_path: Option<&str>,
    image_source: &str,
) -> AppResult<PathBuf> {
    if image_source.starts_with("data:")
        || image_source.starts_with("http://")
        || image_source.starts_with("https://")
    {
        return Err(AppError::UnsupportedFile(
            "Remote and embedded images do not need a local preview".to_string(),
        ));
    }
    let source = image_source.trim_start_matches('/');
    let base = if image_source.starts_with('/') {
        root.to_path_buf()
    } else if let Some(note_path) = note_path {
        existing_entry(root, note_path)?
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.to_path_buf())
    } else {
        root.to_path_buf()
    };
    let candidate = normalize_join_inside(root, &base, source)?;
    ensure_no_symlinks(root, &candidate, false)?;
    let candidate = fs::canonicalize(candidate)?;
    if !candidate.starts_with(root) {
        return Err(AppError::InvalidPath(image_source.to_string()));
    }
    Ok(candidate)
}

fn normalize_join_inside(root: &Path, base: &Path, value: &str) -> AppResult<PathBuf> {
    let mut components = base
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidPath(path_to_string(base)))?
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect::<Vec<OsString>>();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(value) => {
                if value.to_string_lossy().eq_ignore_ascii_case(".denote") {
                    return Err(AppError::InvalidPath(value.to_string_lossy().into_owned()));
                }
                components.push(value.to_os_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if components.pop().is_none() {
                    return Err(AppError::InvalidPath(value.to_string()));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidPath(value.to_string()));
            }
        }
    }
    Ok(components
        .into_iter()
        .fold(root.to_path_buf(), |path, component| path.join(component)))
}

fn available_restore_path(root: &Path, original_path: &str) -> AppResult<PathBuf> {
    let relative = normalized_relative(original_path, false)?;
    let desired = root.join(relative);
    if !desired.exists() {
        return Ok(desired);
    }
    let parent = desired
        .parent()
        .ok_or_else(|| AppError::InvalidPath(original_path.to_string()))?;
    let file_stem = desired
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("restored");
    let extension = desired.extension().and_then(|value| value.to_str());
    for index in 1..1000 {
        let name = match extension {
            Some(extension) => format!("{file_stem} (restored {index}).{extension}"),
            None => format!("{file_stem} (restored {index})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::InvalidPath(
        "Unable to find an available restore name".to_string(),
    ))
}

fn available_named_path(directory: &Path, name: &str) -> AppResult<PathBuf> {
    let desired = directory.join(name);
    if !desired.exists() {
        return Ok(desired);
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..1000 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem}-{index}.{extension}"),
            None => format!("{stem}-{index}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::InvalidPath(
        "Unable to find an available attachment name".to_string(),
    ))
}

fn file_is_encrypted(path: &Path) -> AppResult<bool> {
    let mut file = fs::File::open(path)?;
    let mut prefix = Vec::with_capacity(12);
    Read::by_ref(&mut file).take(12).read_to_end(&mut prefix)?;
    Ok(crypto::is_encrypted_file(&prefix))
}

fn file_plaintext_len(path: &Path) -> AppResult<u64> {
    let stored_len = fs::metadata(path)?.len();
    let mut file = fs::File::open(path)?;
    let mut header = Vec::with_capacity(40);
    Read::by_ref(&mut file).take(40).read_to_end(&mut header)?;
    Ok(crypto::encrypted_file_plaintext_len(&header, stored_len)?.unwrap_or(stored_len))
}

fn transform_file_encryption(path: &Path, vault_key: &[u8; 32], encrypting: bool) -> AppResult<()> {
    let mut reader = fs::File::open(path)?;
    let source_len = reader.metadata()?.len();
    atomic_write_with(path, move |writer| {
        if encrypting {
            crypto::encrypt_file_stream(vault_key, &mut reader, source_len, writer)
        } else {
            crypto::decrypt_file_stream(vault_key, &mut reader, writer)
        }
    })
}

fn create_file_no_replace(path: &Path, data: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path_to_string(path)))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidPath(path_to_string(path)))?;
    let temporary = parent.join(format!(".{file_name}.{}.denote-create", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options.open(&temporary)?;
    if let Err(error) = file.write_all(data).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    drop(file);
    if let Err(error) = rename_no_replace(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    let source = CString::new(source.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid source path")
    })?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid destination path")
    })?;
    // SAFETY: Both paths are valid NUL-terminated strings and remain alive for the call.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    let source = CString::new(source.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid source path")
    })?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid destination path")
    })?;
    // SAFETY: Both paths are valid NUL-terminated strings and remain alive for the call.
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: Both paths are valid NUL-terminated UTF-16 strings for the duration of the call.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios",
    windows
)))]
fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Destination already exists",
        ));
    }
    fs::rename(source, destination)
}

fn atomic_write(path: &Path, data: &[u8]) -> AppResult<()> {
    atomic_write_with(path, |file| {
        file.write_all(data)?;
        Ok(())
    })
}

fn atomic_write_with(
    path: &Path,
    write_content: impl FnOnce(&mut dyn Write) -> AppResult<()>,
) -> AppResult<()> {
    #[cfg(windows)]
    if path.exists() {
        return replace_file_windows(path, write_content);
    }

    #[cfg(windows)]
    fn replace_file_windows(
        path: &Path,
        write_content: impl FnOnce(&mut dyn Write) -> AppResult<()>,
    ) -> AppResult<()> {
        use std::{os::windows::ffi::OsStrExt, ptr};
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

        let parent = path
            .parent()
            .ok_or_else(|| AppError::InvalidPath(path_to_string(path)))?;
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file");
        let temporary_path = parent.join(format!(".{file_name}.{}.denote-tmp", Uuid::new_v4()));
        let backup_path = parent.join(format!(".{file_name}.{}.denote-backup", Uuid::new_v4()));
        let mut temporary = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)?;
        if let Err(error) = write_content(&mut temporary).and_then(|()| Ok(temporary.sync_all()?)) {
            drop(temporary);
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        drop(temporary);

        let target_wide = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let replacement_wide = temporary_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let backup_wide = backup_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let replaced = unsafe {
            ReplaceFileW(
                target_wide.as_ptr(),
                replacement_wide.as_ptr(),
                backup_wide.as_ptr(),
                1,
                ptr::null(),
                ptr::null(),
            )
        };
        if replaced == 0 {
            let error = std::io::Error::last_os_error();
            if !path.exists() {
                let recovery = if backup_path.exists() {
                    fs::rename(&backup_path, path)
                } else if temporary_path.exists() {
                    fs::rename(&temporary_path, path)
                } else {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Windows replacement left no recoverable file",
                    ))
                };
                if let Err(recovery_error) = recovery {
                    return Err(AppError::InvalidData(format!(
                        "Windows file replacement failed: {error}. Recovery also failed: {recovery_error}. Check {} and {}.",
                        path_to_string(&temporary_path),
                        path_to_string(&backup_path)
                    )));
                }
            }
            if path.exists() {
                let _ = fs::remove_file(&temporary_path);
                let _ = fs::remove_file(&backup_path);
            }
            return Err(error.into());
        }
        let _ = fs::remove_file(&backup_path);
        Ok(())
    }
    #[cfg(unix)]
    let extended_attributes = read_extended_attributes(path)?;
    let mut file = AtomicWriteFile::options().open(path)?;
    write_content(&mut file)?;
    #[cfg(unix)]
    {
        use xattr::FileExt;
        for (name, value) in extended_attributes {
            file.as_file().set_xattr(&name, &value)?;
        }
    }
    file.commit()?;
    Ok(())
}

fn acquire_vault_lock(root: &Path, exclusive: bool) -> AppResult<fs::File> {
    acquire_named_vault_lock(root, "vault.lock", exclusive)
}

pub(crate) fn acquire_link_rewrite_lock(root: &Path) -> AppResult<fs::File> {
    acquire_named_vault_lock(root, "link-rewrite.lock", true)
}

fn acquire_named_vault_lock(root: &Path, lock_name: &str, exclusive: bool) -> AppResult<fs::File> {
    let lock_directory = root.join(".denote").join("locks");
    ensure_no_symlinks(root, &lock_directory, true)?;
    fs::create_dir_all(&lock_directory)?;
    let lock_path = lock_directory.join(lock_name);
    ensure_no_symlinks(root, &lock_path, true)?;
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)?;
    if exclusive {
        Fs2FileExt::lock_exclusive(&file)?;
    } else {
        Fs2FileExt::lock_shared(&file)?;
    }
    Ok(file)
}

pub(crate) fn acquire_vault_control_lock(root: &Path) -> AppResult<fs::File> {
    acquire_vault_lock(root, true)
}

fn acquire_note_lock(root: &Path, relative_path: &str) -> AppResult<fs::File> {
    let lock_directory = root.join(".denote").join("locks");
    ensure_no_symlinks(root, &lock_directory, true)?;
    fs::create_dir_all(&lock_directory)?;
    let lock_name = format!("{}.lock", hash_content(relative_path));
    let lock_path = lock_directory.join(lock_name);
    ensure_no_symlinks(root, &lock_path, true)?;
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)?;
    file.lock_exclusive()?;
    Ok(file)
}

#[cfg(unix)]
fn read_extended_attributes(path: &Path) -> AppResult<Vec<(OsString, Vec<u8>)>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut attributes = Vec::new();
    for name in xattr::list(path)? {
        if let Some(value) = xattr::get(path, &name)? {
            attributes.push((name, value));
        }
    }
    Ok(attributes)
}

fn hash_content(content: &str) -> String {
    hash_bytes(content.as_bytes())
}

fn hash_bytes(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

fn rollback_operation(
    connection: &Connection,
    operation_id: &str,
    current: &Path,
    original: &Path,
    cause: AppError,
) -> AppError {
    match rename_no_replace(current, original) {
        Ok(()) => match db::cancel_file_operation(connection, operation_id) {
            Ok(()) => cause,
            Err(cancel_error) => AppError::InvalidData(format!(
                "{cause}. The filesystem move was rolled back, but the recovery journal could not be cleared: {cancel_error}"
            )),
        },
        Err(rollback_error) => AppError::InvalidData(format!(
            "{cause}. Rollback also failed: {rollback_error}. The recovery journal was preserved for the next vault open."
        )),
    }
}

fn ensure_no_symlinks(root: &Path, path: &Path, allow_missing: bool) -> AppResult<()> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidPath(path_to_string(path)))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(AppError::InvalidPath(path_to_string(path)));
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata_is_link(&metadata) => {
                return Err(AppError::InvalidPath(format!(
                    "Symbolic links are not supported: {}",
                    path_to_string(&current)
                )));
            }
            Ok(_) => {}
            Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::models::{PaneLayout, PaneLayoutKind, TabSessionPane};

    #[test]
    fn validates_and_normalizes_tag_color_metadata() {
        assert_eq!(normalize_tag("#Guide").expect("normalized tag"), "guide");
        assert_eq!(normalize_tag("#I").expect("locale-independent tag"), "i");
        assert_eq!(
            normalize_tag("#cafe\u{301}").expect("decomposed tag"),
            normalize_tag("#café").expect("composed tag")
        );
        assert_eq!(
            normalize_tag("日本語/資料-next").expect("Unicode tag"),
            "日本語/資料-next"
        );
        assert!(normalize_tag("not a tag").is_err());
        assert_eq!(
            normalize_tag_color("#A1B2C3").expect("normalized color"),
            "#a1b2c3"
        );
        assert!(normalize_tag_color("red").is_err());
    }

    fn session_tab(path: &str, group_id: Option<&str>) -> TabSessionTab {
        TabSessionTab {
            path: path.to_string(),
            group_id: group_id.map(str::to_string),
        }
    }

    fn pane_session(panes: Vec<TabSessionPane>, layout: PaneLayout) -> TabSessionState {
        TabSessionState {
            tabs: panes.iter().flat_map(|pane| pane.tabs.clone()).collect(),
            groups: panes.iter().flat_map(|pane| pane.groups.clone()).collect(),
            active_path: panes.first().and_then(|pane| pane.active_path.clone()),
            focused_pane_id: panes.first().map(|pane| pane.id.clone()),
            layout: Some(layout),
            panes: Some(panes),
        }
    }

    #[test]
    fn rejects_semantically_invalid_saved_tab_sessions() {
        let session = TabSessionState {
            tabs: vec![session_tab("note.md", Some("missing"))],
            groups: Vec::new(),
            active_path: Some("note.md".to_string()),
            panes: None,
            layout: None,
            focused_pane_id: None,
        };

        assert!(validate_tab_session(&session).is_err());
    }

    #[test]
    fn accepts_legacy_flat_saved_tab_sessions() {
        let session = TabSessionState {
            tabs: vec![session_tab("one.md", None), session_tab("two.md", None)],
            groups: Vec::new(),
            active_path: Some("two.md".to_string()),
            panes: None,
            layout: None,
            focused_pane_id: None,
        };

        assert!(validate_tab_session(&session).is_ok());
    }

    #[test]
    fn accepts_saved_pane_sessions_within_the_pane_limit() {
        let session = pane_session(
            vec![
                TabSessionPane {
                    id: "pane-1".to_string(),
                    tabs: vec![session_tab("one.md", None)],
                    groups: Vec::new(),
                    active_path: Some("one.md".to_string()),
                },
                TabSessionPane {
                    id: "pane-2".to_string(),
                    tabs: vec![session_tab("two.md", Some("work"))],
                    groups: vec![TabGroup {
                        id: "work".to_string(),
                        name: "Work".to_string(),
                        collapsed: false,
                    }],
                    active_path: Some("two.md".to_string()),
                },
            ],
            PaneLayout {
                kind: PaneLayoutKind::Horizontal,
                sizes: vec![0.6, 0.4],
            },
        );

        assert!(validate_tab_session(&session).is_ok());
    }

    #[test]
    fn rejects_saved_pane_sessions_that_break_pane_invariants() {
        let pane = |id: &str, path: &str| TabSessionPane {
            id: id.to_string(),
            tabs: vec![session_tab(path, None)],
            groups: Vec::new(),
            active_path: Some(path.to_string()),
        };
        let horizontal = |sizes: Vec<f64>| PaneLayout {
            kind: PaneLayoutKind::Horizontal,
            sizes,
        };

        let duplicate_ids = pane_session(
            vec![pane("pane-1", "one.md"), pane("pane-1", "two.md")],
            horizontal(vec![0.5, 0.5]),
        );
        assert!(validate_tab_session(&duplicate_ids).is_err());

        let duplicate_paths = pane_session(
            vec![pane("pane-1", "one.md"), pane("pane-2", "one.md")],
            horizontal(vec![0.5, 0.5]),
        );
        assert!(validate_tab_session(&duplicate_paths).is_err());

        let too_many_panes = pane_session(
            vec![
                pane("pane-1", "one.md"),
                pane("pane-2", "two.md"),
                pane("pane-3", "three.md"),
                pane("pane-4", "four.md"),
                pane("pane-5", "five.md"),
            ],
            horizontal(vec![0.2, 0.2, 0.2, 0.2, 0.2]),
        );
        assert!(validate_tab_session(&too_many_panes).is_err());

        let mut wrong_layout = pane_session(
            vec![pane("pane-1", "one.md"), pane("pane-2", "two.md")],
            PaneLayout {
                kind: PaneLayoutKind::Grid,
                sizes: vec![0.5, 0.5, 0.5, 0.5],
            },
        );
        assert!(validate_tab_session(&wrong_layout).is_err());

        wrong_layout.layout = Some(horizontal(vec![0.5, 0.5, 0.5]));
        assert!(validate_tab_session(&wrong_layout).is_err());

        wrong_layout.layout = Some(horizontal(vec![0.5, 0.0]));
        assert!(validate_tab_session(&wrong_layout).is_err());

        let mut unknown_focus = pane_session(
            vec![pane("pane-1", "one.md"), pane("pane-2", "two.md")],
            horizontal(vec![0.5, 0.5]),
        );
        unknown_focus.focused_pane_id = Some("pane-9".to_string());
        assert!(validate_tab_session(&unknown_focus).is_err());

        let mut invalid_active = pane_session(
            vec![pane("pane-1", "one.md")],
            PaneLayout {
                kind: PaneLayoutKind::Single,
                sizes: Vec::new(),
            },
        );
        invalid_active.panes.as_mut().expect("panes")[0].active_path =
            Some("missing.md".to_string());
        assert!(validate_tab_session(&invalid_active).is_err());
    }

    #[test]
    fn rejects_pane_layouts_without_panes() {
        let session = TabSessionState {
            tabs: Vec::new(),
            groups: Vec::new(),
            active_path: None,
            panes: None,
            layout: Some(PaneLayout {
                kind: PaneLayoutKind::Horizontal,
                sizes: vec![0.5, 0.5],
            }),
            focused_pane_id: None,
        };

        assert!(validate_tab_session(&session).is_err());
    }

    fn read_note(db_path: &Path, vault_path: &str, relative_path: &str) -> AppResult<NoteDocument> {
        super::read_note(db_path, vault_path, relative_path, None)
    }

    #[allow(clippy::too_many_arguments)]
    fn save_note(
        db_path: &Path,
        vault_path: &str,
        relative_path: &str,
        content: &str,
        encoding: FileEncoding,
        line_ending: FileLineEnding,
        reason: &str,
        expected_hash: Option<&str>,
    ) -> AppResult<SaveOutcome> {
        super::save_note(
            db_path,
            vault_path,
            relative_path,
            content,
            encoding,
            line_ending,
            reason,
            expected_hash,
            None,
        )
    }

    fn create_entry(
        db_path: &Path,
        vault_path: &str,
        parent_path: &str,
        name: &str,
        directory: bool,
    ) -> AppResult<FileNode> {
        super::create_entry(db_path, vault_path, parent_path, name, directory, None)
    }

    fn duplicate_file(
        db_path: &Path,
        vault_path: &str,
        relative_path: &str,
    ) -> AppResult<FileNode> {
        super::duplicate_file(db_path, vault_path, relative_path, None)
    }

    fn list_history(
        db_path: &Path,
        vault_path: &str,
        relative_path: &str,
    ) -> AppResult<Vec<HistoryRevision>> {
        super::list_history(db_path, vault_path, relative_path, None)
    }

    fn restore_revision(
        db_path: &Path,
        vault_path: &str,
        relative_path: &str,
        revision_id: i64,
    ) -> AppResult<NoteDocument> {
        super::restore_revision(db_path, vault_path, relative_path, revision_id, None)
    }

    fn list_search_documents(db_path: &Path, vault_path: &str) -> AppResult<DocumentBatch> {
        super::list_search_documents(db_path, vault_path, None)
    }

    fn list_editable_documents(db_path: &Path, vault_path: &str) -> AppResult<DocumentBatch> {
        super::list_editable_documents(db_path, vault_path, None)
    }

    fn list_link_rewrite_documents(
        db_path: &Path,
        vault_path: &str,
    ) -> AppResult<LinkRewriteBatch> {
        super::list_link_rewrite_documents(db_path, vault_path, None)
    }

    fn read_image_data_url(
        db_path: &Path,
        vault_path: &str,
        note_path: Option<&str>,
        image_source: &str,
    ) -> AppResult<String> {
        super::read_image_data_url(db_path, vault_path, note_path, image_source, None)
    }

    #[cfg(unix)]
    fn save_attachment(
        vault_path: &str,
        note_path: &str,
        file_name: &str,
        data: &[u8],
    ) -> AppResult<String> {
        super::save_attachment(vault_path, note_path, file_name, data, None)
    }

    #[test]
    fn rejects_parent_directory_paths() {
        assert!(normalized_relative("../secret.md", false).is_err());
        assert!(normalized_relative("notes/../../secret.md", false).is_err());
        assert!(normalized_relative(".DENOTE/trash/file.md", false).is_err());
        assert!(validate_name(".DeNoTe").is_err());
    }

    #[test]
    fn resolves_existing_entries_to_absolute_paths() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "content").expect("note");

        let path = absolute_entry_path(vault_path.to_str().unwrap(), "note.md")
            .expect("absolute file path");

        assert_eq!(
            PathBuf::from(path),
            fs::canonicalize(vault_path.join("note.md")).expect("canonical note")
        );
        assert!(absolute_entry_path(vault_path.to_str().unwrap(), "../note.md").is_err());
    }

    #[test]
    fn duplicates_files_with_non_conflicting_names() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("example.md"), "invented content").expect("note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let first = duplicate_file(&db_path, vault_path.to_str().unwrap(), "example.md")
            .expect("first duplicate");
        let second = duplicate_file(&db_path, vault_path.to_str().unwrap(), "example.md")
            .expect("second duplicate");

        assert_eq!(first.path, "example copy.md");
        assert_eq!(second.path, "example copy 2.md");
        assert_eq!(
            fs::read_to_string(vault_path.join(&first.path)).expect("duplicate content"),
            "invented content"
        );
        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");
        assert!(snapshot.tree.iter().any(|node| node.path == first.path));
        assert!(snapshot.tree.iter().any(|node| node.path == second.path));
    }

    #[test]
    fn pins_and_custom_orders_entries_within_their_folder() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let folder_path = vault_path.join("folder");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::create_dir(&folder_path).expect("nested folder");
        fs::write(vault_path.join("root.md"), "root").expect("root note");
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(folder_path.join(name), name).expect("nested note");
        }
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        set_entry_order(
            &db_path,
            vault_path.to_str().unwrap(),
            &[
                "folder/c.md".to_string(),
                "folder/b.md".to_string(),
                "folder/a.md".to_string(),
            ],
        )
        .expect("custom order");
        set_entry_pinned(&db_path, vault_path.to_str().unwrap(), "folder/b.md", true)
            .expect("pin note");

        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("vault snapshot");
        let folder = snapshot
            .tree
            .iter()
            .find(|node| node.path == "folder")
            .expect("folder");
        assert_eq!(
            folder
                .children
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["b.md", "c.md", "a.md"]
        );
        assert!(folder.children[0].pinned);

        set_entry_pinned(&db_path, vault_path.to_str().unwrap(), "folder/a.md", true)
            .expect("pin second note");
        set_entry_order(
            &db_path,
            vault_path.to_str().unwrap(),
            &[
                "folder/a.md".to_string(),
                "folder/b.md".to_string(),
                "folder/c.md".to_string(),
            ],
        )
        .expect("reorder pinned notes");
        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("reordered snapshot");
        let folder = snapshot
            .tree
            .iter()
            .find(|node| node.path == "folder")
            .expect("folder");
        assert_eq!(
            folder
                .children
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["a.md", "b.md", "c.md"]
        );
        assert!(
            set_entry_order(
                &db_path,
                vault_path.to_str().unwrap(),
                &["root.md".to_string(), "folder/a.md".to_string()],
            )
            .is_err()
        );
    }

    #[test]
    fn extracts_unicode_tags_without_treating_headings_as_tags() {
        let tags = extract_tags(
            "# Heading\n**#guide** `#literal` \\#escaped #हिन्दी #cafe\u{301} #研究 #tag-one",
        );
        assert_eq!(
            tags.into_iter().collect::<HashSet<_>>(),
            HashSet::from([
                "café".to_string(),
                "guide".to_string(),
                "tag-one".to_string(),
                "हिन्दी".to_string(),
                "研究".to_string(),
            ])
        );
    }

    #[test]
    fn persists_tag_colors_in_workspace_snapshots() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        let db_path = directory.path().join("denote.sqlite3");

        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        set_tag_color(&db_path, vault_path.to_str().unwrap(), "#Guide", "#A1B2C3")
            .expect("save tag color");
        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");

        assert_eq!(
            snapshot.tag_colors,
            vec![TagColor {
                tag: "guide".to_string(),
                color: "#a1b2c3".to_string(),
            }]
        );
    }

    #[test]
    fn lists_file_names_across_known_vaults_without_internal_metadata() {
        let directory = tempdir().expect("temp directory");
        let work = directory.path().join("work");
        let music = directory.path().join("music");
        fs::create_dir_all(work.join("projects")).expect("work folders");
        fs::create_dir_all(work.join(".denote")).expect("internal folder");
        fs::create_dir_all(music.join("songs")).expect("music folders");
        fs::write(work.join("projects/Atlas.md"), "work").expect("work file");
        fs::write(work.join(".denote/private.md"), "hidden").expect("hidden file");
        fs::write(music.join("songs/Set list.md"), "music").expect("music file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        let connection = db::open(&db_path).expect("database opened");
        db::ensure_vault(&connection, work.to_str().unwrap(), "Work").expect("work vault");
        db::ensure_vault(&connection, music.to_str().unwrap(), "Music").expect("music vault");

        let batch = list_known_vault_files(&db_path, Some(&work)).expect("global file inventory");

        assert_eq!(batch.files.len(), 2);
        assert!(
            batch
                .files
                .iter()
                .any(|file| file.file_name == "Atlas.md" && file.current)
        );
        assert!(
            batch
                .files
                .iter()
                .any(|file| file.file_name == "Set list.md" && !file.current)
        );
        assert!(
            batch
                .files
                .iter()
                .all(|file| !file.path.starts_with(".denote"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn global_file_search_rejects_symlinked_vault_roots() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = directory.path().join("outside");
        let linked = directory.path().join("linked-vault");
        fs::create_dir(&outside).expect("outside directory");
        fs::write(outside.join("private.md"), "private").expect("outside file");
        symlink(&outside, &linked).expect("vault symlink");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        let connection = db::open(&db_path).expect("database opened");
        db::ensure_vault(&connection, linked.to_str().unwrap(), "Linked")
            .expect("linked vault record");

        let batch = list_known_vault_files(&db_path, None).expect("global file inventory");

        assert!(batch.files.is_empty());
        assert_eq!(batch.skipped_vault_count, 1);
    }

    #[test]
    fn persists_one_markdown_view_mode_per_vault() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "# Note").expect("note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        assert_eq!(
            open_vault(&db_path, vault_path.to_str().unwrap())
                .expect("initial vault")
                .markdown_view_mode,
            None
        );
        set_vault_markdown_view_mode(
            &db_path,
            vault_path.to_str().unwrap(),
            MarkdownViewMode::Source,
        )
        .expect("save view mode");
        assert_eq!(
            refresh_vault(&db_path, vault_path.to_str().unwrap())
                .expect("refreshed vault")
                .markdown_view_mode,
            Some(MarkdownViewMode::Source)
        );

        let other_vault = directory.path().join("other");
        fs::create_dir(&other_vault).expect("other vault");
        assert_eq!(
            open_vault(&db_path, other_vault.to_str().unwrap())
                .expect("other vault")
                .markdown_view_mode,
            None
        );
    }

    #[test]
    fn resolves_and_maintains_a_custom_welcome_page() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("denote.sqlite3");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("docs")).expect("vault directory");
        fs::write(vault_path.join(".denote.md"), "# Default").expect("default welcome");
        fs::write(vault_path.join("docs/Start.md"), "# Start").expect("custom welcome");
        fs::write(vault_path.join("plain.txt"), "Plain").expect("plain text");
        db::initialize(&db_path).expect("database initialized");

        let initial = open_vault(&db_path, vault_path.to_str().unwrap()).expect("initial vault");
        assert_eq!(initial.welcome_page.custom_path, None);
        assert_eq!(
            initial.welcome_page.effective_path,
            Some(".denote.md".to_string())
        );

        let selected = set_welcome_page_path(
            &db_path,
            vault_path.to_str().unwrap(),
            Some("docs/Start.md"),
        )
        .expect("set welcome page");
        assert_eq!(selected.custom_path, Some("docs/Start.md".to_string()));
        assert_eq!(selected.effective_path, selected.custom_path);

        assert!(
            set_welcome_page_path(&db_path, vault_path.to_str().unwrap(), Some("plain.txt"),)
                .is_err()
        );

        rename_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "docs/Start.md",
            "Start.txt",
        )
        .expect("rename welcome extension");
        assert_eq!(
            refresh_vault(&db_path, vault_path.to_str().unwrap())
                .expect("renamed extension")
                .welcome_page
                .custom_path,
            None
        );
        rename_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "docs/Start.txt",
            "Start.md",
        )
        .expect("restore welcome extension");
        set_welcome_page_path(
            &db_path,
            vault_path.to_str().unwrap(),
            Some("docs/Start.md"),
        )
        .expect("restore welcome page");

        rename_entry(&db_path, vault_path.to_str().unwrap(), "docs", "guide")
            .expect("rename welcome folder");
        assert_eq!(
            refresh_vault(&db_path, vault_path.to_str().unwrap())
                .expect("renamed vault")
                .welcome_page
                .custom_path,
            Some("guide/Start.md".to_string())
        );

        trash_entry(&db_path, vault_path.to_str().unwrap(), "guide/Start.md")
            .expect("trash welcome page");
        let cleared = refresh_vault(&db_path, vault_path.to_str().unwrap())
            .expect("cleared welcome page")
            .welcome_page;
        assert_eq!(cleared.custom_path, None);
        assert_eq!(cleared.effective_path, Some(".denote.md".to_string()));
    }

    #[test]
    fn does_not_fall_back_when_a_custom_welcome_page_disappears() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("denote.sqlite3");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join(".denote.md"), "# Default").expect("default welcome");
        fs::write(vault_path.join("Start.md"), "# Start").expect("custom welcome");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        set_welcome_page_path(&db_path, vault_path.to_str().unwrap(), Some("Start.md"))
            .expect("set welcome page");

        fs::remove_file(vault_path.join("Start.md")).expect("remove custom welcome");

        let welcome_page = refresh_vault(&db_path, vault_path.to_str().unwrap())
            .expect("refresh vault")
            .welcome_page;
        assert_eq!(welcome_page.custom_path, Some("Start.md".to_string()));
        assert_eq!(welcome_page.effective_path, welcome_page.custom_path);
    }

    #[test]
    fn preserves_the_legacy_welcome_page_for_the_builtin_vault() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("denote.sqlite3");
        let vault_path = directory.path().join("Denote Welcome");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("Welcome.md"), "# Welcome").expect("legacy welcome");
        db::initialize(&db_path).expect("database initialized");
        let mut connection = db::open(&db_path).expect("database opened");
        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        db::register_default_vault(
            &mut connection,
            canonical_vault_path.to_str().unwrap(),
            "Denote Welcome",
        )
        .expect("register default vault");

        let snapshot = open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        assert_eq!(
            snapshot.welcome_page.effective_path,
            Some("Welcome.md".to_string())
        );
    }

    #[test]
    fn cached_vault_open_returns_immediately_then_refreshes_from_disk() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("one.md"), "one").expect("first file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let initial = open_vault(&db_path, vault_path.to_str().unwrap()).expect("initial scan");
        assert!(!initial.from_cache);
        fs::write(vault_path.join("two.md"), "two").expect("external file");
        fs::write(vault_path.join(".denote.md"), "# Welcome").expect("welcome file");

        let cached =
            open_cached_vault(&db_path, vault_path.to_str().unwrap()).expect("cached open");
        assert!(cached.from_cache);
        assert!(cached.tree.iter().all(|node| node.name != "two.md"));
        assert!(cached.tree.iter().all(|node| node.name != ".denote.md"));
        assert_eq!(
            cached.welcome_page.effective_path,
            Some(".denote.md".to_string())
        );

        let refreshed =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh scan");
        assert!(!refreshed.from_cache);
        assert!(refreshed.tree.iter().any(|node| node.name == "two.md"));

        let updated =
            open_cached_vault(&db_path, vault_path.to_str().unwrap()).expect("updated cache");
        assert!(updated.from_cache);
        assert!(updated.tree.iter().any(|node| node.name == "two.md"));
    }

    #[test]
    fn persists_project_roots_outside_the_tree_cache_and_tracks_availability() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("apps/web")).expect("project folders");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let initial = open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        assert!(initial.project_roots.is_empty());

        let roots =
            mark_project_root(&db_path, vault_path.to_str().unwrap(), "").expect("whole vault");
        assert_eq!(roots.project_roots.len(), 1);
        assert_eq!(roots.project_roots[0].root_path, "");
        assert!(roots.project_roots[0].available);

        let roots = mark_project_root(&db_path, vault_path.to_str().unwrap(), "apps/web")
            .expect("nested project root");
        let nested = roots
            .project_roots
            .iter()
            .find(|root| root.root_path == "apps/web")
            .expect("nested root")
            .clone();
        let duplicate = mark_project_root(&db_path, vault_path.to_str().unwrap(), "apps/web")
            .expect("duplicate nested project root");
        assert_eq!(
            duplicate
                .project_roots
                .iter()
                .find(|root| root.root_path == "apps/web")
                .expect("duplicate root")
                .id,
            nested.id
        );

        fs::remove_dir_all(vault_path.join("apps")).expect("external project removal");

        let cached =
            open_cached_vault(&db_path, vault_path.to_str().unwrap()).expect("cached vault");
        assert!(cached.from_cache);
        assert!(
            !cached
                .project_roots
                .iter()
                .find(|root| root.id == nested.id)
                .expect("missing cached project root")
                .available
        );
        assert!(
            cached
                .project_roots
                .iter()
                .find(|root| root.root_path.is_empty())
                .expect("whole-vault root")
                .available
        );
        let refreshed =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refreshed vault");
        assert!(
            !refreshed
                .project_roots
                .iter()
                .find(|root| root.id == nested.id)
                .expect("missing refreshed project root")
                .available
        );

        let remaining = unmark_project_root(&db_path, vault_path.to_str().unwrap(), &nested.id)
            .expect("remove missing project root");
        assert_eq!(remaining.project_roots.len(), 1);
        assert_eq!(remaining.project_roots[0].root_path, "");
    }

    #[test]
    fn materializes_only_safe_direct_workspace_children_and_keeps_missing_rows() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("mono/app/src")).expect("nested app");
        fs::create_dir_all(vault_path.join("mono/lib")).expect("library");
        fs::create_dir_all(vault_path.join("mono/.git")).expect("git metadata");
        fs::write(vault_path.join("mono/README.md"), "workspace file").expect("workspace file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(
                directory.path().join("outside"),
                vault_path.join("mono/linked"),
            )
            .expect("workspace symlink");
        }
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        let marked = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "mono")
            .expect("mark workspace");
        assert_eq!(marked.project_workspaces.len(), 1);
        assert_eq!(
            marked
                .project_roots
                .iter()
                .map(|project| project.root_path.as_str())
                .collect::<Vec<_>>(),
            ["mono/app", "mono/lib"]
        );
        assert!(
            marked
                .project_roots
                .iter()
                .all(|project| !project.explicit && project.workspace_id.is_some())
        );
        let app_id = marked
            .project_roots
            .iter()
            .find(|project| project.root_path == "mono/app")
            .expect("app project")
            .id
            .clone();

        let cached =
            open_cached_vault(&db_path, vault_path.to_str().unwrap()).expect("cached snapshot");
        assert_eq!(
            cached
                .project_roots
                .iter()
                .find(|project| project.root_path == "mono/app")
                .expect("cached app")
                .id,
            app_id
        );

        fs::create_dir(vault_path.join("mono/new-child")).expect("new direct child");
        let discovered =
            open_cached_vault(&db_path, vault_path.to_str().unwrap()).expect("cached discovery");
        assert!(
            discovered
                .project_roots
                .iter()
                .any(|project| project.root_path == "mono/new-child")
        );

        fs::remove_dir_all(vault_path.join("mono/lib")).expect("external child removal");
        let missing =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("missing child snapshot");
        assert!(
            !missing
                .project_roots
                .iter()
                .find(|project| project.root_path == "mono/lib")
                .expect("retained missing child")
                .available
        );
        fs::remove_dir_all(vault_path.join("mono")).expect("external workspace removal");
        let unavailable = refresh_vault(&db_path, vault_path.to_str().unwrap())
            .expect("unavailable workspace snapshot");
        assert!(!unavailable.project_workspaces[0].available);
        assert!(
            unavailable
                .project_roots
                .iter()
                .all(|project| !project.available)
        );
    }

    #[test]
    fn preserves_explicit_and_workspace_provenance_through_unmarking() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("ws/child")).expect("workspace child");
        fs::create_dir(vault_path.join("explicit-only")).expect("explicit folder");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        let implicit = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "ws")
            .expect("mark workspace");
        let workspace_id = implicit.project_workspaces[0].id.clone();
        let child_id = implicit.project_roots[0].id.clone();
        assert!(!implicit.project_roots[0].explicit);

        let explicit = mark_project_root(&db_path, vault_path.to_str().unwrap(), "ws/child")
            .expect("explicit child");
        let child = explicit
            .project_roots
            .iter()
            .find(|project| project.root_path == "ws/child")
            .expect("explicit child project");
        assert_eq!(child.id, child_id);
        assert!(child.explicit);
        assert_eq!(child.workspace_id.as_deref(), Some(workspace_id.as_str()));

        let implicit_again = unmark_project_root(&db_path, vault_path.to_str().unwrap(), &child_id)
            .expect("clear explicit provenance");
        let child = implicit_again
            .project_roots
            .iter()
            .find(|project| project.id == child_id)
            .expect("retained implicit child");
        assert!(!child.explicit);
        assert_eq!(child.workspace_id.as_deref(), Some(workspace_id.as_str()));

        let explicit_only =
            mark_project_root(&db_path, vault_path.to_str().unwrap(), "explicit-only")
                .expect("explicit-only project");
        let explicit_only_id = explicit_only
            .project_roots
            .iter()
            .find(|project| project.root_path == "explicit-only")
            .expect("explicit-only root")
            .id
            .clone();
        let unmarked =
            unmark_project_workspace(&db_path, vault_path.to_str().unwrap(), &workspace_id)
                .expect("unmark workspace");
        assert!(unmarked.project_workspaces.is_empty());
        assert!(
            !unmarked
                .project_roots
                .iter()
                .any(|project| project.id == child_id)
        );
        assert!(
            unmarked
                .project_roots
                .iter()
                .any(|project| project.id == explicit_only_id && project.explicit)
        );
    }

    #[test]
    fn supports_nested_workspaces_with_one_direct_association_per_project() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("parent/child/deep")).expect("nested workspaces");
        fs::create_dir(vault_path.join("sibling")).expect("root sibling");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        let root_workspace = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "")
            .expect("root workspace");
        let root_workspace_id = root_workspace.project_workspaces[0].id.clone();
        let nested = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "parent")
            .expect("nested workspace");
        let nested_workspace_id = nested
            .project_workspaces
            .iter()
            .find(|workspace| workspace.root_path == "parent")
            .expect("nested workspace record")
            .id
            .clone();
        assert_eq!(nested.project_workspaces.len(), 2);
        assert_eq!(
            nested
                .project_roots
                .iter()
                .find(|project| project.root_path == "parent")
                .expect("parent project")
                .workspace_id
                .as_deref(),
            Some(root_workspace_id.as_str())
        );
        assert_eq!(
            nested
                .project_roots
                .iter()
                .find(|project| project.root_path == "parent/child")
                .expect("nested child project")
                .workspace_id
                .as_deref(),
            Some(nested_workspace_id.as_str())
        );
        assert!(
            !nested
                .project_roots
                .iter()
                .any(|project| project.root_path == "parent/child/deep")
        );
    }

    #[test]
    fn managed_moves_reconcile_workspace_associations_and_preserve_ids() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("a/item")).expect("first workspace child");
        fs::create_dir_all(vault_path.join("a/keep")).expect("explicit child");
        fs::create_dir(vault_path.join("b")).expect("second workspace");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "a")
            .expect("first workspace");
        let initial = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "b")
            .expect("second workspace");
        let item_id = initial
            .project_roots
            .iter()
            .find(|project| project.root_path == "a/item")
            .expect("implicit item")
            .id
            .clone();
        let b_workspace_id = initial
            .project_workspaces
            .iter()
            .find(|workspace| workspace.root_path == "b")
            .expect("second workspace")
            .id
            .clone();

        rename_entry(&db_path, vault_path.to_str().unwrap(), "a/item", "renamed")
            .expect("rename child");
        move_entry(&db_path, vault_path.to_str().unwrap(), "a/renamed", "b")
            .expect("move between workspaces");
        let moved = refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("moved snapshot");
        let project = moved
            .project_roots
            .iter()
            .find(|project| project.id == item_id)
            .expect("moved implicit project");
        assert_eq!(project.root_path, "b/renamed");
        assert_eq!(
            project.workspace_id.as_deref(),
            Some(b_workspace_id.as_str())
        );

        move_entry(&db_path, vault_path.to_str().unwrap(), "b/renamed", "")
            .expect("move outside workspaces");
        let outside =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("outside snapshot");
        assert!(
            !outside
                .project_roots
                .iter()
                .any(|project| project.id == item_id)
        );

        let explicit = mark_project_root(&db_path, vault_path.to_str().unwrap(), "a/keep")
            .expect("explicit implicit child");
        let explicit_id = explicit
            .project_roots
            .iter()
            .find(|project| project.root_path == "a/keep")
            .expect("explicit child")
            .id
            .clone();
        move_entry(&db_path, vault_path.to_str().unwrap(), "a/keep", "")
            .expect("move explicit project outside workspace");
        let explicit_outside =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("explicit snapshot");
        let project = explicit_outside
            .project_roots
            .iter()
            .find(|project| project.id == explicit_id)
            .expect("preserved explicit project");
        assert_eq!(project.root_path, "keep");
        assert!(project.explicit);
        assert_eq!(project.workspace_id, None);
    }

    #[test]
    fn workspace_rename_and_recovery_keep_workspace_and_project_ids() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("container/project")).expect("workspace project");
        fs::create_dir_all(vault_path.join("other")).expect("other workspace");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        let initial = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "container")
            .expect("workspace");
        let workspace_id = initial.project_workspaces[0].id.clone();
        let project_id = initial.project_roots[0].id.clone();
        mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "other")
            .expect("other workspace");

        rename_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "container",
            "renamed",
        )
        .expect("rename workspace");
        let renamed =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("renamed snapshot");
        assert!(
            renamed
                .project_workspaces
                .iter()
                .any(|workspace| workspace.id == workspace_id && workspace.root_path == "renamed")
        );
        assert!(
            renamed
                .project_roots
                .iter()
                .any(|project| project.id == project_id
                    && project.root_path == "renamed/project"
                    && project.workspace_id.as_deref() == Some(workspace_id.as_str()))
        );

        let canonical = fs::canonicalize(&vault_path).expect("canonical vault");
        let connection = db::open(&db_path).expect("database opened");
        let (vault_id, _) = ensure_vault(&connection, &canonical).expect("vault");
        db::begin_file_operation(
            &connection,
            vault_id,
            "rename",
            "renamed/project",
            "other/project",
            None,
            true,
        )
        .expect("recovery journal");
        fs::rename(
            vault_path.join("renamed/project"),
            vault_path.join("other/project"),
        )
        .expect("interrupted move");
        drop(connection);

        let recovered =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("recover move");
        let other_workspace_id = recovered
            .project_workspaces
            .iter()
            .find(|workspace| workspace.root_path == "other")
            .expect("other workspace")
            .id
            .clone();
        let project = recovered
            .project_roots
            .iter()
            .find(|project| project.id == project_id)
            .expect("recovered project");
        assert_eq!(project.root_path, "other/project");
        assert_eq!(
            project.workspace_id.as_deref(),
            Some(other_workspace_id.as_str())
        );
    }

    #[test]
    fn trash_and_restore_rediscover_workspace_children_with_new_ids() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("ws/child")).expect("workspace child");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        let initial = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "ws")
            .expect("workspace");
        let original_id = initial.project_roots[0].id.clone();

        let trash =
            trash_entry(&db_path, vault_path.to_str().unwrap(), "ws/child").expect("trash child");
        let after_trash =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("trashed snapshot");
        assert!(
            !after_trash
                .project_roots
                .iter()
                .any(|project| project.id == original_id)
        );

        restore_trash_item(&db_path, vault_path.to_str().unwrap(), trash.id)
            .expect("restore child");
        let restored =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("restored snapshot");
        let restored_project = restored
            .project_roots
            .iter()
            .find(|project| project.root_path == "ws/child")
            .expect("rediscovered child");
        assert_ne!(restored_project.id, original_id);
        assert!(!restored_project.explicit);

        trash_entry(&db_path, vault_path.to_str().unwrap(), "ws").expect("trash workspace");
        let removed =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("removed workspace");
        assert!(removed.project_workspaces.is_empty());
        assert!(removed.project_roots.is_empty());
    }

    #[test]
    fn suggests_safe_root_git_projects_once_per_vault() {
        let directory = tempdir().expect("temp directory");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let dismissed_vault = directory.path().join("dismissed");
        fs::create_dir_all(dismissed_vault.join(".git")).expect("git directory");
        let snapshot = open_vault(&db_path, dismissed_vault.to_str().unwrap()).expect("git vault");
        assert!(snapshot.suggest_git_project);
        let dismissed = dismiss_git_project_suggestion(&db_path, dismissed_vault.to_str().unwrap())
            .expect("dismiss suggestion");
        assert!(!dismissed.suggest_git_project);
        assert!(
            !refresh_vault(&db_path, dismissed_vault.to_str().unwrap())
                .expect("dismissed refresh")
                .suggest_git_project
        );

        let project_vault = directory.path().join("project");
        fs::create_dir(&project_vault).expect("project vault");
        fs::write(project_vault.join(".git"), "gitdir: metadata").expect("git file");
        assert!(
            open_vault(&db_path, project_vault.to_str().unwrap())
                .expect("git file vault")
                .suggest_git_project
        );
        let marked = mark_project_root(&db_path, project_vault.to_str().unwrap(), "")
            .expect("mark root project");
        let project_id = marked.project_roots[0].id.clone();
        assert!(!marked.suggest_git_project);
        unmark_project_root(&db_path, project_vault.to_str().unwrap(), &project_id)
            .expect("unmark root project");
        assert!(
            !refresh_vault(&db_path, project_vault.to_str().unwrap())
                .expect("unmarked project refresh")
                .suggest_git_project
        );

        let workspace_vault = directory.path().join("workspace");
        fs::create_dir_all(workspace_vault.join(".git")).expect("workspace git directory");
        let marked = mark_project_workspace(&db_path, workspace_vault.to_str().unwrap(), "")
            .expect("mark root workspace");
        let workspace_id = marked.project_workspaces[0].id.clone();
        assert!(!marked.suggest_git_project);
        unmark_project_workspace(&db_path, workspace_vault.to_str().unwrap(), &workspace_id)
            .expect("unmark root workspace");
        assert!(
            !refresh_vault(&db_path, workspace_vault.to_str().unwrap())
                .expect("unmarked workspace refresh")
                .suggest_git_project
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let symlink_vault = directory.path().join("symlink");
            let external_git = directory.path().join("external-git");
            fs::create_dir(&symlink_vault).expect("symlink vault");
            fs::create_dir(&external_git).expect("external git");
            symlink(&external_git, symlink_vault.join(".git")).expect("git symlink");
            assert!(
                !open_vault(&db_path, symlink_vault.to_str().unwrap())
                    .expect("symlink git vault")
                    .suggest_git_project
            );
        }
    }

    #[test]
    fn resolves_implicit_project_ids_to_safe_project_directories() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("ws/project")).expect("workspace project");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        let configuration = mark_project_workspace(&db_path, vault_path.to_str().unwrap(), "ws")
            .expect("workspace");
        let project_id = configuration.project_roots[0].id.clone();

        let resolved = resolve_project_root(&db_path, vault_path.to_str().unwrap(), &project_id)
            .expect("implicit project resolution");
        assert_eq!(
            resolved,
            fs::canonicalize(vault_path.join("ws/project")).expect("canonical project")
        );
    }

    #[test]
    fn rejects_invalid_project_root_paths() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let outside = directory.path().join("outside");
        fs::create_dir_all(vault_path.join("folder")).expect("vault folders");
        fs::create_dir(&outside).expect("outside folder");
        fs::write(vault_path.join("note.md"), "synthetic note").expect("synthetic file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        for path in [
            "note.md",
            "missing",
            "../outside",
            ".denote",
            vault_path.join("folder").to_str().unwrap(),
        ] {
            assert!(
                mark_project_root(&db_path, vault_path.to_str().unwrap(), path).is_err(),
                "expected invalid project root: {path}"
            );
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            symlink(&outside, vault_path.join("linked")).expect("outside symlink");
            assert!(mark_project_root(&db_path, vault_path.to_str().unwrap(), "linked").is_err());
        }
    }

    #[test]
    fn rename_and_move_rekey_nested_project_roots_with_stable_ids() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("workspace/app")).expect("project folders");
        fs::create_dir_all(vault_path.join("workspace-old")).expect("sibling project");
        fs::create_dir_all(vault_path.join("destination")).expect("move destination");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        mark_project_root(&db_path, vault_path.to_str().unwrap(), "workspace")
            .expect("workspace root");
        mark_project_root(&db_path, vault_path.to_str().unwrap(), "workspace/app")
            .expect("nested root");
        let initial = mark_project_root(&db_path, vault_path.to_str().unwrap(), "workspace-old")
            .expect("sibling root");
        let workspace_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path == "workspace")
            .expect("workspace root")
            .id
            .clone();
        let nested_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path == "workspace/app")
            .expect("nested root")
            .id
            .clone();
        let sibling_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path == "workspace-old")
            .expect("sibling root")
            .id
            .clone();

        rename_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "workspace",
            "renamed",
        )
        .expect("rename project");
        let connection = db::open(&db_path).expect("database opened");
        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let (vault_id, _) = ensure_vault(&connection, &canonical_vault_path).expect("vault");
        let renamed = db::list_project_roots(&connection, vault_id).expect("renamed roots");
        assert_eq!(
            renamed
                .iter()
                .find(|root| root.id == workspace_id)
                .expect("renamed workspace")
                .root_path,
            "renamed"
        );
        assert_eq!(
            renamed
                .iter()
                .find(|root| root.id == nested_id)
                .expect("renamed nested root")
                .root_path,
            "renamed/app"
        );
        assert_eq!(
            renamed
                .iter()
                .find(|root| root.id == sibling_id)
                .expect("unrelated sibling")
                .root_path,
            "workspace-old"
        );

        assert_eq!(
            move_entry(
                &db_path,
                vault_path.to_str().unwrap(),
                "renamed",
                "destination",
            )
            .expect("move project"),
            "destination/renamed"
        );
        let moved = db::list_project_roots(&connection, vault_id).expect("moved roots");
        assert_eq!(
            moved
                .iter()
                .find(|root| root.id == workspace_id)
                .expect("moved workspace")
                .root_path,
            "destination/renamed"
        );
        assert_eq!(
            moved
                .iter()
                .find(|root| root.id == nested_id)
                .expect("moved nested root")
                .root_path,
            "destination/renamed/app"
        );
        assert_eq!(
            moved
                .iter()
                .find(|root| root.id == sibling_id)
                .expect("unrelated sibling")
                .root_path,
            "workspace-old"
        );
    }

    #[test]
    fn stages_current_editor_content_as_a_clipboard_file() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let cache_path = directory.path().join("cache");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "saved").expect("saved file");

        let staged = stage_clipboard_file(
            vault_path.to_str().unwrap(),
            "note.md",
            "unsaved\ntext",
            FileEncoding::Utf8,
            FileLineEnding::Crlf,
            &cache_path,
        )
        .expect("staged clipboard file");

        assert_eq!(staged.file_name().unwrap(), "note.md");
        assert_eq!(fs::read(&staged).expect("staged bytes"), b"unsaved\r\ntext");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&staged)
                    .expect("file metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(staged.parent().unwrap())
                    .expect("directory metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn clipboard_staging_rejects_a_symlinked_cache_root() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let app_cache = directory.path().join("cache");
        let outside = directory.path().join("outside");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::create_dir(&app_cache).expect("app cache");
        fs::create_dir(&outside).expect("outside directory");
        fs::write(vault_path.join("note.md"), "saved").expect("saved file");
        fs::write(outside.join("keep.txt"), "keep").expect("outside sentinel");
        symlink(&outside, app_cache.join("clipboard-files")).expect("cache symlink");

        assert!(
            stage_clipboard_file(
                vault_path.to_str().unwrap(),
                "note.md",
                "plaintext",
                FileEncoding::Utf8,
                FileLineEnding::Lf,
                &app_cache,
            )
            .is_err()
        );
        assert_eq!(
            fs::read_to_string(outside.join("keep.txt")).expect("sentinel remains"),
            "keep"
        );
    }

    #[test]
    fn saves_history_metadata_and_restores_content() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "first").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");
        assert_eq!(document.stats.open_count, 1);
        record_edit(&db_path, vault_path.to_str().unwrap(), "note.md").expect("record edit");

        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "second",
            FileEncoding::Utf8,
            FileLineEnding::Lf,
            "autosave",
            None,
        )
        .expect("save note");
        let history =
            list_history(&db_path, vault_path.to_str().unwrap(), "note.md").expect("history");
        assert_eq!(history.len(), 1);

        let restored = restore_revision(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            history[0].id,
        )
        .expect("restore revision");
        assert_eq!(restored.content, "first");
        assert_eq!(
            fs::read_to_string(vault_path.join("note.md")).expect("restored file"),
            "first"
        );
        assert_eq!(restored.stats.edit_count, 1);
        assert_eq!(restored.stats.save_count, 2);
    }

    #[test]
    fn rejects_saves_when_the_file_changed_outside_denote() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "first").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");
        fs::write(vault_path.join("note.md"), "external").expect("external edit");

        let result = save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "denote edit",
            FileEncoding::Utf8,
            FileLineEnding::Lf,
            "autosave",
            Some(&document.content_hash),
        );
        assert!(matches!(result, Err(AppError::Conflict(_))));
        assert_eq!(
            fs::read_to_string(vault_path.join("note.md")).expect("current file"),
            "external"
        );
        assert!(
            list_history(&db_path, vault_path.to_str().unwrap(), "note.md")
                .expect("history")
                .is_empty()
        );
    }

    #[test]
    fn serializes_saves_across_denote_processes_with_content_hashes() {
        use std::sync::{Arc, Barrier};

        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "first").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");
        let barrier = Arc::new(Barrier::new(2));

        let handles = ["second", "third"].map(|content| {
            let barrier = Arc::clone(&barrier);
            let db_path = db_path.clone();
            let vault_path = vault_path.clone();
            let expected_hash = document.content_hash.clone();
            std::thread::spawn(move || {
                barrier.wait();
                save_note(
                    &db_path,
                    vault_path.to_str().unwrap(),
                    "note.md",
                    content,
                    FileEncoding::Utf8,
                    FileLineEnding::Lf,
                    "autosave",
                    Some(&expected_hash),
                )
            })
        });
        let results = handles.map(|handle| handle.join().expect("save thread"));
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(AppError::Conflict(_))))
                .count(),
            1
        );
    }

    #[test]
    fn moves_entries_to_trash_and_restores_them() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "content").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("initial refresh");
        let trashed =
            trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");
        assert_eq!(trashed.original_path, "note.md");
        assert!(!vault_path.join("note.md").exists());
        let connection = db::open(&db_path).expect("database");
        let canonical = canonical_vault(vault_path.to_str().expect("vault path")).expect("vault");
        let (vault_id, _) = ensure_vault(&connection, &canonical).expect("vault record");
        let mut cached = db::workspace_tree_cache(&connection, vault_id)
            .expect("cached tree")
            .expect("cache");
        assert!(find_cached_node_mut(&mut cached, "note.md").is_none());

        let restored = restore_trash_item(&db_path, vault_path.to_str().unwrap(), trashed.id)
            .expect("restore note");
        assert_eq!(restored.path, "note.md");
        assert!(vault_path.join("note.md").exists());
        let mut cached = db::workspace_tree_cache(&connection, vault_id)
            .expect("cached tree")
            .expect("cache");
        assert!(find_cached_node_mut(&mut cached, "note.md").is_some());
    }

    #[test]
    fn trash_clears_project_roots_below_the_entry_without_restoring_them() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("parent/project/nested")).expect("project folders");
        fs::create_dir_all(vault_path.join("parent/project-old")).expect("sibling project");
        fs::create_dir_all(vault_path.join("parent/note.md-project")).expect("file-prefix sibling");
        fs::write(vault_path.join("parent/note.md"), "synthetic note").expect("synthetic file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        for root_path in [
            "",
            "parent",
            "parent/project",
            "parent/project/nested",
            "parent/project-old",
            "parent/note.md-project",
        ] {
            mark_project_root(&db_path, vault_path.to_str().unwrap(), root_path)
                .expect("mark project root");
        }
        let connection = db::open(&db_path).expect("database opened");
        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let (vault_id, _) = ensure_vault(&connection, &canonical_vault_path).expect("vault");
        let initial = db::list_project_roots(&connection, vault_id).expect("initial roots");
        let whole_vault_id = initial
            .iter()
            .find(|root| root.root_path.is_empty())
            .expect("whole-vault root")
            .id
            .clone();
        let parent_id = initial
            .iter()
            .find(|root| root.root_path == "parent")
            .expect("parent root")
            .id
            .clone();
        let sibling_id = initial
            .iter()
            .find(|root| root.root_path == "parent/project-old")
            .expect("sibling root")
            .id
            .clone();
        let file_prefix_sibling_id = initial
            .iter()
            .find(|root| root.root_path == "parent/note.md-project")
            .expect("file-prefix sibling root")
            .id
            .clone();

        let trashed_file = trash_entry(&db_path, vault_path.to_str().unwrap(), "parent/note.md")
            .expect("trash file");
        assert_eq!(
            db::list_project_roots(&connection, vault_id)
                .expect("roots after file trash")
                .len(),
            initial.len()
        );
        restore_trash_item(&db_path, vault_path.to_str().unwrap(), trashed_file.id)
            .expect("restore file");

        let trashed_project = trash_entry(&db_path, vault_path.to_str().unwrap(), "parent/project")
            .expect("trash project");
        let remaining =
            db::list_project_roots(&connection, vault_id).expect("roots after project trash");
        assert_eq!(remaining.len(), 4);
        assert_eq!(
            remaining
                .iter()
                .find(|root| root.id == whole_vault_id)
                .expect("whole-vault root")
                .root_path,
            ""
        );
        assert_eq!(
            remaining
                .iter()
                .find(|root| root.id == parent_id)
                .expect("ancestor root")
                .root_path,
            "parent"
        );
        assert_eq!(
            remaining
                .iter()
                .find(|root| root.id == sibling_id)
                .expect("sibling root")
                .root_path,
            "parent/project-old"
        );
        assert_eq!(
            remaining
                .iter()
                .find(|root| root.id == file_prefix_sibling_id)
                .expect("file-prefix sibling root")
                .root_path,
            "parent/note.md-project"
        );
        assert!(
            remaining
                .iter()
                .all(|root| !root.root_path.starts_with(".denote/trash"))
        );

        restore_trash_item(&db_path, vault_path.to_str().unwrap(), trashed_project.id)
            .expect("restore project");
        let after_restore =
            db::list_project_roots(&connection, vault_id).expect("roots after restore");
        assert_eq!(after_restore.len(), remaining.len());
        for (id, path) in [
            (&whole_vault_id, ""),
            (&parent_id, "parent"),
            (&sibling_id, "parent/project-old"),
            (&file_prefix_sibling_id, "parent/note.md-project"),
        ] {
            assert_eq!(
                after_restore
                    .iter()
                    .find(|root| &root.id == id)
                    .expect("preserved root")
                    .root_path,
                path
            );
        }
    }

    #[test]
    fn trashed_note_metadata_does_not_leak_to_replacement_file() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "original").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");
        set_bookmark(&db_path, vault_path.to_str().unwrap(), "note.md", true).expect("bookmark");
        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "edited",
            FileEncoding::Utf8,
            FileLineEnding::Lf,
            "autosave",
            None,
        )
        .expect("save note");
        trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");
        let trashed_snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("trashed snapshot");
        assert!(trashed_snapshot.bookmarks.is_empty());
        assert!(trashed_snapshot.recent.is_empty());

        create_entry(&db_path, vault_path.to_str().unwrap(), "", "note.md", false)
            .expect("replacement note");
        let replacement =
            read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("replacement");
        assert!(!replacement.stats.bookmarked);
        assert!(
            list_history(&db_path, vault_path.to_str().unwrap(), "note.md")
                .expect("replacement history")
                .is_empty()
        );

        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");
        let restored =
            restore_trash_item(&db_path, vault_path.to_str().unwrap(), snapshot.trash[0].id)
                .expect("restore original");
        assert_eq!(restored.path, "note (restored 1).md");
        let restored_document = read_note(&db_path, vault_path.to_str().unwrap(), &restored.path)
            .expect("restored note");
        assert!(restored_document.stats.bookmarked);
        assert_eq!(
            list_history(&db_path, vault_path.to_str().unwrap(), &restored.path)
                .expect("restored history")
                .len(),
            1
        );
    }

    #[test]
    fn empty_trash_permanently_removes_hidden_files_and_metadata() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "content").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");
        trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");

        assert_eq!(
            empty_trash(&db_path, vault_path.to_str().unwrap()).expect("empty trash"),
            1
        );
        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");
        assert!(snapshot.trash.is_empty());
        let connection = db::open(&db_path).expect("database opened");
        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let (vault_id, _) = ensure_vault(&connection, &canonical_vault_path).expect("vault");
        assert!(
            db::stats_map(&connection, vault_id)
                .expect("stats")
                .is_empty()
        );
    }

    #[test]
    fn renaming_a_replacement_does_not_change_older_trash_destinations() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "original").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");
        create_entry(&db_path, vault_path.to_str().unwrap(), "", "note.md", false)
            .expect("replacement");
        rename_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "current.md",
        )
        .expect("rename replacement");

        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");
        assert_eq!(snapshot.trash[0].original_path, "note.md");
    }

    #[test]
    fn reconciles_a_file_move_completed_before_metadata_commit() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("old.md"), "content").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        read_note(&db_path, vault_path.to_str().unwrap(), "old.md").expect("read note");

        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let connection = db::open(&db_path).expect("database opened");
        let (vault_id, _) = ensure_vault(&connection, &canonical_vault_path).expect("vault");
        db::begin_file_operation(
            &connection,
            vault_id,
            "rename",
            "old.md",
            "new.md",
            None,
            false,
        )
        .expect("journal operation");
        fs::rename(vault_path.join("old.md"), vault_path.join("new.md")).expect("move file");

        refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("reconcile vault");
        let new_document =
            read_note(&db_path, vault_path.to_str().unwrap(), "new.md").expect("new note");
        assert_eq!(new_document.stats.open_count, 2);
        let connection = db::open(&db_path).expect("database reopened");
        assert!(
            db::pending_file_operations(&connection, vault_id)
                .expect("pending operations")
                .is_empty()
        );
    }

    #[test]
    fn reconciles_project_roots_after_interrupted_directory_operations() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("old/nested")).expect("project folders");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        mark_project_root(&db_path, vault_path.to_str().unwrap(), "").expect("whole-vault root");
        mark_project_root(&db_path, vault_path.to_str().unwrap(), "old").expect("project root");
        let initial = mark_project_root(&db_path, vault_path.to_str().unwrap(), "old/nested")
            .expect("nested root");
        let whole_vault_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path.is_empty())
            .expect("whole-vault root")
            .id
            .clone();
        let project_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path == "old")
            .expect("project root")
            .id
            .clone();
        let nested_id = initial
            .project_roots
            .iter()
            .find(|root| root.root_path == "old/nested")
            .expect("nested root")
            .id
            .clone();

        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let connection = db::open(&db_path).expect("database opened");
        let (vault_id, _) = ensure_vault(&connection, &canonical_vault_path).expect("vault");
        db::begin_file_operation(&connection, vault_id, "rename", "old", "new", None, true)
            .expect("rename journal");
        fs::rename(vault_path.join("old"), vault_path.join("new")).expect("rename directory");

        refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("reconcile rename");
        let renamed = db::list_project_roots(&connection, vault_id).expect("renamed roots");
        assert_eq!(
            renamed
                .iter()
                .find(|root| root.id == project_id)
                .expect("renamed project")
                .root_path,
            "new"
        );
        assert_eq!(
            renamed
                .iter()
                .find(|root| root.id == nested_id)
                .expect("renamed nested root")
                .root_path,
            "new/nested"
        );

        let trash_relative = ".denote/trash/recovery-operation/new";
        fs::create_dir_all(vault_path.join(".denote/trash/recovery-operation"))
            .expect("trash directory");
        db::begin_file_operation(
            &connection,
            vault_id,
            "trash",
            "new",
            trash_relative,
            None,
            true,
        )
        .expect("trash journal");
        fs::rename(vault_path.join("new"), vault_path.join(trash_relative))
            .expect("trash directory");

        let recovered =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("reconcile trash");
        let remaining =
            db::list_project_roots(&connection, vault_id).expect("roots after recovered trash");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, whole_vault_id);
        assert!(remaining[0].root_path.is_empty());
        assert_eq!(recovered.trash.len(), 1);
        restore_trash_item(
            &db_path,
            vault_path.to_str().unwrap(),
            recovered.trash[0].id,
        )
        .expect("restore recovered project");
        let restored =
            db::list_project_roots(&connection, vault_id).expect("roots after recovered restore");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, whole_vault_id);
        assert!(restored[0].root_path.is_empty());
        assert!(
            db::pending_file_operations(&connection, vault_id)
                .expect("pending operations")
                .is_empty()
        );
    }

    #[test]
    fn rename_does_not_treat_path_characters_as_wildcards() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("foo_bar")).expect("first folder");
        fs::create_dir_all(vault_path.join("fooxbar")).expect("second folder");
        fs::write(vault_path.join("foo_bar/a.md"), "a").expect("first note");
        fs::write(vault_path.join("fooxbar/b.md"), "b").expect("second note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        read_note(&db_path, vault_path.to_str().unwrap(), "foo_bar/a.md").expect("first read");
        read_note(&db_path, vault_path.to_str().unwrap(), "fooxbar/b.md").expect("second read");

        rename_entry(&db_path, vault_path.to_str().unwrap(), "foo_bar", "renamed")
            .expect("rename folder");
        let unaffected =
            read_note(&db_path, vault_path.to_str().unwrap(), "fooxbar/b.md").expect("third read");
        assert_eq!(unaffected.stats.open_count, 2);
    }

    #[test]
    fn resolves_parent_relative_images_without_allowing_vault_escape() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("notes")).expect("notes folder");
        fs::create_dir_all(vault_path.join("images")).expect("images folder");
        fs::write(
            vault_path.join("notes/note.md"),
            "![image](../images/pic.png)",
        )
        .expect("note");
        fs::write(vault_path.join("images/pic.png"), b"png").expect("image");
        fs::write(directory.path().join("outside.png"), b"outside").expect("outside image");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let preview = read_image_data_url(
            &db_path,
            vault_path.to_str().unwrap(),
            Some("notes/note.md"),
            "../images/pic.png",
        )
        .expect("relative image");
        assert!(preview.starts_with("data:image/png;base64,"));
        assert!(
            read_image_data_url(
                &db_path,
                vault_path.to_str().unwrap(),
                Some("notes/note.md"),
                "../../outside.png",
            )
            .is_err()
        );
    }

    #[test]
    fn search_prunes_reserved_directories_at_any_depth() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("nested/.DENOTE/trash")).expect("internal folder");
        fs::write(vault_path.join("visible.md"), "visible").expect("visible note");
        fs::write(vault_path.join("nested/.DENOTE/trash/hidden.md"), "hidden")
            .expect("hidden note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let batch =
            list_search_documents(&db_path, vault_path.to_str().unwrap()).expect("documents");
        assert_eq!(
            batch
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            vec!["visible.md"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn search_skips_unreadable_files_without_aborting_the_batch() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("visible.txt"), "visible").expect("visible file");
        let blocked = vault_path.join("blocked.txt");
        fs::write(&blocked, "blocked").expect("blocked file");
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o000))
            .expect("block permissions");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let batch =
            list_search_documents(&db_path, vault_path.to_str().unwrap()).expect("search batch");
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o600))
            .expect("restore permissions");
        assert_eq!(batch.skipped_count, 1);
        assert_eq!(batch.documents.len(), 1);
        assert_eq!(batch.documents[0].path, "visible.txt");
    }

    #[test]
    fn link_rewrite_documents_only_include_small_markdown_files() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "[link](other.md)").expect("markdown");
        fs::write(vault_path.join("note.mdx"), "{value}").expect("mdx");
        fs::write(vault_path.join("note.txt"), "plain").expect("plain text");
        fs::write(vault_path.join("invalid.md"), [0xff]).expect("invalid markdown");
        fs::write(
            vault_path.join("large.md"),
            vec![b'a'; (MAX_LINK_REWRITE_BYTES + 1) as usize],
        )
        .expect("large markdown");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let batch = list_link_rewrite_documents(&db_path, vault_path.to_str().unwrap())
            .expect("link rewrite documents");
        assert_eq!(
            batch
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            vec!["note.md"]
        );
        assert_eq!(batch.skipped_count, 2);
        assert_eq!(batch.available_paths.len(), 5);
    }

    #[test]
    fn reads_and_restores_binary_files_as_base64() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        let original = [0xff, 0x00, 0x80, 0x01];
        fs::write(vault_path.join("archive.bin"), original).expect("binary file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "archive.bin").expect("read binary");
        assert_eq!(document.encoding, FileEncoding::Base64);
        assert_eq!(
            STANDARD
                .decode(document.content.replace(char::is_whitespace, ""))
                .expect("decode original"),
            original
        );
        let indexed =
            list_editable_documents(&db_path, vault_path.to_str().unwrap()).expect("documents");
        let indexed_binary = indexed
            .documents
            .iter()
            .find(|document| document.path == "archive.bin")
            .expect("indexed binary");
        assert_eq!(indexed_binary.kind, FileKind::File);
        assert_eq!(indexed_binary.encoding, FileEncoding::Base64);

        let replacement = STANDARD.encode([0xde, 0xad, 0xbe, 0xef]);
        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "archive.bin",
            &replacement,
            FileEncoding::Base64,
            FileLineEnding::Lf,
            "binary edit",
            Some(&document.content_hash),
        )
        .expect("save binary");
        assert_eq!(
            fs::read(vault_path.join("archive.bin")).expect("saved binary"),
            [0xde, 0xad, 0xbe, 0xef]
        );

        let history =
            list_history(&db_path, vault_path.to_str().unwrap(), "archive.bin").expect("history");
        assert_eq!(history[0].encoding, FileEncoding::Base64);
        let restored = restore_revision(
            &db_path,
            vault_path.to_str().unwrap(),
            "archive.bin",
            history[0].id,
        )
        .expect("restore binary");
        assert_eq!(restored.encoding, FileEncoding::Base64);
        assert_eq!(
            fs::read(vault_path.join("archive.bin")).expect("restored binary"),
            original
        );
    }

    #[test]
    fn preserves_consistent_text_line_endings() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("script.bat"), b"one\r\ntwo\r\n").expect("CRLF file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "script.bat").expect("read script");
        assert_eq!(document.encoding, FileEncoding::Utf8);
        assert_eq!(document.line_ending, FileLineEnding::Crlf);
        assert_eq!(document.content, "one\ntwo\n");

        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "script.bat",
            "one\nchanged\n",
            FileEncoding::Utf8,
            FileLineEnding::Crlf,
            "edit",
            Some(&document.content_hash),
        )
        .expect("save script");
        assert_eq!(
            fs::read(vault_path.join("script.bat")).expect("saved script"),
            b"one\r\nchanged\r\n"
        );
    }

    #[test]
    fn mixed_line_endings_use_byte_preserving_base64() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        let original = b"one\r\ntwo\nthree\r";
        fs::write(vault_path.join("mixed.txt"), original).expect("mixed file");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "mixed.txt").expect("read mixed");
        assert_eq!(document.encoding, FileEncoding::Base64);
        assert_eq!(
            STANDARD
                .decode(document.content.replace(char::is_whitespace, ""))
                .expect("decode mixed"),
            original
        );
    }

    #[test]
    fn allows_files_to_be_renamed_across_extension_categories() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "text").expect("note");
        fs::write(vault_path.join("image.png"), b"png").expect("image");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        assert_eq!(
            rename_entry(
                &db_path,
                vault_path.to_str().unwrap(),
                "note.md",
                "note.png",
            )
            .expect("rename text as image"),
            "note.png"
        );
        assert_eq!(
            rename_entry(
                &db_path,
                vault_path.to_str().unwrap(),
                "image.png",
                "image.md",
            )
            .expect("rename image as markdown"),
            "image.md"
        );
    }

    #[test]
    fn moves_entries_between_folders_and_rekeys_metadata() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("source")).expect("source folder");
        fs::create_dir_all(vault_path.join("target")).expect("target folder");
        fs::write(vault_path.join("source/note.md"), "note").expect("note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");
        let connection = db::open(&db_path).expect("database opened");
        let canonical_vault = fs::canonicalize(&vault_path).expect("canonical vault");
        let vault_id = db::ensure_vault(&connection, canonical_vault.to_str().unwrap(), "vault")
            .expect("vault");
        db::set_bookmark(&connection, vault_id, "source/note.md", true).expect("bookmark");
        db::record_open(&connection, vault_id, "target/note.md").expect("stale target metadata");

        let moved = move_entry(
            &db_path,
            vault_path.to_str().unwrap(),
            "source/note.md",
            "target",
        )
        .expect("move entry");

        assert_eq!(moved, "target/note.md");
        assert!(vault_path.join("target/note.md").is_file());
        assert!(
            db::get_stats(&connection, vault_id, "target/note.md")
                .expect("moved metadata")
                .bookmarked
        );
    }

    #[test]
    fn rejects_moving_a_folder_into_itself() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir_all(vault_path.join("parent/child")).expect("folders");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        assert!(
            move_entry(
                &db_path,
                vault_path.to_str().unwrap(),
                "parent",
                "parent/child",
            )
            .is_err()
        );
    }

    #[test]
    fn no_replace_rename_preserves_an_existing_destination() {
        let directory = tempdir().expect("temp directory");
        let source = directory.path().join("source.md");
        let destination = directory.path().join("destination.md");
        fs::write(&source, "source").expect("source");
        fs::write(&destination, "destination").expect("destination");

        assert!(rename_no_replace(&source, &destination).is_err());
        assert_eq!(
            fs::read_to_string(&source).expect("source remains"),
            "source"
        );
        assert_eq!(
            fs::read_to_string(&destination).expect("destination remains"),
            "destination"
        );
    }

    #[test]
    fn no_replace_file_creation_preserves_an_existing_destination() {
        let directory = tempdir().expect("temp directory");
        let destination = directory.path().join("note.md");
        fs::write(&destination, "existing").expect("existing file");

        assert!(create_file_no_replace(&destination, b"new").is_err());
        assert_eq!(
            fs::read_to_string(&destination).expect("destination remains"),
            "existing"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_attachment_directories() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let outside = directory.path().join("outside");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::create_dir(&outside).expect("outside directory");
        fs::write(vault_path.join("note.md"), "content").expect("initial note");
        symlink(&outside, vault_path.join("assets")).expect("assets symlink");

        let result = save_attachment(
            vault_path.to_str().unwrap(),
            "note.md",
            "image.png",
            b"not-an-image",
        );
        assert!(result.is_err());
        assert!(!outside.join("image.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn atomic_saves_preserve_extended_attributes() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        let note_path = vault_path.join("note.md");
        fs::write(&note_path, "first").expect("initial note");
        let attribute = if cfg!(target_os = "macos") {
            "com.denote.test"
        } else {
            "user.denote.test"
        };
        xattr::set(&note_path, attribute, b"kept").expect("set xattr");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");
        let document =
            read_note(&db_path, vault_path.to_str().unwrap(), "note.md").expect("read note");

        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "second",
            FileEncoding::Utf8,
            FileLineEnding::Lf,
            "autosave",
            Some(&document.content_hash),
        )
        .expect("save note");
        assert_eq!(
            xattr::get(&note_path, attribute).expect("get xattr"),
            Some(b"kept".to_vec())
        );
    }

    #[test]
    fn encryption_round_trip_covers_files_trash_and_history() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let db_path = directory.path().join("denote.sqlite3");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "first").expect("initial note");
        fs::write(vault_path.join("trashed.bin"), [0, 159, 146, 150]).expect("initial binary");
        db::initialize(&db_path).expect("database");
        open_vault(&db_path, vault_path.to_str().unwrap()).expect("open vault");

        let opened = read_note(&db_path, vault_path.to_str().unwrap(), "note.md")
            .expect("read initial note");
        save_note(
            &db_path,
            vault_path.to_str().unwrap(),
            "note.md",
            "second",
            FileEncoding::Utf8,
            FileLineEnding::Lf,
            "manual save",
            Some(&opened.content_hash),
        )
        .expect("save note");
        let connection = db::open(&db_path).expect("database connection");
        let canonical_vault_path = fs::canonicalize(&vault_path).expect("canonical vault");
        let (vault_id, _) =
            ensure_vault(&connection, &canonical_vault_path).expect("vault metadata");
        assert_eq!(
            db::list_history(&connection, vault_id, "note.md")
                .expect("initial stored history")
                .len(),
            1
        );
        trash_entry(&db_path, vault_path.to_str().unwrap(), "trashed.bin").expect("trash binary");

        let (manifest, vault_key, _) =
            crypto::create_manifest("correct horse battery staple").expect("manifest");
        crypto::save_manifest(&vault_path, &manifest).expect("save manifest");
        let key = vault_key.copy_bytes();
        encrypt_vault_contents(&db_path, vault_path.to_str().unwrap(), &key)
            .expect("encrypt vault");

        assert!(crypto::is_encrypted_file(
            &fs::read(vault_path.join("note.md")).expect("encrypted note")
        ));
        let trashed_path = WalkDir::new(vault_path.join(".denote/trash"))
            .into_iter()
            .filter_map(Result::ok)
            .find(|entry| entry.file_name() == "trashed.bin")
            .expect("trashed file")
            .into_path();
        assert!(crypto::is_encrypted_file(
            &fs::read(&trashed_path).expect("encrypted trash")
        ));
        let stored_history =
            db::list_history(&connection, vault_id, "note.md").expect("stored history");
        assert!(stored_history[0].is_encrypted);
        assert!(!stored_history[0].content.contains("first"));
        assert!(
            !fs::read(&db_path)
                .expect("database bytes")
                .windows(b"first".len())
                .any(|window| window == b"first")
        );
        let wal_path = db_path.with_file_name("denote.sqlite3-wal");
        if wal_path.exists() {
            assert!(
                !fs::read(wal_path)
                    .expect("database WAL bytes")
                    .windows(b"first".len())
                    .any(|window| window == b"first")
            );
        }
        assert!(matches!(
            super::read_note(&db_path, vault_path.to_str().unwrap(), "note.md", None),
            Err(AppError::Locked)
        ));
        assert_eq!(
            super::read_note(
                &db_path,
                vault_path.to_str().unwrap(),
                "note.md",
                Some(&key)
            )
            .expect("read encrypted note")
            .content,
            "second"
        );
        assert_eq!(
            super::list_history(
                &db_path,
                vault_path.to_str().unwrap(),
                "note.md",
                Some(&key)
            )
            .expect("encrypted history")[0]
                .preview,
            "first"
        );

        encrypt_vault_contents(&db_path, vault_path.to_str().unwrap(), &key)
            .expect("resume encryption");
        decrypt_vault_contents(&db_path, vault_path.to_str().unwrap(), &key)
            .expect("decrypt vault");
        crypto::remove_manifest(&vault_path).expect("remove manifest");

        assert_eq!(
            fs::read_to_string(vault_path.join("note.md")).expect("plain note"),
            "second"
        );
        assert_eq!(
            fs::read(&trashed_path).expect("plain trash"),
            [0, 159, 146, 150]
        );
        assert_eq!(
            list_history(&db_path, vault_path.to_str().unwrap(), "note.md").expect("plain history")
                [0]
            .preview,
            "first"
        );
        assert!(
            !db::list_history(&connection, vault_id, "note.md").expect("decrypted stored history")
                [0]
            .is_encrypted
        );
    }

    #[cfg(unix)]
    #[test]
    fn unlock_sweep_skips_unreadable_files() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        let db_path = directory.path().join("denote.sqlite3");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("readable.md"), "readable").expect("readable file");
        let unreadable_path = vault_path.join("unreadable.md");
        fs::write(&unreadable_path, "unreadable").expect("unreadable file");
        fs::set_permissions(&unreadable_path, fs::Permissions::from_mode(0o000))
            .expect("remove permissions");
        db::initialize(&db_path).expect("database");
        let (_, vault_key, _) =
            crypto::create_manifest("correct horse battery staple").expect("manifest");
        let key = vault_key.copy_bytes();

        let skipped =
            sweep_vault_encryption(&db_path, vault_path.to_str().unwrap(), &key).expect("sweep");

        fs::set_permissions(&unreadable_path, fs::Permissions::from_mode(0o600))
            .expect("restore permissions");
        assert_eq!(skipped, 1);
        assert!(crypto::is_encrypted_file(
            &fs::read(vault_path.join("readable.md")).expect("encrypted readable file")
        ));
        assert_eq!(
            fs::read_to_string(unreadable_path).expect("plain unreadable file"),
            "unreadable"
        );
    }
}
