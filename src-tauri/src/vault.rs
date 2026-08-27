use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use atomic_write_file::AtomicWriteFile;
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::Connection;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    db,
    error::{AppError, AppResult},
    models::{
        FileKind, FileNode, HistoryRevision, NoteDocument, SaveOutcome, SearchDocument,
        WorkspaceSnapshot,
    },
};

const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

pub fn get_last_vault(db_path: &Path) -> AppResult<Option<String>> {
    let connection = db::open(db_path)?;
    let path = db::get_last_vault(&connection)?;
    Ok(path.filter(|value| Path::new(value).is_dir()))
}

pub fn open_vault(db_path: &Path, vault_path: &str) -> AppResult<WorkspaceSnapshot> {
    let root = canonical_vault(vault_path)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, vault_name) = ensure_vault(&connection, &root)?;
    db::set_last_vault(&connection, &path_to_string(&root))?;
    snapshot(&mut connection, vault_id, &root, vault_name)
}

pub fn refresh_vault(db_path: &Path, vault_path: &str) -> AppResult<WorkspaceSnapshot> {
    let root = canonical_vault(vault_path)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, vault_name) = ensure_vault(&connection, &root)?;
    snapshot(&mut connection, vault_id, &root, vault_name)
}

pub fn read_note(db_path: &Path, vault_path: &str, relative_path: &str) -> AppResult<NoteDocument> {
    let root = canonical_vault(vault_path)?;
    let path = existing_entry(&root, relative_path)?;
    let kind = kind_for_path(&path).ok_or_else(|| {
        AppError::UnsupportedFile(format!("{relative_path} is not a text document"))
    })?;
    if !matches!(kind, FileKind::Markdown | FileKind::Text) {
        return Err(AppError::UnsupportedFile(relative_path.to_string()));
    }
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(AppError::InvalidData(format!(
            "{relative_path} is larger than 10 MB"
        )));
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::InvalidData {
            AppError::InvalidData(format!("{relative_path} is not valid UTF-8"))
        } else {
            AppError::Io(error)
        }
    })?;

    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::record_open(&connection, vault_id, relative_path)?;
    let stats = db::get_stats(&connection, vault_id, relative_path)?;
    Ok(NoteDocument {
        path: relative_path.to_string(),
        content,
        stats,
    })
}

pub fn save_note(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    content: &str,
    reason: &str,
) -> AppResult<SaveOutcome> {
    let root = canonical_vault(vault_path)?;
    let path = existing_entry(&root, relative_path)?;
    let kind = kind_for_path(&path).ok_or_else(|| {
        AppError::UnsupportedFile(format!("{relative_path} is not a text document"))
    })?;
    if !matches!(kind, FileKind::Markdown | FileKind::Text) {
        return Err(AppError::UnsupportedFile(relative_path.to_string()));
    }
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::InvalidData(
            "Document is larger than the 10 MB save limit".to_string(),
        ));
    }

    let previous = fs::read_to_string(&path)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    if previous == content {
        return Ok(SaveOutcome {
            path: relative_path.to_string(),
            changed: false,
            saved_at: db::now(),
            history_count: db::history_count(&connection, vault_id, relative_path)?,
            stats: db::get_stats(&connection, vault_id, relative_path)?,
        });
    }

    let history_transaction = connection.transaction()?;
    db::push_history(
        &history_transaction,
        vault_id,
        relative_path,
        &previous,
        reason,
    )?;
    history_transaction.commit()?;
    atomic_write(&path, content.as_bytes())?;
    let save_transaction = connection.transaction()?;
    db::record_save(&save_transaction, vault_id, relative_path)?;
    save_transaction.commit()?;

    let saved_at = db::now();
    Ok(SaveOutcome {
        path: relative_path.to_string(),
        changed: true,
        saved_at,
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
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
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
        let kind = kind_for_path(&destination).ok_or_else(|| {
            AppError::UnsupportedFile("New notes must use .md, .markdown, or .txt".to_string())
        })?;
        if !matches!(kind, FileKind::Markdown | FileKind::Text) {
            return Err(AppError::UnsupportedFile(name.to_string()));
        }
        atomic_write(&destination, &[])?;
    }
    let connection = db::open(db_path)?;
    let _ = ensure_vault(&connection, &root)?;
    relative_string(&root, &destination)
}

