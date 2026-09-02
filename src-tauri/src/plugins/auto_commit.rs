//! Standing automatic local commits.
//!
//! This is the only Git work Denote starts without a user action, so it is
//! deliberately the narrowest path in the transport: a fixed sequence of local
//! commands that stages tracked changes the user's own settings selected and
//! commits them. No remote command, no checkout, and no sequencer command can
//! be reached from here, and untracked files are never added.
//!
//! A run that does not finish restores the user's index byte for byte, but only
//! while the index on disk is still the one Denote's own staging produced. Any
//! other Git process may take the index over at any moment, so every state
//! Denote writes is fingerprinted by digest and file identity and that
//! fingerprint is rechecked before a single byte is written back. An index that
//! belongs to someone else is left exactly as they left it.

use std::{
    cell::RefCell,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

use super::{
    PluginManager,
    git::{
        CommandOutcome, GIT_TIMEOUT, GitDirectoryState, GitExecution, GitOperationToken,
        GitTransportPolicy, assert_repository_config_is_safe, detect_operation_state,
        ensure_encrypted_repository_metadata, redact, resolve_git_directory,
        resolve_git_executable, run_git_command, validate_author_email, validate_author_name,
        validate_commit_message, validate_operation_id, validated_path,
    },
};

/// Ceiling for every read of the index: the snapshot taken before staging
/// replaces it, and each ownership reading taken afterwards. A larger index is
/// refused rather than staged without a restore point.
const MAX_INDEX_BYTES: u64 = 256 * 1024 * 1024;
/// Ceiling for one automatic run. A repository with more eligible changes than
/// this is left to an explicit commit.
const MAX_ELIGIBLE_PATHS: usize = 5_000;
/// Paths are staged in batches so one command line stays bounded.
const STAGE_BATCH: usize = 100;
const MAX_PATTERNS: usize = 100;

// ---------------------------------------------------------------------------
// Request and outcome
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticCommitRequest {
    pub schedule_id: String,
    pub message: String,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    #[serde(default)]
    pub author_name: Option<String>,
    #[serde(default)]
    pub author_email: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutomaticCommitStatus {
    Committed,
    Unchanged,
    Skipped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticCommitOutcome {
    pub status: AutomaticCommitStatus,
    /// Human-readable reason. It never names a note, a path, or note content.
    pub message: String,
    pub commit_id: Option<String>,
}

impl AutomaticCommitOutcome {
    pub(crate) fn skipped(message: impl Into<String>) -> Self {
        Self {
            status: AutomaticCommitStatus::Skipped,
            message: message.into(),
            commit_id: None,
        }
    }

    fn unchanged() -> Self {
        Self {
            status: AutomaticCommitStatus::Unchanged,
            message: "No tracked change matched the automatic commit settings.".to_string(),
            commit_id: None,
        }
    }

    fn committed(commit_id: Option<String>) -> Self {
        Self {
            status: AutomaticCommitStatus::Committed,
            message: "Committed the tracked changes that matched the automatic commit settings."
                .to_string(),
            commit_id,
        }
    }
}

/// One validated automatic commit. Nothing reaches Git before every field has
/// passed the same checks the typed transport applies.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ValidatedAutomaticCommit {
    pub(crate) message: String,
    pub(crate) include_patterns: Vec<String>,
    pub(crate) exclude_patterns: Vec<String>,
    pub(crate) author_name: Option<String>,
    pub(crate) author_email: Option<String>,
}

pub(crate) fn validate_automatic_commit(
    request: &AutomaticCommitRequest,
) -> AppResult<ValidatedAutomaticCommit> {
    validate_schedule_id(&request.schedule_id)?;
    validate_commit_message(&request.message)?;
    let (author_name, author_email) = match (&request.author_name, &request.author_email) {
        (Some(name), Some(email)) => {
            validate_author_name(name)?;
            validate_author_email(email)?;
            (Some(name.clone()), Some(email.clone()))
        }
        (None, None) => (None, None),
        // Git records an identity as `name <email>`, so half of one would
        // silently mix a configured value with a repository value.
        _ => {
            return Err(AppError::Plugin(
                "An automatic commit identity needs both an author name and an author email"
                    .to_string(),
            ));
        }
    };
    Ok(ValidatedAutomaticCommit {
        message: request.message.clone(),
        include_patterns: validated_prefixes(&request.include_patterns)?,
        exclude_patterns: validated_prefixes(&request.exclude_patterns)?,
        author_name,
        author_email,
    })
}

/// The schedule ID is host-generated and only ever appears in this request, so
/// it is bounded and kept free of anything that could reach a log or a message
/// as something other than an identifier.
fn validate_schedule_id(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 200
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(AppError::Plugin(
            "The automatic commit schedule ID is missing or unusable".to_string(),
        ));
    }
    Ok(())
}

fn validated_prefixes(patterns: &[String]) -> AppResult<Vec<String>> {
    if patterns.len() > MAX_PATTERNS {
        return Err(AppError::Plugin(format!(
            "An automatic commit accepts at most {MAX_PATTERNS} path prefixes"
        )));
    }
    patterns
        .iter()
        .map(|pattern| validated_path(pattern.trim_end_matches('/')))
        .collect()
}

// ---------------------------------------------------------------------------
// Fixed argument templates
// ---------------------------------------------------------------------------

fn head_arguments() -> Vec<String> {
    vec![
        "rev-parse".into(),
        "--verify".into(),
        "--quiet".into(),
        "HEAD".into(),
    ]
}

fn unmerged_arguments() -> Vec<String> {
    vec!["ls-files".into(), "--unmerged".into(), "-z".into()]
}

fn staged_arguments() -> Vec<String> {
    vec![
        "diff-index".into(),
        "--cached".into(),
        "--name-only".into(),
        "-z".into(),
        "--no-renames".into(),
        "HEAD".into(),
        "--".into(),
    ]
}

/// Tracked worktree changes only. `git diff` never reports an untracked file,
/// so an automatic run cannot add one.
fn changed_arguments() -> Vec<String> {
    vec![
        "diff".into(),
        "--name-only".into(),
        "-z".into(),
        "--no-renames".into(),
        "--no-ext-diff".into(),
        "--no-textconv".into(),
        "--ignore-submodules=all".into(),
        "--".into(),
    ]
}

/// `git add -u` updates tracked paths only: it never adds an untracked file,
/// even when one matches an include prefix.
fn stage_arguments(paths: &[String]) -> Vec<String> {
    let mut args = vec!["add".into(), "-u".into(), "--".into()];
    args.extend(paths.iter().cloned());
    args
}

fn commit_arguments(request: &ValidatedAutomaticCommit) -> Vec<String> {
    let mut args = Vec::new();
    // Identity overrides sit before the subcommand, so they are the last `-c`
    // options on the command line and outrank repository configuration.
    if let Some(name) = &request.author_name {
        args.push("-c".into());
        args.push(format!("user.name={name}"));
    }
    if let Some(email) = &request.author_email {
        args.push("-c".into());
        args.push(format!("user.email={email}"));
    }
    args.extend([
        "commit".into(),
        "--no-verify".into(),
        "--no-gpg-sign".into(),
        "--no-post-rewrite".into(),
        "--cleanup=strip".into(),
        "--message".into(),
        request.message.clone(),
    ]);
    args
}

fn commit_id_arguments() -> Vec<String> {
    vec!["rev-parse".into(), "HEAD".into()]
}

/// Every argument template an automatic run can reach. Tests assert that this
/// is the whole surface, so a remote or history-rewriting command can never be
/// introduced here unnoticed.
#[cfg(test)]
pub(crate) fn automatic_commit_argument_templates(
    request: &ValidatedAutomaticCommit,
) -> Vec<Vec<String>> {
    vec![
        head_arguments(),
        unmerged_arguments(),
        staged_arguments(),
        changed_arguments(),
        stage_arguments(&["notes/synthetic.md".to_string()]),
        commit_arguments(request),
        commit_id_arguments(),
    ]
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/// Reads NUL separated Git output. A path Git cannot express as UTF-8 is left
/// out rather than guessed at, so it is never staged.
fn parse_nul_paths(stdout: &[u8]) -> Vec<String> {
    stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .filter_map(|record| String::from_utf8(record.to_vec()).ok())
        .collect()
}

pub(crate) fn is_eligible(path: &str, include: &[String], exclude: &[String]) -> bool {
    if exclude.iter().any(|prefix| matches_prefix(path, prefix)) {
        return false;
    }
    include.is_empty() || include.iter().any(|prefix| matches_prefix(path, prefix))
}

/// Prefixes match whole path segments, so `notes` never matches `notesbook`.
fn matches_prefix(path: &str, prefix: &str) -> bool {
    path == prefix
        || (path.len() > prefix.len()
            && path.starts_with(prefix)
            && path.as_bytes()[prefix.len()] == b'/')
}

// ---------------------------------------------------------------------------
// Index ownership
// ---------------------------------------------------------------------------

/// Which file the index actually is. Git never rewrites the index in place: it
/// renames a freshly created file over it, so any Git process that touches the
/// index changes this even when the resulting bytes happen to match.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    volume: u64,
    file: u64,
}

fn file_identity(metadata: &fs::Metadata) -> Option<FileIdentity> {
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        Some(FileIdentity {
            volume: metadata.dev(),
            file: metadata.ino(),
        })
    };
    #[cfg(windows)]
    let identity = {
        use std::os::windows::fs::MetadataExt;
        match (metadata.volume_serial_number(), metadata.file_index()) {
            (Some(volume), Some(file)) => Some(FileIdentity {
                volume: u64::from(volume),
                file,
            }),
            // Windows reports these only for a handle that can supply them, and
            // an identity Denote cannot read is one it must not assume.
            _ => None,
        }
    };
    #[cfg(not(any(unix, windows)))]
    let identity = {
        let _ = metadata;
        None
    };
    identity
}

