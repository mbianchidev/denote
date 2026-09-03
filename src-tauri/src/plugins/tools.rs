use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
const TARGET_TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";

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
    executable_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityFile {
    path: String,
    size_bytes: u64,
    sha256: String,
    executable: bool,
}

pub(crate) fn resolve_git(
    resource_dir: &Path,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    if mode == ExecutableMode::Disabled {
        return Err(AppError::Plugin(
            "Git cannot be disabled. Choose Bundled, System, or Custom in the Git plugin settings."
                .to_string(),
        ));
    }
    resolve(resource_dir, ToolKind::Git, mode, custom_path)
}

pub(crate) fn resolve_gh(
    resource_dir: &Path,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    if mode == ExecutableMode::Disabled {
        return Err(AppError::Plugin(
            "GitHub CLI is disabled. Choose Bundled, System, or Custom in the Git plugin settings before using GitHub sign-in."
                .to_string(),
        ));
    }
    resolve(resource_dir, ToolKind::GitHubCli, mode, custom_path)
}

pub(crate) fn inspect(
    resource_dir: &Path,
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
    match resolve(resource_dir, kind, mode, custom_path) {
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
    kind: ToolKind,
    mode: ExecutableMode,
    custom_path: Option<&str>,
) -> AppResult<PathBuf> {
    match mode {
        ExecutableMode::Disabled => Err(AppError::Plugin(format!("{} is disabled", kind.name()))),
        ExecutableMode::Bundled => resolve_bundled(resource_dir, kind),
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

fn resolve_bundled(resource_dir: &Path, kind: ToolKind) -> AppResult<PathBuf> {
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
        .find(|file| file.path == tool.executable_path)
        .ok_or_else(|| {
            AppError::Plugin(format!(
                "Bundled {} executable is missing from the integrity manifest",
                kind.name()
            ))
        })?;
    if !record.executable {
        return Err(AppError::Plugin(format!(
            "Bundled {} executable is not marked executable",
            kind.name()
        )));
    }
    let path = root.join(&tool.executable_path);
    let canonical_root = fs::canonicalize(&root)?;
    let canonical = fs::canonicalize(&path).map_err(|error| {
        AppError::Plugin(format!(
            "Bundled {} executable is unavailable: {error}",
            kind.name()
        ))
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(AppError::Plugin(format!(
            "Bundled {} executable escapes the signed resource directory",
            kind.name()
        )));
    }
    verify_locked_file(&canonical, record).map_err(|_| {
        AppError::Plugin(format!(
            "Bundled {} executable failed integrity verification. Reinstall Denote from an official signed installer.",
            kind.name()
        ))
    })?;
    verify_executable(&canonical, kind)?;
    Ok(canonical)
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
    use std::io::Write;
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
            executable: true,
        };
        assert!(verify_locked_file(&path, &record).is_err());
    }
}
