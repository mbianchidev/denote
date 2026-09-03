//! Host-owned GitHub adapter.
//!
//! Denote resolves and pins the GitHub CLI itself, runs it with a fixed
//! argument template and a stripped environment, and converts its output into
//! bounded structured metadata. A plugin can ask for a repository list and can
//! name `github-https` as an authentication mode; it never receives, and never
//! sends, a token.

use std::{
    ffi::OsStr,
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};
#[cfg(test)]
use std::path::PathBuf;

use command_group::CommandGroup;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    git::{GitOperationToken, first_line},
};

/// Ceiling for one adapter invocation. A listing is a small metadata read and
/// a token read is smaller still, so this is far below the Git limit.
const GH_TIMEOUT: Duration = Duration::from_secs(60);
const GH_OUTPUT_LIMIT: u64 = 1024 * 1024;
const MAX_TOKEN_BYTES: usize = 4096;
pub(crate) const MAX_REPOSITORY_LIMIT: u32 = 200;
const MAX_FIELD_BYTES: usize = 512;

/// Bounded repository metadata. Nothing else from `gh` is kept, so no
/// description, topic, or other free text ever reaches a plugin.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    pub name_with_owner: String,
    pub https_url: String,
    pub ssh_url: String,
    pub default_branch: Option<String>,
    pub private: bool,
}

#[derive(Debug, Deserialize)]
struct GhDefaultBranch {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhRepository {
    name_with_owner: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    ssh_url: Option<String>,
    #[serde(default)]
    default_branch_ref: Option<GhDefaultBranch>,
    #[serde(default)]
    is_private: bool,
}

/// Resolves and pins one canonical GitHub CLI executable. `PATH` is never
/// searched, and a custom executable, which only ever comes from the
/// host-owned persisted `githubExecutablePath` setting, must be an absolute,
/// canonical, regular file that identifies itself as `gh`.
#[cfg(test)]
pub(crate) fn resolve_gh_executable(configured: Option<&str>) -> AppResult<PathBuf> {
    super::tools::resolve_gh(
        Path::new(""),
        if configured.is_some() {
            super::tools::ExecutableMode::Custom
        } else {
            super::tools::ExecutableMode::System
        },
        configured,
    )
}

/// Lists repositories the authenticated account can reach. The listing is
/// bounded on both sides: `gh` is asked for at most `limit` entries and only
/// the five fixed fields, and anything unparseable or oversized is dropped
/// rather than forwarded.
pub(crate) fn list_repositories(
    executable: &Path,
    limit: u32,
    token: Option<&GitOperationToken>,
) -> AppResult<Vec<GitHubRepository>> {
    if limit == 0 || limit > MAX_REPOSITORY_LIMIT {
        return Err(AppError::Plugin(format!(
            "The repository limit must be between 1 and {MAX_REPOSITORY_LIMIT}"
        )));
    }
    let outcome = run_gh(
        executable,
        &[
            "repo".to_string(),
            "list".to_string(),
            "--limit".to_string(),
            limit.to_string(),
            "--json".to_string(),
            "nameWithOwner,url,sshUrl,defaultBranchRef,isPrivate".to_string(),
        ],
        token,
    )?;
    if outcome.exit_code != 0 {
        return Err(AppError::Plugin(format!(
            "The GitHub CLI could not list repositories. {}",
            first_line(&String::from_utf8_lossy(&outcome.stderr))
        )));
    }
    parse_repository_list(&String::from_utf8_lossy(&outcome.stdout), limit)
}

pub(crate) fn parse_repository_list(stdout: &str, limit: u32) -> AppResult<Vec<GitHubRepository>> {
    let parsed: Vec<GhRepository> = serde_json::from_str(stdout.trim()).map_err(|error| {
        AppError::Plugin(format!(
            "The GitHub CLI returned a repository list Denote cannot read: {error}"
        ))
    })?;
    let mut repositories = Vec::new();
    for entry in parsed.into_iter().take(limit as usize) {
        let Some(repository) = bounded_repository(entry) else {
            continue;
        };
        repositories.push(repository);
    }
    Ok(repositories)
}

/// Keeps only entries whose every field is short, control-free, and shaped the
/// way Denote's own Git validation already requires.
fn bounded_repository(entry: GhRepository) -> Option<GitHubRepository> {
    let name_with_owner = bounded_field(&entry.name_with_owner)?;
    if !name_with_owner.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '/')
    }) || name_with_owner.matches('/').count() != 1
    {
        return None;
    }
    let https_url = bounded_field(&entry.url?)?;
    let ssh_url = bounded_field(&entry.ssh_url?)?;
    if super::git::validate_remote_url(&https_url).is_err()
        || super::git::validate_remote_url(&ssh_url).is_err()
    {
        return None;
    }
    let default_branch = entry
        .default_branch_ref
        .and_then(|branch| branch.name)
        .and_then(|name| bounded_field(&name))
        .filter(|name| super::git::validate_branch_name(name).is_ok());
    Some(GitHubRepository {
        name_with_owner,
        https_url,
        ssh_url,
        default_branch,
        private: entry.is_private,
    })
}

fn bounded_field(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_FIELD_BYTES
        || trimmed.chars().any(char::is_control)
    {
        return None;
    }
    Some(trimmed.to_string())
}

