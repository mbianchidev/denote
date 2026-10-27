use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex, MutexGuard, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{
    db,
    dialogs::{self, SelectionKind, SelectionOptions},
    error::{AppError, AppResult},
    vault::credentials::{self, Container, Document, Entry, EntryView, Key},
};

#[derive(Default)]
struct State {
    session: Option<Session>,
    transfer: Option<Transfer>,
    clipboard: Option<ClipboardLease>,
}

struct Session {
    generation: u64,
    id: String,
    plugin: String,
    root: PathBuf,
    key: Key,
    hash: String,
    timeout: Duration,
    expires: Instant,
    wall_expires: SystemTime,
}

struct Transfer {
    id: String,
    plugin: String,
    root: PathBuf,
    expected_hash: Option<String>,
    destination: Option<PathBuf>,
    imported: Option<Container>,
    expires: Instant,
    wall_expires: SystemTime,
}

struct ClipboardLease {
    generation: u64,
    id: String,
    plugin: String,
    value: Zeroizing<String>,
    app: AppHandle,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub(crate) struct Secret(String);

impl std::ops::Deref for Secret {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum ResultView {
    Status {
        exists: bool,
    },
    Snapshot {
        session: String,
        hash: String,
        entries: Vec<EntryView>,
    },
    Revealed {
        value: String,
    },
    Prepared {
        ticket: String,
    },
    Done,
    Cancelled,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EntryInput {
    id: Option<String>,
    service: String,
    username: String,
    secret: Option<String>,
    url: String,
    notes: String,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum Request {
    Status,
    Create {
        password: Secret,
        confirmation: Secret,
        timeout: u64,
    },
    Unlock {
        password: Secret,
        timeout: u64,
    },
    List {
        session: String,
    },
    Lock {
        session: String,
    },
    Touch {
        session: String,
    },
    Upsert {
        session: String,
        hash: String,
        entry: EntryInput,
    },
    Delete {
        session: String,
        hash: String,
        id: String,
    },
    Reveal {
        session: String,
        id: String,
    },
    Copy {
        session: String,
        id: String,
        field: String,
        timeout: u64,
    },
    Export {
        ticket: String,
        password: Secret,
        confirmed: bool,
    },
    Import {
        ticket: String,
        password: Secret,
        current_password: Secret,
        confirmed: bool,
        timeout: u64,
    },
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TransferKind {
    Backup,
    Import,
    Export,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(1);

pub(super) fn invalidate() -> u64 {
    GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

fn shared_state() -> AppResult<MutexGuard<'static, State>> {
    STATE
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| invalid("Credential session state is unavailable. Restart Denote."))
}

fn invalid(message: &str) -> AppError {
    AppError::Crypto(message.into())
}

fn timeout(seconds: u64) -> AppResult<Duration> {
    if !(30..=3600).contains(&seconds) {
        return Err(invalid(
            "Choose an inactivity timeout from 30 to 3600 seconds.",
        ));
    }
    Ok(Duration::from_secs(seconds))
}

fn session<'a>(
    state: &'a mut State,
    id: &str,
    plugin: &str,
    root: &Path,
) -> AppResult<&'a mut Session> {
    session_in_generation(state, id, plugin, root, GENERATION.load(Ordering::Acquire))
}

fn session_in_generation<'a>(
    state: &'a mut State,
    id: &str,
    plugin: &str,
    root: &Path,
    generation: u64,
) -> AppResult<&'a mut Session> {
    if state.session.as_ref().is_some_and(|session| {
        Instant::now() >= session.expires
            || SystemTime::now() >= session.wall_expires
            || session.generation != generation
    }) {
        state.session.take();
    }
    state
        .session
        .as_mut()
        .filter(|session| session.id == id && session.plugin == plugin && session.root == root)
        .ok_or_else(|| invalid("The credential store is locked. Unlock it again."))
}

fn current(root: &Path, outer: Option<&[u8; 32]>, session: &Session) -> AppResult<Container> {
    let container = credentials::read(&root.to_string_lossy(), outer)?
        .ok_or_else(|| invalid("The credential file is missing. Restore an encrypted backup."))?;
    if container.hash() != session.hash {
        return Err(invalid(
            "The credential file changed. Lock and unlock it again; nothing was overwritten.",
        ));
    }
    Ok(container)
}

fn unlocked(
    state: &mut State,
    plugin: &str,
    root: &Path,
    key: Key,
    hash: String,
    document: &Document,
    seconds: u64,
    generation: u64,
) -> AppResult<ResultView> {
    if generation != GENERATION.load(Ordering::Acquire) {
        return Err(invalid(
            "Credential unlock was cancelled after focus or workspace changed. Unlock it again.",
        ));
    }
    let timeout = timeout(seconds)?;
    let id = uuid::Uuid::new_v4().to_string();
    let result = ResultView::Snapshot {
        session: id.clone(),
        hash: hash.clone(),
        entries: document.views(),
    };
    state.session = Some(Session {
        generation,
        id: id.clone(),
        plugin: plugin.into(),
        root: root.into(),
        key,
        hash,
        timeout,
        expires: Instant::now() + timeout,
        wall_expires: SystemTime::now() + timeout,
    });
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let Ok(mut state) = shared_state() else {
                eprintln!("Credential session expiry failed.");
                return;
            };
            if state
                .session
                .as_ref()
                .is_none_or(|session| session.id != id)
            {
                return;
            }
            if state.session.as_ref().is_some_and(|session| {
                Instant::now() >= session.expires
                    || SystemTime::now() >= session.wall_expires
                    || session.generation != GENERATION.load(Ordering::Acquire)
            }) {
                state.session.take();
                if let Some(clipboard) = state.clipboard.take() {
                    clear_clipboard(clipboard);
                }
                return;
            }
        }
    });
    Ok(result)
}