/// What the Git index was at one moment: which file it was, and the bytes it
/// held. Two readings are equal only when the same file still holds the same
/// bytes, which is what makes "is this still the index Denote produced?" a
/// question rollback can answer. The digest is what decides it; identity, size,
/// and timestamp only make a coincidence less possible, never more.
#[derive(Clone, Debug, Eq, PartialEq)]
enum IndexState {
    /// A repository with nothing staged yet has no index at all, and that
    /// absence is as much a state to own and restore as any bytes.
    Absent,
    Present {
        digest: [u8; 32],
        length: u64,
        identity: Option<FileIdentity>,
        modified: Option<SystemTime>,
    },
}

/// Whether a reading keeps the index bytes. Ownership checks need only the
/// digest, and an index can be large, so the bytes are held only when they are
/// going to be written back.
#[derive(Clone, Copy, Eq, PartialEq)]
enum IndexBytes {
    Keep,
    Discard,
}

struct IndexReading {
    state: IndexState,
    contents: Option<Vec<u8>>,
    permissions: Option<fs::Permissions>,
}

/// Reads the index through a single handle, so the bytes that are hashed and
/// the metadata that identifies them describe one file rather than whatever sat
/// at the path at two different moments. The open refuses to follow a link and
/// the read is bounded, so neither a link nor a file growing under Denote can
/// widen what it reads.
fn read_index(path: &Path, retain: IndexBytes) -> AppResult<IndexReading> {
    let file = match open_without_following_links(path) {
        Ok(file) => file,
        // A repository with nothing staged yet has no index at all.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(IndexReading {
                state: IndexState::Absent,
                contents: None,
                permissions: None,
            });
        }
        Err(error) if is_symbolic_link_error(&error) => return Err(index_is_a_link()),
        Err(error) => return Err(error.into()),
    };
    let metadata = file.metadata()?;
    if metadata_is_link(&metadata) {
        return Err(index_is_a_link());
    }
    if !metadata.is_file() {
        return Err(AppError::Plugin(
            "The Git index is not a regular file".to_string(),
        ));
    }
    if metadata.len() > MAX_INDEX_BYTES {
        return Err(index_is_too_large());
    }
    // One byte beyond the ceiling, so an index that grew between its size and
    // its contents being read is refused rather than silently truncated.
    let mut contents = Vec::new();
    (&file)
        .take(MAX_INDEX_BYTES + 1)
        .read_to_end(&mut contents)?;
    if contents.len() as u64 > MAX_INDEX_BYTES {
        return Err(index_is_too_large());
    }
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&Sha256::digest(&contents));
    Ok(IndexReading {
        state: IndexState::Present {
            digest,
            length: contents.len() as u64,
            identity: file_identity(&metadata),
            modified: metadata.modified().ok(),
        },
        contents: matches!(retain, IndexBytes::Keep).then_some(contents),
        permissions: Some(metadata.permissions()),
    })
}

