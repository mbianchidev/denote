use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, ipc::Channel};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{AppError, AppResult};

use super::credentials::Secret;

pub(super) const MODEL_NAME: &str = "NVIDIA Nemotron 3.5 ASR Streaming 0.6B";
const MODEL_FILE: &str = "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf";
const MODEL_URL: &str = "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/ea30d66debe3740a08b573244286791d423d6b3e/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf";
const MODEL_SHA: &str = "3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1";
const MODEL_BYTES: u64 = 742_090_464;
const MAX_EXTRACTED_BYTES: usize = 128 * 1024 * 1024;
pub(super) const MAX_WAV_BYTES: usize = 44 + 16000 * 2 * 600;
const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;
pub(super) const LOCALES: &[&str] = &[
    "auto", "en-US", "en-GB", "es-US", "es-ES", "fr-FR", "fr-CA", "it-IT", "pt-BR", "pt-PT",
    "nl-NL", "de-DE", "tr-TR", "ru-RU", "ar-AR", "hi-IN", "ja-JP", "ko-KR", "vi-VN", "uk-UA",
    "pl-PL", "sv-SE", "cs-CZ", "nb-NO", "da-DK", "bg-BG", "fi-FI", "hr-HR", "sk-SK", "zh-CN",
    "hu-HU", "ro-RO", "et-EE",
];

#[derive(Clone, Copy)]
struct Artifact {
    name: &'static str,
    size: u64,
    sha: &'static str,
}

fn runtime_artifact() -> AppResult<Artifact> {
    let artifact = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Artifact {
            name: "nemo-speech-0.2.0-macos-aarch64-cpu.tar.gz",
            size: 4_638_057,
            sha: "6a91355e15d22db6a319144d389d2e1b02f233c1c6808c0da85b6d3283e52296",
        },
        ("macos", "x86_64") => Artifact {
            name: "nemo-speech-0.2.0-macos-x86_64-cpu.tar.gz",
            size: 5_256_846,
            sha: "d52c318d8197511d4f7eee02bcf05511f7e91b300555a130b562e571695a0f39",
        },
        ("linux", "aarch64") => Artifact {
            name: "nemo-speech-0.2.0-linux-aarch64-cpu.tar.gz",
            size: 6_309_769,
            sha: "ac50694d4729f9eae390a9851d38f51269d9af9829b535325539090a3b95c787",
        },
        ("linux", "x86_64") => Artifact {
            name: "nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz",
            size: 6_683_477,
            sha: "f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507",
        },
        ("windows", "x86_64") => Artifact {
            name: "nemo-speech-0.2.0-windows-x86_64-cpu.zip",
            size: 5_528_418,
            sha: "82c80451086e86194aba9af19f800da77cd66d1c28d993d0efceffd6cdb49bb8",
        },
        _ => {
            return Err(failure(
                "Local Nemotron inference is unavailable for this operating system or architecture.",
            ));
        }
    };
    Ok(artifact)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineStatus {
    installed: bool,
    model_cached: bool,
    supported: bool,
    model: &'static str,
    model_bytes: u64,
    runtime_bytes: u64,
    license_url: &'static str,
    source_url: &'static str,
    locales: &'static [&'static str],
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    phase: &'static str,
    downloaded_bytes: u64,
    total_bytes: u64,
}

#[derive(Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Transcript {
    pub text: String,
    pub words: Vec<Word>,
}

#[derive(Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Word {
    pub text: String,
    pub start_ms: u32,
    pub end_ms: u32,
}

struct Operation {
    id: String,
    plugin: String,
    cancelled: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Default)]
struct Operations {
    active: Option<Operation>,
    cancelled: VecDeque<(String, String)>,
}
static OPERATIONS: OnceLock<Mutex<Operations>> = OnceLock::new();

fn operations() -> AppResult<std::sync::MutexGuard<'static, Operations>> {
    OPERATIONS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| failure("Speech operation state is unavailable. Restart Denote."))
}

struct OperationGuard {
    id: String,
    cancelled: Arc<AtomicBool>,
}

struct ChildGuard(Arc<Mutex<Child>>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        match self.0.lock() {
            Ok(mut child) => {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                if child.kill().is_err() && !matches!(child.try_wait(), Ok(Some(_))) {
                    eprintln!("Unable to terminate the local transcription helper.");
                }
                if child.wait().is_err() {
                    eprintln!("Unable to reap the local transcription helper.");
                }
            }
            Err(_) => eprintln!("Local transcription process cleanup state is unavailable."),
        }
    }
}

