use std::{
    fs::{self, File},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tar::{Archive, EntryType};
use uuid::Uuid;

use super::package::ensure_managed_directory;
use crate::error::{AppError, AppResult};

const LOCK_JSON: &str = include_str!("../../../bundled-tools.lock.json");
const MAX_INTEGRITY_BYTES: u64 = 16 * 1024 * 1024;

#[cfg(target_os = "macos")]
const SYSTEM_GIT_PATHS: &[&str] = &[
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
];
#[cfg(target_os = "linux")]
const SYSTEM_GIT_PATHS: &[&str] = &["/usr/bin/git", "/bin/git", "/usr/local/bin/git"];
#[cfg(target_os = "windows")]
const SYSTEM_GIT_PATHS: &[&str] = &[
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files\Git\bin\git.exe",
    r"C:\Program Files (x86)\Git\cmd\git.exe",
];

#[cfg(target_os = "macos")]
const SYSTEM_GH_PATHS: &[&str] = &["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
#[cfg(target_os = "linux")]
const SYSTEM_GH_PATHS: &[&str] = &["/usr/bin/gh", "/bin/gh", "/usr/local/bin/gh"];
#[cfg(target_os = "windows")]
const SYSTEM_GH_PATHS: &[&str] = &[
    r"C:\Program Files\GitHub CLI\gh.exe",
    r"C:\Program Files (x86)\GitHub CLI\gh.exe",
];

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(crate) const TARGET_TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub(crate) const TARGET_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub(crate) const TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
pub(crate) const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExecutableMode {
    Disabled,
    Bundled,
    System,
    Custom,
}

impl ExecutableMode {
    pub(crate) fn parse(value: Option<&str>, default: Self) -> Self {
        match value {
            Some("disabled") => Self::Disabled,
            Some("bundled") => Self::Bundled,
            Some("system") => Self::System,
            Some("custom") => Self::Custom,
            _ => default,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Disabled => "Disabled",
            Self::Bundled => "Bundled",
            Self::System => "System",
            Self::Custom => "Custom",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ToolKind {
    Git,
    GitHubCli,
}

impl ToolKind {
    fn key(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::GitHubCli => "github-cli",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Git => "Git",
            Self::GitHubCli => "GitHub CLI",
        }
    }

    fn version_prefix(self) -> &'static str {
        match self {
            Self::Git => "git version ",
            Self::GitHubCli => "gh version ",
        }
    }

    fn probe_argument(self) -> &'static str {
        match self {
            Self::Git => "--version",
            Self::GitHubCli => "version",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub tool: String,
    pub selected_source: String,
    pub resolved_path: Option<String>,
    pub version: Option<String>,
    pub validation_status: String,
    pub message: String,
    pub guidance: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockManifest {
    git: LockTool,
    github_cli: LockTool,
    targets: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockTool {
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityManifest {
    schema_version: u32,
    target: String,
    lock_sha256: String,
    git: IntegrityTool,
    github_cli: IntegrityTool,
    files: Vec<IntegrityFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityTool {
    version: String,
    archive_path: String,
    archive_root: String,
    executable_path: String,
    executable_size_bytes: u64,
    executable_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityFile {
    path: String,
    size_bytes: u64,
    sha256: String,
}

pub(crate) fn resolve_git(
    resource_dir: &Path,
    install_dir: &Path,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    if mode == ExecutableMode::Disabled {
        return Err(AppError::Plugin(
            "Git cannot be disabled. Choose Bundled, System, or Custom in the Git plugin settings."
                .to_string(),
        ));
    }
    resolve(resource_dir, install_dir, ToolKind::Git, mode, custom_path)
}

pub(crate) fn resolve_gh(
    resource_dir: &Path,
    install_dir: &Path,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    if mode == ExecutableMode::Disabled {
        return Err(AppError::Plugin(
            "GitHub CLI is disabled. Choose Bundled, System, or Custom in the Git plugin settings before using GitHub sign-in."
                .to_string(),
        ));
    }
    resolve(
        resource_dir,
        install_dir,
        ToolKind::GitHubCli,
        mode,
        custom_path,
    )
}

pub(crate) fn inspect(
    resource_dir: &Path,
    install_dir: &Path,
    kind: ToolKind,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> ToolStatus {
    if mode == ExecutableMode::Disabled {
        return ToolStatus {
            tool: kind.name().to_string(),
            selected_source: mode.label().to_string(),
            resolved_path: None,
            version: None,
            validation_status: "disabled".to_string(),
            message: "This executable is disabled.".to_string(),
            guidance: "Ordinary Git actions remain available. Enable GitHub CLI only for GitHub sign-in and repository browsing.".to_string(),
        };
    }
    match resolve(resource_dir, install_dir, kind, mode, custom_path) {
        Ok(path) => match probe(&path, kind) {
            Ok(version) => ToolStatus {
                tool: kind.name().to_string(),
                selected_source: mode.label().to_string(),
                resolved_path: Some(path.to_string_lossy().into_owned()),
                version: Some(version),
                validation_status: "valid".to_string(),
                message: format!("{} is ready.", kind.name()),
                guidance: guidance(kind, mode),
            },
            Err(error) => invalid_status(kind, mode, Some(path), error),
        },
        Err(error) => invalid_status(kind, mode, None, error),
    }
}

fn invalid_status(
    kind: ToolKind,
    mode: ExecutableMode,
    path: Option<PathBuf>,
    error: AppError,
) -> ToolStatus {
    ToolStatus {
        tool: kind.name().to_string(),
        selected_source: mode.label().to_string(),
        resolved_path: path.map(|value| value.to_string_lossy().into_owned()),
        version: None,
        validation_status: "invalid".to_string(),
        message: error.to_string(),
        guidance: guidance(kind, mode),
    }
}

fn guidance(kind: ToolKind, mode: ExecutableMode) -> String {
    match (kind, mode) {
        (ToolKind::Git, ExecutableMode::Bundled) => {
            "Bundled Git is verified with the signed Denote installer and the bundled integrity manifest.".to_string()
        }
        (ToolKind::Git, ExecutableMode::System) => {
            "Install Git in a standard operating-system location, then validate this setting again.".to_string()
        }
        (ToolKind::Git, ExecutableMode::Custom) => {
            "Choose an absolute path to a Git executable. Denote never falls back to another source.".to_string()
        }
        (ToolKind::GitHubCli, ExecutableMode::Bundled) => {
            "Run GitHub sign-in when prompted. Generic Git actions do not use GitHub CLI.".to_string()
        }
        (ToolKind::GitHubCli, ExecutableMode::System) => {
            "Install GitHub CLI in a standard location and run `gh auth login` before GitHub-specific actions.".to_string()
        }
        (ToolKind::GitHubCli, ExecutableMode::Custom) => {
            "Choose an absolute path to a GitHub CLI executable and authenticate it with `gh auth login`.".to_string()
        }
        (_, ExecutableMode::Disabled) => String::new(),
    }
}

fn resolve(
    resource_dir: &Path,
    install_dir: &Path,
    kind: ToolKind,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    match mode {
        ExecutableMode::Disabled => Err(AppError::Plugin(format!("{} is disabled", kind.name()))),
        ExecutableMode::Bundled => resolve_bundled(resource_dir, install_dir, kind),
        ExecutableMode::System => resolve_system(kind),
        ExecutableMode::Custom => {
            let custom = custom_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::Plugin(format!(
                        "Custom {} source requires an absolute executable path",
                        kind.name()
                    ))
                })?;
            resolve_custom(kind, custom)
        }
    }
}

fn resolve_custom(kind: ToolKind, custom: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(custom);
    if !candidate.is_absolute() {
        return Err(AppError::Plugin(format!(
            "The custom {} executable must be an absolute path",
            kind.name()
        )));
    }
    let canonical = fs::canonicalize(candidate).map_err(|error| {
        AppError::Plugin(format!(
            "The custom {} executable is unavailable: {error}",
            kind.name()
        ))
    })?;
    verify_executable(&canonical, kind)?;
    Ok(canonical)
}

fn resolve_system(kind: ToolKind) -> AppResult<PathBuf> {
    let paths = match kind {
        ToolKind::Git => SYSTEM_GIT_PATHS,
        ToolKind::GitHubCli => SYSTEM_GH_PATHS,
    };
    let mut last_error = None;
    for candidate in paths {
        let Ok(canonical) = fs::canonicalize(candidate) else {
            continue;
        };
        match verify_executable(&canonical, kind) {
            Ok(()) => return Ok(canonical),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        AppError::Plugin(format!(
            "{} was not found in a standard location. Install it or choose Bundled or Custom in the Git plugin settings.",
            kind.name()
        ))
    }))
}

fn resolve_bundled(resource_dir: &Path, install_dir: &Path, kind: ToolKind) -> AppResult<PathBuf> {
    if resource_dir.as_os_str().is_empty() {
        return Err(AppError::Plugin(format!(
            "Bundled {} resources are unavailable in this build",
            kind.name()
        )));
    }
    let root = resource_dir.join("tools").join(TARGET_TRIPLE);
    let manifest_path = root.join("integrity.json");
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|error| {
        AppError::Plugin(format!(
            "Bundled {} integrity manifest is unavailable: {error}",
            kind.name()
        ))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_INTEGRITY_BYTES {
        return Err(AppError::Plugin(
            "The bundled tools integrity manifest is invalid".to_string(),
        ));
    }
    let bytes = fs::read(&manifest_path)?;
    verify_compiled_manifest_digest(&bytes)?;
    let integrity: IntegrityManifest = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::Plugin(format!(
            "The bundled tools integrity manifest cannot be read: {error}"
        ))
    })?;
    if integrity.schema_version != 1
        || integrity.target != TARGET_TRIPLE
        || integrity.lock_sha256 != hex::encode(Sha256::digest(LOCK_JSON.as_bytes()))
    {
        return Err(AppError::Plugin(
            "The bundled tools integrity manifest does not match this Denote build".to_string(),
        ));
    }
    let lock: LockManifest = serde_json::from_str(LOCK_JSON)
        .map_err(|error| AppError::Plugin(format!("Invalid bundled tools lock: {error}")))?;
    if !lock.targets.contains_key(TARGET_TRIPLE) {
        return Err(AppError::Plugin(
            "This release target is missing from the bundled tools lock".to_string(),
        ));
    }
    let (tool, locked_version) = match kind {
        ToolKind::Git => (&integrity.git, &lock.git.version),
        ToolKind::GitHubCli => (&integrity.github_cli, &lock.github_cli.version),
    };
    if &tool.version != locked_version {
        return Err(AppError::Plugin(format!(
            "Bundled {} version does not match the immutable lock",
            kind.name()
        )));
    }
    let record = integrity
        .files
        .iter()
        .find(|file| file.path == tool.archive_path)
        .ok_or_else(|| {
            AppError::Plugin(format!(
                "Bundled {} archive is missing from the integrity manifest",
                kind.name()
            ))
        })?;
    let archive_path = root.join(&tool.archive_path);
    let canonical_root = fs::canonicalize(&root)?;
    let canonical_archive = fs::canonicalize(&archive_path).map_err(|error| {
        AppError::Plugin(format!(
            "Bundled {} archive is unavailable: {error}",
            kind.name()
        ))
    })?;
    if !canonical_archive.starts_with(&canonical_root) {
        return Err(AppError::Plugin(format!(
            "Bundled {} archive escapes the signed resource directory",
            kind.name()
        )));
    }
    verify_locked_file(&canonical_archive, record).map_err(|_| {
        AppError::Plugin(format!(
            "Bundled {} archive failed integrity verification. Reinstall Denote from an official signed installer.",
            kind.name()
        ))
    })?;
    let canonical = ensure_extracted(&canonical_archive, install_dir, kind, tool, &record.sha256)?;
    verify_executable(&canonical, kind)?;
    Ok(canonical)
}

fn ensure_extracted(
    archive_path: &Path,
    install_dir: &Path,
    kind: ToolKind,
    tool: &IntegrityTool,
    archive_sha256: &str,
) -> AppResult<PathBuf> {
    if install_dir.as_os_str().is_empty() {
        return Err(AppError::Plugin(format!(
            "Bundled {} installation directory is unavailable",
            kind.name()
        )));
    }
    ensure_managed_directory(install_dir)?;
    let target_root = install_dir.join(TARGET_TRIPLE);
    ensure_managed_directory(&target_root)?;
    let destination = target_root.join(format!("{}-{archive_sha256}", kind.key()));
    let executable = destination.join(&tool.executable_path);
    if destination.exists() {
        return validate_extracted_cache(&destination, tool, kind, archive_sha256);
    }

    let staging = target_root.join(format!(".prepare-{}", Uuid::new_v4()));
    fs::create_dir(&staging)?;
    let result = (|| {
        extract_verified_archive(archive_path, &staging, &tool.archive_root)?;
        let staged_executable = staging.join(&tool.executable_path);
        verify_extracted_executable(&staged_executable, tool, kind)?;
        fs::write(staging.join(".complete"), archive_sha256.as_bytes())?;
        match fs::rename(&staging, &destination) {
            Ok(()) => {}
            Err(_error) if destination.exists() => {
                fs::remove_dir_all(&staging)?;
                return validate_extracted_cache(&destination, tool, kind, archive_sha256);
            }
            Err(error) => return Err(error.into()),
        }
        fs::canonicalize(&executable).map_err(Into::into)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn validate_extracted_cache(
    destination: &Path,
    tool: &IntegrityTool,
    kind: ToolKind,
    archive_sha256: &str,
) -> AppResult<PathBuf> {
    let destination_metadata = fs::symlink_metadata(destination)?;
    if !destination_metadata.is_dir() || destination_metadata.file_type().is_symlink() {
        return Err(AppError::Plugin(format!(
            "The extracted bundled {} cache is not a safe directory",
            kind.name()
        )));
    }
    let marker = destination.join(".complete");
    if !fs::symlink_metadata(&marker).is_ok_and(|metadata| metadata.is_file())
        || fs::read_to_string(&marker).ok().as_deref() != Some(archive_sha256)
    {
        return Err(AppError::Plugin(format!(
            "The extracted bundled {} cache is incomplete. Remove {} and restart Denote.",
            kind.name(),
            destination.display()
        )));
    }
    let executable = destination.join(&tool.executable_path);
    verify_extracted_executable(&executable, tool, kind)?;
    fs::canonicalize(executable).map_err(Into::into)
}

fn extract_verified_archive(
    archive_path: &Path,
    destination: &Path,
    archive_root: &str,
) -> AppResult<()> {
    let file = File::open(archive_path)?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let mut entries = 0usize;
    let mut expanded_bytes = 0u64;
    for entry in archive.entries()? {
        let mut entry = entry?;
        entries += 1;
        expanded_bytes = expanded_bytes.saturating_add(entry.size());
        if entries > 30_000 || expanded_bytes > 512 * 1024 * 1024 {
            return Err(AppError::Plugin(
                "Bundled tool archive exceeds the extraction limit".to_string(),
            ));
        }
        let path = entry.path()?.into_owned();
        validate_archive_path(&path, archive_root)?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            let target = entry
                .link_name()?
                .ok_or_else(|| AppError::Plugin("Archive link has no target".to_string()))?;
            validate_archive_link(&path, &target, archive_root, entry_type)?;
        } else if !(entry_type.is_file() || entry_type.is_dir()) {
            return Err(AppError::Plugin(format!(
                "Bundled tool archive contains unsupported entry {}",
                path.display()
            )));
        }
        if !entry.unpack_in(destination)? {
            return Err(AppError::Plugin(format!(
                "Bundled tool archive entry escapes extraction: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_archive_path(path: &Path, archive_root: &str) -> AppResult<()> {
    let normalized = normalize_archive_path(path)?;
    if normalized.components().next() != Some(Component::Normal(archive_root.as_ref())) {
        return Err(AppError::Plugin(format!(
            "Bundled tool archive entry is outside {archive_root}"
        )));
    }
    Ok(())
}

fn validate_archive_link(
    path: &Path,
    target: &Path,
    archive_root: &str,
    entry_type: EntryType,
) -> AppResult<()> {
    if target.is_absolute() {
        return Err(AppError::Plugin(
            "Bundled tool archive contains an absolute link".to_string(),
        ));
    }
    let resolved = if entry_type.is_symlink() {
        path.parent().unwrap_or_else(|| Path::new("")).join(target)
    } else {
        target.to_path_buf()
    };
    validate_archive_path(&resolved, archive_root)
}

fn normalize_archive_path(path: &Path) -> AppResult<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(AppError::Plugin(
                        "Bundled tool archive path escapes its root".to_string(),
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::Plugin(
                    "Bundled tool archive path must be relative".to_string(),
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(AppError::Plugin(
            "Bundled tool archive path is empty".to_string(),
        ));
    }
    Ok(normalized)
}

fn verify_extracted_executable(path: &Path, tool: &IntegrityTool, kind: ToolKind) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::Plugin(format!(
            "Extracted bundled {} executable is unavailable: {error}",
            kind.name()
        ))
    })?;
    if !metadata.is_file()
        || metadata.len() != tool.executable_size_bytes
        || sha256_path(path)? != tool.executable_sha256
    {
        return Err(AppError::Plugin(format!(
            "Extracted bundled {} executable failed integrity verification",
            kind.name()
        )));
    }
    Ok(())
}

fn verify_compiled_manifest_digest(bytes: &[u8]) -> AppResult<()> {
    let expected_target = option_env!("DENOTE_BUNDLED_TOOLS_TARGET").unwrap_or("");
    let expected_digest = option_env!("DENOTE_BUNDLED_TOOLS_INTEGRITY_SHA256").unwrap_or("");
    if expected_target.is_empty() || expected_digest.is_empty() {
        return Err(AppError::Plugin(
            "This Denote build does not contain an anchored bundled-tools manifest".to_string(),
        ));
    }
    if expected_target != TARGET_TRIPLE || hex::encode(Sha256::digest(bytes)) != expected_digest {
        return Err(AppError::Plugin(
            "The bundled-tools manifest was changed after Denote was built".to_string(),
        ));
    }
    Ok(())
}

fn verify_executable(path: &Path, kind: ToolKind) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::Plugin(format!(
            "The {} executable must be a regular file",
            kind.name()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(AppError::Plugin(format!(
                "The {} executable is not executable. Fix its permissions or choose another path.",
                kind.name()
            )));
        }
    }
    probe(path, kind).map(|_| ())
}

fn probe(path: &Path, kind: ToolKind) -> AppResult<String> {
    let mut command = Command::new(path);
    command
        .arg(kind.probe_argument())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for name in [
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
    ] {
        command.env_remove(name);
    }
    let output = command.output().map_err(|error| {
        AppError::Plugin(format!(
            "Unable to start the {} executable: {error}",
            kind.name()
        ))
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or("").trim().to_string();
    if !output.status.success() || !line.starts_with(kind.version_prefix()) {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Plugin(format!(
            "The selected executable did not identify itself as {}. {}",
            kind.name(),
            detail.lines().next().unwrap_or("").trim()
        )));
    }
    Ok(line)
}

fn sha256_path(path: &Path) -> AppResult<String> {
    Ok(hex::encode(Sha256::digest(fs::read(path)?)))
}

fn verify_locked_file(path: &Path, record: &IntegrityFile) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file()
        || metadata.len() != record.size_bytes
        || sha256_path(path)? != record.sha256
    {
        return Err(AppError::Plugin(
            "Bundled resource digest mismatch".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use std::io::Write;
    use tar::{Builder, Header};
    use tempfile::tempdir;

    #[test]
    fn custom_paths_must_be_absolute_and_executable() {
        assert!(resolve_custom(ToolKind::Git, "relative/git").is_err());
        let directory = tempdir().expect("temp");
        let path = directory.path().join("git");
        fs::File::create(&path)
            .expect("create")
            .write_all(b"not executable")
            .expect("write");
        assert!(resolve_custom(ToolKind::Git, path.to_str().unwrap()).is_err());
    }

    #[test]
    fn disabled_github_cli_is_explicit() {
        let status = inspect(
            Path::new(""),
            Path::new(""),
            ToolKind::GitHubCli,
            ExecutableMode::Disabled,
            None,
        );
        assert_eq!(status.validation_status, "disabled");
        assert!(status.resolved_path.is_none());
    }

    #[test]
    fn corrupted_bundled_executable_is_rejected() {
        let directory = tempdir().expect("temp");
        let path = directory.path().join("git");
        fs::write(&path, b"synthetic executable").expect("write");
        let record = IntegrityFile {
            path: "git/bin/git".to_string(),
            size_bytes: 20,
            sha256: hex::encode(Sha256::digest(b"different bytes")),
        };
        assert!(verify_locked_file(&path, &record).is_err());
    }

    #[test]
    fn archive_paths_and_links_cannot_escape_the_tool_root() {
        assert!(validate_archive_path(Path::new("../git"), "git").is_err());
        assert!(validate_archive_path(Path::new("gh/bin/gh"), "git").is_err());
        assert!(
            validate_archive_link(
                Path::new("git/bin/alias"),
                Path::new("../../../outside"),
                "git",
                EntryType::Symlink,
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn verified_archive_extracts_atomically_and_runs_the_locked_executable() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp");
        let archive_path = directory.path().join("git.tar.gz");
        let encoder = GzEncoder::new(
            File::create(&archive_path).expect("archive"),
            Compression::default(),
        );
        let mut builder = Builder::new(encoder);
        let content = b"#!/bin/sh\necho 'git version 2.55.0'\n";
        let mut header = Header::new_gnu();
        header.set_path("git/bin/git").expect("path");
        header.set_size(content.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder.append(&header, content.as_slice()).expect("append");
        builder
            .into_inner()
            .expect("builder")
            .finish()
            .expect("gzip");

        let tool = IntegrityTool {
            version: "2.55.0".to_string(),
            archive_path: "git.tar.gz".to_string(),
            archive_root: "git".to_string(),
            executable_path: "git/bin/git".to_string(),
            executable_size_bytes: content.len() as u64,
            executable_sha256: hex::encode(Sha256::digest(content)),
        };
        let install = directory.path().join("installed");
        let executable = ensure_extracted(
            &archive_path,
            &install,
            ToolKind::Git,
            &tool,
            "synthetic-archive-digest",
        )
        .expect("extract");

        assert_eq!(
            fs::metadata(&executable)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o111,
            0o111
        );
        assert!(
            probe(&executable, ToolKind::Git)
                .expect("probe")
                .starts_with("git version 2.55.0")
        );
        assert_eq!(
            ensure_extracted(
                &archive_path,
                &install,
                ToolKind::Git,
                &tool,
                "synthetic-archive-digest",
            )
            .expect("reuse"),
            executable
        );
        fs::write(&executable, b"corrupted").expect("corrupt");
        assert!(
            ensure_extracted(
                &archive_path,
                &install,
                ToolKind::Git,
                &tool,
                "synthetic-archive-digest",
            )
            .is_err()
        );
    }

    #[test]
    fn prepared_release_resource_resolves_when_present() {
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        if !resources
            .join("tools")
            .join(TARGET_TRIPLE)
            .join("integrity.json")
            .exists()
        {
            return;
        }
        let install = tempdir().expect("install");
        let executable =
            resolve_bundled(&resources, install.path(), ToolKind::Git).expect("bundled Git");
        assert_eq!(
            probe(&executable, ToolKind::Git).expect("probe"),
            "git version 2.55.0"
        );
    }
}