fn index_is_a_link() -> AppError {
    AppError::Plugin(
        "Denote will not stage against a Git index that is a symbolic link".to_string(),
    )
}

fn index_is_too_large() -> AppError {
    AppError::Plugin(
        "The Git index is too large to snapshot before an automatic commit".to_string(),
    )
}

fn open_without_following_links(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // `O_NOFOLLOW` refuses a link outright, and `O_NONBLOCK` keeps a named
        // pipe left at the path from blocking the open until a writer appears.
        // A regular file ignores it, and anything that is not one is rejected
        // as soon as its metadata is read.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

/// `O_NOFOLLOW` reports a symbolic link as a loop rather than as a link.
fn is_symbolic_link_error(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    let is_link = matches!(error.raw_os_error(), Some(libc::ELOOP) | Some(libc::EMLINK));
    #[cfg(not(unix))]
    let is_link = {
        let _ = error;
        false
    };
    is_link
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

/// The exact bytes and metadata of the user's index before an automatic run
/// touched it. Restoring it puts back anything the user had staged, including
/// the absence of an index.
pub(crate) struct IndexSnapshot {
    path: PathBuf,
    state: IndexState,
    contents: Option<Vec<u8>>,
    permissions: Option<fs::Permissions>,
}

impl IndexSnapshot {
    fn capture(path: &Path) -> AppResult<Self> {
        let reading = read_index(path, IndexBytes::Keep)?;
        Ok(Self {
            path: path.to_path_buf(),
            state: reading.state,
            contents: reading.contents,
            permissions: reading.permissions,
        })
    }

    fn restore(&self) -> AppResult<()> {
        let Some(contents) = &self.contents else {
            return match fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.into()),
            };
        };
        use std::io::Write;
        let mut file = atomic_write_file::AtomicWriteFile::options().open(&self.path)?;
        file.write_all(contents)?;
        // Permissions and timestamp are set on the file that is about to become
        // the index rather than on the path afterwards, so the index is never
        // briefly in place with the wrong ones and nothing has to reopen a path
        // another process could have replaced in the meantime.
        if let Some(permissions) = &self.permissions {
            file.as_file().set_permissions(permissions.clone())?;
        }
        if let IndexState::Present {
            modified: Some(modified),
            ..
        } = &self.state
        {
            file.as_file().set_modified(*modified)?;
        }
        file.commit()?;
        Ok(())
    }
}

