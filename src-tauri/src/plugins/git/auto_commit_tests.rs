use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::SystemTime,
};

use super::{
    auto_commit::{
        AutomaticCommitObserver, AutomaticCommitOutcome, AutomaticCommitRequest,
        AutomaticCommitStatus, AutomaticCommitTarget, ValidatedAutomaticCommit,
        automatic_commit_argument_templates, is_eligible, validate_automatic_commit,
    },
    git_tests::{GitFixture, encrypt_fixture, fixture, identify, new_operation_id},
    transport::{git_cli_path, resolve_git_executable},
};

const PLUGIN_ID: &str = "denote.reference";

fn request(message: &str) -> AutomaticCommitRequest {
    AutomaticCommitRequest {
        schedule_id: "denote.reference.nightly".to_string(),
        message: message.to_string(),
        include_patterns: vec![],
        exclude_patterns: vec![],
        author_name: None,
        author_email: None,
    }
}

fn run(
    fixture: &GitFixture,
    request: AutomaticCommitRequest,
) -> crate::error::AppResult<AutomaticCommitOutcome> {
    crate::plugins::commands::automatic_commit_with_app_state(
        &fixture.manager,
        &fixture.app_state,
        PLUGIN_ID,
        request,
        &fixture.vault_root.to_string_lossy(),
        None,
        &new_operation_id(),
    )
}

fn run_observed(
    fixture: &GitFixture,
    request: AutomaticCommitRequest,
    observer: &dyn AutomaticCommitObserver,
) -> crate::error::AppResult<AutomaticCommitOutcome> {
    fixture.manager.automatic_commit_with_observer(
        PLUGIN_ID,
        request,
        AutomaticCommitTarget {
            repository_root: &fixture.vault_root,
            redacted_roots: vec![fixture.vault_root.clone()],
            encrypted: false,
        },
        &new_operation_id(),
        observer,
    )
}

/// A synthetic repository with one committed note, ready for a tracked change.
fn initialized(fixture: &GitFixture) {
    git(&fixture.vault_root, &["init", "--initial-branch", "main"]);
    identify(&fixture.vault_root);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "first synthetic line\n",
    )
    .expect("note");
    git(&fixture.vault_root, &["add", "--", "alpha.md"]);
    git(
        &fixture.vault_root,
        &["commit", "--message", "Record alpha"],
    );
}

fn git(repository: &Path, arguments: &[&str]) {
    let status = git_command(repository)
        .args(arguments)
        .status()
        .expect("git");
    assert!(status.success(), "git {arguments:?} failed");
}