impl OperationGuard {
    fn start(plugin: &str, id: &str) -> AppResult<Self> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(failure("Invalid speech operation identity."));
        }
        let mut operations = operations()?;
        if operations.active.is_some() {
            return Err(failure(
                "Another local speech operation is running. Stop it first.",
            ));
        }
        if operations
            .cancelled
            .iter()
            .any(|(owner, operation)| owner == plugin && operation == id)
        {
            return Err(failure("The speech operation was cancelled."));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        operations.active = Some(Operation {
            id: id.into(),
            plugin: plugin.into(),
            cancelled: cancelled.clone(),
            child: None,
        });
        Ok(Self {
            id: id.into(),
            cancelled,
        })
    }

    fn check(&self) -> AppResult<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(failure("The speech operation was cancelled."))
        } else {
            Ok(())
        }
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        if let Ok(mut operations) = operations() {
            if operations
                .active
                .as_ref()
                .is_some_and(|active| active.id == self.id)
            {
                operations.active.take();
            }
        } else {
            eprintln!("Speech operation cleanup failed.");
        }
    }
}

pub(crate) fn cancel(plugin: Option<&str>, id: Option<&str>) -> AppResult<()> {
    let mut operations = operations()?;
    if let (Some(plugin), Some(id)) = (plugin, id) {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(failure("Invalid speech operation identity."));
        }
        if operations.cancelled.len() >= 256 {
            operations.cancelled.pop_front();
        }
        operations.cancelled.push_back((plugin.into(), id.into()));
    }
    if let Some(active) = &operations.active {
        if plugin.is_none_or(|plugin| plugin == active.plugin)
            && id.is_none_or(|id| id == active.id)
        {
            active.cancelled.store(true, Ordering::Release);
            if let Some(child) = &active.child {
                let mut child = child
                    .lock()
                    .map_err(|_| failure("Unable to stop local transcription."))?;
                if child
                    .try_wait()
                    .map_err(|_| failure("Unable to inspect local transcription."))?
                    .is_none()
                {
                    child
                        .kill()
                        .map_err(|_| failure("Unable to stop local transcription."))?;
                    child
                        .wait()
                        .map_err(|_| failure("Unable to reap local transcription."))?;
                }
            }
        }
    }
    Ok(())
}

fn failure(message: &str) -> AppError {
    AppError::Plugin(message.into())
}

fn root(app: &AppHandle) -> AppResult<PathBuf> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| failure("Local speech storage is unavailable."))?
        .canonicalize()
        .map_err(|_| failure("Local speech storage is unavailable."))?;
    let root = app_data.join("speech");
    safe_path(&root)?;
    fs::create_dir_all(&root).map_err(|_| failure("Unable to create local speech storage."))?;
    Ok(root)
}

fn safe_path(path: &Path) -> AppResult<()> {
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
                    return Err(failure(
                        "Local speech storage cannot contain symbolic links or reparse points.",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(failure("Local speech storage is unavailable.")),
        }
    }
    Ok(())
}

fn digest(path: &Path, size: u64, expected: &str) -> AppResult<()> {
    safe_path(path)?;
    let mut file = File::open(path).map_err(|_| {
        failure("The local speech download is missing. Download the engine and model first.")
    })?;
    let metadata = file
        .metadata()
        .map_err(|_| failure("Unable to inspect a local speech download."))?;
    if !metadata.is_file() || metadata.len() != size {
        return Err(failure(
            "A local speech download has the wrong size. Remove it and download it again.",
        ));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let length = file
            .read(&mut buffer)
            .map_err(|_| failure("Unable to verify a local speech download."))?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    if hex::encode(hash.finalize()) != expected {
        return Err(failure(
            "A local speech download failed integrity verification. Remove it and download it again.",
        ));
    }
    Ok(())
}

type Files = BTreeMap<PathBuf, Vec<u8>>;

fn archive_path(path: &Path) -> AppResult<PathBuf> {
    if path.as_os_str().to_string_lossy().contains('\\') {
        return Err(failure(
            "The speech runtime archive contains an unsafe path.",
        ));
    }
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) if !value.to_string_lossy().contains(['\\', ':', '\0']) => {
                output.push(value)
            }
            Component::CurDir => {}
            _ => {
                return Err(failure(
                    "The speech runtime archive contains an unsafe path.",
                ));
            }
        }
    }
    if output.as_os_str().is_empty() {
        return Err(failure(
            "The speech runtime archive contains an empty path.",
        ));
    }
    Ok(output)
}