pub(super) fn lock_before(generation: u64) -> AppResult<()> {
    let mut state = shared_state()?;
    if state
        .session
        .as_ref()
        .is_some_and(|session| session.generation < generation)
    {
        state.session.take();
    }
    if state
        .clipboard
        .as_ref()
        .is_some_and(|lease| lease.generation < generation)
    {
        if let Some(clipboard) = state.clipboard.take() {
            clear_clipboard(clipboard);
        }
    }
    Ok(())
}

pub(crate) fn revoke(plugin: Option<&str>) -> AppResult<()> {
    if plugin.is_none() {
        invalidate();
    }
    let mut state = shared_state()?;
    if state
        .session
        .as_ref()
        .is_some_and(|session| plugin.is_none_or(|plugin| plugin == session.plugin))
    {
        state.session.take();
    }
    if state
        .transfer
        .as_ref()
        .is_some_and(|transfer| plugin.is_none_or(|plugin| plugin == transfer.plugin))
    {
        state.transfer.take();
    }
    if state
        .clipboard
        .as_ref()
        .is_some_and(|clipboard| plugin.is_none_or(|plugin| plugin == clipboard.plugin))
    {
        if let Some(clipboard) = state.clipboard.take() {
            clear_clipboard(clipboard);
        }
    }
    Ok(())
}

fn clear_clipboard(lease: ClipboardLease) {
    let result = lease
        .app
        .clipboard()
        .read_text()
        .map(Zeroizing::new)
        .and_then(|current| {
            if current.as_str() == lease.value.as_str() {
                lease.app.clipboard().write_text("")
            } else {
                Ok(())
            }
        });
    if result.is_err() {
        if lease
            .app
            .emit(
                "denote://sensitive-error",
                "Clipboard cleanup failed. Clear copied credentials manually.",
            )
            .is_err()
        {
            eprintln!("Credential clipboard cleanup failed.");
        }
    }
}