/// What rollback did with the index.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IndexRollback {
    /// The index was still the one Denote produced, so the user's index is back
    /// exactly as it was.
    Restored,
    /// The index is no longer the one Denote produced, so it was left exactly as
    /// the process that took it over wrote it.
    Preserved,
}

/// Added to the outcome of a run that stopped after staging and put the user's
/// index back.
const RESTORED_NOTE: &str = "Your index was restored.";
/// Added when the index Denote staged has since been replaced by another Git
/// process. Rolling back would destroy that process's work, which is the one
/// thing an unattended commit must never do, so the index is left alone and the
/// user is told what is now in it.
const PRESERVED_NOTE: &str = "Another Git process changed the Git index at the same time, so Denote left the index untouched and preserved that concurrent Git activity. Review the staged changes with your Git tooling before running Git again.";

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/// Test seam that observes the exact moment between staging and committing,
/// where cancellation and external Git activity have to be handled.
pub(crate) trait AutomaticCommitObserver {
    /// After one staging batch has landed, where a later batch can still fail
    /// or be cancelled with Denote's own partial staging in the index.
    fn staged_batch(&self) {}
    fn staged(&self) {}
}

impl AutomaticCommitObserver for () {}

/// Runs the fixed local sequence for one automatic commit.
pub(crate) fn run_automatic_commit(
    execution: &GitExecution<'_>,
    token: &GitOperationToken,
    request: &ValidatedAutomaticCommit,
    observer: &dyn AutomaticCommitObserver,
) -> AppResult<AutomaticCommitOutcome> {
    let git_directory = execution.repository_root.join(".git");
    let runner = AutomaticCommitRunner {
        execution,
        token,
        deadline: Instant::now() + GIT_TIMEOUT,
        index_path: git_directory.join("index"),
        git_directory,
        owned_index: RefCell::new(None),
    };
    let eligible = match runner.eligible_changes(request)? {
        Eligibility::Ready(eligible) => eligible,
        Eligibility::Cancelled => return Ok(cancelled()),
        Eligibility::Refused(outcome) => return Ok(outcome),
    };

    // Everything from here on can leave the index different from how the user
    // left it, so it is snapshotted first and put back unless the commit lands.
    // The snapshot is also the first index state this run is answerable for:
    // until staging replaces it, it is what Denote owns.
    let snapshot = IndexSnapshot::capture(&runner.index_path)?;
    runner.claim(snapshot.state.clone());
    let outcome = runner.stage_and_commit(request, &eligible, observer);
    if matches!(
        &outcome,
        Ok(result) if result.status == AutomaticCommitStatus::Committed
    ) {
        return outcome;
    }
    let rollback = match runner.roll_back(&snapshot) {
        Ok(rollback) => rollback,
        // Whatever stopped the run is the more useful report, so a rollback
        // that cannot even read the index only surfaces on its own when the run
        // itself did not already fail.
        Err(error) => return outcome.and(Err(error)),
    };
    match (outcome, rollback) {
        (Ok(mut result), IndexRollback::Restored) => {
            result.message = format!("{} {RESTORED_NOTE}", result.message);
            Ok(result)
        }
        (Ok(result), IndexRollback::Preserved) => Ok(AutomaticCommitOutcome::skipped(format!(
            "{} {PRESERVED_NOTE}",
            result.message
        ))),
        (Err(error), IndexRollback::Restored) => Err(error),
        (Err(AppError::Plugin(reason)), IndexRollback::Preserved) => {
            Err(AppError::Plugin(format!("{reason} {PRESERVED_NOTE}")))
        }
        (Err(error), IndexRollback::Preserved) => {
            Err(AppError::Plugin(format!("{error} {PRESERVED_NOTE}")))
        }
    }
}

