//! Host-owned repository cloning.
//!
//! A clone is the one Git operation that creates a whole vault, so the host
//! owns every part of it: the user picks the destination in a native chooser,
//! the host validates that the folder is empty, runs the same hardened Git the
//! rest of the transport uses, and refuses to register anything as a vault
//! until the checkout has been inspected. A plugin supplies a URL, an
//! authentication mode, and an optional branch, and receives an outcome that
//! never contains a path.

use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::plugins::PluginManager;

use super::{
    askpass::AskpassMaterial,
    transport::{
        GIT_TIMEOUT, GitDirectoryState, GitExecution, GitOperationToken, GitOutputMode,
        GitPlanStep, GitTransportPolicy, PluginGitAuthMode, PluginGitRequest, PluginGitScope,
        SystemGitSettings, apply_system_git_settings, assert_repository_config_is_safe, first_line,
        git_cli_path_string, read_system_git_settings, redact, resolve_git_directory,
        run_git_command, validate_branch_name, validate_remote_url_for,
    },
};

/// Ceiling for the post-clone inspection. A repository larger than this is
/// refused rather than half-inspected, because a partial inspection cannot
/// promise that no entry escapes the destination.
const MAX_INSPECTED_ENTRIES: usize = 200_000;
const MAX_INSPECTED_DEPTH: usize = 64;

/// Operational directories Denote owns inside a vault. A clone that carries
/// them would hand a new vault another machine's locks or trashed files.
const REFUSED_CONTROL_PATHS: &[&str] = &[".denote/locks", ".denote/trash"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGitCloneVaultRequest {
    pub url: String,
    #[serde(default)]
    pub auth_mode: PluginGitAuthMode,
    #[serde(default)]
    pub branch: Option<String>,
}

/// What a plugin learns about a clone.
///
/// A success reports a short label and the repository's own branch metadata,
/// never a path: the host renderer opens the vault itself. A failure reports an
/// opaque cleanup token instead of a path, so the only thing that can be asked
/// for is deletion of that exact destination.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PluginGitCloneVaultOutcome {
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Cloned {
        label: String,
        remote_url: String,
        branch: Option<String>,
        default_branch: Option<String>,
        upstream: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        message: String,
        cleanup_token: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGitCloneCleanupOutcome {
    pub cleaned: bool,
    pub message: String,
}

/// A checkout that passed every validation and may be registered as a vault.
#[derive(Debug)]
pub(crate) struct ValidatedClone {
    pub(crate) path: PathBuf,
    pub(crate) label: String,
    pub(crate) remote_url: String,
    pub(crate) branch: Option<String>,
    pub(crate) default_branch: Option<String>,
    pub(crate) upstream: Option<String>,
}

#[derive(Debug)]
pub(crate) enum CloneAttempt {
    Cloned(Box<ValidatedClone>),
    Failed {
        message: String,
        cleanup_token: Option<String>,
    },
}

/// One destination a clone failed in. The token is the only handle to it, and
/// it is bound to this exact canonical path and to the plugin that produced it.
pub(crate) struct CloneCleanupEntry {
    pub(crate) plugin_id: String,
    pub(crate) path: PathBuf,
}

#[derive(Default)]
pub(crate) struct CloneCleanupRegistry {
    entries: std::sync::Mutex<std::collections::HashMap<String, CloneCleanupEntry>>,
}

impl CloneCleanupRegistry {
    fn insert(&self, plugin_id: &str, path: PathBuf) -> Option<String> {
        let token = Uuid::new_v4().to_string();
        let mut entries = self.entries.lock().ok()?;
        entries.insert(
            token.clone(),
            CloneCleanupEntry {
                plugin_id: plugin_id.to_string(),
                path,
            },
        );
        Some(token)
    }

    /// Resolves a token for the plugin that owns it. A token from another
    /// plugin, or one that was already spent, resolves to nothing.
    fn resolve(&self, plugin_id: &str, token: &str) -> AppResult<Option<PathBuf>> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| AppError::State("Clone cleanup lock is poisoned".to_string()))?;
        Ok(entries
            .get(token)
            .filter(|entry| entry.plugin_id == plugin_id)
            .map(|entry| entry.path.clone()))
    }

    fn consume(&self, token: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(token);
        }
    }

    pub(crate) fn forget_plugin(&self, plugin_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, entry| entry.plugin_id != plugin_id);
        }
    }
}

