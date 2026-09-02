//! Typed, hardened Git transport.
//!
//! Every plugin request names one fixed operation with structured fields. This
//! module maps each operation to a fixed argument template, so a plugin never
//! supplies raw arguments, option flags, environment values, or shell input.
//! Git is always executed directly through `std::process::Command`; no shell,
//! hook, filter, pager, editor, or credential helper is ever run on its behalf.

use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use command_group::{CommandGroup, GroupChild};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Hard ceiling for one Git operation, matching the extended source-control
/// action lease in the renderer.
pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(600);
const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;
const MAX_MESSAGE_BYTES: usize = 20 * 1024;
const MAX_AUTHOR_BYTES: usize = 255;
const MAX_PATHS: usize = 500;
const MAX_PATH_BYTES: usize = 1024;
const MAX_REF_BYTES: usize = 255;
const MAX_URL_BYTES: usize = 2048;
const MAX_HISTORY_COUNT: u32 = 1000;
const MAX_SKIP: u32 = 100_000;
const MAX_STASH_ENTRY: u32 = 1000;
const MAX_RESOLVED_CONTENT_BYTES: usize = 32 * 1024 * 1024;
/// Ceiling for snapshotting a file before conflict resolution replaces it.
const MAX_ROLLBACK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

const ATTRIBUTES_BEGIN: &str = "# BEGIN Denote encrypted vault (managed)";
const ATTRIBUTES_END: &str = "# END Denote encrypted vault (managed)";
const EXCLUDE_BEGIN: &str = "# BEGIN Denote operational excludes (managed)";
const EXCLUDE_END: &str = "# END Denote operational excludes (managed)";

const ENCRYPTED_ATTRIBUTES: &[&str] = &[
    "# Encrypted vault content is ciphertext. Git must never treat it as text,",
    "# diff it, or write conflict markers into it. The encryption manifest is",
    "# tracked like any other file and is covered by these rules too, so Git can",
    "# never line-merge wrapped-key metadata.",
    "* binary",
    "* -text",
    "* -diff",
    "* -merge",
    "* -textconv",
];

const OPERATIONAL_EXCLUDES: &[&str] = &[
    ".denote/locks/",
    ".denote/trash/",
    ".*.denote-tmp",
    ".*.denote-backup",
    ".*.denote-create",
];