struct AutomaticCommitRunner<'a> {
    execution: &'a GitExecution<'a>,
    token: &'a GitOperationToken,
    deadline: Instant,
    git_directory: PathBuf,
    index_path: PathBuf,
    /// The index state this run is answerable for: the snapshot it captured,
    /// then whatever each staging command it completed produced. Rollback
    /// writes only while the index on disk still matches this.
    owned_index: RefCell<Option<IndexState>>,
}

impl AutomaticCommitRunner<'_> {
    fn claim(&self, state: IndexState) {
        *self.owned_index.borrow_mut() = Some(state);
    }

    /// Takes ownership of the index as it is right now. Called after every
    /// staging command that completed, so a run that stops part way through
    /// still owns exactly the partial staging it created.
    fn claim_current_index(&self) -> AppResult<()> {
        self.claim(read_index(&self.index_path, IndexBytes::Discard)?.state);
        Ok(())
    }

    /// Puts the user's index back, but only while the index on disk is still
    /// the one Denote's own staging produced. Another Git process may have
    /// committed, staged, or reset in the meantime; that index is its work, and
    /// restoring over it would destroy exactly what an unattended commit has no
    /// standing to touch.
    fn roll_back(&self, snapshot: &IndexSnapshot) -> AppResult<IndexRollback> {
        let owned = self.owned_index.borrow().clone();
        // Without an established owner there is no basis on which to write.
        let Some(owned) = owned else {
            return Ok(IndexRollback::Preserved);
        };
        if read_index(&self.index_path, IndexBytes::Discard)?.state != owned {
            return Ok(IndexRollback::Preserved);
        }
        // Nothing Denote did reached the index, so there is nothing to write:
        // the user's index is already exactly the one they left.
        if owned == snapshot.state {
            return Ok(IndexRollback::Restored);
        }
        snapshot.restore()?;
        Ok(IndexRollback::Restored)
    }

    /// Runs one command. `None` reports that the run was cancelled.
    fn run(&self, args: &[String], mutating: bool) -> AppResult<Option<CommandOutcome>> {
        if self.token.is_cancelled() {
            return Ok(None);
        }
        let outcome = run_git_command(args, self.execution, self.token, self.deadline, mutating)?;
        Ok((!outcome.cancelled).then_some(outcome))
    }

    /// Decides what this run may commit, before anything is staged.
    fn eligible_changes(&self, request: &ValidatedAutomaticCommit) -> AppResult<Eligibility> {
        let Some(head) = self.run(&head_arguments(), false)? else {
            return Ok(Eligibility::Cancelled);
        };
        if head.exit_code != 0 {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                "This repository has no commit on HEAD yet, so Denote did not create one automatically.",
            )));
        }
        let head_id = String::from_utf8_lossy(&head.stdout).trim().to_string();
        if let Some(reason) = in_progress_reason(&self.git_directory) {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                reason,
            )));
        }
        let Some(unmerged) = self.run(&unmerged_arguments(), false)? else {
            return Ok(Eligibility::Cancelled);
        };
        if unmerged.exit_code != 0 || !unmerged.stdout.is_empty() {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                "This repository has unresolved conflicts, so Denote did not commit automatically.",
            )));
        }
        let Some(staged) = self.run(&staged_arguments(), false)? else {
            return Ok(Eligibility::Cancelled);
        };
        if staged.exit_code != 0 {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                "Denote could not read the staged state, so it did not commit automatically.",
            )));
        }
        if !staged.stdout.is_empty() {
            // Committing here would take work the user staged by hand into a
            // commit they never asked for.
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                "Changes are already staged, so Denote left this commit to you.",
            )));
        }
        let Some(changed) = self.run(&changed_arguments(), false)? else {
            return Ok(Eligibility::Cancelled);
        };
        if changed.exit_code != 0 {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                "Denote could not read the working tree, so it did not commit automatically.",
            )));
        }
        let paths: Vec<String> = parse_nul_paths(&changed.stdout)
            .into_iter()
            .filter(|path| validated_path(path).is_ok())
            .filter(|path| is_eligible(path, &request.include_patterns, &request.exclude_patterns))
            .collect();
        if paths.is_empty() {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::unchanged()));
        }
        if paths.len() > MAX_ELIGIBLE_PATHS {
            return Ok(Eligibility::Refused(AutomaticCommitOutcome::skipped(
                format!(
                    "More than {MAX_ELIGIBLE_PATHS} tracked files changed, so Denote left this commit to you."
                ),
            )));
        }
        Ok(Eligibility::Ready(EligibleChanges { head_id, paths }))
    }

    fn stage_and_commit(
        &self,
        request: &ValidatedAutomaticCommit,
        eligible: &EligibleChanges,
        observer: &dyn AutomaticCommitObserver,
    ) -> AppResult<AutomaticCommitOutcome> {
        for batch in eligible.paths.chunks(STAGE_BATCH) {
            let Some(staged) = self.run(&stage_arguments(batch), true)? else {
                return Ok(cancelled());
            };
            if staged.exit_code != 0 {
                return Err(AppError::Plugin(format!(
                    "The automatic commit could not stage its changes: {}",
                    self.report(&staged.stderr)
                )));
            }
            // Each batch that landed is Denote's own work, so ownership moves
            // with it: a later batch that fails or is cancelled still rolls
            // back the partial staging the earlier ones created. A command that
            // did not land leaves ownership where it was, and since Git only
            // ever renames a finished index into place, the index it did not
            // finish writing is still the one Denote already owns.
            self.claim_current_index()?;
            observer.staged_batch();
        }
        observer.staged();
        // Another Git process may have committed, checked out, or started a
        // merge while this run was staging, so the state the decision rested on
        // is confirmed again before anything is committed.
        let Some(recheck) = self.run(&head_arguments(), false)? else {
            return Ok(cancelled());
        };
        if recheck.exit_code != 0
            || String::from_utf8_lossy(&recheck.stdout).trim() != eligible.head_id
            || in_progress_reason(&self.git_directory).is_some()
        {
            return Ok(AutomaticCommitOutcome::skipped(
                "The repository changed while Denote was preparing an automatic commit, so it stopped without committing.",
            ));
        }
        let Some(commit) = self.run(&commit_arguments(request), true)? else {
            return Ok(cancelled());
        };
        if commit.exit_code != 0 {
            return Err(AppError::Plugin(format!(
                "The automatic commit failed: {}",
                self.report(&commit.stderr)
            )));
        }
        Ok(AutomaticCommitOutcome::committed(self.committed_id()))
    }

    /// The commit that was just created. It is reported when it can be read,
    /// and left out when it cannot, because the commit itself already landed.
    fn committed_id(&self) -> Option<String> {
        let outcome = self.run(&commit_id_arguments(), false).ok()??;
        if outcome.exit_code != 0 {
            return None;
        }
        let id = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
        (!id.is_empty()).then_some(id)
    }

    /// Git's own message, with host paths and URL credentials removed. Denote
    /// adds no path of its own to any message it generates.
    fn report(&self, stderr: &[u8]) -> String {
        let report = redact(
            &String::from_utf8_lossy(stderr),
            &self.execution.redacted_roots,
        );
        let trimmed = report.trim();
        if trimmed.is_empty() {
            "Git reported no details.".to_string()
        } else {
            trimmed.to_string()
        }
    }
}