fn read_archive(bytes: &[u8], zip: bool) -> AppResult<Files> {
    let mut files = Files::new();
    let mut links = BTreeMap::new();
    let mut total = 0usize;
    let mut insert = |path: PathBuf, data: Vec<u8>| -> AppResult<()> {
        total = total
            .checked_add(data.len())
            .ok_or_else(|| failure("The speech runtime archive is too large."))?;
        if total > MAX_EXTRACTED_BYTES
            || files.len() >= 5000
            || files.keys().any(|other| {
                other
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&path.to_string_lossy())
            })
        {
            return Err(failure(
                "The speech runtime archive is oversized or contains duplicate paths.",
            ));
        }
        files.insert(path, data);
        Ok(())
    };
    if zip {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|_| failure("Invalid speech runtime ZIP archive."))?;
        if archive.len() > 5000 {
            return Err(failure("The speech runtime archive has too many entries."));
        }
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| failure("Invalid speech runtime ZIP entry."))?;
            if entry.is_dir() {
                continue;
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(failure("The speech runtime ZIP cannot contain links."));
            }
            let name = entry
                .name()
                .map_err(|_| failure("Invalid speech runtime ZIP path."))?;
            let path = archive_path(Path::new(name.as_ref()))?;
            let mut data = Vec::new();
            (&mut entry)
                .take(MAX_EXTRACTED_BYTES as u64 + 1)
                .read_to_end(&mut data)
                .map_err(|_| failure("Unable to read the speech runtime archive."))?;
            insert(path, data)?;
        }
    } else {
        let mut archive = tar::Archive::new(GzDecoder::new(bytes));
        for (index, entry) in archive
            .entries()
            .map_err(|_| failure("Invalid speech runtime archive."))?
            .enumerate()
        {
            if index >= 5000 {
                return Err(failure("The speech runtime archive has too many entries."));
            }
            let entry = entry.map_err(|_| failure("Invalid speech runtime archive entry."))?;
            let path = archive_path(
                &entry
                    .path()
                    .map_err(|_| failure("Invalid speech runtime archive path."))?,
            )?;
            if entry.header().entry_type().is_dir() {
                continue;
            }
            if entry.header().entry_type().is_symlink() {
                let target = entry
                    .link_name()
                    .map_err(|_| failure("Invalid speech runtime library link."))?
                    .ok_or_else(|| failure("Missing speech runtime library link target."))?;
                let target = archive_path(&target)?;
                let target = path
                    .parent()
                    .ok_or_else(|| failure("Invalid speech runtime library path."))?
                    .join(target);
                if links.insert(path, target).is_some() {
                    return Err(failure("Duplicate speech runtime library link."));
                }
                continue;
            }
            if !entry.header().entry_type().is_file() {
                return Err(failure(
                    "The speech runtime archive contains a special file.",
                ));
            }
            let mut data = Vec::new();
            entry
                .take(MAX_EXTRACTED_BYTES as u64 + 1)
                .read_to_end(&mut data)
                .map_err(|_| failure("Unable to read the speech runtime archive."))?;
            insert(path, data)?;
        }
    }
    // Materialize verified, in-archive library aliases as regular files.
    for (path, target) in &links {
        if files.contains_key(path) {
            return Err(failure("Duplicate speech runtime library path."));
        }
        let mut target = target;
        for _ in 0..8 {
            if let Some(next) = links.get(target) {
                target = next;
            } else {
                break;
            }
        }
        let data = files
            .get(target)
            .ok_or_else(|| {
                failure("The speech runtime archive contains a dangling or cyclic library link.")
            })?
            .clone();
        total += data.len();
        if total > MAX_EXTRACTED_BYTES {
            return Err(failure("The speech runtime archive is too large."));
        }
        files.insert(path.clone(), data);
    }
    if files.is_empty() {
        return Err(failure("The speech runtime archive is empty."));
    }
    Ok(files)
}

fn library_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "nemo_speech_asr_c.dll"
    } else if cfg!(target_os = "macos") {
        "libnemo_speech_asr_c.dylib"
    } else {
        "libnemo_speech_asr_c.so"
    }
}

