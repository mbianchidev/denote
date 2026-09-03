//! Host-owned askpass transport for authenticated Git remotes.
//!
//! Git asks for credentials by running the program named by `GIT_ASKPASS` with
//! the prompt as its only argument. Denote names itself, so no shell, helper
//! script, or third-party binary is ever involved, and answers from a private
//! temporary file that only this process wrote.
//!
//! A credential therefore never appears in an argument vector, in a URL, in
//! `.git/config`, in Git's output, in a log line, or in anything a plugin can
//! read. The file is created with owner-only permissions, is deleted when the
//! operation ends for any reason, and its contents are zeroized in memory.

use std::{
    env,
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use uuid::Uuid;
use zeroize::Zeroize;

use crate::error::{AppError, AppResult};

/// Marker that puts a Denote process into askpass mode. It is set only on the
/// exact Git child that needs it and is stripped from every other child.
pub(crate) const ASKPASS_MODE_ENV: &str = "DENOTE_GIT_ASKPASS_MODE";
/// Absolute path of the private file holding the answer.
pub(crate) const ASKPASS_FILE_ENV: &str = "DENOTE_GIT_ASKPASS_FILE";
pub(crate) const ASKPASS_CONTEXT_ENV: &str = "DENOTE_GIT_ASKPASS_CONTEXT";
/// Username Git should use for a GitHub HTTPS token. GitHub ignores the name
/// when the password is a token, so this is a constant, not a credential.
pub(crate) const GITHUB_TOKEN_USERNAME: &str = "x-access-token";

const ASKPASS_MODE_VALUE: &str = "1";
const ASKPASS_CONTEXT_GITHUB: &str = "github";
const ASKPASS_CONTEXT_SIGNING: &str = "signing";
const MAX_ASKPASS_FILE_BYTES: u64 = 16 * 1024;
/// The only hosts a Denote-managed GitHub token is ever offered to. The match
/// is exact and case-insensitive, so a subdomain, a suffix lookalike, a
/// trailing dot, or a host carrying a port is not one of them.
const GITHUB_PROMPT_HOSTS: &[&str] = &["github.com", "www.github.com"];
/// Git wraps the target it is asking about in single quotes:
/// `Username for 'https://github.com': `.
const PROMPT_QUOTE: char = '\'';
/// Every directory Denote writes a secret into is named with this prefix, so
/// startup recovery can recognise its own residue and nothing else.
const ASKPASS_DIRECTORY_PREFIX: &str = "askpass-";
const ASKPASS_SECRET_FILE: &str = "secret";

/// Answers one askpass prompt and reports whether this process was in askpass
/// mode at all.
///
/// It runs before any window, database, or plugin manager exists, so an
/// askpass invocation can never start a second Denote instance, and it writes
/// exactly one line to standard output.
pub fn run_askpass_if_requested() -> bool {
    if env::var_os(ASKPASS_MODE_ENV).as_deref() != Some(OsStr::new(ASKPASS_MODE_VALUE)) {
        return false;
    }
    let prompt = env::args().nth(1).unwrap_or_default();
    let file = env::var_os(ASKPASS_FILE_ENV).map(PathBuf::from);
    let mut answer = if env::var(ASKPASS_CONTEXT_ENV).as_deref() == Ok(ASKPASS_CONTEXT_SIGNING) {
        signing_askpass_answer(&prompt, file.as_deref())
    } else {
        askpass_answer(&prompt, file.as_deref())
    };
    // Standard output is the only channel Git reads. A failure is silent
    // because a diagnostic here would land in Git's stderr, which is reported
    // back to the plugin.
    let mut line = String::with_capacity(answer.len() + 1);
    line.push_str(&answer);
    line.push('\n');
    let _ = std::io::stdout().write_all(line.as_bytes());
    let _ = std::io::stdout().flush();
    line.zeroize();
    answer.zeroize();
    true
}

/// Reads the answer for one prompt.
///
/// The prompt itself is the authority, not the operation that created the
/// secret. Git names the target it is about to authenticate to, so the host in
/// that prompt is parsed here and an answer is produced only when it is
/// exactly `github.com` or `www.github.com` over HTTPS. A username prompt is
/// answered with the fixed placeholder GitHub expects, a password prompt with
/// the secret in the private file, and everything else with nothing.
///
/// This is what makes the binding safe against a remote that is repointed
/// after Denote validated it: the URL check that runs before a token is read
/// cannot see a change that lands later, but the prompt Git produces always
/// names the host Git is really contacting. An absent, malformed, non-HTTPS,
/// userinfo-confused, port-bearing, lookalike, or non-GitHub target answers
/// with nothing, so Git fails with its own authentication error rather than
/// offering a GitHub token to another host.
pub(crate) fn askpass_answer(prompt: &str, file: Option<&Path>) -> String {
    let Some(kind) = prompt_kind(prompt) else {
        return String::new();
    };
    if !prompt_targets_github_https(prompt) {
        return String::new();
    }

    match kind {
        PromptKind::Username => GITHUB_TOKEN_USERNAME.to_string(),
        PromptKind::Password => file.and_then(read_secret_file).unwrap_or_default(),
    }
}

pub(crate) fn signing_askpass_answer(prompt: &str, file: Option<&Path>) -> String {
    let label = prompt.to_ascii_lowercase();
    if !label.contains("passphrase") && !label.contains("pin for") {
        return String::new();
    }
    file.and_then(read_secret_file_exact).unwrap_or_default()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PromptKind {
    Username,
    Password,
}

/// Classifies a prompt from the label Git writes *before* the quoted target,
/// so a URL that happens to contain the word `username` or `password` cannot
/// change which answer is produced.
fn prompt_kind(prompt: &str) -> Option<PromptKind> {
    let label = prompt
        .split(PROMPT_QUOTE)
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if label.contains("username") {
        Some(PromptKind::Username)
    } else if label.contains("password") {
        Some(PromptKind::Password)
    } else {
        None
    }
}

/// Reports whether the target Git quoted in the prompt is a GitHub HTTPS
/// target and nothing else.
fn prompt_targets_github_https(prompt: &str) -> bool {
    let Some(target) = prompt_target(prompt) else {
        return false;
    };
    // The same validation every remote URL Denote accepts has already passed,
    // so a control character, an option-like value, an embedded password, or
    // an oversized target is refused here exactly as it is there.
    if super::git::validate_remote_url(target).is_err() {
        return false;
    }
    let Some(rest) = target.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = match authority.rsplit_once('@') {
        // Userinfo is allowed, but only a plain one. A second `@`, or a colon,
        // means the value is shaped to be read two ways, so it is refused
        // rather than resolved.
        Some((userinfo, host)) if !userinfo.contains([':', '@']) => host,
        Some(_) => return false,
        None => authority,
    };
    GITHUB_PROMPT_HOSTS
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
}

/// Extracts the single quoted target from a prompt. A prompt with no target,
/// or with more than one quoted span, yields nothing.
fn prompt_target(prompt: &str) -> Option<&str> {
    let (_, rest) = prompt.split_once(PROMPT_QUOTE)?;
    let (target, tail) = rest.split_once(PROMPT_QUOTE)?;
    if tail.contains(PROMPT_QUOTE) {
        return None;
    }
    Some(target)
}

fn read_secret_file(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ASKPASS_FILE_BYTES {
        return None;
    }

    let mut content = fs::read_to_string(path).ok()?;
    let answer = content.trim_end_matches(['\r', '\n']).to_string();
    content.zeroize();
    Some(answer)
}

fn read_secret_file_exact(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ASKPASS_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AskpassContext {
    Github,
    Signing,
}

/// One live askpass secret on disk.
///
/// The file is removed when this value is dropped, so the secret is gone when
/// the operation succeeds, fails, times out, or is cancelled. The directory is
/// removed with it, so nothing is left behind to be reused.
#[derive(Debug)]
pub(crate) struct AskpassMaterial {
    directory: PathBuf,
    file: PathBuf,
    program: PathBuf,
    context: AskpassContext,
}

impl AskpassMaterial {
    /// Writes one secret into a fresh owner-only directory beside the other
    /// host-owned Git support files.
    pub(crate) fn create(
        support_directory: &Path,
        program: PathBuf,
        secret: &str,
    ) -> AppResult<Self> {
        let directory =
            support_directory.join(format!("{ASKPASS_DIRECTORY_PREFIX}{}", Uuid::new_v4()));
        fs::create_dir_all(&directory)?;
        restrict_directory(&directory)?;
        let file = directory.join(ASKPASS_SECRET_FILE);
        write_secret(&file, secret)?;
        Ok(Self {
            directory,
            file,
            program,
            context: AskpassContext::Github,
        })
    }

    pub(crate) fn create_signing(
        support_directory: &Path,
        program: PathBuf,
        secret: &str,
    ) -> AppResult<Self> {
        let mut material = Self::create(support_directory, program, secret)?;
        material.context = AskpassContext::Signing;
        Ok(material)
    }

    /// The Denote executable Git will run for a prompt.
    pub(crate) fn program(&self) -> &Path {
        &self.program
    }

    pub(crate) fn file(&self) -> &Path {
        &self.file
    }
}

impl Drop for AskpassMaterial {
    fn drop(&mut self) {
        // Overwrite before unlinking so the bytes do not survive in a file the
        // filesystem has not reclaimed yet.
        if let Ok(metadata) = fs::symlink_metadata(&self.file)
            && metadata.is_file()
        {
            let _ = fs::write(&self.file, vec![0u8; metadata.len() as usize]);
        }
        let _ = fs::remove_file(&self.file);
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn write_secret(path: &Path, secret: &str) -> AppResult<()> {
    let mut file = create_private_file(path)?;
    file.write_all(secret.as_bytes())?;
    file.flush()?;
    Ok(())
}

#[cfg(unix)]
fn create_private_file(path: &Path) -> AppResult<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(Into::into)
}

#[cfg(not(unix))]
fn create_private_file(path: &Path) -> AppResult<fs::File> {
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(Into::into)
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(Into::into)
}

#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> AppResult<()> {
    Ok(())
}

/// Removes askpass material a previous run left behind.
///
/// A live operation always deletes its own material when it ends, so anything
/// still here belongs to a process that was killed or crashed. This is why it
/// runs exactly once, while the plugin manager is being constructed, after the
/// exclusive manager lock has been acquired and before any operation can
/// exist: an ordinary operation must never have its secret removed out from
/// under it, and a second Denote that loses the lock must never touch the
/// material the instance holding it is authenticating with.
///
/// Nothing is followed and nothing outside the support directory is touched. A
/// directory is removed only when it sits directly inside the support
/// directory, is a real directory rather than a link, and holds nothing but
/// the one regular `secret` file Denote writes. Anything else is left exactly
/// as it is, except a plain symbolic link wearing the reserved name, which is
/// unlinked without ever being followed.
pub(crate) fn remove_stale_material(support_directory: &Path) {
    let Ok(parent) = fs::canonicalize(support_directory) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_reserved = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(ASKPASS_DIRECTORY_PREFIX));
        if !is_reserved {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            // `remove_file` unlinks the link itself and never the target, so a
            // link planted under the reserved name cannot make recovery delete
            // anything anywhere else.
            let _ = fs::remove_file(&path);
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        // The resolved directory has to still be a direct child of the support
        // directory, so a path that was swapped between the listing and now is
        // refused rather than deleted.
        let Ok(canonical) = fs::canonicalize(&path) else {
            continue;
        };
        if canonical.parent() != Some(parent.as_path()) {
            continue;
        }
        if !holds_only_askpass_secret(&canonical) {
            continue;
        }
        let _ = fs::remove_dir_all(&canonical);
    }
}

/// Reports whether a directory holds nothing but the single regular secret
/// file Denote writes, so recovery never deletes a folder that only borrowed
/// the reserved name.
fn holds_only_askpass_secret(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return false;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            return false;
        };
        if entry.file_name() != OsStr::new(ASKPASS_SECRET_FILE) {
            return false;
        }
        match fs::symlink_metadata(entry.path()) {
            Ok(metadata)
                if metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && metadata.len() <= MAX_ASKPASS_FILE_BYTES => {}
            _ => return false,
        }
    }
    true
}