fn copy(
    app: &AppHandle,
    state: &mut State,
    plugin: &str,
    value: &str,
    seconds: u64,
    generation: u64,
) -> AppResult<()> {
    if !(5..=120).contains(&seconds) {
        return Err(invalid("Choose a clipboard timeout from 5 to 120 seconds."));
    }
    app.clipboard()
        .write_text(value)
        .map_err(|_| invalid("Unable to copy the credential. The clipboard may be unavailable."))?;
    let id = uuid::Uuid::new_v4().to_string();
    state.clipboard = Some(ClipboardLease {
        generation,
        id: id.clone(),
        plugin: plugin.into(),
        value: Zeroizing::new(value.into()),
        app: app.clone(),
    });
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(seconds));
        match shared_state() {
            Ok(mut state) if state.clipboard.as_ref().is_some_and(|lease| lease.id == id) => {
                if let Some(lease) = state.clipboard.take() {
                    clear_clipboard(lease);
                }
            }
            Ok(_) => {}
            Err(_) => eprintln!("Credential clipboard expiry failed."),
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn credential_store(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    request: Request,
) -> AppResult<ResultView> {
    let generation = GENERATION.load(Ordering::Acquire);
    let handle = app.clone();
    let owner = plugin_id.clone();
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "credential-store",
        move |_, root, outer| {
            if generation != GENERATION.load(Ordering::Acquire) {
                return Err(invalid("The credential action expired. Reopen the store."));
            }
            let result = execute(&handle, &owner, root, outer, request, generation)?;
            let current = GENERATION.load(Ordering::Acquire);
            if generation != current {
                lock_before(current)?;
                return Err(invalid(
                    "The credential action ended after the store was locked.",
                ));
            }
            Ok(result)
        },
    )
    .await
}