pub fn rename_entry(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    new_name: &str,
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let source = existing_entry(&root, relative_path)?;
    let safe_name = validate_name(new_name)?;
    let parent = source
        .parent()
        .ok_or_else(|| AppError::InvalidPath(relative_path.to_string()))?;
    let destination = parent.join(safe_name);
    if destination.exists() {
        return Err(AppError::InvalidPath(format!("{new_name} already exists")));
    }
    if source.is_file() && kind_for_path(&destination).is_none() {
        return Err(AppError::UnsupportedFile(
            "Renamed files must keep a supported extension".to_string(),
        ));
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
        source.is_dir(),
    )?;
    if let Err(error) = fs::rename(&source, &destination) {
        db::cancel_file_operation(&connection, &operation_id)?;
        return Err(error.into());
    }
    if let Err(error) = db::rename_metadata(
        &mut connection,
        vault_id,
        relative_path,
        &new_relative,
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
    Ok(new_relative)
}

pub fn trash_entry(db_path: &Path, vault_path: &str, relative_path: &str) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
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
    if let Err(error) = db::trash_metadata(
        &mut connection,
        vault_id,
        relative_path,
        &trash_relative,
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
    Ok(())
}

pub fn restore_trash_item(db_path: &Path, vault_path: &str, item_id: i64) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let (original_path, trash_path, _) = db::trash_path(&connection, vault_id, item_id)?
        .ok_or_else(|| AppError::NotFound(format!("Trash item {item_id}")))?;
    let source = internal_entry(&root, &trash_path)?;
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
    if let Err(error) = fs::rename(&source, &destination) {
        db::cancel_file_operation(&connection, &operation_id)?;
        return Err(error.into());
    }
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
    Ok(restored_relative)
}

pub fn set_bookmark(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    bookmarked: bool,
) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_bookmark(&connection, vault_id, relative_path, bookmarked)
}

pub fn record_edit(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
) -> AppResult<crate::models::NoteStats> {
    let root = canonical_vault(vault_path)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::record_edit(&connection, vault_id, relative_path)?;
    db::get_stats(&connection, vault_id, relative_path)
}

pub fn set_entry_order(db_path: &Path, vault_path: &str, paths: &[String]) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    for path in paths {
        let _ = existing_entry(&root, path)?;
    }
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::set_entry_order(&mut connection, vault_id, paths)
}

pub fn list_history(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
) -> AppResult<Vec<HistoryRevision>> {
    let root = canonical_vault(vault_path)?;
    let _ = existing_entry(&root, relative_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    db::list_history(&connection, vault_id, relative_path)
}

pub fn restore_revision(
    db_path: &Path,
    vault_path: &str,
    relative_path: &str,
    revision_id: i64,
) -> AppResult<NoteDocument> {
    let root = canonical_vault(vault_path)?;
    let path = existing_entry(&root, relative_path)?;
    let current = fs::read_to_string(&path)?;
    let mut connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let restored = db::history_content(&connection, vault_id, relative_path, revision_id)?
        .ok_or_else(|| AppError::NotFound(format!("Revision {revision_id}")))?;
    let history_transaction = connection.transaction()?;
    db::push_history(
        &history_transaction,
        vault_id,
        relative_path,
        &current,
        "before restore",
    )?;
    history_transaction.commit()?;
    atomic_write(&path, restored.as_bytes())?;
    let save_transaction = connection.transaction()?;
    db::record_save(&save_transaction, vault_id, relative_path)?;
    save_transaction.commit()?;
    Ok(NoteDocument {
        path: relative_path.to_string(),
        content: restored,
        stats: db::get_stats(&connection, vault_id, relative_path)?,
    })
}

pub fn list_search_documents(db_path: &Path, vault_path: &str) -> AppResult<Vec<SearchDocument>> {
    let root = canonical_vault(vault_path)?;
    let connection = db::open(db_path)?;
    let (vault_id, _) = ensure_vault(&connection, &root)?;
    let stats = db::stats_map(&connection, vault_id)?;
    let mut documents = Vec::new();

    for entry in WalkDir::new(&root).follow_links(false).into_iter() {
        let entry = entry.map_err(|error| {
            AppError::Io(
                error
                    .into_io_error()
                    .unwrap_or_else(|| std::io::Error::other("Unable to scan vault")),
            )
        })?;
        if entry.path() == root {
            continue;
        }
        let relative = relative_internal_string(&root, entry.path())?;
        if relative == ".denote" || relative.starts_with(".denote/") {
            continue;
        }
        if metadata_is_link(&fs::symlink_metadata(entry.path())?) || !entry.file_type().is_file() {
            continue;
        }
        let Some(kind) = kind_for_path(entry.path()) else {
            continue;
        };
        let metadata = entry
            .metadata()
            .map_err(|error| AppError::Io(error.into()))?;
        let (content, tags, title) = if matches!(kind, FileKind::Markdown | FileKind::Text) {
            if metadata.len() > MAX_TEXT_BYTES {
                continue;
            }
            let Ok(content) = fs::read_to_string(entry.path()) else {
                continue;
            };
            (
                content.clone(),
                extract_tags(&content),
                document_title(&relative, &content),
            )
        } else {
            (
                String::new(),
                Vec::new(),
                Path::new(&relative)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&relative)
                    .to_string(),
            )
        };
        let stored = stats.get(&relative).cloned().unwrap_or_default();
        documents.push(SearchDocument {
            path: relative.clone(),
            title,
            tags,
            content,
            kind,
            bookmarked: stored.bookmarked,
            last_opened_at: stored.last_opened_at,
        });
    }
    Ok(documents)
}