fn git_output(repository: &Path, arguments: &[&str]) -> String {
    let output = git_command(repository)
        .args(arguments)
        .output()
        .expect("git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Git as a synthetic user would run it, without whatever the developer's own
/// global configuration enables, such as commit signing.
fn git_command(repository: &Path) -> Command {
    let empty_config = repository
        .parent()
        .expect("parent")
        .join("synthetic-global-config");
    if !empty_config.exists() {
        fs::write(&empty_config, b"").expect("global config");
    }
    let mut command = Command::new(resolve_git_executable(None).expect("git"));
    command
        .arg("-C")
        .arg(git_cli_path(repository))
        .args([
            "-c",
            "commit.gpgSign=false",
            "-c",
            "tag.gpgSign=false",
            "-c",
            "gpg.program=",
        ])
        .env("GIT_CONFIG_GLOBAL", git_cli_path(&empty_config))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    command
}

fn index_path(fixture: &GitFixture) -> PathBuf {
    fixture.vault_root.join(".git").join("index")
}

fn index_bytes(fixture: &GitFixture) -> Vec<u8> {
    fs::read(index_path(fixture)).expect("index")
}

/// The index metadata a restore has to put back alongside the bytes.
fn index_metadata(fixture: &GitFixture) -> (fs::Permissions, Option<SystemTime>) {
    let metadata = fs::metadata(index_path(fixture)).expect("index metadata");
    (metadata.permissions(), metadata.modified().ok())
}

/// Runs a closure at the exact point between staging and committing.
struct Interference<F: Fn()>(F);

impl<F: Fn()> AutomaticCommitObserver for Interference<F> {
    fn staged(&self) {
        (self.0)();
    }
}

/// Runs a closure once the first staging batch has landed, while Denote's own
/// partial staging sits in the index and later batches are still to come.
struct BatchInterference<F: Fn()> {
    after_first_batch: F,
    batches: Mutex<usize>,
}

impl<F: Fn()> AutomaticCommitObserver for BatchInterference<F> {
    fn staged_batch(&self) {
        let mut batches = self.batches.lock().expect("batches");
        *batches += 1;
        if *batches == 1 {
            (self.after_first_batch)();
        }
    }
}

// ---------------------------------------------------------------------------
// Argument surface and validation
// ---------------------------------------------------------------------------

#[test]
fn never_reaches_a_remote_or_history_rewriting_command() {
    let validated = validate_automatic_commit(&AutomaticCommitRequest {
        schedule_id: "denote.reference.nightly".to_string(),
        message: "Synthetic automatic commit".to_string(),
        include_patterns: vec!["notes".to_string()],
        exclude_patterns: vec!["notes/drafts".to_string()],
        author_name: Some("Synthetic Author".to_string()),
        author_email: Some("synthetic@example.invalid".to_string()),
    })
    .expect("validate");

    let templates = automatic_commit_argument_templates(&validated);

    let subcommands: Vec<String> = templates
        .iter()
        .map(|arguments| subcommand(arguments))
        .collect();
    assert_eq!(
        subcommands,
        vec![
            "rev-parse",
            "ls-files",
            "diff-index",
            "diff",
            "add",
            "commit",
            "rev-parse"
        ]
    );
    for arguments in &templates {
        for forbidden in [
            "fetch",
            "pull",
            "push",
            "clone",
            "remote",
            "checkout",
            "switch",
            "merge",
            "rebase",
            "cherry-pick",
            "revert",
            "reset",
            "stash",
            "gc",
            "--amend",
            "--all",
            "--force",
        ] {
            assert!(
                !arguments.iter().any(|argument| argument == forbidden),
                "{forbidden} must never appear in {arguments:?}"
            );
        }
    }
    // Only tracked updates are ever staged.
    assert!(templates.iter().any(|arguments| arguments
        == &vec![
            "add".to_string(),
            "-u".to_string(),
            "--".to_string(),
            "notes/synthetic.md".to_string()
        ]));
}

/// The first argument that is neither an option nor a `-c` override value.
fn subcommand(arguments: &[String]) -> String {
    let mut skip_value = false;
    for argument in arguments {
        if skip_value {
            skip_value = false;
            continue;
        }
        if argument == "-c" {
            skip_value = true;
            continue;
        }
        if !argument.starts_with('-') {
            return argument.clone();
        }
    }
    String::new()
}

#[test]
fn matches_include_and_exclude_prefixes_on_whole_segments() {
    let include = vec!["notes".to_string()];
    let exclude = vec!["notes/drafts".to_string()];

    assert!(is_eligible("notes/alpha.md", &include, &exclude));
    assert!(is_eligible("notes", &include, &exclude));
    assert!(!is_eligible("notesbook/alpha.md", &include, &exclude));
    assert!(!is_eligible("notes/drafts/beta.md", &include, &exclude));
    assert!(!is_eligible("projects/alpha.md", &include, &exclude));
    // An empty include list means the whole repository, and excludes still win.
    assert!(is_eligible("projects/alpha.md", &[], &exclude));
    assert!(!is_eligible("notes/drafts/beta.md", &[], &exclude));
}

#[test]
fn refuses_a_half_configured_identity_and_unsafe_prefixes() {
    let mut incomplete = request("Synthetic automatic commit");
    incomplete.author_name = Some("Synthetic Author".to_string());
    assert!(validate_automatic_commit(&incomplete).is_err());

    for pattern in ["/absolute", "../escape", "notes/../secrets", ".git", "-o"] {
        let mut included = request("Synthetic automatic commit");
        included.include_patterns = vec![pattern.to_string()];
        assert!(
            validate_automatic_commit(&included).is_err(),
            "{pattern} must be refused"
        );
        let mut excluded = request("Synthetic automatic commit");
        excluded.exclude_patterns = vec![pattern.to_string()];
        assert!(validate_automatic_commit(&excluded).is_err());
    }

    let mut trailing = request("Synthetic automatic commit");
    trailing.include_patterns = vec!["notes/".to_string()];
    assert_eq!(
        validate_automatic_commit(&trailing).expect("validate"),
        ValidatedAutomaticCommit {
            message: "Synthetic automatic commit".to_string(),
            include_patterns: vec!["notes".to_string()],
            exclude_patterns: vec![],
            author_name: None,
            author_email: None,
        }
    );
}

// ---------------------------------------------------------------------------
// Synthetic repositories
// ---------------------------------------------------------------------------

#[test]
fn reports_unchanged_when_no_tracked_file_changed() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Unchanged);
    assert_eq!(outcome.commit_id, None);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn commits_tracked_changes_and_never_adds_untracked_files() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "first synthetic line\nsecond synthetic line\n",
    )
    .expect("note");
    fs::write(fixture.vault_root.join("beta.md"), "untracked synthetic\n").expect("note");

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Committed);
    assert_eq!(
        outcome.commit_id.as_deref(),
        Some(git_output(&fixture.vault_root, &["rev-parse", "HEAD"]).as_str())
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["log", "-1", "--format=%s"]),
        "Synthetic automatic commit"
    );
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["show", "--name-only", "--format=", "HEAD"]
        ),
        "alpha.md"
    );
    // The untracked file is still untracked and still present.
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["status", "--porcelain", "--untracked-files=all"]
        ),
        "?? beta.md"
    );
}