pub(super) fn verified_library(root: &Path, verify_model: bool) -> AppResult<PathBuf> {
    let artifact = runtime_artifact()?;
    let archive = root.join(artifact.name);
    digest(&archive, artifact.size, artifact.sha)?;
    let bytes =
        fs::read(&archive).map_err(|_| failure("Unable to read the local speech runtime."))?;
    let files = read_archive(&bytes, artifact.name.ends_with(".zip"))?;
    let installed = root.join("runtime");
    let mut library = None;
    for (relative, expected) in &files {
        let path = installed.join(relative);
        safe_path(&path)?;
        let metadata = fs::metadata(&path).map_err(|_| {
            failure("The local speech runtime is incomplete. Remove it and download it again.")
        })?;
        if !metadata.is_file()
            || metadata.len() != expected.len() as u64
            || fs::read(&path).map_err(|_| failure("Unable to verify the local speech runtime."))?
                != *expected
        {
            return Err(failure(
                "The local speech runtime changed. Remove it and download it again.",
            ));
        }
        if relative
            .file_name()
            .is_some_and(|name| name == library_name())
        {
            if library.replace(path).is_some() {
                return Err(failure(
                    "The local speech runtime contains duplicate ASR libraries.",
                ));
            }
        }
    }
    for entry in walkdir::WalkDir::new(&installed).follow_links(false) {
        let entry = entry.map_err(|_| failure("Unable to inspect local speech runtime files."))?;
        if entry.file_type().is_symlink()
            || entry.file_type().is_file()
                && !files.contains_key(
                    entry
                        .path()
                        .strip_prefix(&installed)
                        .map_err(|_| failure("Invalid local speech runtime path."))?,
                )
        {
            return Err(failure(
                "The local speech runtime contains unverified files.",
            ));
        }
    }
    if verify_model {
        digest(&root.join(MODEL_FILE), MODEL_BYTES, MODEL_SHA)?;
    }
    library.ok_or_else(|| {
        failure("This runtime archive does not contain the supported ASR C interface.")
    })
}

fn download(
    root: &Path,
    url: &str,
    name: &str,
    size: u64,
    sha: &str,
    operation: &OperationGuard,
    progress: &Channel<Progress>,
    completed: u64,
    total: u64,
) -> AppResult<()> {
    tauri::async_runtime::block_on(download_async(
        root, url, name, size, sha, operation, progress, completed, total,
    ))
}

async fn download_async(
    root: &Path,
    url: &str,
    name: &str,
    size: u64,
    sha: &str,
    operation: &OperationGuard,
    progress: &Channel<Progress>,
    completed: u64,
    total: u64,
) -> AppResult<()> {
    let destination = root.join(name);
    if destination.exists() {
        digest(&destination, size, sha)?;
        return Ok(());
    }
    operation.check()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .read_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let allowed = url.host_str().is_some_and(|host| {
                [
                    "github.com",
                    "release-assets.githubusercontent.com",
                    "objects.githubusercontent.com",
                    "huggingface.co",
                ]
                .contains(&host)
                    || host.ends_with(".hf.co")
            });
            if url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port_or_known_default() == Some(443)
                && allowed
                && attempt.previous().len() < 5
            {
                attempt.follow()
            } else {
                attempt.error("Unapproved speech download redirect")
            }
        }))
        .build()
        .map_err(|_| failure("Unable to initialize the speech downloader."))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| failure("The speech download failed. Check connectivity and retry."))?;
    if response
        .content_length()
        .is_some_and(|length| length != size)
    {
        return Err(failure("The speech download has an unexpected size."));
    }
    let mut staged = tempfile::NamedTempFile::new_in(root)
        .map_err(|_| failure("Unable to stage the speech download."))?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut last_update = Instant::now();
    loop {
        operation.check()?;
        let Some(buffer) = response
            .chunk()
            .await
            .map_err(|_| failure("The speech download was interrupted. Retry the download."))?
        else {
            break;
        };
        received += buffer.len() as u64;
        if received > size {
            return Err(failure("The speech download exceeded its approved size."));
        }
        staged
            .write_all(&buffer)
            .map_err(|_| failure("Unable to save the speech download."))?;
        hash.update(&buffer);
        if last_update.elapsed() >= Duration::from_millis(100) {
            progress
                .send(Progress {
                    phase: "downloading",
                    downloaded_bytes: completed + received,
                    total_bytes: total,
                })
                .map_err(|_| failure("The speech download panel closed."))?;
            last_update = Instant::now();
        }
    }
    operation.check()?;
    if received != size || hex::encode(hash.finalize()) != sha {
        return Err(failure(
            "The speech download failed integrity verification. Retry it.",
        ));
    }
    staged
        .as_file()
        .sync_all()
        .map_err(|_| failure("Unable to finish the speech download."))?;
    staged
        .persist_noclobber(&destination)
        .map_err(|_| failure("Unable to commit the verified speech download."))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn speech_engine_status(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
) -> AppResult<EngineStatus> {
    let handle = app.clone();
    super::scoped(
        app,
        plugin_id,
        workspace_scope,
        "speech",
        move |state, vault, key| {
            crate::vault::speech::recover(&state.db_path, &vault.to_string_lossy(), key, None)?;
            let artifact = runtime_artifact();
            let supported = artifact.is_ok();
            let runtime_bytes = artifact.as_ref().map(|artifact| artifact.size).unwrap_or(0);
            let root = root(&handle)?;
            let model_cached = root.join(MODEL_FILE).exists();
            if model_cached {
                digest(&root.join(MODEL_FILE), MODEL_BYTES, MODEL_SHA)?;
            }
            let runtime_present = root.join("runtime").exists();
            if runtime_present {
                verified_library(&root, false)?;
            }
            let installed = model_cached && runtime_present;
            Ok(EngineStatus {
                installed,
                model_cached,
                supported,
                model: MODEL_NAME,
                model_bytes: MODEL_BYTES,
                runtime_bytes,
                license_url: "https://openmdw.ai/license/1-1/",
                source_url: "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b",
                locales: LOCALES,
            })
        },
    )
    .await
}