fn execute(
    app: &AppHandle,
    plugin: &str,
    root: &Path,
    outer: Option<&[u8; 32]>,
    request: Request,
    generation: u64,
) -> AppResult<ResultView> {
    let mut state = shared_state()?;
    match request {
        Request::Status => Ok(ResultView::Status {
            exists: credentials::read(&root.to_string_lossy(), outer)?.is_some(),
        }),
        Request::Create {
            password,
            confirmation,
            timeout: seconds,
        } => {
            timeout(seconds)?;
            if password.0 != confirmation.0 {
                return Err(invalid("The master passwords do not match."));
            }
            let (container, key) = credentials::create(&password)?;
            credentials::save(&root.to_string_lossy(), None, &container, outer)?;
            unlocked(
                &mut state,
                plugin,
                root,
                key,
                container.hash(),
                &Document::default(),
                seconds,
                generation,
            )
        }
        Request::Unlock {
            password,
            timeout: seconds,
        } => {
            timeout(seconds)?;
            state.session.take();
            let container =
                credentials::read(&root.to_string_lossy(), outer)?.ok_or_else(|| {
                    invalid(
                        "No credential file exists. Create a store or import an encrypted backup.",
                    )
                })?;
            let (key, document) = container.unlock(&password)?;
            unlocked(
                &mut state,
                plugin,
                root,
                key,
                container.hash(),
                &document,
                seconds,
                generation,
            )
        }
        Request::Touch { session: id } => {
            let session = session(&mut state, &id, plugin, root)?;
            session.expires = Instant::now() + session.timeout;
            session.wall_expires = SystemTime::now() + session.timeout;
            Ok(ResultView::Done)
        }
        Request::Lock { session: id } => {
            if state.session.as_ref().is_some_and(|session| {
                session.id == id && session.plugin == plugin && session.root == root
            }) {
                state.session.take();
                if let Some(clipboard) = state.clipboard.take() {
                    clear_clipboard(clipboard);
                }
            }
            Ok(ResultView::Done)
        }
        Request::List { session: id } => {
            let session = session(&mut state, &id, plugin, root)?;
            let document = current(root, outer, session)?.decrypt(&session.key)?;
            Ok(ResultView::Snapshot {
                session: session.id.clone(),
                hash: session.hash.clone(),
                entries: document.views(),
            })
        }
        Request::Upsert {
            session: id,
            hash,
            mut entry,
        } => {
            let session = session(&mut state, &id, plugin, root)?;
            if session.hash != hash {
                return Err(invalid(
                    "This credential edit is stale. Reload the store; nothing was overwritten.",
                ));
            }
            let container = current(root, outer, session)?;
            let mut document = container.decrypt(&session.key)?;
            let entry_id = entry
                .id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let existing = document
                .entries
                .iter_mut()
                .find(|existing| existing.id == entry_id);
            if entry.id.is_some() && existing.is_none() {
                return Err(invalid(
                    "The credential no longer exists. Reload the store.",
                ));
            }
            if let Some(existing) = existing {
                existing.service.zeroize();
                existing.username.zeroize();
                existing.url.zeroize();
                existing.notes.zeroize();
                existing.service = std::mem::take(&mut entry.service);
                existing.username = std::mem::take(&mut entry.username);
                existing.url = std::mem::take(&mut entry.url);
                existing.notes = std::mem::take(&mut entry.notes);
                if let Some(secret) = entry.secret.take() {
                    existing.secret.zeroize();
                    existing.secret = secret;
                }
            } else {
                document.entries.push(Entry {
                    id: entry_id,
                    service: std::mem::take(&mut entry.service),
                    username: std::mem::take(&mut entry.username),
                    secret: entry.secret.take().unwrap_or_default(),
                    url: std::mem::take(&mut entry.url),
                    notes: std::mem::take(&mut entry.notes),
                });
            }
            persist(root, outer, session, &container, &document)
        }
        Request::Delete {
            session: id,
            hash,
            id: entry_id,
        } => {
            let session = session(&mut state, &id, plugin, root)?;
            if session.hash != hash {
                return Err(invalid(
                    "This credential deletion is stale. Reload the store.",
                ));
            }
            let container = current(root, outer, session)?;
            let mut document = container.decrypt(&session.key)?;
            let before = document.entries.len();
            document.entries.retain(|entry| entry.id != entry_id);
            if before == document.entries.len() {
                return Err(invalid(
                    "The credential no longer exists. Reload the store.",
                ));
            }
            persist(root, outer, session, &container, &document)
        }
        Request::Reveal {
            session: id,
            id: entry_id,
        } => {
            let session = session(&mut state, &id, plugin, root)?;
            let mut document = current(root, outer, session)?.decrypt(&session.key)?;
            let entry = document
                .entries
                .iter_mut()
                .find(|entry| entry.id == entry_id)
                .ok_or_else(|| invalid("The credential no longer exists. Reload the store."))?;
            Ok(ResultView::Revealed {
                value: std::mem::take(&mut entry.secret),
            })
        }
        Request::Copy {
            session: id,
            id: entry_id,
            field,
            timeout,
        } => {
            let session = session(&mut state, &id, plugin, root)?;
            let document = current(root, outer, session)?.decrypt(&session.key)?;
            let entry = document
                .entries
                .iter()
                .find(|entry| entry.id == entry_id)
                .ok_or_else(|| invalid("The credential no longer exists. Reload the store."))?;
            let value = match field.as_str() {
                "username" => &entry.username,
                "secret" => &entry.secret,
                _ => return Err(invalid("Choose username or secret to copy.")),
            };
            copy(app, &mut state, plugin, value, timeout, generation)?;
            Ok(ResultView::Done)
        }
        Request::Export {
            ticket,
            password,
            confirmed,
        } => {
            let transfer = take_transfer(&mut state, &ticket, plugin, root)?;
            if !confirmed {
                return Err(invalid(
                    "Plaintext export requires a separate explicit risk confirmation.",
                ));
            }
            let destination = transfer
                .destination
                .ok_or_else(|| invalid("Choose an export destination again."))?;
            let container =
                checked_transfer_container(root, outer, transfer.expected_hash.as_deref())?
                    .ok_or_else(|| invalid("The credential file is missing."))?;
            let (_, document) = container.unlock(&password)?;
            if generation != GENERATION.load(Ordering::Acquire) {
                return Err(invalid(
                    "Plaintext export was cancelled after focus changed. Authenticate again.",
                ));
            }
            validate_export_destination(app, &destination)?;
            write_external(&destination, &document.export()?)?;
            Ok(ResultView::Done)
        }
        Request::Import {
            ticket,
            password,
            current_password,
            confirmed,
            timeout: seconds,
        } => {
            timeout(seconds)?;
            let transfer = take_transfer(&mut state, &ticket, plugin, root)?;
            if !confirmed {
                return Err(invalid(
                    "Import requires explicit confirmation before replacing credentials.",
                ));
            }
            let current =
                checked_transfer_container(root, outer, transfer.expected_hash.as_deref())?;
            if let Some(container) = current {
                container.unlock(&current_password)?;
            }
            let imported = transfer
                .imported
                .ok_or_else(|| invalid("Choose an encrypted backup again."))?;
            let (key, document) = imported.unlock(&password)?;
            credentials::save(
                &root.to_string_lossy(),
                transfer.expected_hash.as_deref(),
                &imported,
                outer,
            )?;
            unlocked(
                &mut state,
                plugin,
                root,
                key,
                imported.hash(),
                &document,
                seconds,
                generation,
            )
        }
    }
}