/// What one run may commit, once every refusal has been ruled out.
enum Eligibility {
    Ready(EligibleChanges),
    /// The run was cancelled before anything was staged.
    Cancelled,
    /// Nothing may be committed, and the outcome says why.
    Refused(AutomaticCommitOutcome),
}

/// The tracked paths one run may commit, and the commit they were selected
/// against.
struct EligibleChanges {
    head_id: String,
    paths: Vec<String>,
}

fn cancelled() -> AutomaticCommitOutcome {
    AutomaticCommitOutcome::skipped("The automatic commit was cancelled.")
}

fn in_progress_reason(git_directory: &Path) -> Option<String> {
    let state = detect_operation_state(git_directory);
    (state.merge_in_progress
        || state.rebase_in_progress
        || state.cherry_pick_in_progress
        || state.revert_in_progress
        || state.sequencer_in_progress)
        .then(|| {
            "A merge, rebase, cherry-pick, or revert is in progress, so Denote did not commit automatically."
                .to_string()
        })
}

// ---------------------------------------------------------------------------
// Manager integration
// ---------------------------------------------------------------------------

/// The repository one automatic run applies to. The caller owns vault scope,
/// project identity, and the encryption preflight that produced it.
pub(crate) struct AutomaticCommitTarget<'a> {
    pub(crate) repository_root: &'a Path,
    pub(crate) redacted_roots: Vec<PathBuf>,
    pub(crate) encrypted: bool,
}