pub(crate) fn cleanup_disabled(app_data: &Path, clear_model: bool) -> AppResult<()> {
    cancel(None, None)?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while operations()?.active.is_some() {
        if Instant::now() >= deadline {
            return Err(failure(
                "Speech is still stopping. Retry removal after the pending operation ends.",
            ));
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let root = app_data
        .canonicalize()
        .map_err(|_| failure("Local speech storage is unavailable."))?
        .join("speech");
    safe_path(&root)?;
    if !root.exists() {
        return Ok(());
    }
    let runtime = root.join("runtime");
    safe_path(&runtime)?;
    match fs::remove_dir_all(&runtime) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err(failure(
                "Unable to remove the stopped native speech runtime. Retry removal.",
            ));
        }
    }
    for name in [
        "nemo-speech-0.2.0-macos-aarch64-cpu.tar.gz",
        "nemo-speech-0.2.0-macos-x86_64-cpu.tar.gz",
        "nemo-speech-0.2.0-linux-aarch64-cpu.tar.gz",
        "nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz",
        "nemo-speech-0.2.0-windows-x86_64-cpu.zip",
    ]
    .into_iter()
    .chain(if clear_model { Some(MODEL_FILE) } else { None })
    {
        let path = root.join(name);
        safe_path(&path)?;
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(failure("Unable to remove a speech asset. Retry removal.")),
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_speech_engine(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    operation_id: String,
    approved: bool,
    progress: Channel<Progress>,
) -> AppResult<()> {
    if !approved {
        return Err(failure(
            "Approve the model, runtime, license, origin, and download size before downloading.",
        ));
    }
    let owner = plugin_id.clone();
    let operation = super::scoped(
        app.clone(),
        plugin_id.clone(),
        workspace_scope.clone(),
        "speech",
        move |_, _, _| OperationGuard::start(&owner, &operation_id),
    )
    .await?;
    let handle = app.clone();
    let operation = tauri::async_runtime::spawn_blocking(move || {
        let artifact = runtime_artifact()?;
        let root = root(&handle)?;
        let total = MODEL_BYTES + artifact.size;
        download(
            &root,
            &format!(
                "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/{}",
                artifact.name
            ),
            artifact.name,
            artifact.size,
            artifact.sha,
            &operation,
            &progress,
            0,
            total,
        )?;
        install_runtime(&root, artifact, &operation)?;
        download(
            &root,
            MODEL_URL,
            MODEL_FILE,
            MODEL_BYTES,
            MODEL_SHA,
            &operation,
            &progress,
            artifact.size,
            total,
        )?;
        verified_library(&root, true)?;
        progress
            .send(Progress {
                phase: "ready",
                downloaded_bytes: total,
                total_bytes: total,
            })
            .map_err(|_| failure("The speech download panel closed."))?;
        Ok::<_, AppError>(operation)
    })
    .await
    .map_err(|_| failure("The speech download task failed."))??;
    super::scoped(app, plugin_id, workspace_scope, "speech", move |_, _, _| {
        operation.check()
    })
    .await
}

fn install_runtime(root: &Path, artifact: Artifact, operation: &OperationGuard) -> AppResult<()> {
    let runtime = root.join("runtime");
    if runtime.exists() {
        return Ok(());
    }
    digest(&root.join(artifact.name), artifact.size, artifact.sha)?;
    let files = read_archive(
        &fs::read(root.join(artifact.name))
            .map_err(|_| failure("Unable to read the speech runtime archive."))?,
        artifact.name.ends_with(".zip"),
    )?;
    let staged =
        tempfile::tempdir_in(root).map_err(|_| failure("Unable to stage the speech runtime."))?;
    for (relative, bytes) in files {
        operation.check()?;
        let destination = staged.path().join(relative);
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| failure("Invalid speech runtime path."))?,
        )
        .map_err(|_| failure("Unable to create speech runtime folders."))?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o700);
        }
        options
            .open(destination)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|_| failure("Unable to install the verified speech runtime."))?;
    }
    fs::rename(staged.path(), &runtime)
        .map_err(|_| failure("Unable to commit the verified speech runtime."))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn cancel_speech_operation(
    plugin_id: String,
    operation_id: String,
) -> AppResult<()> {
    cancel(Some(&plugin_id), Some(&operation_id))
}