fn persist(
    root: &Path,
    outer: Option<&[u8; 32]>,
    session: &mut Session,
    container: &Container,
    document: &Document,
) -> AppResult<ResultView> {
    let next = container.replace(&session.key, document)?;
    credentials::save(&root.to_string_lossy(), Some(&session.hash), &next, outer)?;
    session.hash = next.hash();
    session.expires = Instant::now() + session.timeout;
    session.wall_expires = SystemTime::now() + session.timeout;
    Ok(ResultView::Snapshot {
        session: session.id.clone(),
        hash: session.hash.clone(),
        entries: document.views(),
    })
}

fn take_transfer(
    state: &mut State,
    ticket: &str,
    plugin: &str,
    root: &Path,
) -> AppResult<Transfer> {
    if !state.transfer.as_ref().is_some_and(|transfer| {
        transfer.id == ticket
            && transfer.plugin == plugin
            && transfer.root == root
            && Instant::now() < transfer.expires
            && SystemTime::now() < transfer.wall_expires
    }) {
        return Err(invalid(
            "The transfer approval expired. Choose the file again.",
        ));
    }
    state
        .transfer
        .take()
        .ok_or_else(|| invalid("The transfer approval expired."))
}

fn checked_transfer_container(
    root: &Path,
    outer: Option<&[u8; 32]>,
    expected: Option<&str>,
) -> AppResult<Option<Container>> {
    let current = credentials::read(&root.to_string_lossy(), outer)?;
    if current.as_ref().map(Container::hash).as_deref() != expected {
        return Err(invalid(
            "The credential file changed during file selection. Nothing was exported or overwritten.",
        ));
    }
    Ok(current)
}