impl PluginManager {
    /// Runs one automatic local commit against an already resolved and
    /// revalidated repository root.
    pub(crate) fn automatic_commit(
        &self,
        plugin_id: &str,
        request: AutomaticCommitRequest,
        target: AutomaticCommitTarget<'_>,
        operation_id: &str,
    ) -> AppResult<AutomaticCommitOutcome> {
        self.automatic_commit_with_observer(plugin_id, request, target, operation_id, &())
    }

    pub(crate) fn automatic_commit_with_observer(
        &self,
        plugin_id: &str,
        request: AutomaticCommitRequest,
        target: AutomaticCommitTarget<'_>,
        operation_id: &str,
        observer: &dyn AutomaticCommitObserver,
    ) -> AppResult<AutomaticCommitOutcome> {
        let AutomaticCommitTarget {
            repository_root,
            redacted_roots,
            encrypted,
        } = target;
        // Both permissions are required: the standing schedule authority and
        // the Git authority it commits with.
        self.enabled_permission(plugin_id, "git")?;
        self.enabled_permission(plugin_id, "automatic-local-commit")?;
        validate_operation_id(operation_id)?;
        let validated = validate_automatic_commit(&request)?;
        if resolve_git_directory(repository_root)? == GitDirectoryState::Missing {
            return Ok(AutomaticCommitOutcome::skipped(
                "This scope is not a Git repository yet, so there was nothing to commit.",
            ));
        }
        let git_directory = repository_root.join(".git");
        assert_repository_config_is_safe(&git_directory)?;
        if encrypted {
            ensure_encrypted_repository_metadata(&git_directory)?;
        }
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
            // An automatic commit is local by construction: it never contacts
            // a remote, so it never needs credentials.
            askpass: None,
            encrypted,
            transport: GitTransportPolicy::RemoteOnly,
        };
        // Registering with the shared operation registry is what makes a
        // standing run cancellable by plugin disable and by shutdown.
        let token = self
            .inner
            .git_operations
            .register(plugin_id, operation_id)?;
        let result = run_automatic_commit(&execution, &token, &validated, observer);
        self.inner.git_operations.finish(&token.operation_id);
        result
    }
}