#[tauri::command]
pub(crate) async fn remove_speech_engine(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    confirmed: bool,
) -> AppResult<()> {
    let handle = app.clone();
    super::scoped(app, plugin_id, workspace_scope, "speech", move |_, _, _| {
        if !confirmed {
            return Err(failure(
                "Confirm removal of the local speech engine and model.",
            ));
        }
        if operations()?.active.is_some() {
            return Err(failure(
                "Stop the current speech operation before removing its model.",
            ));
        }
        let root = root(&handle)?;
        for name in [runtime_artifact()?.name, MODEL_FILE] {
            let path = root.join(name);
            safe_path(&path)?;
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(failure("Unable to remove a local speech download.")),
            }
        }
        let runtime = root.join("runtime");
        safe_path(&runtime)?;
        if runtime.exists() {
            fs::remove_dir_all(&runtime)
                .map_err(|_| failure("Unable to remove the local speech runtime."))?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn transcribe_speech(
    app: AppHandle,
    plugin_id: String,
    workspace_scope: String,
    operation_id: String,
    wav: Secret,
    locale: String,
) -> AppResult<Transcript> {
    if !LOCALES.contains(&locale.as_str()) {
        return Err(failure("Choose a supported transcription locale."));
    }
    if wav.len() > MAX_WAV_BYTES.div_ceil(3) * 4 {
        return Err(failure(
            "Audio exceeds the 10-minute local transcription limit.",
        ));
    }
    let owner = plugin_id.clone();
    let operation = super::scoped(
        app.clone(),
        plugin_id.clone(),
        workspace_scope.clone(),
        "speech",
        move |_, _, _| OperationGuard::start(&owner, &operation_id),
    )
    .await?;
    let handle = app.clone();
    let (transcript, operation) = tauri::async_runtime::spawn_blocking(move || {
        let bytes = Zeroizing::new(
            STANDARD
                .decode(wav.as_bytes())
                .map_err(|_| failure("Invalid local audio bytes."))?,
        );
        let root = root(&handle)?;
        let executable = helper_executable(&handle)?;
        let transcript = run_transcription(&root, bytes, &locale, &operation, &executable)?;
        Ok::<_, AppError>((transcript, operation))
    })
    .await
    .map_err(|_| failure("The local transcription task failed."))??;
    super::scoped(app, plugin_id, workspace_scope, "speech", move |_, _, _| {
        operation.check()?;
        Ok(transcript)
    })
    .await
}

fn packaged_helper(resources: &Path) -> AppResult<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        Ok(resources
            .parent()
            .ok_or_else(|| failure("The packaged speech helper is unavailable."))?
            .join("Helpers/Denote Speech Helper.app/Contents/MacOS/denote-speech-worker"))
    }
    #[cfg(windows)]
    {
        Ok(resources.join("speech/denote-speech-worker.exe"))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Ok(resources.join("speech/denote-speech-worker"))
    }
}

fn helper_executable(app: &AppHandle) -> AppResult<PathBuf> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| failure("The packaged speech helper is unavailable."))?;
    let executable = packaged_helper(&resources)?;
    if executable.is_file() {
        safe_path(&executable)?;
        return Ok(executable);
    }
    #[cfg(debug_assertions)]
    {
        let stage = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/speech");
        #[cfg(target_os = "macos")]
        let executable = stage.join("Denote Speech Helper.app/Contents/MacOS/denote-speech-worker");
        #[cfg(windows)]
        let executable = stage.join("denote-speech-worker.exe");
        #[cfg(not(any(target_os = "macos", windows)))]
        let executable = stage.join("denote-speech-worker");
        if executable.is_file() {
            safe_path(&executable)?;
            return Ok(executable);
        }
    }
    Err(failure(
        "The packaged speech helper is missing. Reinstall Denote to restore local transcription.",
    ))
}