impl PluginManager {
    /// Validates one chosen destination and clones into it.
    ///
    /// The destination is whatever the host's own folder chooser returned, so
    /// this is where it is proved to be a real, empty, non-symlinked directory
    /// before Git is allowed near it.
    pub(crate) fn clone_into_destination(
        &self,
        plugin_id: &str,
        request: &PluginGitCloneVaultRequest,
        destination: &Path,
        operation_id: &str,
        transport: GitTransportPolicy,
    ) -> AppResult<CloneAttempt> {
        self.enabled_permission(plugin_id, "git")?;
        validate_remote_url_for(&request.url, transport)?;
        if let Some(branch) = &request.branch {
            validate_branch_name(branch)?;
        }
        let destination = validate_empty_destination(destination)?;
        let operation = self.register_git_operation(plugin_id, operation_id)?;
        let executable = self.resolve_git_executable_for_plugin(plugin_id)?;
        if operation.token().is_cancelled() {
            return Ok(CloneAttempt::Failed {
                message: "The clone was cancelled before it started.".to_string(),
                cleanup_token: None,
            });
        }
        let policy = self.git_settings_policy(plugin_id)?;
        let system_settings = if policy.use_system_settings {
            read_system_git_settings(&executable)?
        } else {
            SystemGitSettings::default()
        };
        let policy_request = PluginGitRequest::Clone {
            scope: PluginGitScope::Vault,
            url: request.url.clone(),
            directory: "clone-destination".to_string(),
            branch: request.branch.clone(),
            auth_mode: request.auth_mode,
        };
        let mut clone_plan = vec![GitPlanStep::Command {
            args: clone_arguments(request, &destination),
            mutating: true,
            output: GitOutputMode::Redacted,
        }];
        apply_system_git_settings(&mut clone_plan, &policy_request, &policy, &system_settings)?;
        let clone_arguments = match clone_plan.remove(0) {
            GitPlanStep::Command { args, .. } => args,
            _ => unreachable!("clone policy keeps one command"),
        };
        let hooks_directory = self.git_hooks_directory()?;
        let global_config = self.git_global_config()?;
        // The operation is registered before any credential is read, so
        // cancelling it stops the GitHub CLI too, and the guard unregisters it
        // however this function returns. Credential material is created before
        // Git starts and destroyed when it goes out of scope, whichever way
        // the clone ends.
        let token = operation.token();
        let askpass = self.authentication_material(
            plugin_id,
            request.auth_mode,
            std::slice::from_ref(&request.url),
            Some(token),
        )?;
        let execution = GitExecution {
            executable: &executable,
            repository_root: &destination,
            hooks_directory: &hooks_directory,
            global_config: &global_config,
            redacted_roots: vec![destination.clone()],
            askpass: askpass.as_ref(),
            encrypted: false,
            transport,
        };
        match self.run_clone(&execution, &destination, &clone_arguments, token) {
            Ok(attempt) => Ok(attempt),
            Err(error) => Ok(CloneAttempt::Failed {
                message: error.to_string(),
                cleanup_token: self.mint_cleanup_token(plugin_id, &destination),
            }),
        }
    }