/// Reads the GitHub token for the current account.
///
/// The value never leaves the native host: it is held in a zeroizing buffer,
/// written only into the private askpass file, and dropped as soon as the
/// operation ends.
pub(crate) fn auth_token(
    executable: &Path,
    token: Option<&GitOperationToken>,
) -> AppResult<Zeroizing<String>> {
    let outcome = run_gh(
        executable,
        &["auth".to_string(), "token".to_string()],
        token,
    )?;
    if outcome.exit_code != 0 {
        return Err(AppError::Plugin(
            "The GitHub CLI is not authenticated. Run `gh auth login` in your terminal, then try again."
                .to_string(),
        ));
    }
    let mut raw = Zeroizing::new(String::from_utf8_lossy(&outcome.stdout).into_owned());
    let token = Zeroizing::new(raw.trim().to_string());
    raw.clear();
    if token.is_empty() || token.len() > MAX_TOKEN_BYTES || token.contains(char::is_whitespace) {
        return Err(AppError::Plugin(
            "The GitHub CLI did not return a usable token.".to_string(),
        ));
    }
    Ok(token)
}

struct GhOutcome {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// Runs `gh` directly, with no shell, no inherited Git or GitHub environment,
/// and no standard input.
///
/// Output is written straight into private temporary files, exactly as Git's
/// output is, so the child can never block on a pipe nobody is draining while
/// this thread waits for it to exit. The sizes are polled during the wait and
/// re-checked once the process is gone, so output that arrives entirely
/// between two polls is still bounded rather than silently truncated.
///
/// The child is started in its own process group and is killed, with every
/// descendant, when the operation is cancelled or the one minute bound passes,
/// so disabling the plugin or closing Denote never leaves the GitHub CLI
/// running.
fn run_gh(
    executable: &Path,
    args: &[String],
    cancellation: Option<&GitOperationToken>,
) -> AppResult<GhOutcome> {
    let mut stdout_file = tempfile::tempfile()?;
    let mut stderr_file = tempfile::tempfile()?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file.try_clone()?))
        .stderr(Stdio::from(stderr_file.try_clone()?));
    remove_inherited_environment(&mut command);
    command
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("PAGER", "cat")
        .env("CLICOLOR", "0")
        .env("NO_COLOR", "1");
    let mut child = command
        .group_spawn()
        .map_err(|error| AppError::Plugin(format!("Unable to start the GitHub CLI: {error}")))?;
    let deadline = std::time::Instant::now() + GH_TIMEOUT;
    let mut output_exceeded = false;
    let status = loop {
        match child.inner().try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                return Err(AppError::Plugin(format!(
                    "Unable to wait for the GitHub CLI: {error}"
                )));
            }
        }
        output_exceeded = stdout_file.metadata()?.len() > GH_OUTPUT_LIMIT
            || stderr_file.metadata()?.len() > GH_OUTPUT_LIMIT;
        let cancelled = cancellation.is_some_and(GitOperationToken::is_cancelled);
        if output_exceeded || cancelled || std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Plugin(if output_exceeded {
                "The GitHub CLI produced more than 1 MiB of output".to_string()
            } else if cancelled {
                "The GitHub CLI request was cancelled".to_string()
            } else {
                "The GitHub CLI did not finish within one minute and was stopped".to_string()
            }));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // A fast command can write everything it produces between two polls, so
    // the final sizes are always re-checked once the process is gone.
    if output_exceeded
        || stdout_file.metadata()?.len() > GH_OUTPUT_LIMIT
        || stderr_file.metadata()?.len() > GH_OUTPUT_LIMIT
    {
        return Err(AppError::Plugin(
            "The GitHub CLI produced more than 1 MiB of output".to_string(),
        ));
    }
    stdout_file.seek(SeekFrom::Start(0))?;
    stderr_file.seek(SeekFrom::Start(0))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    stdout_file
        .take(GH_OUTPUT_LIMIT + 1)
        .read_to_end(&mut stdout)?;
    stderr_file
        .take(GH_OUTPUT_LIMIT + 1)
        .read_to_end(&mut stderr)?;
    if stdout.len() as u64 > GH_OUTPUT_LIMIT || stderr.len() as u64 > GH_OUTPUT_LIMIT {
        return Err(AppError::Plugin(
            "The GitHub CLI produced more than 1 MiB of output".to_string(),
        ));
    }
    Ok(GhOutcome {
        exit_code: status.code().unwrap_or(-1),
        stdout,
        stderr,
    })
}

/// Ambient GitHub and Git variables are stripped so an inherited token, host,
/// or configuration file cannot silently change which account Denote reads.
const REMOVED_GH_ENVIRONMENT: &[&str] = &[
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GH_CONFIG_DIR",
    "GH_EDITOR",
    "GH_BROWSER",
    "GH_PAGER",
    "GH_FORCE_TTY",
    "GH_REPO",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    super::askpass::ASKPASS_MODE_ENV,
    super::askpass::ASKPASS_FILE_ENV,
];

fn remove_inherited_environment(command: &mut Command) {
    for name in REMOVED_GH_ENVIRONMENT {
        command.env_remove(OsStr::new(name));
    }
}

impl PluginManager {
    /// Lists repositories under the caller's own registered operation, so the
    /// plugin can publish the ID and cancel a browse while it is running, and
    /// so disabling the plugin or closing Denote stops the GitHub CLI the same
    /// way it stops Git.
    pub(crate) fn list_github_repositories(
        &self,
        plugin_id: &str,
        limit: u32,
        operation_id: &str,
    ) -> AppResult<Vec<GitHubRepository>> {
        self.enabled_permission(plugin_id, "git")?;
        let operation = self.register_git_operation(plugin_id, operation_id)?;
        let executable = self.resolve_github_executable_for_plugin(plugin_id)?;
        if operation.token().is_cancelled() {
            return Err(AppError::Plugin(
                "The GitHub CLI request was cancelled before it started".to_string(),
            ));
        }
        list_repositories(&executable, limit, Some(operation.token()))
    }
}