fn run_transcription(
    root: &Path,
    bytes: Zeroizing<Vec<u8>>,
    locale: &str,
    operation: &OperationGuard,
    executable: &Path,
) -> AppResult<Transcript> {
    super::speech_helper::validate_pcm_wav(&bytes)?;
    let library = verified_library(root, true)?;
    let directory = library
        .parent()
        .ok_or_else(|| failure("The verified native runtime directory is unavailable."))?;
    operation.check()?;
    let mut command = Command::new(executable);
    command
        .arg("--denote-speech-worker")
        .arg(&root)
        .arg(&locale)
        .current_dir(directory)
        .env_clear()
        .env("OMP_NUM_THREADS", "2")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(test)]
    command.stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|_| failure("Unable to start the local transcription helper."))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| failure("The local transcription input pipe is unavailable."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("The local transcription output pipe is unavailable."))?;
    let child = Arc::new(Mutex::new(child));
    let _child_guard = ChildGuard(child.clone());
    {
        let mut operations = operations()?;
        let active = operations
            .active
            .as_mut()
            .filter(|active| active.id == operation.id)
            .ok_or_else(|| failure("The transcription operation expired."))?;
        active.child = Some(child.clone());
    }
    let input = std::thread::spawn(move || stdin.write_all(&bytes));
    let cancel_output = operation.cancelled.clone();
    let output = std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        let result = stdout
            .take(MAX_RESULT_BYTES as u64 + 1)
            .read_to_end(&mut bytes);
        if bytes.len() > MAX_RESULT_BYTES {
            cancel_output.store(true, Ordering::Release);
        }
        result.map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(600);
    let status = loop {
        let mut child = child
            .lock()
            .map_err(|_| failure("Local transcription process state is unavailable."))?;
        if operation.cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
            if child
                .try_wait()
                .map_err(|_| failure("Unable to inspect local transcription."))?
                .is_none()
            {
                child
                    .kill()
                    .map_err(|_| failure("Unable to stop local transcription."))?;
            }
            break child
                .wait()
                .map_err(|_| failure("Unable to finish local transcription cleanup."))?;
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|_| failure("Unable to inspect local transcription."))?
        {
            break status;
        }
        drop(child);
        std::thread::sleep(Duration::from_millis(30));
    };
    let input_ok = input
        .join()
        .map_err(|_| failure("Local transcription input failed."))?
        .is_ok();
    let output = output
        .join()
        .map_err(|_| failure("Local transcription output failed."))?
        .map_err(|_| failure("Unable to read local transcription results."))?;
    operation.check()?;
    if !status.success() {
        return Err(failure(&format!(
            "The local transcription helper exited with {status}. No transcript was inserted."
        )));
    }
    if !input_ok || output.len() > MAX_RESULT_BYTES {
        return Err(failure(
            "Local transcription failed or timed out. No transcript was inserted.",
        ));
    }
    let transcript: Transcript = serde_json::from_slice(&output).map_err(|_| {
        failure("The local engine returned an invalid transcript. No text was inserted.")
    })?;
    validate_transcript(&transcript)?;
    Ok(transcript)
}