    fn run_clone(
        &self,
        execution: &GitExecution<'_>,
        destination: &Path,
        arguments: &[String],
        token: &GitOperationToken,
    ) -> AppResult<CloneAttempt> {
        let deadline = Instant::now() + GIT_TIMEOUT;
        let outcome = run_git_command(arguments, execution, token, deadline, true)?;
        if outcome.cancelled || token.is_cancelled() {
            return Ok(CloneAttempt::Failed {
                message: "The clone was cancelled before it finished.".to_string(),
                cleanup_token: self.mint_cleanup_token(&plugin_of(token), destination),
            });
        }
        if outcome.exit_code != 0 {
            let detail = redact(
                &String::from_utf8_lossy(&outcome.stderr),
                &execution.redacted_roots,
            );
            return Ok(CloneAttempt::Failed {
                message: format!(
                    "Git could not clone this repository. {}",
                    first_line(&detail)
                ),
                cleanup_token: self.mint_cleanup_token(&plugin_of(token), destination),
            });
        }
        match validate_clone(execution, destination, token, deadline) {
            Ok(validated) => Ok(CloneAttempt::Cloned(Box::new(validated))),
            Err(error) => Ok(CloneAttempt::Failed {
                message: error.to_string(),
                cleanup_token: self.mint_cleanup_token(&plugin_of(token), destination),
            }),
        }
    }

    pub(crate) fn mint_cleanup_token(&self, plugin_id: &str, destination: &Path) -> Option<String> {
        // Nothing was created, so there is nothing to clean and no token to
        // hand out that could later be pointed at a folder the user filled.
        if directory_is_empty(destination).unwrap_or(false) {
            return None;
        }
        self.inner
            .clone_cleanups
            .insert(plugin_id, destination.to_path_buf())
    }

    /// Deletes the destination of a failed clone, named only by its token.
    ///
    /// The recorded path is revalidated first: it has to still be a real
    /// directory that looks like the failed clone, so a token can never delete
    /// a folder the user has since made into something else.
    pub(crate) fn clean_failed_clone(
        &self,
        plugin_id: &str,
        token: &str,
        protected: &[PathBuf],
    ) -> AppResult<PluginGitCloneCleanupOutcome> {
        self.enabled_permission(plugin_id, "git")?;
        let Some(path) = self.inner.clone_cleanups.resolve(plugin_id, token)? else {
            return Ok(PluginGitCloneCleanupOutcome {
                cleaned: false,
                message:
                    "This clean-up is no longer available. It was already used, or it belongs to a different repository."
                        .to_string(),
            });
        };
        if let Err(error) = revalidate_failed_clone(&path, protected) {
            self.inner.clone_cleanups.consume(token);
            return Ok(PluginGitCloneCleanupOutcome {
                cleaned: false,
                message: error.to_string(),
            });
        }
        fs::remove_dir_all(&path)?;
        self.inner.clone_cleanups.consume(token);
        Ok(PluginGitCloneCleanupOutcome {
            cleaned: true,
            message: "Denote deleted the incomplete clone folder.".to_string(),
        })
    }

    /// Builds credential material for one remote operation.
    ///
    /// `public` and `ssh-agent` need none: the hardened invocation already
    /// refuses to prompt, so an unconfigured SSH agent fails with Git's own
    /// error instead of hanging on a prompt. `github-https` reads a token
    /// through the host's GitHub adapter and never returns it to the caller.
    ///
    /// Every URL the operation will actually contact has to be a GitHub HTTPS
    /// URL. A remote with a separate push URL, or with several URLs, is
    /// checked in full, so a token is never created for an operation that
    /// would offer it to another host.
    pub(crate) fn authentication_material(
        &self,
        plugin_id: &str,
        mode: PluginGitAuthMode,
        urls: &[String],
        cancellation: Option<&GitOperationToken>,
    ) -> AppResult<Option<AskpassMaterial>> {
        match mode {
            PluginGitAuthMode::System | PluginGitAuthMode::Public | PluginGitAuthMode::SshAgent => {
                Ok(None)
            }
            PluginGitAuthMode::GithubHttps => {
                if urls.is_empty() || !urls.iter().all(|url| is_github_https_url(url)) {
                    return Err(AppError::Plugin(
                        "GitHub sign-in only applies to https://github.com remotes. Choose public or SSH agent authentication for this remote."
                            .to_string(),
                    ));
                }
                let executable = self.resolve_github_executable_for_plugin(plugin_id)?;
                let token = super::github::auth_token(&executable, cancellation)?;
                let program = super::askpass::askpass_program()?;
                Ok(Some(AskpassMaterial::create(
                    &self.git_support_directory()?,
                    program,
                    &token,
                )?))
            }
        }
    }
}