#[test]
fn commits_a_tracked_deletion_with_the_configured_identity() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::remove_file(fixture.vault_root.join("alpha.md")).expect("remove");
    let mut scheduled = request("Synthetic automatic commit");
    scheduled.author_name = Some("Scheduled Author".to_string());
    scheduled.author_email = Some("scheduled@example.invalid".to_string());

    let outcome = run(&fixture, scheduled).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Committed);
    assert_eq!(
        git_output(&fixture.vault_root, &["log", "-1", "--format=%an <%ae>"]),
        "Scheduled Author <scheduled@example.invalid>"
    );
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["show", "--name-status", "--format=", "HEAD"]
        ),
        "D\talpha.md"
    );
}

#[test]
fn commits_only_paths_that_match_the_include_and_exclude_prefixes() {
    let Some(fixture) = fixture() else {
        return;
    };
    git(&fixture.vault_root, &["init", "--initial-branch", "main"]);
    identify(&fixture.vault_root);
    let paths = [
        "notes/alpha.md",
        "notes/drafts/beta.md",
        "projects/gamma.md",
    ];
    for path in paths {
        let target = fixture.vault_root.join(path);
        fs::create_dir_all(target.parent().expect("parent")).expect("directory");
        fs::write(&target, "first synthetic line\n").expect("note");
    }
    git(&fixture.vault_root, &["add", "--", "notes", "projects"]);
    git(
        &fixture.vault_root,
        &["commit", "--message", "Record notes"],
    );
    for path in paths {
        fs::write(fixture.vault_root.join(path), "second synthetic line\n").expect("note");
    }
    let mut scheduled = request("Synthetic automatic commit");
    scheduled.include_patterns = vec!["notes".to_string()];
    scheduled.exclude_patterns = vec!["notes/drafts".to_string()];

    let outcome = run(&fixture, scheduled).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Committed);
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["show", "--name-only", "--format=", "HEAD"]
        ),
        "notes/alpha.md"
    );
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["status", "--porcelain", "--untracked-files=all"]
        )
        .lines()
        .map(str::trim)
        .collect::<Vec<&str>>(),
        vec!["M notes/drafts/beta.md", "M projects/gamma.md"]
    );
}