pub fn read_image_data_url(
    db_path: &Path,
    vault_path: &str,
    note_path: Option<&str>,
    image_source: &str,
) -> AppResult<String> {
    let root = canonical_vault(vault_path)?;
    let image_path = resolve_image_source(&root, note_path, image_source)?;
    let metadata = fs::metadata(&image_path)?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(AppError::InvalidData(
            "Image is larger than the 25 MB preview limit".to_string(),
        ));
    }
    let kind = kind_for_path(&image_path);
    if kind != Some(FileKind::Image) {
        return Err(AppError::UnsupportedFile(image_source.to_string()));
    }
    let mime = mime_guess::from_path(&image_path).first_or_octet_stream();
    let encoded = STANDARD.encode(fs::read(&image_path)?);
    if note_path.is_none() {
        let relative = relative_string(&root, &image_path)?;
        let connection = db::open(db_path)?;
        let (vault_id, _) = ensure_vault(&connection, &root)?;
        db::record_open(&connection, vault_id, &relative)?;
    }
    Ok(format!("data:{mime};base64,{encoded}"))
}

pub fn save_attachment(
    vault_path: &str,
    note_path: &str,
    file_name: &str,
    data: &[u8],
) -> AppResult<String> {
    if data.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::InvalidData(
            "Attachment is larger than the 25 MB limit".to_string(),
        ));
    }
    let root = canonical_vault(vault_path)?;
    let note = existing_entry(&root, note_path)?;
    let parent = note
        .parent()
        .ok_or_else(|| AppError::InvalidPath(note_path.to_string()))?;
    let safe_name = validate_name(file_name)?;
    let kind = kind_for_path(Path::new(safe_name));
    if kind != Some(FileKind::Image) {
        return Err(AppError::UnsupportedFile(file_name.to_string()));
    }
    let attachments = parent.join("assets");
    ensure_no_symlinks(&root, &attachments, true)?;
    fs::create_dir_all(&attachments)?;
    let destination = available_named_path(&attachments, safe_name)?;
    ensure_no_symlinks(&root, &destination, true)?;
    atomic_write(&destination, data)?;
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
    let stats = db::stats_map(connection, vault_id)?;
    let order = db::order_map(connection, vault_id)?;
    let tree = scan_directory(root, root, &stats, &order, 0)?;
    let (bookmarks, recent) = db::note_lists(connection, vault_id)?;
    let trash = db::list_trash(connection, vault_id)?;
    Ok(WorkspaceSnapshot {
        vault_path: path_to_string(root),
        vault_name,
        tree,
        bookmarks,
        recent,
        trash,
    })
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
                    return Err(AppError::InvalidData(format!(
                        "Unknown file operation in recovery journal: {kind}"
                    )));
                }
            },
            state => {
                return Err(AppError::InvalidData(format!(
                    "Unable to reconcile {} operation {}: source/destination state is {state:?}",
                    operation.kind, operation.id
                )));
            }
        }
    }
    Ok(())
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    stats: &HashMap<String, crate::models::NoteStats>,
    order: &HashMap<String, i64>,
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
        let file_type = entry.file_type()?;
        let path = entry.path();
        if metadata_is_link(&fs::symlink_metadata(&path)?) || entry.file_name() == ".denote" {
            continue;
        }
        let relative = relative_string(root, &path)?;
        let metadata = entry.metadata()?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64);
        if file_type.is_dir() {
            nodes.push(FileNode {
                path: relative.clone(),
                name: entry.file_name().to_string_lossy().into_owned(),
                kind: FileKind::Folder,
                children: scan_directory(root, &path, stats, order, depth + 1)?,
                size: 0,
                modified_at,
                bookmarked: false,
            });
        } else if let Some(kind) = kind_for_path(&path) {
            nodes.push(FileNode {
                path: relative.clone(),
                name: entry.file_name().to_string_lossy().into_owned(),
                kind,
                children: Vec::new(),
                size: metadata.len(),
                modified_at,
                bookmarked: stats
                    .get(&relative)
                    .map(|value| value.bookmarked)
                    .unwrap_or(false),
            });
        }
    }
    nodes.sort_by(|left, right| {
        let left_position = order.get(&left.path).copied().unwrap_or(i64::MAX);
        let right_position = order.get(&right.path).copied().unwrap_or(i64::MAX);
        left_position
            .cmp(&right_position)
            .then_with(|| {
                matches!(right.kind, FileKind::Folder).cmp(&matches!(left.kind, FileKind::Folder))
            })
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(nodes)
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
                if !allow_internal && value == ".denote" {
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
    if relative == ".denote" || relative.starts_with(".denote/") {
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
        || trimmed == ".denote"
    {
        return Err(AppError::InvalidPath(name.to_string()));
    }
    Ok(trimmed)
}

fn kind_for_path(path: &Path) -> Option<FileKind> {
    if path.is_dir() {
        return Some(FileKind::Folder);
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown") => Some(FileKind::Markdown),
        Some("txt") => Some(FileKind::Text),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif") => {
            Some(FileKind::Image)
        }
        _ => None,
    }
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

fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    let chars = content.char_indices().collect::<Vec<_>>();
    for (index, (byte_index, character)) in chars.iter().enumerate() {
        if *character != '#' {
            continue;
        }
        let previous_is_boundary = index == 0
            || chars[index - 1].1.is_whitespace()
            || matches!(chars[index - 1].1, '(' | '[' | '{' | '"' | '\'');
        if !previous_is_boundary {
            continue;
        }
        let start = byte_index + character.len_utf8();
        let mut end = start;
        for (_, next) in chars.iter().skip(index + 1) {
            if next.is_alphanumeric() || matches!(next, '_' | '-' | '/') {
                end += next.len_utf8();
            } else {
                break;
            }
        }
        if end > start {
            tags.insert(content[start..end].to_lowercase());
        }
    }
    let mut tags = tags.into_iter().collect::<Vec<_>>();
    tags.sort();
    tags
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
    let candidate = base.join(source);
    ensure_no_symlinks(root, &candidate, false)?;
    let candidate = fs::canonicalize(candidate)?;
    if !candidate.starts_with(root) {
        return Err(AppError::InvalidPath(image_source.to_string()));
    }
    Ok(candidate)
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

fn atomic_write(path: &Path, data: &[u8]) -> AppResult<()> {
    let mut file = AtomicWriteFile::options().open(path)?;
    file.write_all(data)?;
    file.commit()?;
    Ok(())
}

fn rollback_operation(
    connection: &Connection,
    operation_id: &str,
    current: &Path,
    original: &Path,
    cause: AppError,
) -> AppError {
    match fs::rename(current, original) {
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

    #[test]
    fn rejects_parent_directory_paths() {
        assert!(normalized_relative("../secret.md", false).is_err());
        assert!(normalized_relative("notes/../../secret.md", false).is_err());
    }

    #[test]
    fn extracts_unicode_tags_without_treating_headings_as_tags() {
        let tags = extract_tags("# Heading\n日本語 #研究 русский #заметка #tag-one");
        assert_eq!(tags, vec!["tag-one", "заметка", "研究"]);
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
            "autosave",
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
    fn moves_entries_to_trash_and_restores_them() {
        let directory = tempdir().expect("temp directory");
        let vault_path = directory.path().join("vault");
        fs::create_dir(&vault_path).expect("vault directory");
        fs::write(vault_path.join("note.md"), "content").expect("initial note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database initialized");

        trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");
        assert!(!vault_path.join("note.md").exists());
        let snapshot =
            refresh_vault(&db_path, vault_path.to_str().unwrap()).expect("refresh vault");
        assert_eq!(snapshot.trash.len(), 1);

        let restored =
            restore_trash_item(&db_path, vault_path.to_str().unwrap(), snapshot.trash[0].id)
                .expect("restore note");
        assert_eq!(restored, "note.md");
        assert!(vault_path.join("note.md").exists());
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
            "autosave",
        )
        .expect("save note");
        trash_entry(&db_path, vault_path.to_str().unwrap(), "note.md").expect("trash note");

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
        assert_eq!(restored, "note (restored 1).md");
        let restored_document =
            read_note(&db_path, vault_path.to_str().unwrap(), &restored).expect("restored note");
        assert!(restored_document.stats.bookmarked);
        assert_eq!(
            list_history(&db_path, vault_path.to_str().unwrap(), &restored)
                .expect("restored history")
                .len(),
            1
        );
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
}