#[tauri::command]
pub(crate) async fn credential_transfer(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    kind: TransferKind,
    session_id: Option<String>,
) -> AppResult<ResultView> {
    let owner = plugin_id.clone();
    let expected_hash = super::scoped(
        app.clone(),
        plugin_id.clone(),
        workspace_scope.clone(),
        "credential-store",
        move |_, root, outer| {
            let mut state = shared_state()?;
            let current = credentials::read(&root.to_string_lossy(), outer)?;
            if current.is_some() {
                let session = session(
                    &mut state,
                    session_id.as_deref().unwrap_or(""),
                    &owner,
                    root,
                )?;
                if current.as_ref().map(Container::hash).as_deref() != Some(&session.hash) {
                    return Err(invalid("The credential file changed. Unlock it again."));
                }
            } else if kind != TransferKind::Import {
                return Err(invalid("Create or unlock the credential store first."));
            }
            Ok(current.map(|container| container.hash()))
        },
    )
    .await?;
    let selected = match kind {
        TransferKind::Import => {
            dialogs::select(
                &app,
                SelectionKind::File,
                SelectionOptions::new("Import encrypted credentials")
                    .with_filter("Encrypted credentials", &["dncred"]),
            )
            .await?
        }
        TransferKind::Backup => {
            dialogs::save(
                &app,
                "Back up encrypted credentials",
                "credentials-backup.dncred",
                "dncred",
            )
            .await?
        }
        TransferKind::Export => {
            dialogs::save(
                &app,
                "Choose plaintext credential export",
                "credentials-plaintext.json",
                "json",
            )
            .await?
        }
    };
    let Some(path) = selected else {
        return Ok(ResultView::Cancelled);
    };
    let handle = app.clone();
    let owner = plugin_id.clone();
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "credential-store",
        move |_, root, outer| {
            let container = checked_transfer_container(root, outer, expected_hash.as_deref())?;
            if kind == TransferKind::Backup {
                write_external(
                    &path,
                    &container
                        .ok_or_else(|| invalid("The credential file is missing."))?
                        .bytes,
                )?;
                return Ok(ResultView::Done);
            }
            let imported = if kind == TransferKind::Import {
                reject_links(&path)?;
                let file = fs::File::open(&path)
                    .map_err(|_| invalid("Unable to read the encrypted backup."))?;
                if !file
                    .metadata()
                    .map_err(|_| invalid("Unable to read the encrypted backup."))?
                    .is_file()
                {
                    return Err(invalid("The encrypted backup must be a regular file."));
                }
                let mut bytes = Vec::new();
                file.take(4 * 1024 * 1024 + 8193)
                    .read_to_end(&mut bytes)
                    .map_err(|_| invalid("Unable to read the encrypted backup."))?;
                Some(Container::parse(bytes)?)
            } else {
                validate_export_destination(&handle, &path)?;
                None
            };
            let id = uuid::Uuid::new_v4().to_string();
            shared_state()?.transfer = Some(Transfer {
                id: id.clone(),
                plugin: owner,
                root: root.into(),
                expected_hash,
                destination: if kind == TransferKind::Export {
                    Some(path)
                } else {
                    None
                },
                imported,
                expires: Instant::now() + Duration::from_secs(120),
                wall_expires: SystemTime::now() + Duration::from_secs(120),
            });
            Ok(ResultView::Prepared { ticket: id })
        },
    )
    .await
}