#[test]
fn skips_a_repository_with_staged_changes() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(fixture.vault_root.join("alpha.md"), "staged synthetic\n").expect("note");
    git(&fixture.vault_root, &["add", "--", "alpha.md"]);
    let staged = index_bytes(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert!(
        outcome.message.contains("already staged"),
        "{}",
        outcome.message
    );
    assert_eq!(index_bytes(&fixture), staged);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn skips_an_unborn_branch_and_a_folder_without_a_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");

    let missing = run(&fixture, request("Synthetic automatic commit")).expect("run");
    assert_eq!(missing.status, AutomaticCommitStatus::Skipped);
    assert!(
        missing.message.contains("not a Git repository"),
        "{}",
        missing.message
    );

    git(&fixture.vault_root, &["init", "--initial-branch", "main"]);
    identify(&fixture.vault_root);

    let unborn = run(&fixture, request("Synthetic automatic commit")).expect("run");
    assert_eq!(unborn.status, AutomaticCommitStatus::Skipped);
    assert!(
        unborn.message.contains("no commit on HEAD"),
        "{}",
        unborn.message
    );
    assert!(
        !fixture
            .vault_root
            .join(".git")
            .join("refs")
            .join("heads")
            .join("main")
            .exists(),
        "no commit may be created on an unborn branch"
    );
}

#[test]
fn skips_a_repository_with_a_conflicted_merge_in_progress() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    git(&fixture.vault_root, &["checkout", "-b", "topic"]);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "topic synthetic line\n",
    )
    .expect("note");
    git(
        &fixture.vault_root,
        &["commit", "--all", "--message", "Topic"],
    );
    git(&fixture.vault_root, &["checkout", "main"]);
    fs::write(fixture.vault_root.join("alpha.md"), "main synthetic line\n").expect("note");
    git(
        &fixture.vault_root,
        &["commit", "--all", "--message", "Main"],
    );
    let conflicted = git_command(&fixture.vault_root)
        .args(["merge", "topic"])
        .status()
        .expect("merge");
    assert!(!conflicted.success(), "the synthetic merge must conflict");
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);
    let index = index_bytes(&fixture);

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
    assert_eq!(index_bytes(&fixture), index);
}

#[test]
fn keeps_the_index_byte_identical_when_staging_fails() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    let before = index_bytes(&fixture);
    // A concurrent Git process holds the index lock, so staging cannot start.
    fs::write(fixture.vault_root.join(".git").join("index.lock"), b"").expect("lock");

    let failure =
        run(&fixture, request("Synthetic automatic commit")).expect_err("staging must fail");

    assert!(failure.to_string().contains("could not stage"), "{failure}");
    assert_eq!(index_bytes(&fixture), before);
}