fn validate_transcript(transcript: &Transcript) -> AppResult<()> {
    if transcript.text.len() > 1024 * 1024
        || transcript.text.contains('\0')
        || transcript.words.len() > 20000
        || transcript.words.iter().any(|word| {
            word.text.len() > 1024 || word.start_ms > word.end_ms || word.end_ms > 600_000
        })
    {
        return Err(failure(
            "The local engine returned an oversized or invalid transcript.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_uses_a_dedicated_packaged_executable_not_the_desktop_process() {
        let resources = Path::new("mock-install/Denote.app/Contents/Resources");
        let helper = packaged_helper(resources).unwrap();
        #[cfg(target_os = "macos")]
        assert_eq!(
            helper,
            Path::new(
                "mock-install/Denote.app/Contents/Helpers/Denote Speech Helper.app/Contents/MacOS/denote-speech-worker"
            )
        );
        #[cfg(windows)]
        assert_eq!(helper, resources.join("speech/denote-speech-worker.exe"));
        #[cfg(not(any(target_os = "macos", windows)))]
        assert_eq!(helper, resources.join("speech/denote-speech-worker"));
    }

    #[test]
    fn speech_archives_reject_traversal_absolute_paths_and_special_names() {
        for path in [
            "../escape",
            "/absolute",
            "C:\\escape",
            "inside/../../escape",
            "inside/file:stream",
            "inside\\escape",
        ] {
            assert!(archive_path(Path::new(path)).is_err(), "{path}");
        }
        assert_eq!(
            archive_path(Path::new("./safe/lib.so")).unwrap(),
            PathBuf::from("safe/lib.so")
        );
        assert!(read_archive(b"invalid archive", false).is_err());
        assert!(read_archive(b"invalid zip", true).is_err());
    }

    #[test]
    fn speech_transcript_validation_refuses_oversized_and_invalid_results() {
        assert!(
            validate_transcript(&Transcript {
                text: "Invented transcript.".into(),
                words: vec![]
            })
            .is_ok()
        );
        assert!(
            validate_transcript(&Transcript {
                text: "\0".into(),
                words: vec![]
            })
            .is_err()
        );
        assert!(
            validate_transcript(&Transcript {
                text: String::new(),
                words: vec![Word {
                    text: "synthetic".into(),
                    start_ms: 10,
                    end_ms: 9
                }]
            })
            .is_err()
        );
    }

    #[test]
    fn speech_cancelled_operations_cannot_start_after_cancellation_arrives_early() {
        let id = uuid::Uuid::new_v4().to_string();
        cancel(Some("denote.synthetic-speech"), Some(&id)).unwrap();
        assert!(OperationGuard::start("denote.synthetic-speech", &id).is_err());
    }

    #[test]
    fn speech_runtime_extracts_only_bounded_regular_files_and_local_library_aliases() {
        let mut archive = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, "synthetic/lib/libasr.1", Cursor::new(b"safe"))
            .unwrap();
        let mut alias = tar::Header::new_gnu();
        alias.set_entry_type(tar::EntryType::Symlink);
        alias.set_size(0);
        alias.set_mode(0o777);
        alias.set_link_name("libasr.1").unwrap();
        alias.set_cksum();
        archive
            .append_data(&mut alias, "synthetic/lib/libasr", Cursor::new([]))
            .unwrap();
        let bytes = archive.into_inner().unwrap();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&bytes).unwrap();
        let files = read_archive(&gzip.finish().unwrap(), false).unwrap();
        assert_eq!(files[Path::new("synthetic/lib/libasr")], b"safe");
    }

    #[test]
    #[ignore = "Requires explicit approval of the 742 MB model download and generated synthetic speech"]
    fn speech_real_approved_model_download_and_anonymous_pipe_inference() {
        assert_eq!(
            std::env::var("DENOTE_SPEECH_TEST_DOWNLOAD").as_deref(),
            Ok("approved")
        );
        let root = PathBuf::from(
            std::env::var_os("DENOTE_SPEECH_TEST_ROOT").expect("Explicit temporary engine folder"),
        );
        let root = root.canonicalize().unwrap();
        let executable = PathBuf::from(
            std::env::var_os("DENOTE_SPEECH_TEST_EXECUTABLE").expect("Built Denote executable"),
        );
        let wav = PathBuf::from(
            std::env::var_os("DENOTE_SPEECH_TEST_WAV").expect("Generated synthetic speech WAV"),
        );
        let operation = OperationGuard::start(
            "denote.speech.synthetic-test",
            &uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
        let progress = Channel::new(|_| Ok(()));
        let artifact = runtime_artifact().unwrap();
        download(
            &root,
            &format!(
                "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0/{}",
                artifact.name
            ),
            artifact.name,
            artifact.size,
            artifact.sha,
            &operation,
            &progress,
            0,
            MODEL_BYTES + artifact.size,
        )
        .unwrap();
        install_runtime(&root, artifact, &operation).unwrap();
        download(
            &root,
            MODEL_URL,
            MODEL_FILE,
            MODEL_BYTES,
            MODEL_SHA,
            &operation,
            &progress,
            artifact.size,
            MODEL_BYTES + artifact.size,
        )
        .unwrap();
        let transcript = run_transcription(
            &root,
            Zeroizing::new(fs::read(wav).unwrap()),
            "en-US",
            &operation,
            &executable,
        )
        .unwrap();
        assert!(
            transcript.text.to_lowercase().contains("synthetic"),
            "Generated speech must be recognized, not merely return a valid result shape"
        );
        assert!(
            !transcript.words.is_empty(),
            "The real model must return word timing data"
        );
        for entry in walkdir::WalkDir::new(&root) {
            let entry = entry.unwrap();
            assert_ne!(
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str()),
                Some("wav")
            );
            assert_ne!(
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str()),
                Some("core")
            );
        }
    }
}