fn reject_links(path: &Path) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(invalid("Choose an absolute local file path."));
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                let linked = metadata.file_type().is_symlink();
                #[cfg(windows)]
                let linked = {
                    use std::os::windows::fs::MetadataExt;
                    linked || metadata.file_attributes() & 0x400 != 0
                };
                if linked {
                    return Err(invalid(
                        "Credential transfers cannot follow symbolic links or reparse points.",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && ancestor == path => {}
            Err(_) => {
                return Err(invalid(
                    "The selected credential transfer path is unavailable.",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_export_destination(app: &AppHandle, path: &Path) -> AppResult<()> {
    reject_links(path)?;
    if path.exists() {
        return Err(invalid(
            "Choose a new export filename. Existing files are never overwritten.",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Choose a local export folder."))?
        .canonicalize()
        .map_err(|_| invalid("The export folder is unavailable."))?;
    for managed in [app.path().app_data_dir(), app.path().app_cache_dir()] {
        let managed = managed.map_err(|_| invalid("Unable to verify the export destination."))?;
        if parent.starts_with(managed.canonicalize().unwrap_or(managed)) {
            return Err(invalid(
                "Plaintext exports must stay outside Denote application storage.",
            ));
        }
    }
    let app_state = app.state::<db::AppState>();
    let connection = db::open(&app_state.db_path)?;
    for vault in db::list_all_known_vaults(&connection)? {
        let root = PathBuf::from(vault.path);
        if parent.starts_with(root.canonicalize().unwrap_or(root)) {
            return Err(invalid(
                "Plaintext exports must stay outside every known Denote vault.",
            ));
        }
    }
    Ok(())
}

pub(super) fn write_external(path: &Path, bytes: &[u8]) -> AppResult<()> {
    reject_links(path)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_WRITE, WRITE_DAC};
        // SetSecurityInfo needs WRITE_DAC before any plaintext can be written.
        options.access_mode(FILE_GENERIC_WRITE | WRITE_DAC);
    }
    let mut file = options.open(path).map_err(|_| {
        invalid("Unable to create the transfer file. Choose a new private filename.")
    })?;
    let result = super::private_file::restrict(&file).and_then(|_| {
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(AppError::Io)
    });
    if result.is_err() {
        drop(file);
        if fs::remove_file(path).is_err() {
            return Err(invalid(
                "Credential transfer failed and its partial output could not be removed. Remove the selected file manually.",
            ));
        }
        return Err(invalid(
            "Credential transfer failed. The partial output was removed.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_sessions_expire_and_do_not_accept_other_owners_or_vaults() {
        let (_, key) = credentials::create("invented session password").unwrap();
        let mut state = State::default();
        state.session = Some(Session {
            generation: 1,
            id: "synthetic-session".into(),
            plugin: "denote.synthetic".into(),
            root: PathBuf::from("/synthetic"),
            key,
            hash: "synthetic-hash".into(),
            timeout: Duration::from_secs(30),
            expires: Instant::now() + Duration::from_secs(30),
            wall_expires: SystemTime::now() + Duration::from_secs(30),
        });
        assert!(
            session_in_generation(
                &mut state,
                "synthetic-session",
                "denote.other",
                Path::new("/synthetic"),
                1
            )
            .is_err()
        );
        assert!(
            session_in_generation(
                &mut state,
                "synthetic-session",
                "denote.synthetic",
                Path::new("/another"),
                1
            )
            .is_err()
        );
        state.session.as_mut().unwrap().expires = Instant::now();
        assert!(
            session_in_generation(
                &mut state,
                "synthetic-session",
                "denote.synthetic",
                Path::new("/synthetic"),
                1
            )
            .is_err()
        );
        assert!(state.session.is_none());
    }

    #[test]
    fn credential_exports_require_one_current_scoped_short_lived_ticket() {
        let mut state = State::default();
        state.transfer = Some(Transfer {
            id: "synthetic-ticket".into(),
            plugin: "denote.synthetic".into(),
            root: PathBuf::from("/synthetic"),
            expected_hash: None,
            destination: None,
            imported: None,
            expires: Instant::now() + Duration::from_secs(3600),
            wall_expires: SystemTime::now() + Duration::from_secs(3600),
        });
        assert!(
            take_transfer(
                &mut state,
                "synthetic-ticket",
                "denote.other",
                Path::new("/synthetic")
            )
            .is_err()
        );
        assert!(
            take_transfer(
                &mut state,
                "synthetic-ticket",
                "denote.synthetic",
                Path::new("/other")
            )
            .is_err()
        );
        assert!(
            take_transfer(
                &mut state,
                "synthetic-ticket",
                "denote.synthetic",
                Path::new("/synthetic")
            )
            .is_ok()
        );
        assert!(
            take_transfer(
                &mut state,
                "synthetic-ticket",
                "denote.synthetic",
                Path::new("/synthetic")
            )
            .is_err()
        );
        assert!(timeout(0).is_err());
        assert!(timeout(3601).is_err());
    }

    #[test]
    fn credential_transfers_create_private_files_and_never_replace_existing_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .canonicalize()
            .unwrap()
            .join("synthetic.dncred");
        write_external(&path, b"invented ciphertext").unwrap();
        assert!(write_external(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"invented ciphertext");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