#[test]
fn keeps_the_index_byte_identical_when_the_commit_fails() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    let before = index_bytes(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);
    let lock = fixture.vault_root.join(".git").join("index.lock");
    let interference = Interference(move || {
        fs::write(&lock, b"").expect("lock");
    });

    let failure = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect_err("the commit must fail");

    assert!(
        failure.to_string().contains("automatic commit failed"),
        "{failure}"
    );
    assert_eq!(index_bytes(&fixture), before);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn restores_the_index_when_the_plugin_is_disabled_mid_run() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    let before = index_bytes(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);
    let manager = fixture.manager.clone();
    // Disabling the plugin cancels its standing run through the shared Git
    // operation registry.
    let interference = Interference(move || manager.cancel_git_operations(PLUGIN_ID));

    let outcome = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert!(outcome.message.contains("cancelled"), "{}", outcome.message);
    assert!(
        outcome.message.contains("Your index was restored"),
        "{}",
        outcome.message
    );
    assert_eq!(index_bytes(&fixture), before);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn rolls_back_partial_staging_when_a_later_batch_is_cancelled() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    // More eligible paths than one staging batch holds, so the run stages in
    // several commands and can be stopped with part of its work already in the
    // index.
    let names: Vec<String> = (0..150)
        .map(|index| format!("note-{index:03}.md"))
        .collect();
    for name in &names {
        fs::write(fixture.vault_root.join(name), "first synthetic line\n").expect("note");
    }
    let mut add = vec!["add", "--"];
    add.extend(names.iter().map(String::as_str));
    git(&fixture.vault_root, &add);
    git(
        &fixture.vault_root,
        &["commit", "--message", "Record synthetic notes"],
    );
    for name in &names {
        fs::write(fixture.vault_root.join(name), "second synthetic line\n").expect("note");
    }
    let before = index_bytes(&fixture);
    let index = index_path(&fixture);
    let manager = fixture.manager.clone();
    let partial = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&partial);
    let interference = BatchInterference {
        batches: Mutex::new(0),
        after_first_batch: move || {
            *recorded.lock().expect("partial index") = fs::read(&index).expect("index");
            manager.cancel_git_operations(PLUGIN_ID);
        },
    };

    let outcome = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert!(outcome.message.contains("cancelled"), "{}", outcome.message);
    // The first batch really did stage part of the run before it stopped, and
    // none of it is left behind.
    assert_ne!(*partial.lock().expect("partial index"), before);
    assert_eq!(index_bytes(&fixture), before);
    assert_eq!(
        git_output(&fixture.vault_root, &["diff", "--cached", "--name-only"]),
        ""
    );
}

#[test]
fn restores_the_index_byte_for_byte_when_denote_still_owns_a_failed_run() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    // A second tracked file, so staging genuinely rewrites the index rather
    // than reproducing the bytes that were already there.
    fs::write(fixture.vault_root.join("beta.md"), "beta first line\n").expect("note");
    git(&fixture.vault_root, &["add", "--", "beta.md"]);
    git(&fixture.vault_root, &["commit", "--message", "Record beta"]);
    for (name, line) in [
        ("alpha.md", "alpha second line\n"),
        ("beta.md", "beta second line\n"),
    ] {
        fs::write(fixture.vault_root.join(name), line).expect("note");
    }
    let before = index_bytes(&fixture);
    let before_metadata = index_metadata(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);
    let index = index_path(&fixture);
    let lock = fixture.vault_root.join(".git").join("index.lock");
    let staged_bytes = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&staged_bytes);
    // The lock makes the commit fail without any other process writing the
    // index, so the index Denote staged is still Denote's own to roll back.
    let interference = Interference(move || {
        *observed.lock().expect("staged bytes") = fs::read(&index).expect("index");
        fs::write(&lock, b"").expect("lock");
    });

    let failure = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect_err("the commit must fail");

    assert!(
        failure.to_string().contains("automatic commit failed"),
        "{failure}"
    );
    assert!(
        !failure.to_string().contains("Another Git process"),
        "an index Denote owns is restored, not preserved: {failure}"
    );
    // Denote really did replace the index, so the restore was a write-back and
    // not an accidental no-op.
    assert_ne!(*staged_bytes.lock().expect("staged bytes"), before);
    assert_eq!(index_bytes(&fixture), before);
    assert_eq!(index_metadata(&fixture), before_metadata);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
    // Nothing Denote staged survived, and the user's own worktree changes did.
    assert_eq!(
        git_output(&fixture.vault_root, &["diff", "--cached", "--name-only"]),
        ""
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["diff", "--name-only"]),
        "alpha.md\nbeta.md"
    );
}