// ---------------------------------------------------------------------------
// Request model
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitScope {
    Vault,
    Project,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitSequencer {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitConflictStage {
    Base,
    Ours,
    Theirs,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitStashAction {
    Push,
    Pop,
    Apply,
    Drop,
    List,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitPullStrategy {
    Merge,
    Rebase,
    FastForwardOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginGitPushMode {
    Normal,
    ForceWithLease,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PluginGitDiffTarget {
    Worktree,
    Index,
    Commit {
        commit: String,
    },
    Range {
        from_commit: String,
        to_commit: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PluginGitConflictResolution {
    Stage { stage: PluginGitConflictStage },
    Content { content_base64: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PluginGitRequest {
    Discover {
        scope: PluginGitScope,
    },
    Status {
        scope: PluginGitScope,
    },
    OperationState {
        scope: PluginGitScope,
    },
    Initialize {
        scope: PluginGitScope,
        default_branch: String,
    },
    Stage {
        scope: PluginGitScope,
        paths: Vec<String>,
    },
    Unstage {
        scope: PluginGitScope,
        paths: Vec<String>,
    },
    Commit {
        scope: PluginGitScope,
        message: String,
        #[serde(default)]
        amend: bool,
        #[serde(default)]
        allow_empty: bool,
        #[serde(default)]
        author_name: Option<String>,
        #[serde(default)]
        author_email: Option<String>,
    },
    ListBranches {
        scope: PluginGitScope,
    },
    ListRemotes {
        scope: PluginGitScope,
    },
    ListHistory {
        scope: PluginGitScope,
        max_count: u32,
        #[serde(default)]
        skip: Option<u32>,
        #[serde(default)]
        r#ref: Option<String>,
        #[serde(default)]
        path: Option<String>,
    },
    Diff {
        scope: PluginGitScope,
        target: PluginGitDiffTarget,
        #[serde(default)]
        paths: Option<Vec<String>>,
    },
    Fetch {
        scope: PluginGitScope,
        remote: String,
        #[serde(default)]
        prune: bool,
    },
    Pull {
        scope: PluginGitScope,
        remote: String,
        branch: String,
        strategy: PluginGitPullStrategy,
    },
    Push {
        scope: PluginGitScope,
        remote: String,
        branch: String,
        #[serde(default)]
        set_upstream: bool,
        #[serde(default)]
        mode: Option<PluginGitPushMode>,
    },
    AddRemote {
        scope: PluginGitScope,
        name: String,
        url: String,
    },
    SetRemoteUrl {
        scope: PluginGitScope,
        name: String,
        url: String,
    },
    RemoveRemote {
        scope: PluginGitScope,
        name: String,
    },
    CreateBranch {
        scope: PluginGitScope,
        name: String,
        #[serde(default)]
        start_point: Option<String>,
        #[serde(default)]
        checkout: bool,
    },
    CheckoutBranch {
        scope: PluginGitScope,
        name: String,
    },
    RenameBranch {
        scope: PluginGitScope,
        name: String,
        new_name: String,
    },
    DeleteBranch {
        scope: PluginGitScope,
        name: String,
        #[serde(default)]
        force: bool,
    },
    Stash {
        scope: PluginGitScope,
        action: PluginGitStashAction,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        include_untracked: bool,
        #[serde(default)]
        entry: Option<u32>,
    },
    Merge {
        scope: PluginGitScope,
        r#ref: String,
        #[serde(default)]
        fast_forward_only: bool,
        #[serde(default)]
        no_commit: bool,
    },
    Rebase {
        scope: PluginGitScope,
        upstream: String,
    },
    CherryPick {
        scope: PluginGitScope,
        commit: String,
    },
    Revert {
        scope: PluginGitScope,
        commit: String,
    },
    Continue {
        scope: PluginGitScope,
        sequencer: PluginGitSequencer,
    },
    Skip {
        scope: PluginGitScope,
        sequencer: PluginGitSequencer,
    },
    Abort {
        scope: PluginGitScope,
        sequencer: PluginGitSequencer,
    },
    ReadConflictStage {
        scope: PluginGitScope,
        path: String,
        stage: PluginGitConflictStage,
    },
    ResolveConflict {
        scope: PluginGitScope,
        path: String,
        resolution: PluginGitConflictResolution,
    },
    Clone {
        scope: PluginGitScope,
        url: String,
        directory: String,
        #[serde(default)]
        branch: Option<String>,
    },
    Cancel {
        operation_id: String,
    },
}

impl PluginGitRequest {
    pub(crate) fn scope(&self) -> Option<PluginGitScope> {
        match self {
            Self::Discover { scope }
            | Self::Status { scope }
            | Self::OperationState { scope }
            | Self::Initialize { scope, .. }
            | Self::Stage { scope, .. }
            | Self::Unstage { scope, .. }
            | Self::Commit { scope, .. }
            | Self::ListBranches { scope }
            | Self::ListRemotes { scope }
            | Self::ListHistory { scope, .. }
            | Self::Diff { scope, .. }
            | Self::Fetch { scope, .. }
            | Self::Pull { scope, .. }
            | Self::Push { scope, .. }
            | Self::AddRemote { scope, .. }
            | Self::SetRemoteUrl { scope, .. }
            | Self::RemoveRemote { scope, .. }
            | Self::CreateBranch { scope, .. }
            | Self::CheckoutBranch { scope, .. }
            | Self::RenameBranch { scope, .. }
            | Self::DeleteBranch { scope, .. }
            | Self::Stash { scope, .. }
            | Self::Merge { scope, .. }
            | Self::Rebase { scope, .. }
            | Self::CherryPick { scope, .. }
            | Self::Revert { scope, .. }
            | Self::Continue { scope, .. }
            | Self::Skip { scope, .. }
            | Self::Abort { scope, .. }
            | Self::ReadConflictStage { scope, .. }
            | Self::ResolveConflict { scope, .. }
            | Self::Clone { scope, .. } => Some(*scope),
            Self::Cancel { .. } => None,
        }
    }

    /// Discovery reports whether a repository exists, and `initialize` and
    /// `clone` create one, so those are the only operations allowed to run
    /// where no repository exists yet.
    pub(crate) fn requires_existing_repository(&self) -> bool {
        !matches!(
            self,
            Self::Discover { .. }
                | Self::OperationState { .. }
                | Self::Initialize { .. }
                | Self::Clone { .. }
        )
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGitResult {
    pub operation_id: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub cancelled: bool,
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GitInspection {
    Discover,
    OperationState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum GitWriteSource {
    PreviousOutput,
    Literal(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum GitPlanStep {
    Command {
        args: Vec<String>,
        /// Mutating commands change refs, the index, or the worktree, so a
        /// cancellation must wait for the command boundary instead of killing
        /// Git midway.
        mutating: bool,
        base64_output: bool,
    },
    /// Fails the plan unless the path currently has unmerged index entries, so
    /// conflict resolution can never write over an ordinary file.
    RequireUnmerged {
        path: String,
    },
    WriteFile {
        path: String,
        source: GitWriteSource,
    },
    Inspect(GitInspection),
}

/// Maps one typed request to its fixed Git argument templates.
pub(crate) fn plan_git_request(request: &PluginGitRequest) -> AppResult<Vec<GitPlanStep>> {
    let steps = match request {
        PluginGitRequest::Cancel { .. } => {
            return Err(AppError::Plugin(
                "Git cancellation is handled before planning".to_string(),
            ));
        }
        PluginGitRequest::Discover { .. } => vec![GitPlanStep::Inspect(GitInspection::Discover)],
        PluginGitRequest::OperationState { .. } => {
            vec![GitPlanStep::Inspect(GitInspection::OperationState)]
        }
        PluginGitRequest::Status { .. } => vec![read_only(vec![
            "status".into(),
            "--porcelain=v2".into(),
            "--branch".into(),
            "--untracked-files=all".into(),
            "--ignore-submodules=all".into(),
            "-z".into(),
        ])],
        PluginGitRequest::Initialize { default_branch, .. } => {
            validate_branch_name(default_branch)?;
            vec![mutating(vec![
                "init".into(),
                "--initial-branch".into(),
                default_branch.clone(),
            ])]
        }
        PluginGitRequest::Stage { paths, .. } => {
            let mut args = vec!["add".into(), "--".into()];
            args.extend(validated_paths(paths)?);
            vec![mutating(args)]
        }
        PluginGitRequest::Unstage { paths, .. } => {
            let mut args = vec!["reset".into(), "--quiet".into(), "--".into()];
            args.extend(validated_paths(paths)?);
            vec![mutating(args)]
        }
        PluginGitRequest::Commit {
            message,
            amend,
            allow_empty,
            author_name,
            author_email,
            ..
        } => {
            validate_commit_message(message)?;
            // Identity overrides are placed before the subcommand, so they are
            // the last `-c` options on the command line and outrank every
            // configuration file the repository could carry.
            let mut args = Vec::new();
            if let Some(name) = author_name {
                validate_author_name(name)?;
                args.push("-c".into());
                args.push(format!("user.name={name}"));
            }
            if let Some(email) = author_email {
                validate_author_email(email)?;
                args.push("-c".into());
                args.push(format!("user.email={email}"));
            }
            args.extend([
                "commit".into(),
                "--no-verify".into(),
                "--no-gpg-sign".into(),
                "--no-post-rewrite".into(),
                "--cleanup=strip".into(),
            ]);
            if *amend {
                args.push("--amend".into());
            }
            if *allow_empty {
                args.push("--allow-empty".into());
            }
            args.push("--message".into());
            args.push(message.clone());
            vec![mutating(args)]
        }
        PluginGitRequest::ListBranches { .. } => vec![read_only(vec![
            "for-each-ref".into(),
            "--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream)%09%(upstream:track)"
                .into(),
            "refs/heads".into(),
            "refs/remotes".into(),
        ])],
        PluginGitRequest::ListRemotes { .. } => {
            vec![read_only(vec!["remote".into(), "--verbose".into()])]
        }
        PluginGitRequest::ListHistory {
            max_count,
            skip,
            r#ref,
            path,
            ..
        } => {
            let max_count = bounded_count(*max_count, 1, MAX_HISTORY_COUNT, "maxCount")?;
            let skip = match skip {
                Some(skip) => Some(bounded_count(*skip, 0, MAX_SKIP, "skip")?),
                None => None,
            };
            let mut args = vec![
                "log".into(),
                "--no-color".into(),
                "--no-ext-diff".into(),
                "--no-textconv".into(),
                "--no-show-signature".into(),
                "--date=iso-strict".into(),
                // Every field is NUL separated and `-z` terminates each record
                // with a NUL as well, so the whole report is one flat stream of
                // NUL separated fields, seven per commit. Git cannot put a NUL
                // into an author name, a subject, a ref, or a path, so no text
                // read out of the repository can shift a field or split a
                // record the way a tab or a newline could.
                "-z".into(),
                "--format=%H%x00%h%x00%an%x00%aI%x00%P%x00%D%x00%s".into(),
                format!("--max-count={max_count}"),
            ];
            if let Some(skip) = skip {
                args.push(format!("--skip={skip}"));
            }
            match r#ref {
                Some(value) => {
                    validate_revision(value)?;
                    args.push(value.clone());
                }
                None => args.push("HEAD".into()),
            }
            if let Some(path) = path {
                args.push("--".into());
                args.push(validated_path(path)?);
            }
            vec![read_only(args)]
        }
        PluginGitRequest::Diff { target, paths, .. } => {
            let mut args = match target {
                PluginGitDiffTarget::Worktree => vec!["diff".into()],
                PluginGitDiffTarget::Index => vec!["diff".into(), "--cached".into()],
                PluginGitDiffTarget::Commit { commit } => {
                    validate_revision(commit)?;
                    vec!["show".into(), commit.clone()]
                }
                PluginGitDiffTarget::Range {
                    from_commit,
                    to_commit,
                } => {
                    validate_revision(from_commit)?;
                    validate_revision(to_commit)?;
                    vec!["diff".into(), from_commit.clone(), to_commit.clone()]
                }
            };
            let head = args.remove(0);
            let mut full = vec![
                head,
                "--no-color".into(),
                "--no-ext-diff".into(),
                "--no-textconv".into(),
                "--find-renames".into(),
                "--patch".into(),
            ];
            full.extend(args);
            if let Some(paths) = paths {
                full.push("--".into());
                full.extend(validated_paths(paths)?);
            }
            vec![read_only(full)]
        }
        PluginGitRequest::Fetch { remote, prune, .. } => {
            validate_remote_name(remote)?;
            let mut args = vec![
                "fetch".into(),
                "--no-recurse-submodules".into(),
                "--no-auto-gc".into(),
            ];
            if *prune {
                args.push("--prune".into());
            }
            args.push(remote.clone());
            vec![mutating(args)]
        }
        PluginGitRequest::Pull {
            remote,
            branch,
            strategy,
            ..
        } => {
            validate_remote_name(remote)?;
            validate_branch_name(branch)?;
            let strategy_flag = match strategy {
                PluginGitPullStrategy::Merge => "--no-rebase",
                PluginGitPullStrategy::Rebase => "--rebase",
                PluginGitPullStrategy::FastForwardOnly => "--ff-only",
            };
            vec![mutating(vec![
                "pull".into(),
                "--no-recurse-submodules".into(),
                "--no-autostash".into(),
                strategy_flag.into(),
                remote.clone(),
                branch.clone(),
            ])]
        }
        PluginGitRequest::Push {
            remote,
            branch,
            set_upstream,
            mode,
            ..
        } => {
            validate_remote_name(remote)?;
            validate_branch_name(branch)?;
            let mut args = vec![
                "push".into(),
                "--no-recurse-submodules".into(),
                "--no-verify".into(),
            ];
            if *set_upstream {
                args.push("--set-upstream".into());
            }
            if matches!(mode, Some(PluginGitPushMode::ForceWithLease)) {
                args.push("--force-with-lease".into());
            }
            args.push(remote.clone());
            args.push(format!("refs/heads/{branch}:refs/heads/{branch}"));
            vec![mutating(args)]
        }
        PluginGitRequest::AddRemote { name, url, .. } => {
            validate_remote_name(name)?;
            validate_remote_url(url)?;
            vec![mutating(vec![
                "remote".into(),
                "add".into(),
                name.clone(),
                url.clone(),
            ])]
        }
        PluginGitRequest::SetRemoteUrl { name, url, .. } => {
            validate_remote_name(name)?;
            validate_remote_url(url)?;
            vec![mutating(vec![
                "remote".into(),
                "set-url".into(),
                name.clone(),
                url.clone(),
            ])]
        }
        PluginGitRequest::RemoveRemote { name, .. } => {
            validate_remote_name(name)?;
            vec![mutating(vec![
                "remote".into(),
                "remove".into(),
                name.clone(),
            ])]
        }
        PluginGitRequest::CreateBranch {
            name,
            start_point,
            checkout,
            ..
        } => {
            validate_branch_name(name)?;
            if let Some(start_point) = start_point {
                validate_revision(start_point)?;
            }
            let mut args = if *checkout {
                vec!["checkout".into(), "-b".into(), name.clone()]
            } else {
                vec!["branch".into(), name.clone()]
            };
            if let Some(start_point) = start_point {
                args.push(start_point.clone());
            }
            vec![mutating(args)]
        }
        PluginGitRequest::CheckoutBranch { name, .. } => {
            validate_branch_name(name)?;
            vec![mutating(vec!["checkout".into(), name.clone(), "--".into()])]
        }
        PluginGitRequest::RenameBranch { name, new_name, .. } => {
            validate_branch_name(name)?;
            validate_branch_name(new_name)?;
            vec![mutating(vec![
                "branch".into(),
                "--move".into(),
                name.clone(),
                new_name.clone(),
            ])]
        }
        PluginGitRequest::DeleteBranch { name, force, .. } => {
            validate_branch_name(name)?;
            let mut args: Vec<String> = vec!["branch".into(), "--delete".into()];
            if *force {
                args.push("--force".into());
            }
            args.push(name.clone());
            vec![mutating(args)]
        }
        PluginGitRequest::Stash {
            action,
            message,
            include_untracked,
            entry,
            ..
        } => {
            let entry_ref = match entry {
                Some(entry) => Some(format!(
                    "stash@{{{}}}",
                    bounded_count(*entry, 0, MAX_STASH_ENTRY, "entry",)?
                )),
                None => None,
            };
            match action {
                PluginGitStashAction::Push => {
                    let mut args = vec!["stash".into(), "push".into()];
                    if *include_untracked {
                        args.push("--include-untracked".into());
                    }
                    if let Some(message) = message {
                        validate_stash_message(message)?;
                        args.push("--message".into());
                        args.push(message.clone());
                    }
                    vec![mutating(args)]
                }
                PluginGitStashAction::Pop | PluginGitStashAction::Apply => {
                    let mut args = vec![
                        "stash".into(),
                        if matches!(action, PluginGitStashAction::Pop) {
                            "pop".into()
                        } else {
                            "apply".into()
                        },
                    ];
                    if let Some(entry_ref) = entry_ref {
                        args.push(entry_ref);
                    }
                    vec![mutating(args)]
                }
                PluginGitStashAction::Drop => {
                    let mut args = vec!["stash".into(), "drop".into()];
                    if let Some(entry_ref) = entry_ref {
                        args.push(entry_ref);
                    }
                    vec![mutating(args)]
                }
                PluginGitStashAction::List => vec![read_only(vec![
                    "stash".into(),
                    "list".into(),
                    "--format=%gd%x09%H%x09%aI%x09%s".into(),
                ])],
            }
        }
        PluginGitRequest::Merge {
            r#ref,
            fast_forward_only,
            no_commit,
            ..
        } => {
            validate_revision(r#ref)?;
            let mut args = vec!["merge".into(), "--no-gpg-sign".into(), "--no-edit".into()];
            if *fast_forward_only {
                args.push("--ff-only".into());
            }
            if *no_commit {
                args.push("--no-commit".into());
            }
            args.push(r#ref.clone());
            vec![mutating(args)]
        }
        PluginGitRequest::Rebase { upstream, .. } => {
            validate_revision(upstream)?;
            vec![mutating(vec![
                "rebase".into(),
                "--no-verify".into(),
                "--no-gpg-sign".into(),
                "--no-autostash".into(),
                upstream.clone(),
            ])]
        }
        PluginGitRequest::CherryPick { commit, .. } => {
            validate_revision(commit)?;
            vec![mutating(vec![
                "cherry-pick".into(),
                "--no-gpg-sign".into(),
                commit.clone(),
            ])]
        }
        PluginGitRequest::Revert { commit, .. } => {
            validate_revision(commit)?;
            vec![mutating(vec![
                "revert".into(),
                "--no-edit".into(),
                "--no-gpg-sign".into(),
                commit.clone(),
            ])]
        }
        PluginGitRequest::Continue { sequencer, .. } => {
            vec![mutating(vec![
                sequencer_command(*sequencer).into(),
                "--continue".into(),
            ])]
        }
        PluginGitRequest::Skip { sequencer, .. } => {
            if matches!(sequencer, PluginGitSequencer::Merge) {
                return Err(AppError::Plugin(
                    "A merge cannot be skipped; continue or abort it instead".to_string(),
                ));
            }
            vec![mutating(vec![
                sequencer_command(*sequencer).into(),
                "--skip".into(),
            ])]
        }
        PluginGitRequest::Abort { sequencer, .. } => {
            vec![mutating(vec![
                sequencer_command(*sequencer).into(),
                "--abort".into(),
            ])]
        }
        PluginGitRequest::ReadConflictStage { path, stage, .. } => {
            let path = validated_path(path)?;
            vec![GitPlanStep::Command {
                args: vec![
                    "cat-file".into(),
                    "blob".into(),
                    format!(":{}:{path}", stage_number(*stage)),
                ],
                mutating: false,
                base64_output: true,
            }]
        }
        PluginGitRequest::ResolveConflict {
            path, resolution, ..
        } => {
            let path = validated_path(path)?;
            // The index decides what may be written: a path without unmerged
            // entries is an ordinary tracked or untracked file, and resolving
            // it would be an arbitrary write into the worktree.
            let mut steps = vec![GitPlanStep::RequireUnmerged { path: path.clone() }];
            match resolution {
                PluginGitConflictResolution::Stage { stage } => {
                    steps.push(GitPlanStep::Command {
                        args: vec![
                            "cat-file".into(),
                            "blob".into(),
                            format!(":{}:{path}", stage_number(*stage)),
                        ],
                        mutating: false,
                        base64_output: false,
                    });
                    steps.push(GitPlanStep::WriteFile {
                        path: path.clone(),
                        source: GitWriteSource::PreviousOutput,
                    });
                }
                PluginGitConflictResolution::Content { content_base64 } => {
                    let content = STANDARD.decode(content_base64).map_err(|error| {
                        AppError::Plugin(format!(
                            "Git conflict resolution content is not valid base64: {error}"
                        ))
                    })?;
                    if content.len() > MAX_RESOLVED_CONTENT_BYTES {
                        return Err(AppError::Plugin(
                            "Git conflict resolution content exceeds 32 MiB".to_string(),
                        ));
                    }
                    steps.push(GitPlanStep::WriteFile {
                        path: path.clone(),
                        source: GitWriteSource::Literal(content),
                    });
                }
            }
            steps.push(mutating(vec!["add".into(), "--".into(), path]));
            steps
        }
        PluginGitRequest::Clone {
            url,
            directory,
            branch,
            ..
        } => {
            validate_remote_url(url)?;
            let directory = validated_path(directory)?;
            let mut args = vec![
                "clone".into(),
                "--no-recurse-submodules".into(),
                "--no-local".into(),
            ];
            if let Some(branch) = branch {
                validate_branch_name(branch)?;
                args.push("--branch".into());
                args.push(branch.clone());
            }
            args.push("--".into());
            args.push(url.clone());
            args.push(directory);
            vec![mutating(args)]
        }
    };
    Ok(steps)
}

fn read_only(args: Vec<String>) -> GitPlanStep {
    GitPlanStep::Command {
        args,
        mutating: false,
        base64_output: false,
    }
}

fn mutating(args: Vec<String>) -> GitPlanStep {
    GitPlanStep::Command {
        args,
        mutating: true,
        base64_output: false,
    }
}

fn sequencer_command(sequencer: PluginGitSequencer) -> &'static str {
    match sequencer {
        PluginGitSequencer::Merge => "merge",
        PluginGitSequencer::Rebase => "rebase",
        PluginGitSequencer::CherryPick => "cherry-pick",
        PluginGitSequencer::Revert => "revert",
    }
}

fn stage_number(stage: PluginGitConflictStage) -> u8 {
    match stage {
        PluginGitConflictStage::Base => 1,
        PluginGitConflictStage::Ours => 2,
        PluginGitConflictStage::Theirs => 3,
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn bounded_count(value: u32, minimum: u32, maximum: u32, label: &str) -> AppResult<u32> {
    if value < minimum || value > maximum {
        return Err(AppError::Plugin(format!(
            "Git {label} must be between {minimum} and {maximum}"
        )));
    }
    Ok(value)
}

fn reject_option_like(value: &str, label: &str) -> AppResult<()> {
    if value.starts_with('-') {
        return Err(AppError::Plugin(format!(
            "Git {label} cannot start with a dash"
        )));
    }
    Ok(())
}

fn reject_control_characters(value: &str, label: &str) -> AppResult<()> {
    if value.chars().any(|character| {
        character.is_control() || character == '\u{7f}' || character.is_whitespace()
    }) {
        return Err(AppError::Plugin(format!(
            "Git {label} cannot contain control or whitespace characters"
        )));
    }
    Ok(())
}

pub(crate) fn validate_branch_name(value: &str) -> AppResult<()> {
    validate_reference(value, "branch name")?;
    if value.contains('~') || value.contains('^') || value.contains('@') {
        return Err(AppError::Plugin(
            "Git branch name cannot contain revision syntax".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_revision(value: &str) -> AppResult<()> {
    validate_reference(value, "revision")
}

fn validate_reference(value: &str, label: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > MAX_REF_BYTES {
        return Err(AppError::Plugin(format!(
            "Git {label} has an invalid length"
        )));
    }
    reject_control_characters(value, label)?;
    reject_option_like(value, label)?;
    if !value.is_ascii()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | '-' | '/' | '~' | '^')
        })
    {
        return Err(AppError::Plugin(format!(
            "Git {label} contains unsupported characters"
        )));
    }
    if value.contains("..")
        || value.starts_with('/')
        || value.ends_with('/')
        || value.contains("//")
        || value.starts_with('.')
        || value.ends_with('.')
        || value.ends_with(".lock")
        || value.split('/').any(|segment| segment.starts_with('.'))
    {
        return Err(AppError::Plugin(format!(
            "Git {label} is not a safe reference"
        )));
    }
    Ok(())
}

/// Operation IDs are generated by the host runtime for the plugin, so they are
/// required to be canonical hyphenated UUIDs.
pub(crate) fn validate_operation_id(value: &str) -> AppResult<()> {
    if value.len() != 36 || Uuid::try_parse(value).is_err() {
        return Err(AppError::Plugin(
            "Git operation IDs must be canonical UUIDs".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_remote_name(value: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > 100 {
        return Err(AppError::Plugin(
            "Git remote name has an invalid length".to_string(),
        ));
    }
    reject_control_characters(value, "remote name")?;
    reject_option_like(value, "remote name")?;
    if value.starts_with('.')
        || value.contains("..")
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err(AppError::Plugin(
            "Git remote name contains unsupported characters".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_remote_url(value: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > MAX_URL_BYTES {
        return Err(AppError::Plugin(
            "Git remote URL has an invalid length".to_string(),
        ));
    }
    reject_control_characters(value, "remote URL")?;
    reject_option_like(value, "remote URL")?;
    let Some(authority) = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("ssh://"))
    else {
        return Err(AppError::Plugin(
            "Git remote URLs must use https:// or ssh://".to_string(),
        ));
    };
    let authority = authority.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return Err(AppError::Plugin(
            "Git remote URL is missing a host".to_string(),
        ));
    }
    let host = match authority.split_once('@') {
        Some((user, host)) => {
            if user.contains(':') {
                return Err(AppError::Plugin(
                    "Git remote URLs cannot embed a password".to_string(),
                ));
            }
            host
        }
        None => authority,
    };
    let host = host.split(':').next().unwrap_or_default();
    if host.is_empty()
        || !host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err(AppError::Plugin(
            "Git remote URL has an unsupported host".to_string(),
        ));
    }
    Ok(())
}

fn validate_commit_message(value: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::Plugin(
            "Git commit message is empty or exceeds 20 KiB".to_string(),
        ));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(AppError::Plugin(
            "Git commit message cannot contain control characters".to_string(),
        ));
    }
    Ok(())
}

/// Commit identity is optional. When a plugin supplies one, it must be a
/// bounded, non-empty, control-free single-line value, because it is applied
/// verbatim as a command-line configuration override.
fn validate_author_identity(value: &str, label: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.len() > MAX_AUTHOR_BYTES {
        return Err(AppError::Plugin(format!(
            "Git {label} is empty or exceeds {MAX_AUTHOR_BYTES} bytes"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::Plugin(format!(
            "Git {label} cannot contain control characters"
        )));
    }
    Ok(())
}

fn validate_author_name(value: &str) -> AppResult<()> {
    validate_author_identity(value, "author name")?;
    // Git parses an identity as `name <email>`, so angle brackets in the name
    // would move part of it into the address.
    if value.contains('<') || value.contains('>') {
        return Err(AppError::Plugin(
            "Git author name cannot contain angle brackets".to_string(),
        ));
    }
    Ok(())
}

fn validate_author_email(value: &str) -> AppResult<()> {
    validate_author_identity(value, "author email")?;
    if value.contains('<') || value.contains('>') {
        return Err(AppError::Plugin(
            "Git author email cannot contain angle brackets".to_string(),
        ));
    }
    Ok(())
}

fn validate_stash_message(value: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.len() > 500 {
        return Err(AppError::Plugin(
            "Git stash message is empty or exceeds 500 bytes".to_string(),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::Plugin(
            "Git stash message cannot contain control characters".to_string(),
        ));
    }
    Ok(())
}

fn validated_paths(paths: &[String]) -> AppResult<Vec<String>> {
    if paths.is_empty() || paths.len() > MAX_PATHS {
        return Err(AppError::Plugin(format!(
            "Git path list must contain between 1 and {MAX_PATHS} entries"
        )));
    }
    paths.iter().map(|path| validated_path(path)).collect()
}

/// Repository-relative paths only: no absolute paths, traversal, drive letters,
/// backslashes, pathspec magic, or Git metadata.
pub(crate) fn validated_path(path: &str) -> AppResult<String> {
    if path.is_empty() || path.len() > MAX_PATH_BYTES {
        return Err(AppError::Plugin(
            "Git path has an invalid length".to_string(),
        ));
    }
    if path.chars().any(|character| character.is_control()) {
        return Err(AppError::Plugin(
            "Git path cannot contain control characters".to_string(),
        ));
    }
    reject_option_like(path, "path")?;
    if path.starts_with(':') {
        return Err(AppError::Plugin(
            "Git path cannot use pathspec magic".to_string(),
        ));
    }
    if path.contains('\\') {
        return Err(AppError::Plugin(
            "Git paths must use forward slashes".to_string(),
        ));
    }
    if path.starts_with('/') || path.starts_with('~') {
        return Err(AppError::Plugin(
            "Git paths must be repository-relative".to_string(),
        ));
    }
    let bytes = path.as_bytes();
    if bytes.len() > 1 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(AppError::Plugin(
            "Git paths must be repository-relative".to_string(),
        ));
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(AppError::Plugin(
                "Git paths cannot contain empty or traversing segments".to_string(),
            ));
        }
        if segment.eq_ignore_ascii_case(".git") {
            return Err(AppError::Plugin(
                "Git paths cannot address repository metadata".to_string(),
            ));
        }
    }
    Ok(path.to_string())
}

// ---------------------------------------------------------------------------
// Repository inspection
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GitDirectoryState {
    Missing,
    Directory,
}

/// Only ordinary `.git` directories are supported. A `.git` file points at a
/// linked worktree or submodule store, which this transport refuses to touch
/// rather than corrupt.
pub(crate) fn resolve_git_directory(repository_root: &Path) -> AppResult<GitDirectoryState> {
    let candidate = repository_root.join(".git");
    let metadata = match fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(GitDirectoryState::Missing);
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() {
        return Err(AppError::Plugin(
            "Denote does not run Git where .git is a symbolic link".to_string(),
        ));
    }
    if metadata.is_file() {
        return Err(AppError::Plugin(
            "Denote does not yet support repositories that use a .git file indirection, such as linked worktrees and submodules".to_string(),
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::Plugin(
            "The repository metadata entry is not a directory".to_string(),
        ));
    }
    Ok(GitDirectoryState::Directory)
}

const DANGEROUS_CONFIG_SECTIONS: &[&str] = &[
    "filter",
    "include",
    "includeif",
    "credential",
    "url",
    "protocol",
];

const DANGEROUS_CORE_KEYS: &[&str] = &[
    "hookspath",
    "fsmonitor",
    "sshcommand",
    "gitproxy",
    "askpass",
    "editor",
    "pager",
    "alternaterefscommand",
    "externaldiff",
];

const DANGEROUS_DIFF_KEYS: &[&str] = &["external", "command", "textconv", "cachetextconv"];

const DANGEROUS_MERGE_KEYS: &[&str] = &["driver", "tool", "guitool"];

/// Remote keys that name a command rather than a location.
const DANGEROUS_REMOTE_KEYS: &[&str] = &["uploadpack", "receivepack", "vcs"];

/// Rejects repository-local configuration that could execute code or redirect
/// transports before any operation runs.
pub(crate) fn assert_repository_config_is_safe(git_directory: &Path) -> AppResult<()> {
    for name in ["config", "config.worktree"] {
        let path = git_directory.join(name);
        if !path.is_file() {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err(AppError::Plugin(
                "The repository configuration is too large to verify".to_string(),
            ));
        }
        let content = fs::read_to_string(&path).map_err(|error| {
            AppError::Plugin(format!(
                "Unable to read the repository configuration: {error}"
            ))
        })?;
        if let Some(reason) = dangerous_config_reason(&content) {
            return Err(AppError::Plugin(format!(
                "This repository configures {reason}, which Denote refuses to run. Remove it from .git/{name} and try again."
            )));
        }
    }
    Ok(())
}

const UNPARSEABLE_CONFIG: &str = "a configuration line Denote cannot verify";

/// Git reads configuration as a character stream, not as lines, so a section
/// header may be followed by variables on the same line, a section name may be
/// quoted or use the deprecated dotted form, and a value may continue onto the
/// next line. Anything this parser cannot account for is reported as unsafe
/// rather than skipped.
fn dangerous_config_reason(content: &str) -> Option<String> {
    let mut section = String::new();
    let mut continued = false;
    for line in content.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim();
        // Git discards a comment or a blank line before it ever looks for a
        // trailing backslash, so neither can continue onto the next line and
        // hide the variable that follows it. This has to be decided first,
        // even for the tail of a value, because a comment inside a value ends
        // that value at the newline.
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continued = false;
            continue;
        }
        let continues = continues_onto_next_line(line);
        if continued {
            // The line is the tail of the previous value, never a variable.
            continued = continues;
            continue;
        }
        continued = continues;
        let mut remainder = trimmed;
        if let Some(header) = trimmed.strip_prefix('[') {
            let Some((header, rest)) = split_section_header(header) else {
                return Some(UNPARSEABLE_CONFIG.to_string());
            };
            section = section_root(header);
            if DANGEROUS_CONFIG_SECTIONS.contains(&section.as_str()) {
                return Some(format!("a {section} section"));
            }
            remainder = rest;
        }
        let Some(key) = variable_key(remainder) else {
            continue;
        };
        let key = key.to_ascii_lowercase();
        if !key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Some(UNPARSEABLE_CONFIG.to_string());
        }
        if let Some(reason) = dangerous_key_reason(&section, &key) {
            return Some(reason);
        }
    }
    None
}

/// A value continues when the line ends with an unescaped backslash that Git
/// actually reads. Everything after an unquoted `#` or `;` is a comment Git
/// discards, including a trailing backslash, so a commented line never
/// continues.
fn continues_onto_next_line(line: &str) -> bool {
    let mut characters = line.chars();
    let mut quoted = false;
    while let Some(character) = characters.next() {
        match character {
            // A backslash escapes the next character, and one at the end of
            // the line escapes the newline itself.
            '\\' => {
                if characters.next().is_none() {
                    return true;
                }
            }
            '"' => quoted = !quoted,
            '#' | ';' if !quoted => return false,
            _ => {}
        }
    }
    false
}

/// Splits `section "sub"] tail` into the header and whatever follows it,
/// ignoring a `]` inside a quoted or escaped subsection name.
fn split_section_header(header: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in header.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => quoted = !quoted,
            ']' if !quoted => return Some((&header[..index], &header[index + 1..])),
            _ => {}
        }
    }
    None
}

/// Reduces `merge "denote"` and the deprecated `merge.denote` to `merge`, so a
/// subsection can never hide a dangerous section.
fn section_root(header: &str) -> String {
    header
        .split(|character: char| character.is_whitespace() || character == '"')
        .next()
        .unwrap_or_default()
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// Returns the variable name of a `key = value`, a bare boolean `key`, or
/// nothing when only a comment remains.
fn variable_key(remainder: &str) -> Option<&str> {
    let end = remainder.find(['=', '#', ';']).unwrap_or(remainder.len());
    let key = remainder[..end].trim();
    (!key.is_empty()).then_some(key)
}

fn dangerous_key_reason(section: &str, key: &str) -> Option<String> {
    let dangerous = match section {
        "core" => DANGEROUS_CORE_KEYS.contains(&key),
        "diff" => DANGEROUS_DIFF_KEYS.contains(&key),
        "merge" => DANGEROUS_MERGE_KEYS.contains(&key),
        "remote" => DANGEROUS_REMOTE_KEYS.contains(&key),
        "sequence" => key == "editor",
        "gpg" => key == "program",
        "uploadpack" | "receive" => key.contains("hook"),
        _ => false,
    };
    dangerous.then(|| format!("{section}.{key}"))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitOperationStateReport {
    pub(crate) merge_in_progress: bool,
    pub(crate) cherry_pick_in_progress: bool,
    pub(crate) revert_in_progress: bool,
    pub(crate) rebase_in_progress: bool,
    pub(crate) rebase_kind: Option<String>,
    pub(crate) sequencer_in_progress: bool,
    pub(crate) bisect_in_progress: bool,
}

pub(crate) fn detect_operation_state(git_directory: &Path) -> GitOperationStateReport {
    let rebase_kind = if git_directory.join("rebase-merge").is_dir() {
        Some("merge".to_string())
    } else if git_directory.join("rebase-apply").is_dir() {
        Some("apply".to_string())
    } else {
        None
    };
    GitOperationStateReport {
        merge_in_progress: git_directory.join("MERGE_HEAD").exists(),
        cherry_pick_in_progress: git_directory.join("CHERRY_PICK_HEAD").exists(),
        revert_in_progress: git_directory.join("REVERT_HEAD").exists(),
        rebase_in_progress: rebase_kind.is_some(),
        rebase_kind,
        sequencer_in_progress: git_directory.join("sequencer").is_dir(),
        bisect_in_progress: git_directory.join("BISECT_LOG").exists(),
    }
}

// ---------------------------------------------------------------------------
// Repository metadata owned by the host
// ---------------------------------------------------------------------------

/// Writes the managed attribute and exclude blocks an encrypted vault needs.
/// Unrelated user lines outside the delimited blocks are preserved exactly.
pub(crate) fn ensure_encrypted_repository_metadata(git_directory: &Path) -> AppResult<()> {
    let info = git_directory.join("info");
    if !info.exists() {
        fs::create_dir_all(&info)?;
    }
    write_managed_block(
        &info.join("attributes"),
        ATTRIBUTES_BEGIN,
        ATTRIBUTES_END,
        ENCRYPTED_ATTRIBUTES,
    )?;
    write_managed_block(
        &info.join("exclude"),
        EXCLUDE_BEGIN,
        EXCLUDE_END,
        OPERATIONAL_EXCLUDES,
    )
}

fn write_managed_block(path: &Path, begin: &str, end: &str, lines: &[&str]) -> AppResult<()> {
    let existing = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(AppError::Plugin(format!(
                "Denote will not replace the symbolic link at {}",
                path.display()
            )));
        }
        Ok(_) => fs::read_to_string(path)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let mut preserved: Vec<&str> = Vec::new();
    let mut inside = false;
    for line in existing.lines() {
        if line.trim() == begin {
            inside = true;
            continue;
        }
        if line.trim() == end {
            inside = false;
            continue;
        }
        if !inside {
            preserved.push(line);
        }
    }
    while preserved.last().is_some_and(|line| line.trim().is_empty()) {
        preserved.pop();
    }
    let mut content = String::new();
    for line in preserved {
        content.push_str(line);
        content.push('\n');
    }
    if !content.is_empty() {
        content.push('\n');
    }
    content.push_str(begin);
    content.push('\n');
    for line in lines {
        content.push_str(line);
        content.push('\n');
    }
    content.push_str(end);
    content.push('\n');
    if existing == content {
        return Ok(());
    }
    let mut file = atomic_write_file::AtomicWriteFile::options().open(path)?;
    file.write_all(content.as_bytes())?;
    file.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
const DEFAULT_GIT_PATHS: &[&str] = &[
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
];
#[cfg(target_os = "linux")]
const DEFAULT_GIT_PATHS: &[&str] = &["/usr/bin/git", "/bin/git", "/usr/local/bin/git"];
#[cfg(target_os = "windows")]
const DEFAULT_GIT_PATHS: &[&str] = &[
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files\Git\bin\git.exe",
    r"C:\Program Files (x86)\Git\cmd\git.exe",
];

/// Resolves and pins one canonical Git executable for a request. `PATH` is
/// never searched, and a custom executable, which only ever comes from the
/// host-owned persisted plugin setting, must be an absolute, canonical,
/// regular file that identifies itself as Git.
pub(crate) fn resolve_git_executable(configured: Option<&str>) -> AppResult<PathBuf> {
    if let Some(custom) = configured {
        let candidate = Path::new(custom);
        if !candidate.is_absolute() {
            return Err(AppError::Plugin(
                "The configured Git executable must be an absolute path".to_string(),
            ));
        }
        let canonical = fs::canonicalize(candidate).map_err(|error| {
            AppError::Plugin(format!(
                "The configured Git executable is unavailable: {error}"
            ))
        })?;
        return verify_git_executable(&canonical);
    }
    let mut last_error = None;
    for candidate in DEFAULT_GIT_PATHS {
        let Ok(canonical) = fs::canonicalize(candidate) else {
            continue;
        };
        match verify_git_executable(&canonical) {
            Ok(path) => return Ok(path),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        AppError::Plugin(
            "Git was not found in a standard location. Install Git, or select its executable in settings."
                .to_string(),
        )
    }))
}

fn verify_git_executable(canonical: &Path) -> AppResult<PathBuf> {
    let metadata = fs::symlink_metadata(canonical)?;
    if !metadata.is_file() {
        return Err(AppError::Plugin(
            "The Git executable must be a regular file".to_string(),
        ));
    }
    let mut probe = Command::new(canonical);
    probe
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    remove_inherited_environment(&mut probe);
    let output = probe.output().map_err(|error| {
        AppError::Plugin(format!("Unable to start the Git executable: {error}"))
    })?;
    let version = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || !version.trim_start().starts_with("git version") {
        return Err(AppError::Plugin(
            "The selected executable did not identify itself as Git".to_string(),
        ));
    }
    Ok(canonical.to_path_buf())
}

// ---------------------------------------------------------------------------
// Cancellation registry
// ---------------------------------------------------------------------------

struct GitOperationEntry {
    plugin_id: String,
    cancelled: Arc<AtomicBool>,
    mutating: Arc<AtomicBool>,
    child: Arc<Mutex<Option<GroupChild>>>,
}

#[derive(Default)]
pub(crate) struct GitOperationRegistry {
    entries: Mutex<HashMap<String, GitOperationEntry>>,
}

pub(crate) struct GitOperationToken {
    pub(crate) operation_id: String,
    cancelled: Arc<AtomicBool>,
    mutating: Arc<AtomicBool>,
    child: Arc<Mutex<Option<GroupChild>>>,
}

impl GitOperationToken {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn set_mutating(&self, mutating: bool) {
        self.mutating.store(mutating, Ordering::SeqCst);
    }
}

impl GitOperationRegistry {
    /// Registers one operation under the caller-generated ID the plugin
    /// already holds, so it can cancel the operation while it is still
    /// running. Malformed and already-live IDs are refused.
    pub(crate) fn register(
        &self,
        plugin_id: &str,
        operation_id: &str,
    ) -> AppResult<GitOperationToken> {
        validate_operation_id(operation_id)?;
        let token = GitOperationToken {
            operation_id: operation_id.to_string(),
            cancelled: Arc::new(AtomicBool::new(false)),
            mutating: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
        };
        let mut entries = self.lock()?;
        if entries.contains_key(operation_id) {
            return Err(AppError::Plugin(
                "A Git operation with that ID is already running".to_string(),
            ));
        }
        entries.insert(
            operation_id.to_string(),
            GitOperationEntry {
                plugin_id: plugin_id.to_string(),
                cancelled: Arc::clone(&token.cancelled),
                mutating: Arc::clone(&token.mutating),
                child: Arc::clone(&token.child),
            },
        );
        Ok(token)
    }

    pub(crate) fn finish(&self, operation_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(operation_id);
        }
    }

    /// A plugin may cancel only its own operations, and a running Git command
    /// that is mutating refs or the index is allowed to reach its boundary
    /// before the operation stops.
    pub(crate) fn cancel(&self, plugin_id: &str, operation_id: &str) -> AppResult<bool> {
        let entries = self.lock()?;
        let Some(entry) = entries
            .get(operation_id)
            .filter(|entry| entry.plugin_id == plugin_id)
        else {
            return Ok(false);
        };
        entry.cancelled.store(true, Ordering::SeqCst);
        if !entry.mutating.load(Ordering::SeqCst) {
            kill_child(&entry.child);
        }
        Ok(true)
    }

    /// Lifecycle cancellation must never leave a live child behind, so it kills
    /// immediately even during a mutating command.
    pub(crate) fn cancel_plugin(&self, plugin_id: &str) {
        self.force_cancel(Some(plugin_id));
    }

    pub(crate) fn cancel_all(&self) {
        self.force_cancel(None);
    }

    fn force_cancel(&self, plugin_id: Option<&str>) {
        let Ok(entries) = self.entries.lock() else {
            return;
        };
        for entry in entries.values() {
            if plugin_id.is_some_and(|plugin_id| entry.plugin_id != plugin_id) {
                continue;
            }
            entry.cancelled.store(true, Ordering::SeqCst);
            kill_child(&entry.child);
        }
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, GitOperationEntry>>> {
        self.entries
            .lock()
            .map_err(|_| AppError::State("Git operation lock is poisoned".to_string()))
    }
}

fn kill_child(child: &Arc<Mutex<Option<GroupChild>>>) {
    if let Ok(mut guard) = child.lock()
        && let Some(child) = guard.as_mut()
    {
        let _ = child.kill();
    }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

pub(crate) struct GitExecution<'a> {
    pub(crate) executable: &'a Path,
    pub(crate) repository_root: &'a Path,
    pub(crate) hooks_directory: &'a Path,
    /// Host-owned empty file that replaces the user's global configuration for
    /// every invocation, so nothing in `$HOME` can reintroduce a filter or a
    /// command-bearing key.
    pub(crate) global_config: &'a Path,
    pub(crate) redacted_roots: Vec<PathBuf>,
}

pub(crate) fn run_git_plan(
    steps: &[GitPlanStep],
    execution: &GitExecution<'_>,
    token: &GitOperationToken,
) -> AppResult<PluginGitResult> {
    let mut rollback: Vec<WorktreeRollback> = Vec::new();
    let outcome = run_git_steps(steps, execution, token, &mut rollback);
    // A plan that wrote into the worktree and then stopped early never staged
    // that write, so the original files are put back.
    let completed = matches!(&outcome, Ok((_, true)));
    if !completed {
        for entry in rollback.into_iter().rev() {
            entry.restore();
        }
    }
    outcome.map(|(result, _)| result)
}

/// Runs the plan and reports whether every step completed.
fn run_git_steps(
    steps: &[GitPlanStep],
    execution: &GitExecution<'_>,
    token: &GitOperationToken,
    rollback: &mut Vec<WorktreeRollback>,
) -> AppResult<(PluginGitResult, bool)> {
    let deadline = Instant::now() + GIT_TIMEOUT;
    let mut stdout_bytes = Vec::new();
    let mut stdout_text = String::new();
    let mut stderr_text = String::new();
    for step in steps {
        if token.is_cancelled() {
            return Ok((cancelled_result(execution, token), false));
        }
        match step {
            GitPlanStep::Inspect(inspection) => {
                stdout_text = inspect_report(*inspection, execution)?;
                stdout_bytes.clear();
                stderr_text.clear();
            }
            GitPlanStep::RequireUnmerged { path } => {
                let outcome = run_git_command(
                    &[
                        "ls-files".to_string(),
                        "--unmerged".to_string(),
                        "-z".to_string(),
                        "--".to_string(),
                        path.clone(),
                    ],
                    execution,
                    token,
                    deadline,
                    false,
                )?;
                if outcome.cancelled {
                    return Ok((cancelled_result(execution, token), false));
                }
                if outcome.exit_code != 0 {
                    return Ok((
                        PluginGitResult {
                            operation_id: token.operation_id.clone(),
                            exit_code: outcome.exit_code,
                            stdout: redact(
                                &String::from_utf8_lossy(&outcome.stdout),
                                &execution.redacted_roots,
                            ),
                            stderr: redact(
                                &String::from_utf8_lossy(&outcome.stderr),
                                &execution.redacted_roots,
                            ),
                            cancelled: false,
                        },
                        false,
                    ));
                }
                if !reports_unmerged_path(&outcome.stdout, path) {
                    return Err(AppError::Plugin(
                        "That path is not in conflict, so Denote will not overwrite it".to_string(),
                    ));
                }
            }
            GitPlanStep::WriteFile { path, source } => {
                let content = match source {
                    GitWriteSource::PreviousOutput => stdout_bytes.clone(),
                    GitWriteSource::Literal(content) => content.clone(),
                };
                let target = resolve_worktree_target(execution.repository_root, path)?;
                rollback.extend(WorktreeRollback::capture(&target));
                write_worktree_file(&target, &content)?;
                stdout_text.clear();
                stdout_bytes.clear();
            }
            GitPlanStep::Command {
                args,
                mutating,
                base64_output,
            } => {
                token.set_mutating(*mutating);
                let outcome = run_git_command(args, execution, token, deadline, *mutating)?;
                token.set_mutating(false);
                if outcome.cancelled {
                    return Ok((cancelled_result(execution, token), false));
                }
                stdout_bytes = outcome.stdout;
                stdout_text = if *base64_output {
                    STANDARD.encode(&stdout_bytes)
                } else {
                    redact(
                        &String::from_utf8_lossy(&stdout_bytes),
                        &execution.redacted_roots,
                    )
                };
                stderr_text = redact(
                    &String::from_utf8_lossy(&outcome.stderr),
                    &execution.redacted_roots,
                );
                if outcome.exit_code != 0 {
                    return Ok((
                        PluginGitResult {
                            operation_id: token.operation_id.clone(),
                            exit_code: outcome.exit_code,
                            stdout: stdout_text,
                            stderr: stderr_text,
                            cancelled: false,
                        },
                        false,
                    ));
                }
                if *mutating {
                    // Git has taken the worktree writes that came before this
                    // command into the index, so putting the original files
                    // back would leave the index and the worktree disagreeing.
                    rollback.clear();
                }
            }
        }
    }
    Ok((
        PluginGitResult {
            operation_id: token.operation_id.clone(),
            exit_code: 0,
            stdout: stdout_text,
            stderr: stderr_text,
            cancelled: false,
        },
        true,
    ))
}

/// Reads `git ls-files --unmerged -z` output and reports whether this exact
/// path is unmerged. A pathspec also matches everything under a directory, so
/// only an exact match may authorise a write.
fn reports_unmerged_path(stdout: &[u8], path: &str) -> bool {
    stdout.split(|byte| *byte == 0).any(|record| {
        record
            .iter()
            .position(|byte| *byte == b'\t')
            .is_some_and(|tab| &record[tab + 1..] == path.as_bytes())
    })
}

/// Remembers what a worktree path held before a conflict resolution replaced
/// it, so an unfinished plan can put the original file back.
struct WorktreeRollback {
    path: PathBuf,
    previous: Option<Vec<u8>>,
}

impl WorktreeRollback {
    fn capture(path: &Path) -> Option<Self> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_ROLLBACK_BYTES => {
                let previous = fs::read(path).ok()?;
                Some(Self {
                    path: path.to_path_buf(),
                    previous: Some(previous),
                })
            }
            Ok(_) => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(Self {
                path: path.to_path_buf(),
                previous: None,
            }),
            Err(_) => None,
        }
    }

    fn restore(self) {
        match self.previous {
            Some(previous) => {
                if let Ok(mut file) = atomic_write_file::AtomicWriteFile::options().open(&self.path)
                    && file.write_all(&previous).is_ok()
                {
                    let _ = file.commit();
                }
            }
            None => {
                let _ = fs::remove_file(&self.path);
            }
        }
    }
}

struct CommandOutcome {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    cancelled: bool,
}

fn run_git_command(
    args: &[String],
    execution: &GitExecution<'_>,
    token: &GitOperationToken,
    deadline: Instant,
    mutating: bool,
) -> AppResult<CommandOutcome> {
    let mut stdout_file = tempfile::tempfile()?;
    let mut stderr_file = tempfile::tempfile()?;
    let mut command = Command::new(execution.executable);
    command.args(hardening_arguments(execution));
    command.args(args);
    command
        .current_dir(execution.repository_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file.try_clone()?))
        .stderr(Stdio::from(stderr_file.try_clone()?));
    apply_environment(&mut command, execution);
    let child = command
        .group_spawn()
        .map_err(|error| AppError::Plugin(format!("Unable to start Git: {error}")))?;
    {
        let mut guard = token
            .child
            .lock()
            .map_err(|_| AppError::State("Git child lock is poisoned".to_string()))?;
        *guard = Some(child);
    }
    let mut cancelled = false;
    let mut timed_out = false;
    let mut output_exceeded = false;
    let status = loop {
        let finished = {
            let mut guard = token
                .child
                .lock()
                .map_err(|_| AppError::State("Git child lock is poisoned".to_string()))?;
            match guard.as_mut() {
                Some(child) => child.inner().try_wait().map_err(|error| {
                    AppError::Plugin(format!("Unable to wait for Git: {error}"))
                })?,
                None => None,
            }
        };
        if let Some(status) = finished {
            break status;
        }
        output_exceeded = stdout_file.metadata()?.len() > OUTPUT_LIMIT
            || stderr_file.metadata()?.len() > OUTPUT_LIMIT;
        timed_out = Instant::now() >= deadline;
        cancelled = token.is_cancelled();
        if output_exceeded || timed_out || (cancelled && !mutating) {
            kill_child(&token.child);
            let mut guard = token
                .child
                .lock()
                .map_err(|_| AppError::State("Git child lock is poisoned".to_string()))?;
            let Some(child) = guard.as_mut() else {
                return Err(AppError::Plugin(
                    "The Git process handle was lost while stopping".to_string(),
                ));
            };
            break child
                .wait()
                .map_err(|error| AppError::Plugin(format!("Unable to stop Git: {error}")))?;
        }
        thread::sleep(Duration::from_millis(20));
    };
    // A mutating command that reached its own process boundary has already
    // changed refs, the index, or the worktree, so its real exit status and
    // output are reported even when cancellation arrived while it ran.
    // Reporting it as cancelled would discard work Git already committed and
    // let the plan roll the worktree back over a staged resolution. The token
    // stops the next plan step instead. A mutating child that was killed never
    // reached that boundary, so it is still reported as cancelled.
    let reached_mutating_boundary = mutating && status.code().is_some();
    let cancelled = !reached_mutating_boundary && (cancelled || token.is_cancelled());
    if let Ok(mut guard) = token.child.lock()
        && let Some(mut child) = guard.take()
    {
        let _ = child.kill();
        let _ = child.wait();
    }
    // The polling loop can miss output that a fast command wrote entirely
    // between two polls, so the final sizes are always re-checked once the
    // process and its group are gone. Output is never silently truncated.
    output_exceeded = output_exceeded
        || stdout_file.metadata()?.len() > OUTPUT_LIMIT
        || stderr_file.metadata()?.len() > OUTPUT_LIMIT;
    if output_exceeded {
        return Err(AppError::Plugin(
            "The Git operation produced more than 8 MiB of output".to_string(),
        ));
    }
    if timed_out {
        return Err(AppError::Plugin(
            "The Git operation exceeded the 10 minute limit and was stopped".to_string(),
        ));
    }
    if cancelled {
        return Ok(CommandOutcome {
            exit_code: -1,
            stdout: Vec::new(),
            stderr: Vec::new(),
            cancelled: true,
        });
    }
    stdout_file.seek(SeekFrom::Start(0))?;
    stderr_file.seek(SeekFrom::Start(0))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    stdout_file
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut stdout)?;
    stderr_file
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut stderr)?;
    if stdout.len() as u64 > OUTPUT_LIMIT || stderr.len() as u64 > OUTPUT_LIMIT {
        return Err(AppError::Plugin(
            "The Git operation produced more than 8 MiB of output".to_string(),
        ));
    }
    Ok(CommandOutcome {
        exit_code: status.code().unwrap_or(-1),
        stdout,
        stderr,
        cancelled: false,
    })
}

/// Fixed hardening arguments applied to every invocation. Command-line
/// configuration wins over repository configuration, so a hostile repository
/// cannot re-enable any of these.
pub(crate) fn hardening_arguments(execution: &GitExecution<'_>) -> Vec<String> {
    vec![
        "-C".to_string(),
        execution.repository_root.to_string_lossy().into_owned(),
        "--no-pager".to_string(),
        "-c".to_string(),
        format!(
            "core.hooksPath={}",
            // Git configuration values are read with backslash escapes, so the
            // hooks path always uses forward slashes.
            execution
                .hooks_directory
                .to_string_lossy()
                .replace('\\', "/")
        ),
        "-c".to_string(),
        "core.fsmonitor=false".to_string(),
        "-c".to_string(),
        "core.pager=cat".to_string(),
        // Every remaining configuration key that names a command is pinned
        // here, at the highest precedence, so repository configuration can
        // never win even if it slips past the configuration inspection.
        "-c".to_string(),
        "core.sshCommand=ssh".to_string(),
        "-c".to_string(),
        "core.askpass=".to_string(),
        "-c".to_string(),
        "core.editor=:".to_string(),
        "-c".to_string(),
        "core.gitProxy=".to_string(),
        "-c".to_string(),
        "sequence.editor=:".to_string(),
        // Every diff template also passes --no-ext-diff, so the empty value is
        // only ever reached by a path that would otherwise run a command.
        "-c".to_string(),
        "diff.external=".to_string(),
        "-c".to_string(),
        "gpg.program=".to_string(),
        "-c".to_string(),
        "gpg.ssh.program=".to_string(),
        "-c".to_string(),
        "gpg.x509.program=".to_string(),
        "-c".to_string(),
        "commit.gpgSign=false".to_string(),
        "-c".to_string(),
        "tag.gpgSign=false".to_string(),
        "-c".to_string(),
        "merge.autoStash=false".to_string(),
        "-c".to_string(),
        "rebase.autoStash=false".to_string(),
        "-c".to_string(),
        "submodule.recurse=false".to_string(),
        "-c".to_string(),
        "fetch.recurseSubmodules=no".to_string(),
        "-c".to_string(),
        "push.recurseSubmodules=no".to_string(),
        "-c".to_string(),
        "protocol.allow=never".to_string(),
        "-c".to_string(),
        "protocol.file.allow=never".to_string(),
        "-c".to_string(),
        "protocol.ext.allow=never".to_string(),
        "-c".to_string(),
        "protocol.git.allow=never".to_string(),
        "-c".to_string(),
        "protocol.https.allow=always".to_string(),
        "-c".to_string(),
        "protocol.ssh.allow=always".to_string(),
        "-c".to_string(),
        "credential.helper=".to_string(),
        "-c".to_string(),
        "gc.auto=0".to_string(),
        "-c".to_string(),
        "maintenance.auto=false".to_string(),
        "-c".to_string(),
        "advice.detachedHead=false".to_string(),
    ]
}

const REMOVED_ENVIRONMENT: &[&str] = &[
    "EMAIL",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_ASKPASS",
    "GIT_ATTR_SOURCE",
    "GIT_AUTHOR_DATE",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_CEILING_DIRECTORIES",
    "GIT_COMMITTER_DATE",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_SYSTEM",
    "GIT_DIR",
    "GIT_EXEC_PATH",
    "GIT_EXTERNAL_DIFF",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PROXY_COMMAND",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_TEMPLATE_DIR",
    "GIT_WORK_TREE",
    "SSH_ASKPASS",
];

/// The identity variables are removed rather than pinned. Git reads
/// `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`,
/// `GIT_COMMITTER_EMAIL`, `GIT_AUTHOR_DATE`, and `GIT_COMMITTER_DATE` ahead of
/// every `user.name` and `user.email` setting, including a `-c` override, so an
/// ambient value inherited from whatever launched Denote would silently outrank
/// the identity a user configured and stamp the wrong person, or the wrong
/// time, onto a commit. `EMAIL` is removed for the same reason: Git falls back
/// to it whenever no `user.email` is configured, so an inherited value would
/// silently supply an address the user never gave Denote.
/// `GIT_CONFIG_GLOBAL` is deliberately absent from `REMOVED_ENVIRONMENT`.
/// Removing it would only fall back to `$HOME/.gitconfig` and
/// `$XDG_CONFIG_HOME/git/config`, so it is instead pinned to a host-owned
/// empty file, which is the only way to guarantee that no global configuration
/// reintroduces a filter or a command-bearing key.
pub(crate) fn apply_environment(command: &mut Command, execution: &GitExecution<'_>) {
    remove_inherited_environment(command);
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", ":")
        .env("GIT_SEQUENCE_EDITOR", ":")
        .env("GIT_PAGER", "cat")
        .env("GIT_CONFIG_GLOBAL", execution.global_config)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_ATTR_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_ALLOW_PROTOCOL", "https:ssh")
        .env("GIT_PROTOCOL_FROM_USER", "0")
        .env("GIT_FLUSH", "1")
        .env("GIT_ADVICE", "0");
}

/// Strips every inherited variable Denote refuses to let a Git child see. It is
/// applied to every Git child, including the executable probe, so no invocation
/// is ever reached by an ambient value.
fn remove_inherited_environment(command: &mut Command) {
    for name in REMOVED_ENVIRONMENT {
        command.env_remove(OsStr::new(name));
    }
}

fn inspect_report(inspection: GitInspection, execution: &GitExecution<'_>) -> AppResult<String> {
    let git_directory = execution.repository_root.join(".git");
    let value = match inspection {
        GitInspection::Discover => serde_json::json!({
            "initialized": resolve_git_directory(execution.repository_root)?
                == GitDirectoryState::Directory,
        }),
        GitInspection::OperationState => {
            serde_json::to_value(detect_operation_state(&git_directory)).map_err(|error| {
                AppError::Plugin(format!("Unable to report the Git operation state: {error}"))
            })?
        }
    };
    serde_json::to_string(&value)
        .map_err(|error| AppError::Plugin(format!("Unable to encode the Git report: {error}")))
}

fn cancelled_result(execution: &GitExecution<'_>, token: &GitOperationToken) -> PluginGitResult {
    let state = detect_operation_state(&execution.repository_root.join(".git"));
    PluginGitResult {
        operation_id: token.operation_id.clone(),
        exit_code: -1,
        stdout: serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_string()),
        stderr: "The Git operation was cancelled. Standard output reports the repository operation state so it can be continued or aborted.".to_string(),
        cancelled: true,
    }
}

fn resolve_worktree_target(repository_root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let mut target = repository_root.to_path_buf();
    for segment in relative_path.split('/') {
        target.push(segment);
        if fs::symlink_metadata(&target)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(AppError::Plugin(
                "Git conflict resolution cannot follow symbolic links".to_string(),
            ));
        }
    }
    if !target
        .components()
        .all(|component| !matches!(component, Component::ParentDir))
    {
        return Err(AppError::Plugin(
            "Git conflict resolution path escaped the repository".to_string(),
        ));
    }
    if let Some(parent) = target.parent()
        && !parent.exists()
    {
        return Err(AppError::Plugin(
            "Git conflict resolution target folder does not exist".to_string(),
        ));
    }
    Ok(target)
}

fn write_worktree_file(target: &Path, content: &[u8]) -> AppResult<()> {
    let mut file = atomic_write_file::AtomicWriteFile::options().open(target)?;
    file.write_all(content)?;
    file.commit()?;
    Ok(())
}

/// Removes absolute host paths and URL credentials from Git output before it
/// reaches a plugin.
pub(crate) fn redact(value: &str, roots: &[PathBuf]) -> String {
    let mut redacted = value.to_string();
    for root in roots {
        let root = root.to_string_lossy();
        if !root.is_empty() {
            redacted = redacted.replace(root.as_ref(), "<repository>");
        }
    }
    let mut result = String::with_capacity(redacted.len());
    for token in redacted.split_inclusive(char::is_whitespace) {
        result.push_str(&redact_token(token));
    }
    result
}

fn redact_token(token: &str) -> String {
    for scheme in ["https://", "ssh://", "http://"] {
        if let Some(start) = token.find(scheme) {
            let (prefix, rest) = token.split_at(start + scheme.len());
            let authority_end = rest.find('/').unwrap_or(rest.len());
            let (authority, suffix) = rest.split_at(authority_end);
            // Only a password is a credential; `git@host` is an ordinary user.
            if let Some((userinfo, host)) = authority.split_once('@')
                && userinfo.contains(':')
            {
                return format!("{prefix}<redacted>@{host}{suffix}");
            }
        }
    }
    token.to_string()
}

// ---------------------------------------------------------------------------
// Manager integration
// ---------------------------------------------------------------------------

use super::PluginManager;

impl PluginManager {
    fn git_support_directory(&self) -> AppResult<PathBuf> {
        let directory = self.inner.app_data_dir.join("plugins").join("git");
        if !directory.is_dir() {
            fs::create_dir_all(&directory)?;
        }
        Ok(directory)
    }

    pub(crate) fn git_hooks_directory(&self) -> AppResult<PathBuf> {
        let directory = self.git_support_directory()?.join("disabled-hooks");
        if !directory.is_dir() {
            fs::create_dir_all(&directory)?;
        }
        Ok(directory)
    }

    /// Host-owned empty global configuration file, kept beside the empty hooks
    /// directory. Every invocation points `GIT_CONFIG_GLOBAL` at this exact
    /// file, because merely removing that variable would fall back to
    /// `$HOME/.gitconfig` or `$XDG_CONFIG_HOME/git/config`, either of which
    /// could reintroduce a filter or a command-bearing key. The file is
    /// refused unless it is a regular file, never a symlink or a directory,
    /// and is truncated so it can never carry configuration of its own.
    pub(crate) fn git_global_config(&self) -> AppResult<PathBuf> {
        let path = self.git_support_directory()?.join("empty-global-config");
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if !metadata.file_type().is_file() {
                    return Err(AppError::Plugin(
                        "The managed Git global configuration must be a regular file".to_string(),
                    ));
                }
                if metadata.len() > 0 {
                    fs::write(&path, b"")?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::write(&path, b"")?;
            }
            Err(error) => return Err(error.into()),
        }
        Ok(path)
    }

    /// Runs one typed Git request against an already resolved and revalidated
    /// repository root. The caller owns vault scope, project identity, and the
    /// encryption preflight; the vault key never reaches this layer. The
    /// operation ID is generated by the host runtime before the plugin awaits
    /// the result, so a concurrent action can cancel the operation by ID. A
    /// custom Git executable is read from this plugin's host-owned persisted
    /// settings, never from the request.
    pub(crate) fn git_request(
        &self,
        plugin_id: &str,
        request: PluginGitRequest,
        repository_root: &Path,
        redacted_roots: Vec<PathBuf>,
        encrypted: bool,
        operation_id: &str,
    ) -> AppResult<PluginGitResult> {
        self.enabled_permission(plugin_id, "git")?;
        validate_operation_id(operation_id)?;
        if let PluginGitRequest::Cancel {
            operation_id: target,
        } = &request
        {
            validate_operation_id(target)?;
            let cancelled = self.inner.git_operations.cancel(plugin_id, target)?;
            return Ok(PluginGitResult {
                // A cancellation reports the operation it stopped, not its own
                // short-lived invocation.
                operation_id: target.clone(),
                exit_code: 0,
                stdout: String::new(),
                stderr: if cancelled {
                    String::new()
                } else {
                    "No matching Git operation is running.".to_string()
                },
                cancelled,
            });
        }
        if encrypted
            && matches!(
                request,
                PluginGitRequest::ResolveConflict {
                    resolution: PluginGitConflictResolution::Content { .. },
                    ..
                }
            )
        {
            return Err(AppError::Plugin(
                "Encrypted vaults resolve conflicts by choosing a whole side, because merged plaintext cannot be written into ciphertext".to_string(),
            ));
        }
        // `git stash push --include-untracked` removes every untracked file
        // from the worktree. In an encrypted vault that can take an untracked
        // `.denote/encryption.json` with it and leave the ciphertext
        // unreadable, so it is refused before any Git command starts. A
        // tracked-only stash leaves untracked files exactly where they are.
        if encrypted
            && matches!(
                request,
                PluginGitRequest::Stash {
                    action: PluginGitStashAction::Push,
                    include_untracked: true,
                    ..
                }
            )
        {
            return Err(AppError::Plugin(
                "Encrypted vaults cannot stash untracked files, because that would remove an untracked .denote/encryption.json manifest from the vault. Stash tracked changes instead.".to_string(),
            ));
        }
        let state = resolve_git_directory(repository_root)?;
        if state == GitDirectoryState::Missing && request.requires_existing_repository() {
            return Err(AppError::Plugin(
                "This folder is not a Git repository yet".to_string(),
            ));
        }
        if state == GitDirectoryState::Directory {
            let git_directory = repository_root.join(".git");
            assert_repository_config_is_safe(&git_directory)?;
            if encrypted {
                ensure_encrypted_repository_metadata(&git_directory)?;
            }
        }
        let steps = plan_git_request(&request)?;
        let configured = self.git_executable_setting(plugin_id)?;
        let executable = resolve_git_executable(configured.as_deref())?;
        let hooks_directory = self.git_hooks_directory()?;
        let global_config = self.git_global_config()?;
        let execution = GitExecution {
            executable: &executable,
            repository_root,
            hooks_directory: &hooks_directory,
            global_config: &global_config,
            redacted_roots,
        };
        let token = self
            .inner
            .git_operations
            .register(plugin_id, operation_id)?;
        let result = run_git_plan(&steps, &execution, &token);
        self.inner.git_operations.finish(&token.operation_id);
        result
    }

    pub(crate) fn cancel_git_operations(&self, plugin_id: &str) {
        self.inner.git_operations.cancel_plugin(plugin_id);
    }

    pub(crate) fn cancel_all_git_operations(&self) {
        self.inner.git_operations.cancel_all();
    }
}