/// Resolves the running Denote executable, which is the only program Denote
/// will let Git run for a credential prompt.
pub(crate) fn askpass_program() -> AppResult<PathBuf> {
    let executable = env::current_exe().map_err(|error| {
        AppError::Plugin(format!(
            "Denote could not locate its own executable for authentication: {error}"
        ))
    })?;
    let canonical = fs::canonicalize(&executable).unwrap_or(executable);
    let metadata = fs::symlink_metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(AppError::Plugin(
            "Denote's executable is not a regular file, so authenticated Git is refused"
                .to_string(),
        ));
    }
    Ok(canonical)
}

/// Points one Git child at the askpass program. Applied after the shared
/// environment, which strips both markers, so only this child can answer a
/// prompt.
///
/// The child's locale is pinned to `C` because the answer now depends on
/// reading the prompt Git writes. A translated prompt would otherwise be
/// unrecognisable, and an unrecognised prompt is answered with nothing.
pub(crate) fn apply_askpass_environment(command: &mut Command, material: &AskpassMaterial) {
    command
        .env("LC_ALL", "C")
        .env_remove("LANGUAGE")
        .env(ASKPASS_MODE_ENV, ASKPASS_MODE_VALUE)
        .env(ASKPASS_FILE_ENV, material.file());
    match material.context {
        AskpassContext::Github => {
            command
                .env("GIT_ASKPASS", material.program())
                .env(ASKPASS_CONTEXT_ENV, ASKPASS_CONTEXT_GITHUB);
        }
        AskpassContext::Signing => {
            command
                .env("SSH_ASKPASS", material.program())
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env("DISPLAY", "denote-signing")
                .env(ASKPASS_CONTEXT_ENV, ASKPASS_CONTEXT_SIGNING);
        }
    }
}