#[test]
fn preserves_a_concurrent_index_when_another_process_commits_while_staging() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    let before = index_bytes(&fixture);
    let repository = fixture.vault_root.clone();
    let external = Arc::new(Mutex::new(None));
    let recorded = Arc::clone(&external);
    // A real concurrent Git session: it writes a file, commits the index, and
    // leaves further work of its own staged.
    let interference = Interference(move || {
        fs::write(repository.join("beta.md"), "external first line\n").expect("note");
        git(&repository, &["add", "--", "beta.md"]);
        git(&repository, &["commit", "--message", "External commit"]);
        fs::write(repository.join("beta.md"), "external second line\n").expect("note");
        git(&repository, &["add", "--", "beta.md"]);
        *recorded.lock().expect("external state") = Some((
            fs::read(repository.join(".git").join("index")).expect("index"),
            git_output(&repository, &["rev-parse", "HEAD"]),
        ));
    });

    let outcome = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect("run");

    let (external_index, external_head) = external
        .lock()
        .expect("external state")
        .clone()
        .expect("the external process must have run");
    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert!(
        outcome.message.contains("repository changed"),
        "{}",
        outcome.message
    );
    assert!(
        outcome
            .message
            .contains("preserved that concurrent Git activity"),
        "{}",
        outcome.message
    );
    assert!(
        !outcome.message.contains("Your index was restored"),
        "{}",
        outcome.message
    );
    // The other process's index and HEAD are exactly as it left them.
    assert_ne!(external_index, before);
    assert_eq!(index_bytes(&fixture), external_index);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        external_head
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["log", "-1", "--format=%s"]),
        "External commit"
    );
    // Including the work it had staged but not yet committed.
    assert_eq!(
        git_output(&fixture.vault_root, &["diff", "--cached", "--name-only"]),
        "beta.md"
    );
}

#[test]
fn preserves_a_concurrent_index_when_the_run_is_cancelled_after_staging() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);
    let repository = fixture.vault_root.clone();
    let manager = fixture.manager.clone();
    let external = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&external);
    // Another process takes the index over, and only then is the run
    // cancelled, so the cancellation path is the one that must not write.
    let interference = Interference(move || {
        fs::write(repository.join("beta.md"), "external first line\n").expect("note");
        git(&repository, &["add", "--", "beta.md"]);
        *recorded.lock().expect("external index") =
            fs::read(repository.join(".git").join("index")).expect("index");
        manager.cancel_git_operations(PLUGIN_ID);
    });

    let outcome = run_observed(
        &fixture,
        request("Synthetic automatic commit"),
        &interference,
    )
    .expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert!(outcome.message.contains("cancelled"), "{}", outcome.message);
    assert!(
        outcome
            .message
            .contains("preserved that concurrent Git activity"),
        "{}",
        outcome.message
    );
    assert_eq!(
        index_bytes(&fixture),
        *external.lock().expect("external index")
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn refuses_a_plugin_without_the_automatic_local_commit_permission() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "second synthetic line\n",
    )
    .expect("note");
    {
        let mut state = fixture.manager.state().expect("state");
        let permissions = state
            .approved_permissions
            .get_mut(PLUGIN_ID)
            .expect("permissions");
        permissions.retain(|permission| permission.capability != "automatic-local-commit");
    }
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);

    let failure =
        run(&fixture, request("Synthetic automatic commit")).expect_err("the run must be refused");

    assert!(
        failure
            .to_string()
            .contains("automatic-local-commit permission"),
        "{failure}"
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}

#[test]
fn commits_ciphertext_in_an_encrypted_vault() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Committed);
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["show", "--format=", "--name-only", "HEAD"]
        ),
        "alpha.md"
    );
    let patch = git_output(&fixture.vault_root, &["show", "--format=", "HEAD"]);
    assert!(
        !patch.contains("first synthetic line"),
        "plaintext must never be stored: {patch}"
    );
    assert!(crate::crypto::is_encrypted_file(
        &fs::read(fixture.vault_root.join("alpha.md")).expect("file")
    ));
}

#[test]
fn skips_an_encrypted_vault_that_is_still_locked() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialized(&fixture);
    encrypt_fixture(&fixture);
    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"]);

    let outcome = run(&fixture, request("Synthetic automatic commit")).expect("run");

    assert_eq!(outcome.status, AutomaticCommitStatus::Skipped);
    assert_eq!(
        git_output(&fixture.vault_root, &["rev-parse", "HEAD"]),
        head
    );
}