/// A token that reaches here always belongs to the operation that is running,
/// so the plugin it was registered under is the one that owns the destination.
fn plugin_of(token: &GitOperationToken) -> String {
    token.plugin_id.clone()
}

pub(crate) fn is_github_https_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = host.split(':').next().unwrap_or_default();
    host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("www.github.com")
}

/// The fixed clone template. No hooks, no filters, no submodules, no local
/// object sharing, and no protocol beyond the ones the hardened invocation
/// already allows.
pub(crate) fn clone_arguments(
    request: &PluginGitCloneVaultRequest,
    destination: &Path,
) -> Vec<String> {
    let mut args = vec![
        "clone".to_string(),
        "--no-recurse-submodules".to_string(),
        "--no-local".to_string(),
        "--no-hardlinks".to_string(),
    ];
    if let Some(branch) = &request.branch {
        args.push("--branch".to_string());
        args.push(branch.clone());
    }
    args.push("--".to_string());
    args.push(if Path::new(&request.url).is_absolute() {
        git_cli_path_string(Path::new(&request.url))
    } else {
        request.url.clone()
    });
    args.push(git_cli_path_string(destination));
    args
}

/// Proves the chooser returned a folder Denote may clone into: a real, empty
/// directory that is not a symbolic link and not an existing repository.
pub(crate) fn validate_empty_destination(destination: &Path) -> AppResult<PathBuf> {
    let metadata = fs::symlink_metadata(destination).map_err(|error| {
        AppError::Plugin(format!("Denote cannot read the chosen folder: {error}"))
    })?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::Plugin(
            "Denote will not clone into a symbolic link. Choose a real folder.".to_string(),
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::Plugin(
            "The clone destination must be a folder.".to_string(),
        ));
    }
    let canonical = fs::canonicalize(destination)?;
    if !directory_is_empty(&canonical)? {
        return Err(AppError::Plugin(
            "The clone destination must be an empty folder. Create a new folder and choose that."
                .to_string(),
        ));
    }
    Ok(canonical)
}

fn directory_is_empty(path: &Path) -> AppResult<bool> {
    Ok(fs::read_dir(path)?.next().is_none())
}

/// Confirms that a destination still holds the failed clone and nothing else
/// that matters. Anything the user has since put there stops the deletion.
fn revalidate_failed_clone(path: &Path, protected: &[PathBuf]) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::Plugin(format!(
            "The incomplete clone folder is no longer readable: {error}"
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::Plugin(
            "The incomplete clone is no longer a folder, so Denote left it alone.".to_string(),
        ));
    }
    let canonical = fs::canonicalize(path)?;
    if canonical != path {
        return Err(AppError::Plugin(
            "The incomplete clone folder moved, so Denote left it alone.".to_string(),
        ));
    }
    for reserved in protected {
        if canonical == *reserved
            || canonical.starts_with(reserved)
            || reserved.starts_with(&canonical)
        {
            return Err(AppError::Plugin(
                "That folder is in use as a vault, so Denote will not delete it.".to_string(),
            ));
        }
    }
    // A failed clone holds Git's own partial work and nothing else. Anything
    // that is not a `.git` directory means the folder is no longer the failure
    // this token described.
    let mut entries = Vec::new();
    for entry in fs::read_dir(&canonical)? {
        entries.push(entry?.file_name());
    }
    if entries.is_empty() {
        return Ok(());
    }
    if entries.len() == 1 && entries[0] == std::ffi::OsStr::new(".git") {
        return Ok(());
    }
    Err(AppError::Plugin(
        "That folder now holds files that did not come from the failed clone, so Denote will not delete it."
            .to_string(),
    ))
}

/// Inspects a finished clone before anything registers it as a vault.
fn validate_clone(
    execution: &GitExecution<'_>,
    destination: &Path,
    token: &GitOperationToken,
    deadline: Instant,
) -> AppResult<ValidatedClone> {
    if resolve_git_directory(destination)? != GitDirectoryState::Directory {
        return Err(AppError::Plugin(
            "The clone did not produce an ordinary Git repository.".to_string(),
        ));
    }
    assert_repository_config_is_safe(&destination.join(".git"))?;
    inspect_checkout(destination)?;
    let head = read_value(
        execution,
        token,
        deadline,
        &["rev-parse", "--verify", "HEAD"],
    )?;
    if head.is_none() {
        return Err(AppError::Plugin(
            "The clone has no checked-out commit, so Denote cannot open it as a vault.".to_string(),
        ));
    }
    let remote_url = read_value(execution, token, deadline, &["remote", "get-url", "origin"])?
        .ok_or_else(|| {
            AppError::Plugin(
                "The clone has no origin remote, so Denote cannot open it as a vault.".to_string(),
            )
        })?;
    let branch = read_value(
        execution,
        token,
        deadline,
        &["symbolic-ref", "--short", "HEAD"],
    )?;
    let default_branch = read_value(
        execution,
        token,
        deadline,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )?
    .map(|value| value.trim_start_matches("origin/").to_string());
    let upstream = read_value(
        execution,
        token,
        deadline,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )?;
    let label = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Cloned repository".to_string());
    Ok(ValidatedClone {
        path: destination.to_path_buf(),
        label,
        remote_url,
        branch,
        default_branch,
        upstream,
    })
}

/// Runs one read-only inspection command and returns its single-line output,
/// or nothing when the command reports that the value does not exist.
fn read_value(
    execution: &GitExecution<'_>,
    token: &GitOperationToken,
    deadline: Instant,
    args: &[&str],
) -> AppResult<Option<String>> {
    let arguments: Vec<String> = args.iter().map(|value| (*value).to_string()).collect();
    let outcome = run_git_command(&arguments, execution, token, deadline, false)?;
    if outcome.cancelled {
        return Err(AppError::Plugin(
            "The clone was cancelled while Denote was checking it.".to_string(),
        ));
    }
    if outcome.exit_code != 0 {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

/// Walks the checkout and refuses anything Denote will not open as a vault: a
/// symbolic link that leaves the folder, and Denote's own operational control
/// directories arriving as tracked content.
fn inspect_checkout(destination: &Path) -> AppResult<()> {
    for reserved in REFUSED_CONTROL_PATHS {
        if destination.join(reserved).exists() {
            return Err(AppError::Plugin(format!(
                "This repository tracks {reserved}, which Denote manages itself. Denote will not open it as a vault."
            )));
        }
    }
    let control = destination.join(".denote");
    match fs::symlink_metadata(&control) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AppError::Plugin(
                "This repository replaces Denote's .denote folder, so Denote will not open it as a vault."
                    .to_string(),
            ));
        }
        _ => {}
    }
    let mut stack = vec![(destination.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((directory, depth)) = stack.pop() {
        if depth > MAX_INSPECTED_DEPTH {
            return Err(AppError::Plugin(
                "This repository nests folders deeper than Denote inspects, so it was not opened."
                    .to_string(),
            ));
        }
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            visited += 1;
            if visited > MAX_INSPECTED_ENTRIES {
                return Err(AppError::Plugin(
                    "This repository holds more files than Denote can check before opening it."
                        .to_string(),
                ));
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                let target = fs::read_link(&path)?;
                let resolved = if target.is_absolute() {
                    target
                } else {
                    directory.join(target)
                };
                if !normalize(&resolved).starts_with(destination) {
                    return Err(AppError::Plugin(
                        "This repository contains a link that points outside the folder, so Denote will not open it as a vault."
                            .to_string(),
                    ));
                }
                continue;
            }
            if metadata.is_dir() {
                // `.git` is Git's own storage, already proved to be an
                // ordinary directory, and is never part of the vault tree.
                if path.file_name() == Some(std::ffi::OsStr::new(".git")) && depth == 0 {
                    continue;
                }
                stack.push((path, depth + 1));
            }
        }
    }
    Ok(())
}

/// Resolves `.` and `..` textually. The target of a symbolic link may not
/// exist, so it cannot be canonicalized, and a textual resolution is what
/// decides whether following it would leave the folder.
fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized
}
