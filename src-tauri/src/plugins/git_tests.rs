use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, mpsc},
    thread,
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use tempfile::TempDir;

use super::{
    PluginManager,
    git::{
        GitDirectoryState, GitExecution, GitInspection, GitOutputMode, GitPlanStep,
        GitTransportPolicy, GitWriteSource, PluginGitAuthMode, PluginGitConflictResolution,
        PluginGitConflictStage, PluginGitDiffTarget, PluginGitHunk, PluginGitHunkLine,
        PluginGitHunkLineKind, PluginGitPullStrategy, PluginGitPushMode, PluginGitRequest,
        PluginGitScope, PluginGitSequencer, PluginGitStashAction, SystemGitSettings,
        apply_environment, apply_system_git_settings, assert_repository_config_is_safe,
        detect_operation_state, ensure_encrypted_repository_metadata, hardening_arguments,
        plan_git_request, redact, resolve_git_directory, resolve_git_executable, run_git_command,
        validate_branch_name, validate_operation_id, validate_remote_name, validate_remote_url,
        validate_revision, validated_path,
    },
    settings::{GitCommitSigningMode, GitSettingsPolicy},
    tests::{catalog, manager},
    tools::{self, ExecutableMode},
    types::PluginPermission,
};

use crate::{crypto, db, vault};

const PLUGIN_ID: &str = "denote.reference";

#[cfg(windows)]
#[test]
fn git_cli_paths_remove_only_windows_verbatim_prefixes() {
    assert_eq!(
        super::git::git_cli_path(Path::new(r"\\?\C:\Temp\vault")),
        PathBuf::from(r"C:\Temp\vault")
    );
    assert_eq!(
        super::git::git_cli_path(Path::new(r"\\?\UNC\server\share\vault")),
        PathBuf::from(r"\\server\share\vault")
    );
    assert_eq!(
        super::git::git_cli_path_string(Path::new(r"C:\Temp\vault")),
        r"C:\Temp\vault"
    );
}

fn command_args(request: PluginGitRequest) -> Vec<String> {
    match plan_git_request(&request).expect("plan").remove(0) {
        GitPlanStep::Command { args, .. } => args,
        other => panic!("expected a command step, found {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Fixed argument templates
// ---------------------------------------------------------------------------

#[test]
fn maps_every_operation_to_a_fixed_argument_template() {
    assert_eq!(
        command_args(PluginGitRequest::Status {
            scope: PluginGitScope::Vault
        }),
        vec![
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
            "--ignore-submodules=all",
            "-z"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        }),
        vec!["init", "--initial-branch", "main"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["notes/alpha.md".to_string()],
        }),
        vec!["add", "--", "notes/alpha.md"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Unstage {
            scope: PluginGitScope::Vault,
            paths: vec!["notes/alpha.md".to_string()],
        }),
        vec!["reset", "--quiet", "--", "notes/alpha.md"]
    );
    assert_eq!(
        command_args(PluginGitRequest::RestoreFromUpstream {
            scope: PluginGitScope::Vault,
            paths: vec!["notes/alpha.md".to_string()],
        }),
        vec![
            "restore",
            "--source=@{upstream}",
            "--staged",
            "--worktree",
            "--",
            "notes/alpha.md"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: true,
            allow_empty: true,
            author_name: None,
            author_email: None,
        }),
        vec![
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "--no-post-rewrite",
            "--cleanup=strip",
            "--amend",
            "--allow-empty",
            "--message",
            "Record synthetic note"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::ListRemotes {
            scope: PluginGitScope::Vault
        }),
        vec!["remote", "--verbose"]
    );
    assert_eq!(
        command_args(PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 5,
            skip: Some(2),
            r#ref: Some("main".to_string()),
            path: Some("notes/alpha.md".to_string()),
        }),
        vec![
            "log",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-show-signature",
            "--date=iso-strict",
            "-z",
            "--format=%H%x00%h%x00%an%x00%aI%x00%P%x00%D%x00%s",
            "--max-count=5",
            "--skip=2",
            "main",
            "--",
            "notes/alpha.md"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Index,
            paths: Some(vec!["notes/alpha.md".to_string()]),
        }),
        vec![
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--patch",
            "--cached",
            "--",
            "notes/alpha.md"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit {
                commit: "1111111111111111111111111111111111111111".to_string(),
            },
            paths: None,
        }),
        vec![
            "show",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--patch",
            "--no-show-signature",
            // The commit header and message are suppressed, so the report is
            // the patch and nothing a message could disguise as one.
            "--format=",
            "1111111111111111111111111111111111111111"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Range {
                from_commit: "1111111111111111111111111111111111111111".to_string(),
                to_commit: "2222222222222222222222222222222222222222".to_string(),
            },
            paths: None,
        }),
        vec![
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--patch",
            "1111111111111111111111111111111111111111",
            "2222222222222222222222222222222222222222"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Fetch {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            prune: true,
        }),
        vec![
            "fetch",
            "--no-recurse-submodules",
            "--no-auto-gc",
            "--prune",
            "origin"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Pull {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            strategy: PluginGitPullStrategy::FastForwardOnly,
        }),
        vec![
            "pull",
            "--no-recurse-submodules",
            "--no-autostash",
            "--ff-only",
            "origin",
            "main"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::Push {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            set_upstream: true,
            mode: Some(PluginGitPushMode::ForceWithLease),
        }),
        vec![
            "push",
            "--no-recurse-submodules",
            "--no-verify",
            "--set-upstream",
            "--force-with-lease",
            "origin",
            "refs/heads/main:refs/heads/main"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::AddRemote {
            scope: PluginGitScope::Vault,
            name: "origin".to_string(),
            url: "https://example.invalid/synthetic.git".to_string(),
        }),
        vec![
            "remote",
            "add",
            "origin",
            "https://example.invalid/synthetic.git"
        ]
    );
    assert_eq!(
        command_args(PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: Some("main".to_string()),
            checkout: true,
        }),
        vec!["checkout", "-b", "topic", "main"]
    );
    assert_eq!(
        command_args(PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
        }),
        vec!["checkout", "topic", "--"]
    );
    assert_eq!(
        command_args(PluginGitRequest::DeleteBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            force: true,
        }),
        vec!["branch", "--delete", "--force", "topic"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Stash {
            scope: PluginGitScope::Vault,
            action: PluginGitStashAction::Drop,
            message: None,
            include_untracked: false,
            entry: Some(2),
        }),
        vec!["stash", "drop", "stash@{2}"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: true,
            no_commit: false,
        }),
        vec!["merge", "--no-gpg-sign", "--no-edit", "--ff-only", "topic"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::CherryPick,
        }),
        vec!["cherry-pick", "--continue"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Abort {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Rebase,
        }),
        vec!["rebase", "--abort"]
    );
    assert_eq!(
        command_args(PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "notes/alpha.md".to_string(),
            stage: PluginGitConflictStage::Theirs,
        }),
        vec!["cat-file", "blob", ":3:notes/alpha.md"]
    );
    assert_eq!(
        command_args(PluginGitRequest::Clone {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            url: "https://example.invalid/synthetic.git".to_string(),
            directory: "synthetic".to_string(),
            branch: Some("main".to_string()),
        }),
        vec![
            "clone",
            "--no-recurse-submodules",
            "--no-local",
            "--branch",
            "main",
            "--",
            "https://example.invalid/synthetic.git",
            "synthetic"
        ]
    );
}

#[test]
fn remote_branch_changes_use_only_fixed_non_force_pushes() {
    let rename = plan_git_request(&PluginGitRequest::RenameRemoteBranch {
        scope: PluginGitScope::Vault,
        remote: "origin".to_string(),
        name: "release".to_string(),
        new_name: "stable".to_string(),
        auth_mode: PluginGitAuthMode::Public,
    })
    .expect("rename plan");
    let commands = rename
        .iter()
        .map(|step| match step {
            GitPlanStep::Command { args, .. } => args.clone(),
            other => panic!("expected command, found {other:?}"),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        commands,
        vec![
            vec![
                "push",
                "--no-recurse-submodules",
                "--no-verify",
                "origin",
                "refs/remotes/origin/release:refs/heads/stable"
            ],
            vec![
                "push",
                "--no-recurse-submodules",
                "--no-verify",
                "--delete",
                "origin",
                "release"
            ]
        ]
    );
    assert!(
        commands
            .iter()
            .flatten()
            .all(|argument| !argument.starts_with("--force"))
    );

    assert_eq!(
        command_args(PluginGitRequest::DeleteRemoteBranch {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            name: "release".to_string(),
            auth_mode: PluginGitAuthMode::Public,
        }),
        vec![
            "push",
            "--no-recurse-submodules",
            "--no-verify",
            "--delete",
            "origin",
            "release"
        ]
    );
}

#[test]
fn prepared_bundled_git_runs_repository_commands_from_the_extracted_cache() {
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    if !resources
        .join("tools")
        .join(super::tools::TARGET_TRIPLE)
        .join("integrity.json")
        .exists()
    {
        return;
    }
    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir(&repository).expect("repository");
    let executable = tools::resolve_git(
        &resources,
        &directory.path().join("installed"),
        ExecutableMode::Bundled,
        None,
    )
    .expect("bundled Git");
    let hooks = directory.path().join("hooks");
    fs::create_dir(&hooks).expect("hooks");
    let global = directory.path().join("global");
    fs::write(&global, b"").expect("global");
    let execution = GitExecution {
        executable: &executable,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global,
        redacted_roots: vec![repository.clone()],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let token = super::git::GitOperationToken::detached();
    let deadline = Instant::now() + Duration::from_secs(30);
    for (arguments, mutating) in [
        (
            vec!["init".to_string(), "--initial-branch=main".to_string()],
            true,
        ),
        (
            vec![
                "-c".to_string(),
                "user.name=Synthetic Author".to_string(),
                "-c".to_string(),
                "user.email=author@example.invalid".to_string(),
                "commit".to_string(),
                "--allow-empty".to_string(),
                "--no-gpg-sign".to_string(),
                "--message".to_string(),
                "Synthetic commit".to_string(),
            ],
            true,
        ),
        (
            vec![
                "status".to_string(),
                "--short".to_string(),
                "--branch".to_string(),
            ],
            false,
        ),
    ] {
        let outcome =
            run_git_command(&arguments, &execution, &token, deadline, mutating).expect("command");
        assert_eq!(
            outcome.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&outcome.stderr)
        );
    }
}

#[test]
fn applies_system_credentials_and_gpg_signing_without_exposing_a_passphrase() {
    let mut commit = plan_git_request(&PluginGitRequest::Commit {
        scope: PluginGitScope::Vault,
        message: "Record synthetic note".to_string(),
        amend: false,
        allow_empty: false,
        author_name: None,
        author_email: None,
    })
    .expect("commit plan");
    apply_system_git_settings(
        &mut commit,
        &PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        &GitSettingsPolicy {
            use_system_settings: true,
            signing: GitCommitSigningMode::Always,
            signing_key: Some("ABCDEF1234567890".to_string()),
        },
        &SystemGitSettings::from_pairs([
            ("user.name", "Synthetic Author"),
            ("user.email", "author@example.invalid"),
            ("credential.helper", "osxkeychain"),
        ]),
    )
    .expect("apply settings");
    let args = match &commit[0] {
        GitPlanStep::Command { args, .. } => args,
        other => panic!("expected command, found {other:?}"),
    };
    expect_args_in_order(
        args,
        &[
            "user.name=Synthetic Author",
            "user.email=author@example.invalid",
            "gpg.program=gpg",
            "commit.gpgSign=true",
            "--gpg-sign=ABCDEF1234567890",
        ],
    );
    assert!(!args.iter().any(|argument| argument == "--no-gpg-sign"));
    assert!(!args.iter().any(|argument| argument.contains("passphrase")));

    let mut fetch = plan_git_request(&PluginGitRequest::Fetch {
        scope: PluginGitScope::Vault,
        remote: "origin".to_string(),
        prune: false,
        auth_mode: PluginGitAuthMode::System,
    })
    .expect("fetch plan");
    apply_system_git_settings(
        &mut fetch,
        &PluginGitRequest::Fetch {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            prune: false,
            auth_mode: PluginGitAuthMode::System,
        },
        &GitSettingsPolicy {
            use_system_settings: true,
            signing: GitCommitSigningMode::System,
            signing_key: None,
        },
        &SystemGitSettings::from_pairs([("credential.helper", "osxkeychain")]),
    )
    .expect("apply credentials");
    let args = match &fetch[0] {
        GitPlanStep::Command { args, .. } => args,
        other => panic!("expected command, found {other:?}"),
    };
    expect_args_in_order(args, &["credential.helper=osxkeychain", "fetch"]);
}

#[test]
fn explicit_signing_remains_enabled_when_system_settings_are_disabled() {
    let request = PluginGitRequest::Commit {
        scope: PluginGitScope::Vault,
        message: "Record synthetic note".to_string(),
        amend: false,
        allow_empty: false,
        author_name: None,
        author_email: None,
    };
    let mut plan = plan_git_request(&request).expect("commit plan");
    apply_system_git_settings(
        &mut plan,
        &request,
        &GitSettingsPolicy {
            use_system_settings: false,
            signing: GitCommitSigningMode::Always,
            signing_key: Some("SYNTHETIC-KEY".to_string()),
        },
        &SystemGitSettings::default(),
    )
    .expect("signing policy");
    let args = match &plan[0] {
        GitPlanStep::Command { args, .. } => args,
        other => panic!("expected command, found {other:?}"),
    };
    expect_args_in_order(
        args,
        &[
            "gpg.program=gpg",
            "commit.gpgSign=true",
            "--gpg-sign=SYNTHETIC-KEY",
        ],
    );
    assert!(!args.iter().any(|argument| argument == "--no-gpg-sign"));
}

fn expect_args_in_order(args: &[String], expected: &[&str]) {
    let mut position = 0;
    for expected in expected {
        let offset = args[position..]
            .iter()
            .position(|argument| argument == expected)
            .unwrap_or_else(|| panic!("missing {expected:?} in {args:?}"));
        position += offset + 1;
    }
}

#[test]
fn commit_identity_overrides_configuration_before_the_subcommand() {
    let args = command_args(PluginGitRequest::Commit {
        scope: PluginGitScope::Vault,
        message: "Record synthetic note".to_string(),
        amend: false,
        allow_empty: false,
        author_name: Some("Synthetic Author".to_string()),
        author_email: Some("author@example.invalid".to_string()),
    });

    assert_eq!(
        args,
        vec![
            "-c",
            "user.name=Synthetic Author",
            "-c",
            "user.email=author@example.invalid",
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "--no-post-rewrite",
            "--cleanup=strip",
            "--message",
            "Record synthetic note"
        ]
    );
    // Command-line configuration is the last word, so the identity outranks
    // anything the repository configuration could set.
    let identity = args
        .iter()
        .position(|argument| argument == "user.name=Synthetic Author")
        .expect("identity");
    let subcommand = args
        .iter()
        .position(|argument| argument == "commit")
        .expect("subcommand");
    assert!(identity < subcommand);
}

#[test]
fn commit_without_identity_keeps_repository_local_configuration() {
    assert_eq!(
        command_args(PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        })
        .first()
        .map(String::as_str),
        Some("commit")
    );
}

#[test]
fn rejects_empty_oversized_and_control_bearing_commit_identities() {
    let rejected = [
        (Some("   ".to_string()), None),
        (None, Some(String::new())),
        (Some("Synthetic\nAuthor".to_string()), None),
        (None, Some("author\u{7f}@example.invalid".to_string())),
        (Some("Synthetic <hidden>".to_string()), None),
        (None, Some("<author@example.invalid>".to_string())),
        (Some("N".repeat(256)), None),
        (None, Some(format!("{}@example.invalid", "a".repeat(256)))),
    ];

    for (author_name, author_email) in rejected {
        assert!(
            plan_git_request(&PluginGitRequest::Commit {
                scope: PluginGitScope::Vault,
                message: "Record synthetic note".to_string(),
                amend: false,
                allow_empty: false,
                author_name: author_name.clone(),
                author_email: author_email.clone(),
            })
            .is_err(),
            "expected rejection for {author_name:?} {author_email:?}"
        );
    }
}

#[test]
fn conflict_resolution_reads_a_stage_then_stages_the_written_file() {
    let steps = plan_git_request(&PluginGitRequest::ResolveConflict {
        scope: PluginGitScope::Vault,
        path: "notes/alpha.md".to_string(),
        resolution: PluginGitConflictResolution::Stage {
            stage: PluginGitConflictStage::Ours,
        },
    })
    .expect("plan");

    assert_eq!(
        steps,
        vec![
            GitPlanStep::RequireUnmerged {
                path: "notes/alpha.md".to_string(),
            },
            GitPlanStep::Command {
                args: vec![
                    "cat-file".to_string(),
                    "blob".to_string(),
                    ":2:notes/alpha.md".to_string()
                ],
                mutating: false,
                output: GitOutputMode::Redacted,
            },
            GitPlanStep::WriteFile {
                path: "notes/alpha.md".to_string(),
                source: GitWriteSource::PreviousOutput,
            },
            GitPlanStep::Command {
                args: vec![
                    "add".to_string(),
                    "--".to_string(),
                    "notes/alpha.md".to_string()
                ],
                mutating: true,
                output: GitOutputMode::Redacted,
            },
        ]
    );
}

#[test]
fn content_conflict_resolution_checks_the_index_before_writing() {
    let steps = plan_git_request(&PluginGitRequest::ResolveConflict {
        scope: PluginGitScope::Vault,
        path: "notes/alpha.md".to_string(),
        resolution: PluginGitConflictResolution::Content {
            content_base64: "c3ludGhldGlj".to_string(),
        },
    })
    .expect("plan");

    assert_eq!(
        steps.first(),
        Some(&GitPlanStep::RequireUnmerged {
            path: "notes/alpha.md".to_string(),
        }),
        "the index precondition must run before any worktree write"
    );
    assert_eq!(
        steps.get(1),
        Some(&GitPlanStep::WriteFile {
            path: "notes/alpha.md".to_string(),
            source: GitWriteSource::Literal(b"synthetic".to_vec()),
        })
    );
}

#[test]
fn discovery_and_operation_state_never_run_git() {
    assert_eq!(
        plan_git_request(&PluginGitRequest::Discover {
            scope: PluginGitScope::Vault
        })
        .expect("plan"),
        vec![GitPlanStep::Inspect(GitInspection::Discover)]
    );
    assert_eq!(
        plan_git_request(&PluginGitRequest::OperationState {
            scope: PluginGitScope::Project
        })
        .expect("plan"),
        vec![GitPlanStep::Inspect(GitInspection::OperationState)]
    );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

#[test]
fn rejects_option_like_traversing_and_metadata_values() {
    for path in [
        "--output=/tmp/pwned",
        "--upload-pack=touch",
        "/etc/passwd",
        "C:\\Windows\\system32",
        "..\\escape",
        "../escape",
        "notes/../../escape",
        "notes//alpha.md",
        ".git/config",
        "notes/.git/config",
        "notes/.GIT/config",
        "notes\\alpha.md",
        ":(exclude)notes",
        "~/secrets.md",
        "notes/al\npha.md",
        "",
    ] {
        assert!(
            validated_path(path).is_err(),
            "path {path} should be rejected"
        );
    }
    assert_eq!(
        validated_path("notes/alpha.md").expect("valid path"),
        "notes/alpha.md"
    );

    for reference in [
        "-force",
        "main..other",
        "main:file",
        "..",
        "/main",
        "main/",
        "main.lock",
        ".hidden",
        "ma in",
        "main\u{0}",
        "réf",
    ] {
        assert!(
            validate_revision(reference).is_err(),
            "revision {reference} should be rejected"
        );
    }
    assert!(validate_revision("main~1").is_ok());
    assert!(validate_revision("origin/main").is_ok());
    assert!(validate_branch_name("main").is_ok());
    assert!(validate_branch_name("main~1").is_err());
    assert!(validate_branch_name("HEAD@{0}").is_err());

    for remote in ["-origin", "or igin", "..", ".origin", "origin/extra", ""] {
        assert!(
            validate_remote_name(remote).is_err(),
            "remote {remote} should be rejected"
        );
    }
    assert!(validate_remote_name("origin").is_ok());

    for url in [
        "ext::sh -c 'touch pwned'",
        "file:///etc/passwd",
        "git://example.invalid/repo.git",
        "http://example.invalid/repo.git",
        "/local/path.git",
        "--upload-pack=touch",
        "https://user:token@example.invalid/repo.git",
        "https:///repo.git",
        "ssh://exa mple.invalid/repo.git",
    ] {
        assert!(
            validate_remote_url(url).is_err(),
            "url {url} should be rejected"
        );
    }
    assert!(validate_remote_url("https://example.invalid/repo.git").is_ok());
    assert!(validate_remote_url("ssh://git@example.invalid/repo.git").is_ok());
}

#[test]
fn rejects_unbounded_counts_and_unsupported_sequencer_steps() {
    assert!(
        plan_git_request(&PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 5000,
            skip: None,
            r#ref: None,
            path: None,
        })
        .is_err()
    );
    assert!(
        plan_git_request(&PluginGitRequest::Skip {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        })
        .is_err()
    );
    assert!(
        plan_git_request(&PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "   ".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        })
        .is_err()
    );
    assert!(
        plan_git_request(&PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec![],
        })
        .is_err()
    );
}

#[test]
fn deserializes_only_declared_fields_from_plugin_json() {
    let request: PluginGitRequest = serde_json::from_str(
        r#"{"operation":"commit","scope":"vault","message":"Synthetic","arguments":["--exec=touch pwned"]}"#,
    )
    .expect("request");

    assert_eq!(
        command_args(request),
        vec![
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "--no-post-rewrite",
            "--cleanup=strip",
            "--message",
            "Synthetic"
        ]
    );
    assert!(
        serde_json::from_str::<PluginGitRequest>(r#"{"operation":"gc","scope":"vault"}"#).is_err()
    );
}

// ---------------------------------------------------------------------------
// Hostile repositories
// ---------------------------------------------------------------------------

#[test]
fn rejects_dangerous_repository_configuration() {
    let directory = TempDir::new().expect("temp");
    let git_directory = directory.path().join(".git");
    fs::create_dir_all(&git_directory).expect("git directory");
    for hostile in [
        "[core]\n\thooksPath = ../hooks\n",
        "[core]\n\tfsmonitor = ./watch\n",
        "[core]\n\tsshCommand = touch pwned\n",
        "[core]\n\tpager = touch pwned\n",
        "[core]\n\teditor = touch pwned\n",
        "[filter \"denote\"]\n\tclean = touch pwned\n",
        "[include]\n\tpath = ../evil-config\n",
        "[includeIf \"gitdir:/\"]\n\tpath = ../evil-config\n",
        "[diff]\n\texternal = touch pwned\n",
        "[diff \"denote\"]\n\ttextconv = touch pwned\n",
        "[credential]\n\thelper = !touch pwned\n",
        "[url \"ext::sh -c touch\"]\n\tinsteadOf = https://\n",
        "[protocol]\n\tallow = always\n",
        "[uploadpack]\n\tpackObjectsHook = touch pwned\n",
        "[sequence]\n\teditor = touch pwned\n",
        "[gpg]\n\tprogram = touch pwned\n",
        "[merge \"denote\"]\n\tdriver = touch pwned\n",
        "[remote \"origin\"]\n\tuploadpack = touch pwned\n",
        // Git reads a configuration file as a character stream, so a variable
        // may sit on the same line as the section header that introduces it.
        "[core] sshCommand = touch pwned\n",
        "[core] askpass = touch pwned\n",
        "[merge \"x\"] driver = touch pwned\n",
        "[gpg] program = touch pwned\n",
        "[filter \"denote\"] clean = touch pwned\n",
        "[diff] external = touch pwned\n",
        // The deprecated dotted subsection form names the same variables.
        "[merge.x]\n\tdriver = touch pwned\n",
        "[filter.denote]\n\tclean = touch pwned\n",
        // A quoted subsection may contain the closing bracket.
        "[merge \"weird]name\"] driver = touch pwned\n",
        // Git never continues a comment, so a trailing backslash on one can
        // never swallow the dangerous line that follows it.
        "; \\\n[filter \"denote\"]\n\tclean = touch pwned\n",
        "# \\\n[include]\n\tpath = ../evil-config\n",
        "[core]\n; \\\n\thooksPath = ../hooks\n",
        "[core]\n# \\\n\tsshCommand = touch pwned\n",
        "[core]\n\t; \\\n\tpager = touch pwned\n",
        // A comment ends the value it follows, so the backslash inside that
        // comment cannot continue either.
        "[core]\n\tbare = false ; \\\n\thooksPath = ../hooks\n",
        "[core]\n\tbare = false # \\\n\tfsmonitor = ./watch\n",
        // A blank line ends a continued value the same way.
        "[core]\n\tbare = false \\\n\n\teditor = touch pwned\n",
        // Anything this parser cannot account for is refused rather than
        // skipped.
        "[core sshCommand = touch pwned\n",
        "[core]] sshCommand = touch pwned\n",
        "[core] \"sshCommand\" = touch pwned\n",
    ] {
        fs::write(git_directory.join("config"), hostile).expect("config");
        assert!(
            assert_repository_config_is_safe(&git_directory).is_err(),
            "configuration should be rejected: {hostile}"
        );
    }

    for safe in [
        "[core]\n\trepositoryformatversion = 0\n[diff]\n\trenames = true\n[merge]\n\tconflictStyle = zdiff3\n[remote \"origin\"]\n\turl = https://example.invalid/repo.git\n",
        // A comment may follow a section header on the same line.
        "[core] # sshCommand = touch pwned\n\tbare = false\n",
        "[core] ; askpass = touch pwned\n",
        // A value continued onto the next line is a value, not a variable.
        "[alias]\n\tsummary = log \\\n\taskpass \\\n\tsshCommand\n",
        // A quoted value keeps a comment character literal, so it still
        // continues onto the next line and its tail is never a variable.
        "[core]\n\tbare = \"false ; x\" \\\n\tsshCommand\n",
        "[branch \"main\"]\n\tremote = origin\n\tmerge = refs/heads/main\n",
    ] {
        fs::write(git_directory.join("config"), safe).expect("config");
        assert!(
            assert_repository_config_is_safe(&git_directory).is_ok(),
            "configuration should be accepted: {safe}"
        );
    }

    fs::write(
        git_directory.join("config.worktree"),
        "[filter \"denote\"]\n\tsmudge = touch pwned\n",
    )
    .expect("worktree config");
    assert!(assert_repository_config_is_safe(&git_directory).is_err());
}

#[test]
fn pins_every_command_bearing_configuration_key_on_the_command_line() {
    let directory = TempDir::new().expect("temp");
    let execution = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &directory.path().join("hooks"),
        global_config: &directory.path().join("empty-global-config"),
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };

    let arguments = hardening_arguments(&execution);

    for expected in [
        "core.sshCommand=ssh",
        "core.askpass=",
        "core.editor=:",
        "core.gitProxy=",
        "core.fsmonitor=false",
        "core.pager=cat",
        "sequence.editor=:",
        "diff.external=",
        "gpg.program=",
        "gpg.ssh.program=",
        "gpg.x509.program=",
        "credential.helper=",
    ] {
        assert!(
            arguments.iter().any(|argument| argument == expected),
            "every invocation must pin {expected}"
        );
    }
    assert!(
        arguments
            .iter()
            .any(|argument| argument.starts_with("core.hooksPath=")),
        "every invocation must pin an empty hooks directory"
    );
}

#[test]
fn pins_the_global_configuration_at_a_host_owned_empty_file() {
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let execution = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let mut command = Command::new("/usr/bin/git");

    apply_environment(&mut command, &execution);

    let environment: BTreeMap<String, Option<String>> = command
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect();
    // Removing the variable would only fall back to the user's own global
    // configuration, so it is pinned to the managed empty file instead.
    assert_eq!(
        environment.get("GIT_CONFIG_GLOBAL"),
        Some(&Some(global_config.to_string_lossy().into_owned()))
    );
    assert_eq!(
        environment.get("GIT_CONFIG_NOSYSTEM"),
        Some(&Some("1".to_string()))
    );
}

/// The six identity variables are the only configuration Git reads ahead of a
/// `-c` override, so a Git child must never see an inherited one.
#[test]
fn removes_every_ambient_identity_variable_from_a_git_child() {
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let execution = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let mut command = Command::new("/usr/bin/git");
    for (name, value) in AMBIENT_IDENTITY {
        command.env(name, value);
    }

    apply_environment(&mut command, &execution);

    let environment: BTreeMap<String, Option<String>> = command
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect();
    for (name, _) in AMBIENT_IDENTITY {
        assert_eq!(
            environment.get(name),
            Some(&None),
            "{name} must be removed from every Git child"
        );
    }
}

/// The identity a Git child would inherit from whatever launched Denote.
/// `EMAIL` belongs here because Git falls back to it whenever `user.email` is
/// unset, so it can supply an address the user never gave Denote.
const AMBIENT_IDENTITY: [(&str, &str); 7] = [
    ("EMAIL", "ambient@example.invalid"),
    ("GIT_AUTHOR_NAME", "Ambient Author"),
    ("GIT_AUTHOR_EMAIL", "ambient-author@example.invalid"),
    ("GIT_COMMITTER_NAME", "Ambient Committer"),
    ("GIT_COMMITTER_EMAIL", "ambient-committer@example.invalid"),
    ("GIT_AUTHOR_DATE", "2001-02-03T04:05:06+00:00"),
    ("GIT_COMMITTER_DATE", "2001-02-03T04:05:06+00:00"),
];

/// Commits twice against the same fixed argument template, once with the
/// hardened environment and once without it, while both children carry an
/// ambient identity. The unhardened commit is the control: it proves the
/// ambient identity really does win when nothing removes it, so the hardened
/// commit is evidence of the removal rather than of an absent variable.
#[test]
fn configured_commit_identity_beats_an_ambient_identity() {
    let Ok(git) = resolve_git_executable(None) else {
        eprintln!("Skipping ambient identity fixture: no Git executable is available.");
        return;
    };
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let commit_args = command_args(PluginGitRequest::Commit {
        scope: PluginGitScope::Vault,
        message: "Record synthetic note".to_string(),
        amend: false,
        allow_empty: false,
        author_name: Some("Configured Author".to_string()),
        author_email: Some("configured@example.invalid".to_string()),
    });

    let commit = |name: &str, hardened: bool| -> Vec<String> {
        let repository = directory.path().join(name);
        fs::create_dir_all(&repository).expect("repository");
        assert!(
            Command::new(&git)
                .arg("-C")
                .arg(&repository)
                .args(["init", "--quiet", "--initial-branch", "main"])
                .status()
                .expect("git init")
                .success()
        );
        fs::write(repository.join("alpha.md"), "synthetic note\n").expect("note");
        assert!(
            Command::new(&git)
                .arg("-C")
                .arg(&repository)
                .args(["add", "--", "alpha.md"])
                .status()
                .expect("git add")
                .success()
        );
        let execution = GitExecution {
            executable: &git,
            repository_root: &repository,
            hooks_directory: &hooks,
            global_config: &global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let mut command = Command::new(&git);
        command.args(hardening_arguments(&execution));
        command.args(&commit_args);
        command.current_dir(&repository);
        // The identity a Git child would inherit from whatever launched Denote.
        for (name, value) in AMBIENT_IDENTITY {
            command.env(name, value);
        }
        if hardened {
            apply_environment(&mut command, &execution);
        }
        let output = command.output().expect("git commit");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let log = Command::new(&git)
            .arg("-C")
            .arg(&repository)
            .args([
                "log",
                "-1",
                "--format=%an%n%ae%n%cn%n%ce%n%ad%n%cd",
                "--date=iso-strict",
            ])
            .output()
            .expect("git log");
        String::from_utf8_lossy(&log.stdout)
            .lines()
            .map(str::to_string)
            .collect()
    };

    let control = commit("control", false);
    assert_eq!(
        control[..4],
        [
            "Ambient Author",
            "ambient-author@example.invalid",
            "Ambient Committer",
            "ambient-committer@example.invalid"
        ],
        "an ambient identity must win when nothing removes it"
    );
    assert!(control[4].starts_with("2001-02-03"), "{}", control[4]);
    assert!(control[5].starts_with("2001-02-03"), "{}", control[5]);

    let hardened = commit("hardened", true);
    assert_eq!(
        hardened[..4],
        [
            "Configured Author",
            "configured@example.invalid",
            "Configured Author",
            "configured@example.invalid"
        ],
        "the configured identity must outrank an ambient one"
    );
    assert!(
        !hardened[4].starts_with("2001-02-03"),
        "an ambient author date must not be stamped onto a commit: {}",
        hardened[4]
    );
    assert!(
        !hardened[5].starts_with("2001-02-03"),
        "an ambient committer date must not be stamped onto a commit: {}",
        hardened[5]
    );
}

#[test]
fn manages_one_empty_regular_global_configuration_file() {
    let Some(fixture) = fixture() else {
        return;
    };

    let path = fixture.manager.git_global_config().expect("global config");
    assert!(path.is_file());
    assert_eq!(fs::metadata(&path).expect("metadata").len(), 0);
    assert!(
        path.parent()
            == fixture
                .manager
                .git_hooks_directory()
                .expect("hooks")
                .parent(),
        "the empty global configuration lives beside the empty hooks directory"
    );

    // Anything written into the managed file is truncated on the next use.
    fs::write(&path, "[filter \"synthetic\"]\n\tclean = touch marker\n").expect("write");
    let path = fixture.manager.git_global_config().expect("global config");
    assert_eq!(fs::metadata(&path).expect("metadata").len(), 0);

    fs::remove_file(&path).expect("remove");
    fs::create_dir_all(&path).expect("directory");
    assert!(fixture.manager.git_global_config().is_err());
    fs::remove_dir_all(&path).expect("remove directory");

    #[cfg(unix)]
    {
        let elsewhere = fixture.data.path().join("synthetic-elsewhere.gitconfig");
        fs::write(&elsewhere, "").expect("elsewhere");
        std::os::unix::fs::symlink(&elsewhere, &path).expect("symlink");
        assert!(fixture.manager.git_global_config().is_err());
        fs::remove_file(&path).expect("remove symlink");
    }
}

/// A global configuration in the user's own `HOME` must never reach a Git
/// invocation, because it can define filters and other command-bearing keys.
#[cfg(unix)]
#[test]
fn ignores_a_global_configuration_that_defines_a_filter() {
    let Ok(git) = resolve_git_executable(None) else {
        eprintln!("Skipping global configuration hardening: no Git executable is available.");
        return;
    };
    let directory = TempDir::new().expect("temp");
    let home = directory.path().join("synthetic-home");
    fs::create_dir_all(&home).expect("home");
    let marker = directory.path().join("filter-ran");
    fs::write(
        home.join(".gitconfig"),
        format!(
            "[filter \"synthetic\"]\n\tclean = touch {}\n\tsmudge = cat\n[core]\n\teditor = touch {}\n",
            marker.display(),
            marker.display(),
        ),
    )
    .expect("global configuration");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());

    // The control repository proves the synthetic global configuration really
    // does run a filter when nothing suppresses it.
    let control = synthetic_repository(&git, &home, directory.path(), "control");
    let mut command = Command::new(&git);
    command
        .current_dir(&control)
        .env("HOME", &home)
        .env_remove("XDG_CONFIG_HOME")
        .env_remove("GIT_CONFIG_GLOBAL")
        .args(["add", "--", "alpha.md"]);
    assert!(command.status().expect("control add").success());
    assert!(
        marker.exists(),
        "the synthetic global filter must run when it is not suppressed"
    );
    fs::remove_file(&marker).expect("reset marker");

    let repository = synthetic_repository(&git, &home, directory.path(), "hardened");
    let execution = GitExecution {
        executable: &git,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let mut command = Command::new(&git);
    command.args(hardening_arguments(&execution));
    command.args(["add", "--", "alpha.md"]);
    command
        .current_dir(&repository)
        .env("HOME", &home)
        .env_remove("XDG_CONFIG_HOME");
    apply_environment(&mut command, &execution);

    assert!(command.status().expect("hardened add").success());
    assert!(
        !marker.exists(),
        "a hardened invocation must never run a global filter"
    );

    let mut command = Command::new(&git);
    command.args(hardening_arguments(&execution));
    command.args(["config", "--get", "filter.synthetic.clean"]);
    command
        .current_dir(&repository)
        .env("HOME", &home)
        .env_remove("XDG_CONFIG_HOME");
    apply_environment(&mut command, &execution);
    let output = command.output().expect("hardened config");
    assert!(
        String::from_utf8_lossy(&output.stdout).trim().is_empty(),
        "the global filter must be invisible to a hardened invocation"
    );
}

/// Builds a repository whose `.gitattributes` routes Markdown through the
/// synthetic filter, so an unhardened invocation would run it.
#[cfg(unix)]
fn synthetic_repository(git: &Path, home: &Path, parent: &Path, name: &str) -> PathBuf {
    let repository = parent.join(name);
    fs::create_dir_all(&repository).expect("repository");
    assert!(
        Command::new(git)
            .env("HOME", home)
            .arg("-C")
            .arg(&repository)
            .args(["init", "--quiet", "--initial-branch", "main"])
            .status()
            .expect("git init")
            .success()
    );
    fs::write(repository.join(".gitattributes"), "*.md filter=synthetic\n").expect("attributes");
    fs::write(repository.join("alpha.md"), "synthetic note\n").expect("note");
    repository
}

#[test]
fn refuses_git_directory_indirection_and_symlinks() {
    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(&repository).expect("repository");

    assert_eq!(
        resolve_git_directory(&repository).expect("missing"),
        GitDirectoryState::Missing
    );

    fs::write(repository.join(".git"), "gitdir: ../elsewhere/.git\n").expect("git file");
    let error = resolve_git_directory(&repository).expect_err("indirection");
    assert!(error.to_string().contains("indirection"));

    fs::remove_file(repository.join(".git")).expect("remove git file");
    #[cfg(unix)]
    {
        let elsewhere = directory.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).expect("elsewhere");
        std::os::unix::fs::symlink(&elsewhere, repository.join(".git")).expect("symlink");
        assert!(resolve_git_directory(&repository).is_err());
        fs::remove_file(repository.join(".git")).expect("remove symlink");
    }

    fs::create_dir_all(repository.join(".git")).expect("git directory");
    assert_eq!(
        resolve_git_directory(&repository).expect("directory"),
        GitDirectoryState::Directory
    );
}

#[test]
fn redacts_absolute_paths_and_url_passwords() {
    let roots = vec![PathBuf::from("/synthetic/vault")];

    assert_eq!(
        redact("fatal: /synthetic/vault/notes/alpha.md is missing", &roots),
        "fatal: <repository>/notes/alpha.md is missing"
    );
    assert_eq!(
        redact(
            "remote: https://denote:secret-token@example.invalid/repo.git failed",
            &roots
        ),
        "remote: https://<redacted>@example.invalid/repo.git failed"
    );
    assert_eq!(
        redact("cloning ssh://git@example.invalid/repo.git", &roots),
        "cloning ssh://git@example.invalid/repo.git"
    );
}

// ---------------------------------------------------------------------------
// Managed repository metadata
// ---------------------------------------------------------------------------

#[test]
fn manages_encrypted_repository_metadata_without_losing_user_lines() {
    let directory = TempDir::new().expect("temp");
    let git_directory = directory.path().join(".git");
    fs::create_dir_all(git_directory.join("info")).expect("info");
    fs::write(git_directory.join("info").join("attributes"), "*.md text\n").expect("attributes");
    fs::write(
        git_directory.join("info").join("exclude"),
        "# user exclusions\nbuild/\n",
    )
    .expect("exclude");

    ensure_encrypted_repository_metadata(&git_directory).expect("metadata");
    ensure_encrypted_repository_metadata(&git_directory).expect("idempotent metadata");

    let attributes =
        fs::read_to_string(git_directory.join("info").join("attributes")).expect("attributes");
    assert!(attributes.starts_with("*.md text\n"));
    assert!(attributes.contains("* binary"));
    assert!(attributes.contains("* -text"));
    assert!(attributes.contains("* -diff"));
    assert!(attributes.contains("* -merge"));
    assert!(
        !attributes.contains(".denote/encryption.json"),
        "the manifest must not be exempted from the binary and no-merge rules"
    );
    assert!(
        !attributes.contains("!binary"),
        "no managed rule may re-enable text handling"
    );
    assert_eq!(attributes.matches("* binary").count(), 1);

    let exclude = fs::read_to_string(git_directory.join("info").join("exclude")).expect("exclude");
    assert!(exclude.starts_with("# user exclusions\nbuild/\n"));
    assert!(exclude.contains(".denote/*"));
    assert!(exclude.contains("!.denote/encryption.json"));
    assert_eq!(exclude.matches(".denote/*").count(), 1);
}

#[test]
fn reports_every_recoverable_operation_state() {
    let directory = TempDir::new().expect("temp");
    let git_directory = directory.path().join(".git");
    fs::create_dir_all(&git_directory).expect("git directory");

    let idle = detect_operation_state(&git_directory);
    assert!(!idle.merge_in_progress);
    assert!(!idle.rebase_in_progress);
    assert_eq!(idle.rebase_kind, None);

    fs::write(git_directory.join("MERGE_HEAD"), "abc\n").expect("merge head");
    fs::write(git_directory.join("CHERRY_PICK_HEAD"), "abc\n").expect("cherry pick head");
    fs::write(git_directory.join("REVERT_HEAD"), "abc\n").expect("revert head");
    fs::write(git_directory.join("BISECT_LOG"), "log\n").expect("bisect log");
    fs::create_dir_all(git_directory.join("sequencer")).expect("sequencer");
    fs::create_dir_all(git_directory.join("rebase-merge")).expect("rebase merge");

    let state = detect_operation_state(&git_directory);
    assert!(state.merge_in_progress);
    assert!(state.cherry_pick_in_progress);
    assert!(state.revert_in_progress);
    assert!(state.bisect_in_progress);
    assert!(state.sequencer_in_progress);
    assert!(state.rebase_in_progress);
    assert_eq!(state.rebase_kind.as_deref(), Some("merge"));

    fs::remove_dir_all(git_directory.join("rebase-merge")).expect("remove rebase merge");
    fs::create_dir_all(git_directory.join("rebase-apply")).expect("rebase apply");
    assert_eq!(
        detect_operation_state(&git_directory)
            .rebase_kind
            .as_deref(),
        Some("apply")
    );
}

/// A sequence paused between two commits records no head file, so the command
/// it is replaying is read from the sequencer's own to-do list. A list Denote
/// cannot read names nothing rather than the wrong operation.
#[test]
fn names_a_paused_sequence_by_the_command_it_is_replaying() {
    let directory = TempDir::new().expect("temp");
    let git_directory = directory.path().join(".git");
    let sequencer = git_directory.join("sequencer");
    fs::create_dir_all(&sequencer).expect("sequencer");

    assert_eq!(detect_operation_state(&git_directory).sequencer_kind, None);

    fs::write(
        sequencer.join("todo"),
        "# comment

revert 1111111 Record a synthetic note
revert 2222222 Record another
",
    )
    .expect("todo");
    assert_eq!(
        detect_operation_state(&git_directory)
            .sequencer_kind
            .as_deref(),
        Some("revert")
    );

    fs::write(
        sequencer.join("todo"),
        "pick 1111111 Record a synthetic note
",
    )
    .expect("todo");
    assert_eq!(
        detect_operation_state(&git_directory)
            .sequencer_kind
            .as_deref(),
        Some("cherry-pick")
    );

    fs::write(
        sequencer.join("todo"),
        "squash 1111111 Something else
",
    )
    .expect("todo");
    assert_eq!(detect_operation_state(&git_directory).sequencer_kind, None);
}

/// A paused sequence may only be resumed as the command it is actually
/// replaying, so a stale surface cannot cherry-pick-continue a revert.
#[test]
fn refuses_to_resume_a_paused_sequence_as_the_wrong_command() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(
        fixture.vault_root.join("alpha.md"),
        "base
",
    )
    .expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");
    // A sequence that is paused between commits, exactly as Git records one.
    let sequencer = fixture.vault_root.join(".git").join("sequencer");
    fs::create_dir_all(&sequencer).expect("sequencer");
    fs::write(
        sequencer.join("todo"),
        "revert 1111111 Undo a synthetic note
",
    )
    .expect("todo");

    let wrong = run(
        &fixture,
        PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::CherryPick,
        },
        None,
    )
    .expect_err("cherry-pick continue");
    assert!(
        wrong.to_string().contains("no cherry-pick in progress"),
        "{wrong}"
    );

    // The revert it really is passes the guard and reaches Git, which is then
    // the only thing that decides the outcome.
    let abort = run(
        &fixture,
        PluginGitRequest::Abort {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Revert,
        },
        None,
    )
    .expect("abort reaches Git");
    assert!(
        !abort.stderr.contains("Denote"),
        "the host must not refuse the operation the sequence is replaying: {}",
        abort.stderr
    );
}

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

#[test]
fn rejects_relative_missing_and_non_git_executables() {
    assert!(resolve_git_executable(Some("git")).is_err());
    assert!(resolve_git_executable(Some("relative/git")).is_err());

    let directory = TempDir::new().expect("temp");
    let missing = directory.path().join("absent-git");
    assert!(resolve_git_executable(Some(&missing.to_string_lossy())).is_err());

    assert!(resolve_git_executable(Some(&directory.path().to_string_lossy())).is_err());

    #[cfg(unix)]
    {
        let impostor = write_script(
            directory.path(),
            "impostor",
            "#!/bin/sh\necho 'not git version 2.0.0'\n",
        );
        assert!(resolve_git_executable(Some(&impostor.to_string_lossy())).is_err());

        let pretender = write_script(
            directory.path(),
            "pretender",
            "#!/bin/sh\necho 'git version 2.99.0'\n",
        );
        assert_eq!(
            resolve_git_executable(Some(&pretender.to_string_lossy())).expect("resolved"),
            fs::canonicalize(&pretender).expect("canonical")
        );
    }
}

#[cfg(unix)]
fn write_script(directory: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = directory.join(name);
    fs::write(&path, body).expect("script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("permissions");
    path
}

/// Stands in for the host-owned empty global configuration in tests that build
/// a `GitExecution` directly.
fn empty_global_config(directory: &Path) -> PathBuf {
    let path = directory.join("empty-global-config");
    fs::write(&path, b"").expect("global config");
    path
}

#[test]
fn an_unconfigured_executable_resolves_the_default_git() {
    let Ok(default) = resolve_git_executable(None) else {
        eprintln!("Skipping default executable resolution: no Git executable is available.");
        return;
    };

    assert!(default.is_absolute());
}

#[test]
fn accepts_a_valid_absolute_custom_git_executable() {
    let Ok(default) = resolve_git_executable(None) else {
        eprintln!("Skipping custom executable resolution: no Git executable is available.");
        return;
    };

    assert_eq!(
        resolve_git_executable(Some(&default.to_string_lossy())).expect("resolved"),
        default
    );
}

/// The host owns the Git executable: tests configure the manager's persisted
/// settings exactly the way Denote's own settings surface does.
fn set_git_executable_setting(fixture: &GitFixture, path: &str) {
    let mut settings = serde_json::Map::new();
    settings.insert(
        super::settings::GIT_EXECUTABLE_SETTING.to_string(),
        serde_json::Value::String(path.to_string()),
    );
    fixture
        .manager
        .set_settings(PLUGIN_ID, serde_json::Value::Object(settings))
        .expect("settings");
}

/// The reserved setting defaults to an empty string, which names no executable
/// at all, so an ordinary install stays on the pinned default Git.
#[test]
fn an_empty_executable_setting_names_no_executable() {
    let Some(fixture) = fixture() else {
        return;
    };

    assert_eq!(
        fixture
            .manager
            .git_executable_setting(PLUGIN_ID)
            .expect("setting"),
        None
    );

    set_git_executable_setting(&fixture, "   ");
    assert_eq!(
        fixture
            .manager
            .git_executable_setting(PLUGIN_ID)
            .expect("setting"),
        None
    );

    set_git_executable_setting(&fixture, "/opt/synthetic/bin/git");
    assert_eq!(
        fixture
            .manager
            .git_executable_setting(PLUGIN_ID)
            .expect("setting"),
        Some("/opt/synthetic/bin/git".to_string())
    );
}

/// A custom executable is read from host-owned persisted settings and is
/// validated exactly like a default one, so a real request honours it.
#[test]
fn runs_a_request_with_the_custom_git_executable_from_settings() {
    let Some(fixture) = fixture() else {
        return;
    };
    let default = resolve_git_executable(None).expect("git");

    set_git_executable_setting(&fixture, &default.to_string_lossy());
    let result = run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);

    set_git_executable_setting(&fixture, "git");
    let rejected = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("relative executable");
    assert!(rejected.to_string().contains("absolute"));
}

/// A request is a request. Nothing a plugin sends, whatever it is named, can
/// reach executable resolution, and the transport keeps using the executable
/// the host has on file.
#[cfg(unix)]
#[test]
fn a_request_payload_can_never_inject_a_git_executable() {
    let Some(fixture) = fixture() else {
        return;
    };
    let marker = fixture.data.path().join("injected-executable-ran");
    let impostor = write_script(
        fixture.data.path(),
        "injected-git",
        &format!(
            "#!/bin/sh\ntouch {}\necho 'git version 2.99.0'\n",
            marker.display()
        ),
    );
    let injected = serde_json::json!({
        "operation": "status",
        "scope": "vault",
        "executablePath": impostor.to_string_lossy(),
        "options": { "executablePath": impostor.to_string_lossy() },
        "gitExecutablePath": impostor.to_string_lossy(),
    });

    let request: PluginGitRequest =
        serde_json::from_value(injected).expect("undeclared fields are dropped");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let status = run(&fixture, request, None).expect("status");

    assert_eq!(status.exit_code, 0, "{}", status.stderr);
    assert!(
        !marker.exists(),
        "a request payload must never choose the executable"
    );
    assert_eq!(
        fixture
            .manager
            .git_executable_setting(PLUGIN_ID)
            .expect("setting"),
        None,
        "a request must never write the host-owned setting"
    );
}

#[cfg(unix)]
#[test]
fn a_request_refuses_a_non_git_custom_executable() {
    let Some(fixture) = fixture() else {
        return;
    };
    let impostor = write_script(
        fixture.data.path(),
        "impostor-git",
        "#!/bin/sh\necho 'not git version 2.0.0'\n",
    );
    set_git_executable_setting(&fixture, &impostor.to_string_lossy());

    let error = run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect_err("non-Git executable");

    assert!(error.to_string().contains("did not identify itself as Git"));
}

/// Cancellation addresses an operation that already resolved its executable,
/// so it never resolves one of its own.
#[test]
fn cancellation_resolves_no_executable() {
    let Some(fixture) = fixture() else {
        return;
    };
    // Even a setting that could never resolve leaves cancellation working.
    set_git_executable_setting(&fixture, "relative/git");

    let result = run(
        &fixture,
        PluginGitRequest::Cancel {
            operation_id: new_operation_id(),
        },
        None,
    )
    .expect("cancel");

    assert!(!result.cancelled);
    assert_eq!(result.exit_code, 0);
}

// ---------------------------------------------------------------------------
// End-to-end synthetic repositories
// ---------------------------------------------------------------------------

pub(super) struct GitFixture {
    pub(super) data: TempDir,
    /// Retained so the plugin download cache outlives the fixture.
    _cache: TempDir,
    pub(super) db_path: PathBuf,
    pub(super) vault_root: PathBuf,
    pub(super) manager: PluginManager,
    pub(super) app_state: Arc<db::AppState>,
}

pub(super) fn git_manager(data: &TempDir, cache: &TempDir) -> PluginManager {
    let mut catalog = catalog();
    for capability in ["git", "automatic-local-commit"] {
        catalog.manifest.permissions.push(PluginPermission {
            capability: capability.to_string(),
            hosts: vec![],
            executables: BTreeMap::new(),
        });
    }
    // A Git plugin manifest declares the reserved executable setting as an
    // ordinary host-rendered string whose default is empty, exactly as the
    // Denote Git plugin will.
    catalog.manifest.settings = Some(serde_json::json!({
        "properties": {
            (super::settings::GIT_EXECUTABLE_SETTING): {
                "type": "string",
                "title": "Git executable",
                "default": "",
            },
            (super::settings::GITHUB_EXECUTABLE_SETTING): {
                "type": "string",
                "title": "GitHub CLI executable",
                "default": "",
            },
        },
    }));
    let manager = manager(catalog.clone(), data, cache);
    {
        let mut state = manager.state().expect("state");
        state.enabled.insert(catalog.manifest.id.clone());
        state.approved_permissions.insert(
            catalog.manifest.id.clone(),
            catalog.manifest.permissions.iter().cloned().collect(),
        );
    }
    manager
}

pub(super) fn fixture() -> Option<GitFixture> {
    if resolve_git_executable(None).is_err() {
        eprintln!("Skipping Git transport fixture: no Git executable is available.");
        return None;
    }
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let db_path = data.path().join("denote.db");
    db::initialize(&db_path).expect("database");
    let vault_root = data.path().join("synthetic-vault");
    fs::create_dir_all(&vault_root).expect("vault");
    let vault_root = fs::canonicalize(vault_root).expect("canonical vault");
    let manager = git_manager(&data, &cache);
    let app_state = Arc::new(db::AppState::new(db_path.clone(), Some(vault_root.clone())));
    Some(GitFixture {
        data,
        db_path,
        vault_root,
        manager,
        app_state,
        _cache: cache,
    })
}

fn run(
    fixture: &GitFixture,
    request: PluginGitRequest,
    project_id: Option<&str>,
) -> crate::error::AppResult<super::git::PluginGitResult> {
    run_as(fixture, request, project_id, &new_operation_id())
}

fn run_as(
    fixture: &GitFixture,
    request: PluginGitRequest,
    project_id: Option<&str>,
    operation_id: &str,
) -> crate::error::AppResult<super::git::PluginGitResult> {
    super::commands::git_request_with_app_state(
        &fixture.manager,
        &fixture.app_state,
        PLUGIN_ID,
        request,
        &fixture.vault_root.to_string_lossy(),
        project_id,
        operation_id,
    )
}

/// The host runtime generates one canonical UUID per Git invocation.
pub(super) fn new_operation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn identify(repository: &Path) {
    for arguments in [
        ["config", "user.name", "Synthetic Author"],
        ["config", "user.email", "synthetic@example.invalid"],
    ] {
        let status = Command::new(resolve_git_executable(None).expect("git"))
            .arg("-C")
            .arg(repository)
            .args(arguments)
            .status()
            .expect("git config");
        assert!(status.success());
    }
}

#[test]
fn initializes_stages_commits_and_reports_a_vault_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");

    let discover = run(
        &fixture,
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("discover");
    assert_eq!(
        discover.stdout,
        r#"{"encrypted":false,"initialized":false}"#
    );

    let initialize = run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    assert_eq!(initialize.exit_code, 0, "{}", initialize.stderr);
    identify(&fixture.vault_root);

    let discover = run(
        &fixture,
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("discover");
    assert_eq!(discover.stdout, r#"{"encrypted":false,"initialized":true}"#);

    let status = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("status");
    assert_eq!(status.exit_code, 0, "{}", status.stderr);
    assert!(status.stdout.contains("alpha.md"));

    let stage = run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    assert_eq!(stage.exit_code, 0, "{}", stage.stderr);

    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Index,
            paths: None,
        },
        None,
    )
    .expect("diff");
    assert!(diff.stdout.contains("synthetic note"));

    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);

    let history = run(
        &fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 10,
            skip: None,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history");
    assert!(history.stdout.contains("Record synthetic note"));

    let branches = run(
        &fixture,
        PluginGitRequest::ListBranches {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("branches");
    assert!(branches.stdout.contains("refs/heads/main"));

    let branch = run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: None,
            checkout: true,
        },
        None,
    )
    .expect("branch");
    assert_eq!(branch.exit_code, 0, "{}", branch.stderr);

    let state = run(
        &fixture,
        PluginGitRequest::OperationState {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("state");
    assert!(state.stdout.contains(r#""mergeInProgress":false"#));
}

#[test]
fn commit_identity_wins_over_repository_configuration() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");

    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: Some("Configured Author".to_string()),
            author_email: Some("configured@example.invalid".to_string()),
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);

    let history = run(
        &fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 1,
            skip: None,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history");
    assert!(
        history.stdout.contains("Configured Author"),
        "{}",
        history.stdout
    );
    assert!(
        !history.stdout.contains("Synthetic Author"),
        "{}",
        history.stdout
    );
}

/// Git reads `$EMAIL` whenever no `user.email` is configured, so an address
/// inherited from whatever launched Denote would be stamped onto a commit the
/// user never gave an identity for.
#[test]
fn ambient_email_cannot_supply_an_omitted_commit_identity() {
    let Some(fixture) = fixture() else {
        return;
    };
    const AMBIENT_EMAIL: &str = "ambient@example.invalid";
    let git = resolve_git_executable(None).expect("git");

    // Every Git child in this process has `EMAIL` removed, which is the
    // behaviour under test, so setting it here cannot change another test.
    unsafe { std::env::set_var("EMAIL", AMBIENT_EMAIL) };
    let control = commit_author_email_without_denote(&git, &fixture.data.path().join("control"));

    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    // Only a name is configured. The email is the value Git has to invent, and
    // `$EMAIL` is where it would look first.
    git_config(&git, &fixture.vault_root, "user.name", "Synthetic Author");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    let recorded = if commit.exit_code == 0 {
        author_email(&git, &fixture.vault_root)
    } else {
        // Refusing the commit outright is also proof: Git had no address left.
        String::new()
    };
    unsafe { std::env::remove_var("EMAIL") };

    assert_eq!(
        control, AMBIENT_EMAIL,
        "the fixture must prove Git really does read $EMAIL, otherwise the regression is vacuous"
    );
    assert_ne!(recorded, AMBIENT_EMAIL, "{}", commit.stderr);
}

/// Runs one commit through plain Git, so the test knows the ambient value it is
/// guarding against is one Git would otherwise have used.
fn commit_author_email_without_denote(git: &Path, repository: &Path) -> String {
    fs::create_dir_all(repository).expect("control repository");
    let status = Command::new(git)
        .arg("-C")
        .arg(repository)
        .args(["init", "--quiet", "--initial-branch=main"])
        .env("GIT_CONFIG_GLOBAL", repository.join("absent-config"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git init");
    assert!(status.success());
    fs::write(repository.join("beta.md"), "control note\n").expect("note");
    let status = Command::new(git)
        .arg("-C")
        .arg(repository)
        .args(["add", "beta.md"])
        .env("GIT_CONFIG_GLOBAL", repository.join("absent-config"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git add");
    assert!(status.success());
    let status = Command::new(git)
        .arg("-C")
        .arg(repository)
        .args([
            "-c",
            "user.name=Control Author",
            "commit",
            "--quiet",
            "--no-gpg-sign",
            "--message",
            "Record control note",
        ])
        .env("GIT_CONFIG_GLOBAL", repository.join("absent-config"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git commit");
    assert!(status.success());
    author_email(git, repository)
}

fn author_email(git: &Path, repository: &Path) -> String {
    let output = Command::new(git)
        .arg("-C")
        .arg(repository)
        .args(["log", "--max-count=1", "--format=%ae"])
        .output()
        .expect("git log");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn git_config(git: &Path, repository: &Path, key: &str, value: &str) {
    let status = Command::new(git)
        .arg("-C")
        .arg(repository)
        .args(["config", key, value])
        .status()
        .expect("git config");
    assert!(status.success());
}

/// A tab in an author name or a subject used to shift every field after it out
/// of place. The NUL delimited report keeps each record exactly seven fields
/// wide no matter what text the repository holds.
#[test]
fn history_records_survive_tabs_in_an_author_name_and_a_subject() {
    let Some(fixture) = fixture() else {
        return;
    };
    let git = resolve_git_executable(None).expect("git");
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    git_config(&git, &fixture.vault_root, "user.name", "Synthetic\tAuthor");
    git_config(
        &git,
        &fixture.vault_root,
        "user.email",
        "synthetic@example.invalid",
    );
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record\ta synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);

    let history = run(
        &fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 10,
            skip: None,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history");

    let fields: Vec<&str> = history.stdout.split('\0').collect();
    // One commit is seven fields plus the empty remainder after the record's
    // own NUL terminator.
    assert_eq!(fields.len(), 8, "{:?}", fields);
    assert_eq!(fields[2], "Synthetic\tAuthor");
    assert_eq!(fields[6], "Record\ta synthetic note");
    assert_eq!(fields[7], "");
    assert_eq!(fields[0].len(), 40, "{:?}", fields);
    assert_eq!(fields[4], "");
    assert!(fields[5].contains("main"), "{:?}", fields);
}

#[test]
fn runs_project_scoped_requests_against_the_captured_project_root() {
    let Some(fixture) = fixture() else {
        return;
    };
    let project_root = fixture.vault_root.join("code");
    fs::create_dir_all(&project_root).expect("project");
    fs::write(project_root.join("beta.md"), "project note\n").expect("note");
    let connection = db::open(&fixture.db_path).expect("connection");
    let vault_id = db::ensure_vault(
        &connection,
        &fixture.vault_root.to_string_lossy(),
        "Synthetic Vault",
    )
    .expect("vault record");
    let project_id =
        db::ensure_project_root(&connection, vault_id, "code", true).expect("project record");
    drop(connection);

    assert!(
        run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Project,
            },
            None,
        )
        .is_err(),
        "project scope without a project must fail"
    );

    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Project,
            default_branch: "main".to_string(),
        },
        Some(&project_id),
    )
    .expect("initialize");
    identify(&project_root);

    let status = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Project,
        },
        Some(&project_id),
    )
    .expect("status");
    assert!(status.stdout.contains("beta.md"));

    // The vault root has no repository of its own, proving the scopes differ.
    assert!(
        run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault,
            },
            None,
        )
        .is_err()
    );
}

#[test]
fn rejects_requests_after_a_vault_switch() {
    let Some(fixture) = fixture() else {
        return;
    };
    let other_vault = fixture.data.path().join("other-vault");
    fs::create_dir_all(&other_vault).expect("other vault");
    fixture
        .app_state
        .set_active_vault(fs::canonicalize(&other_vault).expect("canonical"))
        .expect("switch vault");

    let error = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("stale lease");
    assert!(error.to_string().contains("vault switch"));
}

#[test]
fn refuses_to_run_in_a_hostile_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let hooks = fixture.vault_root.join(".git").join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let marker = fixture.data.path().join("hook-ran");
    #[cfg(unix)]
    {
        write_script(
            &hooks,
            "pre-commit",
            &format!("#!/bin/sh\ntouch {}\n", marker.display()),
        );
    }
    let mut config =
        fs::read_to_string(fixture.vault_root.join(".git").join("config")).expect("config");
    config.push_str("[filter \"denote\"]\n\tclean = touch /tmp/denote-pwned\n");
    fs::write(fixture.vault_root.join(".git").join("config"), config).expect("hostile config");

    let error = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("hostile configuration");
    assert!(error.to_string().contains("filter"));
    assert!(!marker.exists());
}

#[cfg(unix)]
#[test]
fn never_runs_repository_hooks() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    let hooks = fixture.vault_root.join(".git").join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let marker = fixture.data.path().join("hook-ran");
    write_script(
        &hooks,
        "pre-commit",
        &format!("#!/bin/sh\ntouch {}\nexit 1\n", marker.display()),
    );
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");

    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");

    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);
    assert!(!marker.exists(), "the repository hook must not run");
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

pub(super) fn encrypt_fixture(fixture: &GitFixture) -> crypto::VaultKey {
    let (mut manifest, vault_key, _) =
        crypto::create_manifest("correct horse battery staple").expect("manifest");
    crypto::save_manifest(&fixture.vault_root, &manifest).expect("save manifest");
    vault::encrypt_vault_contents(
        &fixture.db_path,
        &fixture.vault_root.to_string_lossy(),
        &vault_key.copy_bytes(),
    )
    .expect("encrypt");
    manifest.phase = crypto::EncryptionPhase::Encrypted;
    crypto::save_manifest(&fixture.vault_root, &manifest).expect("seal manifest");
    vault_key
}

#[test]
fn encrypted_vaults_stage_ciphertext_and_keep_git_metadata_intact() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    let head_before = fs::read(fixture.vault_root.join(".git").join("HEAD")).expect("head");

    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");

    let stage = run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    assert_eq!(stage.exit_code, 0, "{}", stage.stderr);
    let commit = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record encrypted note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);

    let stored = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit {
                commit: "HEAD".to_string(),
            },
            paths: None,
        },
        None,
    )
    .expect("diff");
    assert!(
        !stored.stdout.contains("synthetic note"),
        "plaintext must never be stored: {}",
        stored.stdout
    );
    assert!(stored.stdout.contains("Binary files"));

    assert_eq!(
        fs::read(fixture.vault_root.join(".git").join("HEAD")).expect("head"),
        head_before
    );
    let attributes = fs::read_to_string(
        fixture
            .vault_root
            .join(".git")
            .join("info")
            .join("attributes"),
    )
    .expect("attributes");
    assert!(attributes.contains("* -merge"));
    assert!(crypto::is_encrypted_file(
        &fs::read(fixture.vault_root.join("alpha.md")).expect("file")
    ));
    assert!(
        fs::read_to_string(crypto::manifest_path(&fixture.vault_root))
            .expect("manifest")
            .contains("phase")
    );
}

/// `git stash push --include-untracked` removes untracked files from the
/// worktree, which in an encrypted vault can take the encryption manifest with
/// it and leave the ciphertext unreadable. The request is refused before any
/// Git command runs, and a tracked-only stash still works.
#[test]
fn encrypted_vaults_refuse_to_stash_untracked_files() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);

    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    for request in [
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record encrypted note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
    ] {
        let result = run(&fixture, request, None).expect("prepare");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    // The manifest is deliberately left untracked here, which is exactly the
    // file an untracked stash would carry away.
    let manifest_path = crypto::manifest_path(&fixture.vault_root);
    let manifest_before = fs::read(&manifest_path).expect("manifest");
    fs::write(fixture.vault_root.join("alpha.md"), "changed note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("sweep the changed note into ciphertext");
    let ciphertext_before = fs::read(fixture.vault_root.join("alpha.md")).expect("note");

    let refused = run(
        &fixture,
        PluginGitRequest::Stash {
            scope: PluginGitScope::Vault,
            action: PluginGitStashAction::Push,
            message: Some("Synthetic stash".to_string()),
            include_untracked: true,
            entry: None,
        },
        None,
    )
    .expect_err("untracked stash");

    assert!(
        refused.to_string().contains("cannot stash untracked files"),
        "{refused}"
    );
    assert_eq!(
        fs::read(&manifest_path).expect("manifest"),
        manifest_before,
        "the encryption manifest must stay in the vault"
    );
    assert_eq!(
        fs::read(fixture.vault_root.join("alpha.md")).expect("note"),
        ciphertext_before,
        "the worktree ciphertext must stay untouched"
    );
    let stashes = run(
        &fixture,
        PluginGitRequest::Stash {
            scope: PluginGitScope::Vault,
            action: PluginGitStashAction::List,
            message: None,
            include_untracked: false,
            entry: None,
        },
        None,
    )
    .expect("stash list");
    assert!(
        stashes.stdout.trim().is_empty(),
        "no stash may be created: {}",
        stashes.stdout
    );

    // Stashing tracked changes only leaves untracked files alone, so it stays
    // available on an encrypted vault.
    let tracked = run(
        &fixture,
        PluginGitRequest::Stash {
            scope: PluginGitScope::Vault,
            action: PluginGitStashAction::Push,
            message: Some("Synthetic tracked stash".to_string()),
            include_untracked: false,
            entry: None,
        },
        None,
    )
    .expect("tracked stash");
    assert_eq!(tracked.exit_code, 0, "{}", tracked.stderr);
    assert!(manifest_path.is_file(), "the manifest is never stashed");
    assert!(crypto::is_encrypted_file(
        &fs::read(fixture.vault_root.join("alpha.md")).expect("file")
    ));
}

#[test]
fn blocks_operations_while_the_vault_is_locked_or_mid_maintenance() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let vault_key = encrypt_fixture(&fixture);

    let locked = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("locked vault");
    assert!(matches!(locked, crate::error::AppError::Locked));

    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    let mut manifest = crypto::load_manifest(&fixture.vault_root)
        .expect("load manifest")
        .expect("manifest");
    manifest.phase = crypto::EncryptionPhase::Encrypting;
    crypto::save_manifest(&fixture.vault_root, &manifest).expect("save manifest");

    let maintenance = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("incomplete maintenance");
    assert!(
        maintenance
            .to_string()
            .contains("maintenance is incomplete")
    );
}

#[cfg(unix)]
#[test]
fn blocks_operations_when_the_encryption_sweep_cannot_verify_a_file() {
    use std::os::unix::fs::PermissionsExt;

    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    let unreadable = fixture.vault_root.join("unreadable.md");
    fs::write(&unreadable, "plain").expect("file");
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).expect("permissions");

    let error = run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect_err("sweep failure");

    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o600)).expect("restore");
    assert!(error.to_string().contains("could not be verified"));
}

#[test]
fn encrypted_conflict_resolution_refuses_plaintext_content() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");

    let error = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Content {
                content_base64: "c3ludGhldGlj".to_string(),
            },
        },
        None,
    )
    .expect_err("plaintext resolution");
    assert!(error.to_string().contains("whole side"));
}

// ---------------------------------------------------------------------------
// Cancellation and process cleanup
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn cancels_a_running_read_only_operation_and_leaves_no_child() {
    use super::git::{GitExecution, GitOperationRegistry, GitPlanStep, run_git_plan};

    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let marker = directory.path().join("finished");
    let slow = write_script(
        directory.path(),
        "slow-git",
        &format!("#!/bin/sh\nsleep 30\ntouch {}\n", marker.display()),
    );
    let registry = Arc::new(GitOperationRegistry::default());
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    let operation_id = token.operation_id.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker_registry = Arc::clone(&registry);
    let worker = thread::spawn(move || {
        let execution = GitExecution {
            executable: &slow,
            repository_root: &repository,
            hooks_directory: &hooks,
            global_config: &global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let steps = vec![GitPlanStep::Command {
            args: vec!["status".to_string()],
            mutating: false,
            output: GitOutputMode::Redacted,
        }];
        let result = run_git_plan(&steps, &execution, &token);
        worker_registry.finish(&token.operation_id);
        result_tx.send(result).expect("result");
    });

    thread::sleep(Duration::from_millis(300));
    assert!(
        registry.cancel(PLUGIN_ID, &operation_id).expect("cancel"),
        "the plugin must be able to cancel its own operation"
    );

    let result = result_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("cancelled result")
        .expect("result");
    worker.join().expect("worker");

    assert!(result.cancelled);
    assert_eq!(result.exit_code, -1);
    assert!(result.stdout.contains("mergeInProgress"));
    assert!(!marker.exists(), "the child process must be killed");
}

#[cfg(unix)]
#[test]
fn plugin_cancellation_is_scoped_and_lifecycle_cancellation_is_forced() {
    use super::git::GitOperationRegistry;

    let registry = GitOperationRegistry::default();
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");

    assert!(
        !registry
            .cancel("denote.other", &token.operation_id)
            .expect("cancel"),
        "a plugin cannot cancel another plugin's operation"
    );
    assert!(
        !registry
            .cancel(PLUGIN_ID, "unknown-operation")
            .expect("cancel"),
        "unknown operations report no match"
    );
    assert!(
        registry
            .cancel(PLUGIN_ID, &token.operation_id)
            .expect("cancel")
    );

    registry.cancel_plugin(PLUGIN_ID);
    registry.cancel_all();
    registry.finish(&token.operation_id);
    assert!(
        !registry
            .cancel(PLUGIN_ID, &token.operation_id)
            .expect("cancel"),
        "finished operations are removed from the registry"
    );
}

#[cfg(unix)]
#[test]
fn a_mutating_command_reaches_its_boundary_before_cancellation_stops_the_plan() {
    use super::git::{GitExecution, GitOperationRegistry, GitPlanStep, run_git_plan};

    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let marker = directory.path().join("committed");
    let second = directory.path().join("second-step");
    let script = write_script(
        directory.path(),
        "boundary-git",
        &format!(
            "#!/bin/sh\nfor argument in \"$@\"; do\n  if [ \"$argument\" = \"second\" ]; then\n    touch {}\n    exit 0\n  fi\ndone\nsleep 1\ntouch {}\n",
            second.display(),
            marker.display()
        ),
    );
    let registry = Arc::new(GitOperationRegistry::default());
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    let operation_id = token.operation_id.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker_registry = Arc::clone(&registry);
    let worker = thread::spawn(move || {
        let execution = GitExecution {
            executable: &script,
            repository_root: &repository,
            hooks_directory: &hooks,
            global_config: &global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let steps = vec![
            GitPlanStep::Command {
                args: vec!["commit".to_string()],
                mutating: true,
                output: GitOutputMode::Redacted,
            },
            GitPlanStep::Command {
                args: vec!["second".to_string()],
                mutating: true,
                output: GitOutputMode::Redacted,
            },
        ];
        let result = run_git_plan(&steps, &execution, &token);
        worker_registry.finish(&token.operation_id);
        result_tx.send(result).expect("result");
    });

    thread::sleep(Duration::from_millis(200));
    registry.cancel(PLUGIN_ID, &operation_id).expect("cancel");

    let result = result_rx
        .recv_timeout(Duration::from_secs(20))
        .expect("cancelled result")
        .expect("result");
    worker.join().expect("worker");

    assert!(result.cancelled);
    assert!(
        marker.exists(),
        "the mutating command must reach its own boundary"
    );
    assert!(
        !second.exists(),
        "the plan must stop at the next command boundary"
    );
}

#[test]
fn refuses_ext_and_file_command_transports_configured_inside_a_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let marker = fixture.data.path().join("transport-ran");
    let config_path = fixture.vault_root.join(".git").join("config");
    let mut config = fs::read_to_string(&config_path).expect("config");
    config.push_str(&format!(
        "[remote \"origin\"]\n\turl = ext::sh -c \"touch {} >&2\"\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
        marker.display()
    ));
    fs::write(&config_path, config).expect("ext remote");

    let fetch = run(
        &fixture,
        PluginGitRequest::Fetch {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            prune: false,
        },
        None,
    )
    .expect("fetch result");

    assert_ne!(fetch.exit_code, 0);
    assert!(!marker.exists(), "the ext transport must never execute");

    let source = fixture.data.path().join("source-repository");
    fs::create_dir_all(&source).expect("source");
    let config = fs::read_to_string(&config_path).expect("config");
    fs::write(
        &config_path,
        config.replace(
            &format!("ext::sh -c \"touch {} >&2\"", marker.display()),
            &format!("file://{}", source.display()),
        ),
    )
    .expect("file remote");

    let fetch = run(
        &fixture,
        PluginGitRequest::Fetch {
            auth_mode: PluginGitAuthMode::Public,
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            prune: false,
        },
        None,
    )
    .expect("fetch result");
    assert_ne!(fetch.exit_code, 0, "the file transport must be refused");
}

#[test]
fn rejects_option_injection_before_starting_a_process() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let marker = fixture.data.path().join("injected");

    for request in [
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec![format!("--output={}", marker.display())],
        },
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "--orphan".to_string(),
        },
        PluginGitRequest::AddRemote {
            scope: PluginGitScope::Vault,
            name: "origin".to_string(),
            url: "--upload-pack=touch".to_string(),
        },
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 1,
            skip: None,
            r#ref: Some("--all".to_string()),
            path: None,
        },
    ] {
        assert!(run(&fixture, request, None).is_err());
    }
    assert!(!marker.exists());
}

#[cfg(unix)]
#[test]
fn conflict_resolution_refuses_symlinked_and_escaping_targets() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let outside = fixture.data.path().join("outside.md");
    fs::write(&outside, "original\n").expect("outside file");
    std::os::unix::fs::symlink(&outside, fixture.vault_root.join("linked.md")).expect("symlink");

    // A symbolic link that is not in conflict is stopped by the index
    // precondition before the transport looks at the worktree at all.
    let error = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "linked.md".to_string(),
            resolution: PluginGitConflictResolution::Content {
                content_base64: "cmVwbGFjZWQ=".to_string(),
            },
        },
        None,
    )
    .expect_err("symlinked target");
    assert!(error.to_string().contains("not in conflict"));
    assert_eq!(
        fs::read_to_string(&outside).expect("outside file"),
        "original\n"
    );

    assert!(
        run(
            &fixture,
            PluginGitRequest::ResolveConflict {
                scope: PluginGitScope::Vault,
                path: "../outside.md".to_string(),
                resolution: PluginGitConflictResolution::Content {
                    content_base64: "cmVwbGFjZWQ=".to_string(),
                },
            },
            None,
        )
        .is_err()
    );
    assert_eq!(
        fs::read_to_string(&outside).expect("outside file"),
        "original\n"
    );
}

#[cfg(unix)]
#[test]
fn a_conflicted_path_replaced_by_a_symbolic_link_is_still_refused() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };
    let outside = fixture.data.path().join("outside.md");
    fs::write(&outside, "original\n").expect("outside file");
    fs::remove_file(fixture.vault_root.join("alpha.md")).expect("remove conflicted file");
    std::os::unix::fs::symlink(&outside, fixture.vault_root.join("alpha.md")).expect("symlink");

    let error = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Content {
                content_base64: "cmVwbGFjZWQ=".to_string(),
            },
        },
        None,
    )
    .expect_err("symlinked conflicted target");

    assert!(error.to_string().contains("symbolic links"));
    assert_eq!(
        fs::read_to_string(&outside).expect("outside file"),
        "original\n"
    );
}

// ---------------------------------------------------------------------------
// Bounded output
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn oversized_output_plan(
    directory: &TempDir,
    steps: Vec<GitPlanStep>,
) -> crate::error::AppResult<super::git::PluginGitResult> {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    // Nine mebibytes written in one burst, so the command is already finished
    // by the time the supervising loop looks at it again.
    let flood = write_script(
        directory.path(),
        "flood-git",
        "#!/bin/sh\ndd if=/dev/zero bs=1048576 count=9 2>/dev/null\n",
    );
    let registry = GitOperationRegistry::default();
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    let execution = GitExecution {
        executable: &flood,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let result = run_git_plan(&steps, &execution, &token);
    registry.finish(&token.operation_id);
    result
}

#[cfg(unix)]
#[test]
fn refuses_output_over_the_cap_even_when_the_command_finishes_immediately() {
    let directory = TempDir::new().expect("temp");

    let error = oversized_output_plan(
        &directory,
        vec![GitPlanStep::Command {
            args: vec!["status".to_string()],
            mutating: false,
            output: GitOutputMode::Redacted,
        }],
    )
    .expect_err("bounded output");

    assert!(
        error.to_string().contains("8 MiB"),
        "output over the cap must fail loudly: {error}"
    );
}

#[cfg(unix)]
#[test]
fn oversized_conflict_stage_output_is_never_written_to_the_worktree() {
    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    fs::write(repository.join("alpha.md"), "original\n").expect("note");

    let error = oversized_output_plan(
        &directory,
        vec![
            GitPlanStep::Command {
                args: vec!["cat-file".to_string()],
                mutating: false,
                output: GitOutputMode::Redacted,
            },
            GitPlanStep::WriteFile {
                path: "alpha.md".to_string(),
                source: GitWriteSource::PreviousOutput,
            },
        ],
    )
    .expect_err("bounded output");

    assert!(error.to_string().contains("8 MiB"));
    assert_eq!(
        fs::read_to_string(repository.join("alpha.md")).expect("note"),
        "original\n",
        "truncated output must never reach the worktree"
    );
}

// ---------------------------------------------------------------------------
// Caller-generated operation identity
// ---------------------------------------------------------------------------

#[test]
fn validates_operation_ids_and_refuses_duplicate_live_ones() {
    use super::git::GitOperationRegistry;

    for invalid in [
        "",
        "operation-1",
        "11111111-2222-4333-8444-55555555555",
        "11111111222243338444555555555555",
        "11111111-2222-4333-8444-55555555555z",
    ] {
        assert!(
            validate_operation_id(invalid).is_err(),
            "operation ID should be rejected: {invalid}"
        );
    }
    let operation_id = new_operation_id();
    assert!(validate_operation_id(&operation_id).is_ok());

    let registry = GitOperationRegistry::default();
    let token = registry
        .register(PLUGIN_ID, &operation_id)
        .expect("first registration");
    assert_eq!(token.operation_id, operation_id);
    assert!(
        registry.register(PLUGIN_ID, "operation-1").is_err(),
        "malformed operation IDs never reach the registry"
    );
    assert!(
        registry.register(PLUGIN_ID, &operation_id).is_err(),
        "a live operation ID cannot be reused"
    );
    assert!(
        registry.register("denote.other", &operation_id).is_err(),
        "another plugin cannot claim a live operation ID"
    );

    registry.finish(&operation_id);
    let reused = registry
        .register(PLUGIN_ID, &operation_id)
        .expect("finished IDs are free again");
    registry.finish(&reused.operation_id);
}

#[test]
fn runs_and_cancels_under_the_operation_id_the_caller_already_holds() {
    let Some(fixture) = fixture() else {
        return;
    };
    let operation_id = new_operation_id();

    let initialized = run_as(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
        &operation_id,
    )
    .expect("initialize");
    assert_eq!(initialized.operation_id, operation_id);

    assert!(
        run_as(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault
            },
            None,
            "operation-1",
        )
        .is_err(),
        "a malformed operation ID never starts a process"
    );

    let unknown = new_operation_id();
    let cancelled = run(
        &fixture,
        PluginGitRequest::Cancel {
            operation_id: unknown.clone(),
        },
        None,
    )
    .expect("cancel");
    assert_eq!(cancelled.operation_id, unknown);
    assert!(!cancelled.cancelled);
    assert!(cancelled.stderr.contains("No matching Git operation"));

    assert!(
        run(
            &fixture,
            PluginGitRequest::Cancel {
                operation_id: "operation-1".to_string(),
            },
            None,
        )
        .is_err(),
        "a malformed cancellation target is refused"
    );
}

// ---------------------------------------------------------------------------
// Conflict resolution preconditions
// ---------------------------------------------------------------------------

fn git_output(repository: &Path, arguments: &[&str]) -> String {
    let output = Command::new(resolve_git_executable(None).expect("git"))
        .arg("-C")
        .arg(repository)
        .args(arguments)
        .output()
        .expect("git output");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Builds a synthetic repository whose `alpha.md` is genuinely in conflict,
/// alongside an ordinary tracked file and an untracked file.
fn conflicted_fixture() -> Option<GitFixture> {
    let fixture = fixture()?;
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::create_dir_all(fixture.vault_root.join("notes")).expect("notes folder");
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    fs::write(fixture.vault_root.join("gamma.md"), "tracked\n").expect("gamma");
    fs::write(fixture.vault_root.join("notes").join("delta.md"), "base\n").expect("delta");
    commit_all(&fixture, "Record synthetic base");

    run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: None,
            checkout: true,
        },
        None,
    )
    .expect("create branch");
    fs::write(fixture.vault_root.join("alpha.md"), "topic side\n").expect("alpha");
    fs::write(
        fixture.vault_root.join("notes").join("delta.md"),
        "topic side\n",
    )
    .expect("delta");
    commit_all(&fixture, "Record the topic side");

    run(
        &fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "main".to_string(),
        },
        None,
    )
    .expect("checkout main");
    fs::write(fixture.vault_root.join("alpha.md"), "main side\n").expect("alpha");
    fs::write(
        fixture.vault_root.join("notes").join("delta.md"),
        "main side\n",
    )
    .expect("delta");
    commit_all(&fixture, "Record the main side");

    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge result");
    assert_ne!(merge.exit_code, 0, "the merge must conflict");
    assert!(
        !git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty(),
        "alpha.md must be unmerged"
    );
    fs::write(fixture.vault_root.join("beta.md"), "untracked\n").expect("beta");
    Some(fixture)
}

fn commit_all(fixture: &GitFixture, message: &str) {
    run(
        fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec![
                "alpha.md".to_string(),
                "gamma.md".to_string(),
                "notes/delta.md".to_string(),
            ],
        },
        None,
    )
    .expect("stage");
    let commit = run(
        fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: message.to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);
}

#[test]
fn refuses_to_resolve_a_path_that_is_not_in_conflict() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    // A tracked file, an untracked file, and a folder that merely contains a
    // conflict all fail the index precondition.
    for path in ["gamma.md", "beta.md", "notes"] {
        for resolution in [
            PluginGitConflictResolution::Content {
                content_base64: "b3ZlcndyaXR0ZW4=".to_string(),
            },
            PluginGitConflictResolution::Stage {
                stage: PluginGitConflictStage::Theirs,
            },
        ] {
            let error = run(
                &fixture,
                PluginGitRequest::ResolveConflict {
                    scope: PluginGitScope::Vault,
                    path: path.to_string(),
                    resolution,
                },
                None,
            )
            .expect_err("resolution without a conflict");
            assert!(
                error.to_string().contains("not in conflict"),
                "unexpected error for {path}: {error}"
            );
        }
    }

    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("gamma.md")).expect("gamma"),
        "tracked\n",
        "a tracked file must never be overwritten"
    );
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("beta.md")).expect("beta"),
        "untracked\n",
        "an untracked file must never be overwritten"
    );
}

#[test]
fn resolves_an_actual_conflict_with_content_and_with_a_side() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    let resolved = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            // "merged\n"
            resolution: PluginGitConflictResolution::Content {
                content_base64: "bWVyZ2VkCg==".to_string(),
            },
        },
        None,
    )
    .expect("resolve conflict");

    assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "merged\n"
    );
    assert!(
        git_output(
            &fixture.vault_root,
            &["ls-files", "--unmerged", "--", "alpha.md"]
        )
        .is_empty(),
        "the resolved path must leave the unmerged index"
    );
    assert!(
        !git_output(
            &fixture.vault_root,
            &["ls-files", "--unmerged", "--", "notes/delta.md"]
        )
        .is_empty(),
        "an unrelated conflict must stay untouched"
    );

    let Some(second) = conflicted_fixture() else {
        return;
    };
    let resolved = run(
        &second,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Stage {
                stage: PluginGitConflictStage::Theirs,
            },
        },
        None,
    )
    .expect("resolve conflict");

    assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);
    assert_eq!(
        fs::read_to_string(second.vault_root.join("alpha.md")).expect("alpha"),
        "topic side\n"
    );
    assert!(
        git_output(
            &second.vault_root,
            &["ls-files", "--unmerged", "--", "alpha.md"]
        )
        .is_empty()
    );
}

/// Cancelling while the final staging command of a conflict resolution runs
/// must never leave the index resolved and the worktree unresolved. The
/// resolution either did not happen at all or happened completely.
#[cfg(unix)]
#[test]
fn cancelling_the_final_conflict_staging_never_splits_the_index_from_the_worktree() {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let Some(fixture) = conflicted_fixture() else {
        return;
    };
    let git = resolve_git_executable(None).expect("git");
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let staging = directory.path().join("staging-started");
    // Real Git performs every step against the real conflicted repository. The
    // wrapper only widens the window in which a cancellation can land on the
    // final staging command.
    let script = write_script(
        directory.path(),
        "slow-add-git",
        &format!(
            "#!/bin/sh\nfor argument in \"$@\"; do\n  if [ \"$argument\" = \"add\" ]; then\n    touch {}\n    sleep 1\n    break\n  fi\ndone\nexec {} \"$@\"\n",
            staging.display(),
            git.display()
        ),
    );
    let conflicted = fs::read(fixture.vault_root.join("alpha.md")).expect("conflicted alpha");
    assert!(
        conflicted.starts_with(b"<<<<<<<"),
        "the fixture must leave conflict markers in the worktree"
    );
    let steps = plan_git_request(&PluginGitRequest::ResolveConflict {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        // "resolved by hand\n"
        resolution: PluginGitConflictResolution::Content {
            content_base64: "cmVzb2x2ZWQgYnkgaGFuZAo=".to_string(),
        },
    })
    .expect("plan");

    let registry = Arc::new(GitOperationRegistry::default());
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    let operation_id = token.operation_id.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker_registry = Arc::clone(&registry);
    let worker_steps = steps.clone();
    let worker_script = script.clone();
    let worker_hooks = hooks.clone();
    let worker_global_config = global_config.clone();
    let repository = fixture.vault_root.clone();
    let worker = thread::spawn(move || {
        let execution = GitExecution {
            executable: &worker_script,
            repository_root: &repository,
            hooks_directory: &worker_hooks,
            global_config: &worker_global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let result = run_git_plan(&worker_steps, &execution, &token);
        worker_registry.finish(&token.operation_id);
        result_tx.send(result).expect("result");
    });

    for _ in 0..400 {
        if staging.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    assert!(staging.exists(), "the staging command must start");
    registry.cancel(PLUGIN_ID, &operation_id).expect("cancel");

    let result = result_rx
        .recv_timeout(Duration::from_secs(30))
        .expect("plan result")
        .expect("result");
    worker.join().expect("worker");

    let worktree = fs::read(fixture.vault_root.join("alpha.md")).expect("alpha");
    let unmerged = git_output(
        &fixture.vault_root,
        &["ls-files", "--unmerged", "--", "alpha.md"],
    );
    if unmerged.is_empty() {
        // Fully resolved: the staged blob and the worktree file must agree.
        assert_eq!(
            git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
            "resolved by hand\n",
            "the index must hold the resolution"
        );
        assert_eq!(
            worktree, b"resolved by hand\n",
            "a staged resolution must never be rolled back out of the worktree"
        );
        assert!(!result.cancelled, "a completed resolution is not cancelled");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        // The merge is still recoverable, and the resolved path is no longer
        // eligible for another resolution.
        assert!(fixture.vault_root.join(".git").join("MERGE_HEAD").exists());
        let token = registry
            .register(PLUGIN_ID, &new_operation_id())
            .expect("token");
        let execution = GitExecution {
            executable: &script,
            repository_root: &fixture.vault_root,
            hooks_directory: &hooks,
            global_config: &global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let error = run_git_plan(&steps, &execution, &token).expect_err("already resolved");
        registry.finish(&token.operation_id);
        assert!(error.to_string().contains("not in conflict"));
    } else {
        // Fully unresolved: the original conflicted file must be intact and the
        // resolution must still be retryable.
        assert!(result.cancelled);
        assert_eq!(
            worktree, conflicted,
            "an unstaged resolution must put the conflicted file back"
        );
        let token = registry
            .register(PLUGIN_ID, &new_operation_id())
            .expect("token");
        let execution = GitExecution {
            executable: &script,
            repository_root: &fixture.vault_root,
            hooks_directory: &hooks,
            global_config: &global_config,
            redacted_roots: vec![],
            askpass: None,
            encrypted: false,
            transport: GitTransportPolicy::RemoteOnly,
        };
        let retried = run_git_plan(&steps, &execution, &token).expect("retry");
        registry.finish(&token.operation_id);
        assert_eq!(retried.exit_code, 0, "{}", retried.stderr);
        assert_eq!(
            fs::read(fixture.vault_root.join("alpha.md")).expect("alpha"),
            b"resolved by hand\n"
        );
        assert_eq!(
            git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
            "resolved by hand\n"
        );
    }
}

#[cfg(unix)]
#[test]
fn restores_the_original_file_when_staging_a_resolution_fails() {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    fs::write(repository.join("alpha.md"), "original\n").expect("note");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let failing = write_script(directory.path(), "failing-git", "#!/bin/sh\nexit 1\n");
    let registry = GitOperationRegistry::default();
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    let execution = GitExecution {
        executable: &failing,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };

    let result = run_git_plan(
        &[
            GitPlanStep::WriteFile {
                path: "alpha.md".to_string(),
                source: GitWriteSource::Literal(b"replaced\n".to_vec()),
            },
            GitPlanStep::Command {
                args: vec!["add".to_string()],
                mutating: true,
                output: GitOutputMode::Redacted,
            },
        ],
        &execution,
        &token,
    )
    .expect("plan result");
    registry.finish(&token.operation_id);

    assert_eq!(result.exit_code, 1);
    assert_eq!(
        fs::read_to_string(repository.join("alpha.md")).expect("note"),
        "original\n",
        "a failed staging step must put the original file back"
    );

    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    run_git_plan(
        &[
            GitPlanStep::WriteFile {
                path: "delta.md".to_string(),
                source: GitWriteSource::Literal(b"replaced\n".to_vec()),
            },
            GitPlanStep::Command {
                args: vec!["add".to_string()],
                mutating: true,
                output: GitOutputMode::Redacted,
            },
        ],
        &execution,
        &token,
    )
    .expect("plan result");
    registry.finish(&token.operation_id);

    assert!(
        !repository.join("delta.md").exists(),
        "a file that did not exist before must not survive a failed staging step"
    );
}

// ---------------------------------------------------------------------------
// Same-line repository configuration
// ---------------------------------------------------------------------------

#[test]
fn refuses_command_bearing_configuration_written_beside_a_section_header() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let config_path = fixture.vault_root.join(".git").join("config");
    let baseline = fs::read_to_string(&config_path).expect("config");

    for (hostile, expected) in [
        ("[core] sshCommand = touch {marker}\n", "core.sshcommand"),
        ("[core] askpass = touch {marker}\n", "core.askpass"),
        ("[credential] helper = !touch {marker}\n", "credential"),
        (
            "[merge \"denote\"] driver = touch {marker}\n",
            "merge.driver",
        ),
        ("[filter \"denote\"] clean = touch {marker}\n", "filter"),
    ] {
        let marker = fixture.data.path().join("config-helper-ran");
        let mut config = baseline.clone();
        config.push_str(&hostile.replace("{marker}", &marker.display().to_string()));
        fs::write(&config_path, &config).expect("hostile config");

        let error = run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault,
            },
            None,
        )
        .expect_err("hostile configuration");
        assert!(
            error.to_string().contains(expected),
            "expected {expected} in: {error}"
        );
        assert!(!marker.exists(), "no configured helper may run: {hostile}");
    }

    fs::write(&config_path, &baseline).expect("restore config");
    assert!(
        run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault
            },
            None,
        )
        .is_ok(),
        "an ordinary configuration still runs"
    );
}

/// Git discards a comment before it ever looks for a line continuation, so a
/// commented backslash must never hide the command-bearing configuration on
/// the next line. The proof is end to end: the request is refused before any
/// Git command starts, and the configured helper never runs.
#[test]
fn refuses_command_bearing_configuration_hidden_behind_a_commented_continuation() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    let config_path = fixture.vault_root.join(".git").join("config");
    let baseline = fs::read_to_string(&config_path).expect("config");

    for (hostile, expected) in [
        (
            "; \\\n[filter \"denote\"]\n\tclean = touch {marker}\n",
            "filter",
        ),
        ("# \\\n[include]\n\tpath = ../evil-config\n", "include"),
        (
            "[core]\n; \\\n\tsshCommand = touch {marker}\n",
            "core.sshcommand",
        ),
        ("[core]\n# \\\n\thooksPath = {marker}\n", "core.hookspath"),
        // A comment ends the value it follows, so its trailing backslash
        // cannot continue onto the next line either.
        (
            "[core]\n\tbare = false ; \\\n\tpager = touch {marker}\n",
            "core.pager",
        ),
        // A blank line ends a continued value the same way.
        (
            "[core]\n\tbare = false \\\n\n\teditor = touch {marker}\n",
            "core.editor",
        ),
    ] {
        let marker = fixture.data.path().join("commented-continuation-ran");
        let mut config = baseline.clone();
        config.push_str(&hostile.replace("{marker}", &marker.display().to_string()));
        fs::write(&config_path, &config).expect("hostile config");

        let error = run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault,
            },
            None,
        )
        .expect_err("hostile configuration");
        assert!(
            error.to_string().contains(expected),
            "expected {expected} in: {error}"
        );
        assert!(!marker.exists(), "no configured helper may run: {hostile}");
    }

    fs::write(&config_path, &baseline).expect("restore config");
    assert!(
        run(
            &fixture,
            PluginGitRequest::Status {
                scope: PluginGitScope::Vault
            },
            None,
        )
        .is_ok(),
        "an ordinary configuration still runs"
    );
}

#[cfg(unix)]
#[test]
fn pinned_configuration_beats_repository_configuration_when_git_actually_runs() {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let Ok(executable) = resolve_git_executable(None) else {
        eprintln!("Skipping Git hardening fixture: no Git executable is available.");
        return;
    };
    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(&repository).expect("repository");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    assert!(
        Command::new(&executable)
            .arg("-C")
            .arg(&repository)
            .args(["init", "--quiet", "--initial-branch", "main"])
            .status()
            .expect("git init")
            .success()
    );
    identify(&repository);
    let registry = GitOperationRegistry::default();
    let execution = GitExecution {
        executable: &executable,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let run_plan = |request: PluginGitRequest| {
        let token = registry
            .register(PLUGIN_ID, &new_operation_id())
            .expect("token");
        let steps = plan_git_request(&request).expect("plan");
        let result = run_git_plan(&steps, &execution, &token).expect("result");
        registry.finish(&token.operation_id);
        result
    };

    fs::write(repository.join("alpha.md"), "one\n").expect("note");
    run_plan(PluginGitRequest::Stage {
        scope: PluginGitScope::Vault,
        paths: vec!["alpha.md".to_string()],
    });
    let commit = run_plan(PluginGitRequest::Commit {
        scope: PluginGitScope::Vault,
        message: "Record synthetic note".to_string(),
        amend: false,
        allow_empty: false,
        author_name: None,
        author_email: None,
    });
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);

    // The repository asks for an external diff helper on the same line as its
    // section header. Only the pinned command-line configuration and the fixed
    // argument template stand between it and execution here.
    let marker = directory.path().join("helper-ran");
    let mut config = fs::read_to_string(repository.join(".git").join("config")).expect("config");
    config.push_str(&format!(
        "[diff] external = touch {}\n[core] sshCommand = touch {}\n",
        marker.display(),
        marker.display()
    ));
    fs::write(repository.join(".git").join("config"), config).expect("hostile config");
    fs::write(repository.join("alpha.md"), "two\n").expect("note");

    let diff = run_plan(PluginGitRequest::Diff {
        scope: PluginGitScope::Vault,
        target: PluginGitDiffTarget::Worktree,
        paths: None,
    });

    assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
    assert!(diff.stdout.contains("+two"), "{}", diff.stdout);
    assert!(
        !marker.exists(),
        "a repository-configured helper must never execute"
    );
}

// ---------------------------------------------------------------------------
// Hunk staging
// ---------------------------------------------------------------------------

fn hunk_line(kind: PluginGitHunkLineKind, content: &str) -> PluginGitHunkLine {
    PluginGitHunkLine {
        kind,
        content: content.to_string(),
        no_newline_at_end_of_file: false,
    }
}

/// The one hunk that turns `beta` into `BETA` in a three-line file.
fn synthetic_hunk() -> PluginGitHunk {
    PluginGitHunk {
        old_start: 1,
        old_lines: 3,
        new_start: 1,
        new_lines: 3,
        lines: vec![
            hunk_line(PluginGitHunkLineKind::Context, "alpha"),
            hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
            hunk_line(PluginGitHunkLineKind::Addition, "BETA"),
            hunk_line(PluginGitHunkLineKind::Context, "gamma"),
        ],
    }
}

fn apply_step(request: PluginGitRequest) -> (Vec<String>, String) {
    match plan_git_request(&request).expect("plan").remove(0) {
        GitPlanStep::ApplyPatch { args, patch } => {
            (args, String::from_utf8(patch).expect("utf-8 patch"))
        }
        other => panic!("expected an apply step, found {other:?}"),
    }
}

#[test]
fn builds_one_bounded_patch_for_one_path_from_a_structured_hunk() {
    let (args, patch) = apply_step(PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "notes/my note.md".to_string(),
        hunk: synthetic_hunk(),
    });

    assert_eq!(
        args,
        vec![
            "apply",
            "--cached",
            "--no-unsafe-paths",
            "--whitespace=nowarn",
            "-p1",
            "-"
        ]
    );
    // Both names are tab terminated. Without the tab, `git apply` strips a
    // trailing timestamp-shaped word from an unquoted name, so a path such as
    // "Notes 2010-07-05" would silently be applied to "Notes" instead.
    assert_eq!(
        patch,
        concat!(
            "--- a/notes/my note.md\t\n",
            "+++ b/notes/my note.md\t\n",
            "@@ -1,3 +1,3 @@\n",
            " alpha\n",
            "-beta\n",
            "+BETA\n",
            " gamma\n",
        )
    );

    let (reverse_args, reverse_patch) = apply_step(PluginGitRequest::UnstageHunk {
        scope: PluginGitScope::Vault,
        path: "notes/my note.md".to_string(),
        hunk: synthetic_hunk(),
    });
    assert_eq!(
        reverse_args,
        vec![
            "apply",
            "--cached",
            "--no-unsafe-paths",
            "--whitespace=nowarn",
            "-p1",
            "--reverse",
            "-"
        ]
    );
    // Unstaging is the same patch read backwards, so both directions describe
    // exactly the same change.
    assert_eq!(reverse_patch, patch);
}

#[test]
fn emits_the_missing_newline_marker_only_at_the_end_of_a_side() {
    let mut hunk = PluginGitHunk {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: vec![
            hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
            hunk_line(PluginGitHunkLineKind::Addition, "BETA"),
        ],
    };
    hunk.lines[0].no_newline_at_end_of_file = true;
    hunk.lines[1].no_newline_at_end_of_file = true;

    let (_, patch) = apply_step(PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk,
    });
    assert_eq!(
        patch,
        concat!(
            "--- a/alpha.md\t\n",
            "+++ b/alpha.md\t\n",
            "@@ -1,1 +1,1 @@\n",
            "-beta\n",
            "\\ No newline at end of file\n",
            "+BETA\n",
            "\\ No newline at end of file\n",
        )
    );

    // A marker in the middle of a side would tell Git the file ends there.
    let mut misplaced = synthetic_hunk();
    misplaced.lines[0].no_newline_at_end_of_file = true;
    let error = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: misplaced,
    })
    .expect_err("misplaced marker");
    assert!(error.to_string().contains("last line of a side"));
}

#[test]
fn refuses_hunks_that_could_forge_patch_structure_or_reach_another_path() {
    let forged = |content: &str| PluginGitHunk {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: vec![
            hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
            hunk_line(PluginGitHunkLineKind::Addition, content),
        ],
    };
    for content in [
        // A newline would end the line and let the next bytes be read as a
        // second hunk, or as a header for another file.
        "BETA\n@@ -1,1 +1,1 @@",
        "BETA\r\n--- a/../../etc/passwd",
        // A NUL, or any other control character, is content Git never wrote.
        "BETA\u{0}",
    ] {
        let error = plan_git_request(&PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: forged(content),
        })
        .expect_err("forged content");
        assert!(
            error.to_string().contains("control characters"),
            "{content:?} must be refused: {error}"
        );
    }

    for path in [
        "../outside.md",
        "/etc/passwd",
        ".git/config",
        "notes/../../escape.md",
        "-not-a-path",
    ] {
        assert!(
            plan_git_request(&PluginGitRequest::StageHunk {
                scope: PluginGitScope::Vault,
                path: path.to_string(),
                hunk: synthetic_hunk(),
            })
            .is_err(),
            "{path} must be refused"
        );
    }
}

#[test]
fn refuses_hunks_that_are_incoherent_empty_or_oversized() {
    let mut mismatched = synthetic_hunk();
    mismatched.new_lines = 9;
    let error = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: mismatched,
    })
    .expect_err("mismatched counts");
    assert!(error.to_string().contains("disagrees"));

    let unchanged = PluginGitHunk {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: vec![hunk_line(PluginGitHunkLineKind::Context, "alpha")],
    };
    let error = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: unchanged,
    })
    .expect_err("nothing to stage");
    assert!(
        error
            .to_string()
            .contains("add or remove at least one line")
    );

    let empty = PluginGitHunk {
        old_start: 0,
        old_lines: 0,
        new_start: 0,
        new_lines: 0,
        lines: vec![],
    };
    assert!(
        plan_git_request(&PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: empty,
        })
        .is_err()
    );

    let oversized = PluginGitHunk {
        old_start: 1,
        old_lines: 0,
        new_start: 1,
        new_lines: 1,
        lines: vec![hunk_line(
            PluginGitHunkLineKind::Addition,
            &"a".repeat(9 * 1024),
        )],
    };
    let error = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: oversized,
    })
    .expect_err("oversized line");
    assert!(error.to_string().contains("bytes"));

    let too_many = PluginGitHunk {
        old_start: 1,
        old_lines: 0,
        new_start: 1,
        new_lines: 5001,
        lines: (0..5001)
            .map(|_| hunk_line(PluginGitHunkLineKind::Addition, "line"))
            .collect(),
    };
    let error = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: too_many,
    })
    .expect_err("too many lines");
    assert!(error.to_string().contains("between 1 and"));

    let zero_start = PluginGitHunk {
        old_start: 0,
        old_lines: 3,
        new_start: 1,
        new_lines: 3,
        lines: synthetic_hunk().lines,
    };
    assert!(
        plan_git_request(&PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: zero_start,
        })
        .is_err()
    );
}

#[test]
fn stages_and_unstages_exactly_one_hunk_in_a_real_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    // A name with a space proves the reconstructed patch survives a path Git
    // would otherwise have to disambiguate.
    let note = fixture.vault_root.join("my note.md");
    fs::write(&note, "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["my note.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record a synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    // Two separate edits, far enough apart to be two hunks.
    fs::write(&note, "alpha\nBETA\ngamma\ndelta\nepsilon\nZETA\neta\n").expect("edit");

    let staged = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "my note.md".to_string(),
            hunk: PluginGitHunk {
                old_start: 1,
                old_lines: 4,
                new_start: 1,
                new_lines: 4,
                lines: vec![
                    hunk_line(PluginGitHunkLineKind::Context, "alpha"),
                    hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
                    hunk_line(PluginGitHunkLineKind::Addition, "BETA"),
                    hunk_line(PluginGitHunkLineKind::Context, "gamma"),
                    hunk_line(PluginGitHunkLineKind::Context, "delta"),
                ],
            },
        },
        None,
    )
    .expect("stage hunk");
    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);

    // Exactly the first edit is in the index; the second is still only in the
    // working tree, and the file on disk is untouched.
    let index = git_output(&fixture.vault_root, &["cat-file", "blob", ":0:my note.md"]);
    assert_eq!(index, "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\n");
    assert_eq!(
        fs::read_to_string(&note).expect("note"),
        "alpha\nBETA\ngamma\ndelta\nepsilon\nZETA\neta\n"
    );

    let unstaged = run(
        &fixture,
        PluginGitRequest::UnstageHunk {
            scope: PluginGitScope::Vault,
            path: "my note.md".to_string(),
            hunk: PluginGitHunk {
                old_start: 1,
                old_lines: 4,
                new_start: 1,
                new_lines: 4,
                lines: vec![
                    hunk_line(PluginGitHunkLineKind::Context, "alpha"),
                    hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
                    hunk_line(PluginGitHunkLineKind::Addition, "BETA"),
                    hunk_line(PluginGitHunkLineKind::Context, "gamma"),
                    hunk_line(PluginGitHunkLineKind::Context, "delta"),
                ],
            },
        },
        None,
    )
    .expect("unstage hunk");
    assert_eq!(unstaged.exit_code, 0, "{}", unstaged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:my note.md"]),
        "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n"
    );
    assert_eq!(
        fs::read_to_string(&note).expect("note"),
        "alpha\nBETA\ngamma\ndelta\nepsilon\nZETA\neta\n",
        "unstaging a hunk must never touch the working tree"
    );
}

#[test]
fn leaves_the_index_untouched_when_a_hunk_does_not_apply() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "alpha\nbeta\ngamma\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record a synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    let before = git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]);

    let stale = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: PluginGitHunk {
                old_start: 1,
                old_lines: 3,
                new_start: 1,
                new_lines: 3,
                lines: vec![
                    hunk_line(PluginGitHunkLineKind::Context, "alpha"),
                    // The index holds "beta", so this context can never match.
                    hunk_line(PluginGitHunkLineKind::Deletion, "not-in-the-file"),
                    hunk_line(PluginGitHunkLineKind::Addition, "BETA"),
                    hunk_line(PluginGitHunkLineKind::Context, "gamma"),
                ],
            },
        },
        None,
    )
    .expect("stale hunk");

    assert_ne!(stale.exit_code, 0, "a stale hunk must not be applied");
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        before,
        "a rejected patch must leave the index exactly as it was"
    );

    let missing = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "absent.md".to_string(),
            hunk: synthetic_hunk(),
        },
        None,
    )
    .expect("missing path");
    assert_ne!(missing.exit_code, 0);
    assert!(
        missing.stderr.contains("does not exist in index"),
        "{}",
        missing.stderr
    );
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[test]
fn creates_switches_renames_and_deletes_branches_in_a_real_repository() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record the base".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");

    // Creating without checking out leaves the current branch alone.
    let created = run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "shelf".to_string(),
            start_point: Some("main".to_string()),
            checkout: false,
        },
        None,
    )
    .expect("create branch");
    assert_eq!(created.exit_code, 0, "{}", created.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );

    let checked_out = run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: Some("main".to_string()),
            checkout: true,
        },
        None,
    )
    .expect("create and check out");
    assert_eq!(checked_out.exit_code, 0, "{}", checked_out.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );

    let renamed = run(
        &fixture,
        PluginGitRequest::RenameBranch {
            scope: PluginGitScope::Vault,
            name: "shelf".to_string(),
            new_name: "archive".to_string(),
        },
        None,
    )
    .expect("rename branch");
    assert_eq!(renamed.exit_code, 0, "{}", renamed.stderr);

    let deleted = run(
        &fixture,
        PluginGitRequest::DeleteBranch {
            scope: PluginGitScope::Vault,
            name: "archive".to_string(),
            force: false,
        },
        None,
    )
    .expect("delete branch");
    assert_eq!(deleted.exit_code, 0, "{}", deleted.stderr);

    // Git itself refuses to delete the branch that is checked out, so the
    // refusal does not depend on the surface alone.
    let current = run(
        &fixture,
        PluginGitRequest::DeleteBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            force: false,
        },
        None,
    )
    .expect("delete current branch");
    assert_ne!(current.exit_code, 0);

    let switched = run(
        &fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "main".to_string(),
        },
        None,
    )
    .expect("checkout");
    assert_eq!(switched.exit_code, 0, "{}", switched.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );
}

#[test]
fn refuses_a_checkout_that_would_overwrite_uncommitted_work() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record the base".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: None,
            checkout: true,
        },
        None,
    )
    .expect("create topic");
    fs::write(fixture.vault_root.join("alpha.md"), "topic side\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record the topic side".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    run(
        &fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "main".to_string(),
        },
        None,
    )
    .expect("back to main");
    fs::write(fixture.vault_root.join("alpha.md"), "work in progress\n").expect("note");

    let blocked = run(
        &fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
        },
        None,
    )
    .expect("blocked checkout");

    assert_ne!(blocked.exit_code, 0, "{}", blocked.stdout);
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("note"),
        "work in progress\n",
        "a refused checkout must leave the working tree exactly as it was"
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );
}

#[test]
fn a_cancelled_hunk_application_never_reaches_the_index() {
    use super::git::{GitOperationRegistry, run_git_plan};

    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "alpha\nbeta\ngamma\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record a synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    fs::write(fixture.vault_root.join("alpha.md"), "alpha\nBETA\ngamma\n").expect("edit");
    let before = git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]);

    let steps = plan_git_request(&PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: synthetic_hunk(),
    })
    .expect("plan");
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let git = resolve_git_executable(None).expect("git");
    let registry = GitOperationRegistry::default();
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    // Cancelling before the plan starts is the only deterministic moment: a
    // patch that already reached Git is applied whole or not at all.
    registry
        .cancel(PLUGIN_ID, &token.operation_id)
        .expect("cancel");
    let execution = GitExecution {
        executable: &git,
        repository_root: &fixture.vault_root,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };

    let result = run_git_plan(&steps, &execution, &token).expect("plan result");
    registry.finish(&token.operation_id);

    assert!(result.cancelled);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        before,
        "a cancelled hunk must leave the index exactly as it was"
    );
}

#[test]
fn reports_vault_encryption_in_the_discover_report() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);

    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");

    let discover = run(
        &fixture,
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("discover");

    // A surface reads this to rule out stashing untracked files, which would
    // take the encryption manifest out of the vault.
    assert_eq!(discover.stdout, r#"{"encrypted":true,"initialized":true}"#);
}

/// A path whose last word looks like a timestamp is the exact shape `git apply`
/// would otherwise cut short, applying the patch to a shorter path that happens
/// to exist. The patch must reach only the path the request named.
#[test]
fn a_hunk_never_reaches_a_shorter_path_that_shares_its_prefix() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("Notes"), "alpha\nbeta\ngamma\n").expect("short note");
    fs::write(
        fixture.vault_root.join("Notes 2010-07-05"),
        "alpha\nbeta\ngamma\n",
    )
    .expect("long note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["Notes".to_string(), "Notes 2010-07-05".to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record two synthetic notes".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    fs::write(
        fixture.vault_root.join("Notes 2010-07-05"),
        "alpha\nBETA\ngamma\n",
    )
    .expect("edit");

    let staged = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "Notes 2010-07-05".to_string(),
            hunk: synthetic_hunk(),
        },
        None,
    )
    .expect("stage hunk");

    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);
    assert_eq!(
        git_output(
            &fixture.vault_root,
            &["cat-file", "blob", ":0:Notes 2010-07-05"]
        ),
        "alpha\nBETA\ngamma\n"
    );
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:Notes"]),
        "alpha\nbeta\ngamma\n",
        "the shorter path must never be staged in place of the named one"
    );
}

/// Commits `alpha.md` with the given content and returns the note's path.
fn committed_note(fixture: &GitFixture, name: &str, content: &str) -> PathBuf {
    run(
        fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    let note = fixture.vault_root.join(name);
    fs::write(&note, content).expect("note");
    run(
        fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec![name.to_string()],
        },
        None,
    )
    .expect("stage");
    run(
        fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record a synthetic note".to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    note
}

/// A note may legitimately hold this vault's own absolute path and a URL that
/// looks like it carries a password. Redaction protects diagnostics, not
/// content: were a diff redacted, the surface would quote `<repository>` back
/// in the hunk and Git would write that placeholder into the index in place of
/// the note's real bytes.
#[test]
fn a_staged_hunk_matches_the_bytes_on_disk_even_when_they_look_like_a_secret() {
    let Some(fixture) = fixture() else {
        return;
    };
    let note = committed_note(&fixture, "alpha.md", "alpha\nbeta\ngamma\n");
    let root = fixture.vault_root.to_string_lossy().into_owned();
    let credential = "https://synthetic:s3cr3t@example.invalid/vault.git";
    let sensitive = format!("Cloned {credential} into {root}");
    let edited = format!("alpha\n{sensitive}\ngamma\n");
    fs::write(&note, &edited).expect("edit");

    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Worktree,
            paths: Some(vec!["alpha.md".to_string()]),
        },
        None,
    )
    .expect("diff");

    assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
    assert!(
        diff.stdout.contains(&format!("+{sensitive}\n")),
        "a diff must report the line exactly as the file holds it: {}",
        diff.stdout
    );
    // Redaction would have rewritten both halves of that line, which is
    // precisely what must never be fed back into the index.
    let roots = vec![fixture.vault_root.clone()];
    let redacted = redact(&diff.stdout, &roots);
    assert!(redacted.contains("<repository>") && redacted.contains("<redacted>@"));
    assert_ne!(redacted, diff.stdout);

    let staged = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: PluginGitHunk {
                old_start: 1,
                old_lines: 3,
                new_start: 1,
                new_lines: 3,
                lines: vec![
                    hunk_line(PluginGitHunkLineKind::Context, "alpha"),
                    hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
                    hunk_line(PluginGitHunkLineKind::Addition, &sensitive),
                    hunk_line(PluginGitHunkLineKind::Context, "gamma"),
                ],
            },
        },
        None,
    )
    .expect("stage hunk");

    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        edited,
        "the index must hold the worktree's bytes, not a redacted stand-in"
    );
    assert_eq!(fs::read_to_string(&note).expect("note"), edited);

    // Everything that is not the content surface still hides both. A commit
    // message is ordinary output, so `list-history` redacts it.
    run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: sensitive.clone(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    let history = run(
        &fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 5,
            skip: None,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history");
    assert!(
        !history.stdout.contains(credential) && !history.stdout.contains(&root),
        "ordinary output must stay redacted: {}",
        history.stdout
    );
    assert!(history.stdout.contains("<redacted>@example.invalid"));
    assert!(history.stdout.contains("<repository>"));
}

#[test]
fn a_non_utf8_text_diff_is_refused_before_hunk_staging_can_change_bytes() {
    let Some(fixture) = fixture() else {
        return;
    };
    let note = committed_note(&fixture, "legacy.txt", "alpha\nbeta\n");
    fs::write(&note, b"alpha\ncaf\xe9\n").expect("write non-UTF-8 text");
    let index_before = fs::read(fixture.vault_root.join(".git/index")).expect("index");

    let error = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Worktree,
            paths: Some(vec!["legacy.txt".to_string()]),
        },
        None,
    )
    .expect_err("non-UTF-8 diff must be refused");

    assert!(error.to_string().contains("non-UTF-8"));
    assert_eq!(
        fs::read(fixture.vault_root.join(".git/index")).expect("index"),
        index_before
    );
    assert_eq!(fs::read(&note).expect("worktree"), b"alpha\ncaf\xe9\n");
}

/// Only a typed `diff` or `show` returns exact standard output. Standard error
/// is a diagnostic whichever command wrote it, so it is redacted even there.
#[cfg(unix)]
#[test]
fn exact_output_is_limited_to_diff_stdout_and_never_reaches_stderr() {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let directory = TempDir::new().expect("temp");
    let repository = directory.path().join("repository");
    fs::create_dir_all(repository.join(".git")).expect("repository");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let secret = format!(
        "https://synthetic:s3cr3t@example.invalid/vault.git under {}",
        repository.display()
    );
    // One script stands in for Git and writes the same bytes to both streams,
    // so the only difference the assertions can see is the output mode.
    let script = write_script(
        directory.path(),
        "echoing-git",
        &format!("#!/bin/sh\nprintf '%s\\n' \"{secret}\"\nprintf '%s\\n' \"{secret}\" >&2\n"),
    );
    let registry = GitOperationRegistry::default();
    let execution = GitExecution {
        executable: &script,
        repository_root: &repository,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![repository.clone()],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let outcome = |request: PluginGitRequest| {
        let steps = plan_git_request(&request).expect("plan");
        let token = registry
            .register(PLUGIN_ID, &new_operation_id())
            .expect("token");
        let result = run_git_plan(&steps, &execution, &token).expect("run");
        registry.finish(&token.operation_id);
        result
    };

    let diff = outcome(PluginGitRequest::Diff {
        scope: PluginGitScope::Vault,
        target: PluginGitDiffTarget::Worktree,
        paths: None,
    });
    assert_eq!(diff.stdout, format!("{secret}\n"));
    assert!(
        !diff.stderr.contains("s3cr3t") && !diff.stderr.contains(&repository.display().to_string()),
        "a diff's standard error is still a diagnostic: {}",
        diff.stderr
    );

    let show = outcome(PluginGitRequest::Diff {
        scope: PluginGitScope::Vault,
        target: PluginGitDiffTarget::Commit {
            commit: "HEAD".to_string(),
        },
        paths: None,
    });
    assert_eq!(show.stdout, format!("{secret}\n"));

    let status = outcome(PluginGitRequest::Status {
        scope: PluginGitScope::Vault,
    });
    assert!(
        !status.stdout.contains("s3cr3t"),
        "every other command stays redacted: {}",
        status.stdout
    );
    assert!(status.stdout.contains("<redacted>@example.invalid"));
    assert!(status.stdout.contains("<repository>"));
}

/// Hunk staging rebuilds a plaintext patch. An encrypted vault tracks
/// ciphertext, so the host refuses both directions before Git starts, whatever
/// a plugin surface chose to offer.
#[test]
fn encrypted_vaults_refuse_hunk_staging_in_either_direction() {
    let Some(fixture) = fixture() else {
        return;
    };
    let note = committed_note(&fixture, "alpha.md", "alpha\nbeta\ngamma\n");
    let committed = git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]);
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    let ciphertext = fs::read(&note).expect("ciphertext");

    for request in [
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: synthetic_hunk(),
        },
        PluginGitRequest::UnstageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: synthetic_hunk(),
        },
    ] {
        let error = run(&fixture, request, None).expect_err("encrypted hunk");
        assert!(
            error.to_string().contains("stage whole files"),
            "an encrypted vault must refuse hunk staging: {error}"
        );
    }

    // Neither the index nor the worktree may have moved, and no plaintext line
    // from the refused hunk may have been written anywhere.
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        committed
    );
    assert_eq!(fs::read(&note).expect("note"), ciphertext);
    assert!(
        crypto::is_encrypted_file(&ciphertext),
        "the worktree file must still be ciphertext"
    );
    assert!(
        !String::from_utf8_lossy(&ciphertext).contains("BETA"),
        "no plaintext hunk line may reach the vault"
    );
}

/// A file with CRLF endings produces hunk lines that end with a carriage
/// return. It has to survive the round trip, or the reconstructed patch would
/// not match the file it came from.
#[test]
fn carries_one_trailing_carriage_return_through_a_reconstructed_patch() {
    let (_, patch) = apply_step(PluginGitRequest::StageHunk {
        scope: PluginGitScope::Vault,
        path: "alpha.md".to_string(),
        hunk: PluginGitHunk {
            old_start: 1,
            old_lines: 3,
            new_start: 1,
            new_lines: 3,
            lines: vec![
                hunk_line(PluginGitHunkLineKind::Context, "alpha\r"),
                hunk_line(PluginGitHunkLineKind::Deletion, "beta\r"),
                hunk_line(PluginGitHunkLineKind::Addition, "BETA\r"),
                hunk_line(PluginGitHunkLineKind::Context, "gamma\r"),
            ],
        },
    });

    assert_eq!(
        patch,
        concat!(
            "--- a/alpha.md\t\n",
            "+++ b/alpha.md\t\n",
            "@@ -1,3 +1,3 @@\n",
            " alpha\r\n",
            "-beta\r\n",
            "+BETA\r\n",
            " gamma\r\n",
        )
    );

    // Only the final byte may be a carriage return. Anywhere else it is a
    // control character a request could use to forge patch structure.
    for content in ["BE\rTA", "BETA\r\r", "\rBETA", "BETA\r\n@@ -1,1 +1,1 @@"] {
        let error = plan_git_request(&PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: PluginGitHunk {
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 1,
                lines: vec![
                    hunk_line(PluginGitHunkLineKind::Deletion, "beta"),
                    hunk_line(PluginGitHunkLineKind::Addition, content),
                ],
            },
        })
        .expect_err("embedded carriage return");
        assert!(
            error.to_string().contains("control characters"),
            "{content:?} must be refused: {error}"
        );
    }
}

#[test]
fn stages_and_unstages_a_hunk_of_a_real_file_with_crlf_endings() {
    let Some(fixture) = fixture() else {
        return;
    };
    let committed = "alpha\r\nbeta\r\ngamma\r\n";
    let note = committed_note(&fixture, "alpha.md", committed);
    let edited = "alpha\r\nBETA\r\ngamma\r\n";
    fs::write(&note, edited).expect("edit");
    let crlf_hunk = || PluginGitHunk {
        old_start: 1,
        old_lines: 3,
        new_start: 1,
        new_lines: 3,
        lines: vec![
            hunk_line(PluginGitHunkLineKind::Context, "alpha\r"),
            hunk_line(PluginGitHunkLineKind::Deletion, "beta\r"),
            hunk_line(PluginGitHunkLineKind::Addition, "BETA\r"),
            hunk_line(PluginGitHunkLineKind::Context, "gamma\r"),
        ],
    };

    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Worktree,
            paths: Some(vec!["alpha.md".to_string()]),
        },
        None,
    )
    .expect("diff");
    assert!(
        diff.stdout.contains("+BETA\r\n"),
        "Git reports the carriage return as part of the line: {:?}",
        diff.stdout
    );

    let staged = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: crlf_hunk(),
        },
        None,
    )
    .expect("stage hunk");
    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        edited
    );

    let unstaged = run(
        &fixture,
        PluginGitRequest::UnstageHunk {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            hunk: crlf_hunk(),
        },
        None,
    )
    .expect("unstage hunk");
    assert_eq!(unstaged.exit_code, 0, "{}", unstaged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:alpha.md"]),
        committed
    );
    assert_eq!(
        fs::read_to_string(&note).expect("note"),
        edited,
        "unstaging a hunk must never touch the working tree"
    );
}

#[test]
fn stages_and_unstages_a_hunk_whose_lines_look_like_file_headers() {
    let Some(fixture) = fixture() else {
        return;
    };
    // A `-- ` line is what a SQL comment and an email signature separator both
    // start with, and a `++ ` line is ordinary prose. Git writes them after the
    // line marker as `--- ` and `+++ `, which is exactly what a file header
    // looks like, so both the reported diff and the rebuilt patch have to keep
    // reading them as content.
    let committed = "intro\n-- separator\nmiddle\nold tail\noutro\n";
    let note = committed_note(&fixture, "log.md", committed);
    let edited = "intro\nmiddle\n++ other.md\nnew tail\noutro\n";
    fs::write(&note, edited).expect("edit");
    let ambiguous_hunk = || PluginGitHunk {
        old_start: 1,
        old_lines: 5,
        new_start: 1,
        new_lines: 5,
        lines: vec![
            hunk_line(PluginGitHunkLineKind::Context, "intro"),
            hunk_line(PluginGitHunkLineKind::Deletion, "-- separator"),
            hunk_line(PluginGitHunkLineKind::Context, "middle"),
            hunk_line(PluginGitHunkLineKind::Deletion, "old tail"),
            hunk_line(PluginGitHunkLineKind::Addition, "++ other.md"),
            hunk_line(PluginGitHunkLineKind::Addition, "new tail"),
            hunk_line(PluginGitHunkLineKind::Context, "outro"),
        ],
    };

    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Worktree,
            paths: Some(vec!["log.md".to_string()]),
        },
        None,
    )
    .expect("diff");
    assert!(
        diff.stdout.contains("\n--- separator\n") && diff.stdout.contains("\n+++ other.md\n"),
        "Git reports the content after the marker verbatim: {:?}",
        diff.stdout
    );

    let staged = run(
        &fixture,
        PluginGitRequest::StageHunk {
            scope: PluginGitScope::Vault,
            path: "log.md".to_string(),
            hunk: ambiguous_hunk(),
        },
        None,
    )
    .expect("stage hunk");
    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:log.md"]),
        edited
    );

    let unstaged = run(
        &fixture,
        PluginGitRequest::UnstageHunk {
            scope: PluginGitScope::Vault,
            path: "log.md".to_string(),
            hunk: ambiguous_hunk(),
        },
        None,
    )
    .expect("unstage hunk");
    assert_eq!(unstaged.exit_code, 0, "{}", unstaged.stderr);
    assert_eq!(
        git_output(&fixture.vault_root, &["cat-file", "blob", ":0:log.md"]),
        committed
    );
    assert_eq!(
        fs::read_to_string(&note).expect("note"),
        edited,
        "unstaging a hunk must never touch the working tree"
    );
}

// ---------------------------------------------------------------------------
// History pages and commit diffs
// ---------------------------------------------------------------------------

/// A repository with one commit already in it, and an identity to make more.
fn history_fixture() -> Option<GitFixture> {
    let fixture = fixture()?;
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    Some(fixture)
}

/// Stages everything in the worktree and commits it through the transport.
fn commit_worktree(fixture: &GitFixture, paths: &[&str], message: &str) {
    let staged = run(
        fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: paths.iter().map(|path| (*path).to_string()).collect(),
        },
        None,
    )
    .expect("stage");
    assert_eq!(staged.exit_code, 0, "{}", staged.stderr);
    let commit = run(
        fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: message.to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);
}

/// The commit IDs one history page reports, newest first.
fn history_ids(fixture: &GitFixture, max_count: u32, skip: Option<u32>) -> Vec<String> {
    let history = run(
        fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count,
            skip,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history");
    history
        .stdout
        .split('\0')
        .collect::<Vec<_>>()
        .chunks(7)
        .filter(|record| record.len() == 7 && record[0].len() == 40)
        .map(|record| record[0].to_string())
        .collect()
}

/// Paging must walk the log exactly once: no commit repeated, none skipped.
#[test]
fn history_pages_walk_the_whole_log_without_repeating_a_commit() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    for index in 0..5 {
        fs::write(
            fixture.vault_root.join("alpha.md"),
            format!("synthetic note {index}\n"),
        )
        .expect("note");
        commit_worktree(&fixture, &["alpha.md"], &format!("Record note {index}"));
    }

    let all = history_ids(&fixture, 10, None);
    assert_eq!(all.len(), 5, "{all:?}");
    let first = history_ids(&fixture, 2, None);
    let second = history_ids(&fixture, 2, Some(2));
    let third = history_ids(&fixture, 2, Some(4));
    assert_eq!(first, all[0..2].to_vec());
    assert_eq!(second, all[2..4].to_vec());
    assert_eq!(third, all[4..5].to_vec());
    // A page past the end of the log is empty rather than an error.
    assert!(history_ids(&fixture, 2, Some(10)).is_empty());
    // One commit beyond the page is what tells a surface another page exists.
    assert_eq!(history_ids(&fixture, 3, None).len(), 3);
}

#[test]
fn history_bounds_refuse_a_page_size_or_skip_outside_the_allowed_range() {
    let request = |max_count: u32, skip: Option<u32>| PluginGitRequest::ListHistory {
        scope: PluginGitScope::Vault,
        max_count,
        skip,
        r#ref: None,
        path: None,
    };

    assert!(plan_git_request(&request(0, None)).is_err());
    assert!(plan_git_request(&request(1001, None)).is_err());
    assert!(plan_git_request(&request(20, Some(100_001))).is_err());
    assert!(plan_git_request(&request(1000, Some(100_000))).is_ok());
}

#[test]
fn history_and_diff_refuse_a_revision_or_path_that_is_not_one() {
    for revision in [
        "--upload-pack=synthetic",
        "-HEAD",
        "HEAD; rm -rf .",
        "main branch",
        "",
    ] {
        assert!(
            plan_git_request(&PluginGitRequest::ListHistory {
                scope: PluginGitScope::Vault,
                max_count: 20,
                skip: None,
                r#ref: Some(revision.to_string()),
                path: None,
            })
            .is_err(),
            "revision {revision:?} must be refused"
        );
        assert!(
            plan_git_request(&PluginGitRequest::Diff {
                scope: PluginGitScope::Vault,
                target: PluginGitDiffTarget::Commit {
                    commit: revision.to_string()
                },
                paths: None,
            })
            .is_err(),
            "commit {revision:?} must be refused"
        );
        assert!(
            plan_git_request(&PluginGitRequest::Diff {
                scope: PluginGitScope::Vault,
                target: PluginGitDiffTarget::Range {
                    from_commit: revision.to_string(),
                    to_commit: "HEAD".to_string(),
                },
                paths: None,
            })
            .is_err(),
            "range start {revision:?} must be refused"
        );
    }
    for path in ["../outside.md", "/etc/passwd", ".git/config"] {
        assert!(
            plan_git_request(&PluginGitRequest::Diff {
                scope: PluginGitScope::Vault,
                target: PluginGitDiffTarget::Worktree,
                paths: Some(vec![path.to_string()]),
            })
            .is_err(),
            "path {path:?} must be refused"
        );
        assert!(
            plan_git_request(&PluginGitRequest::ListHistory {
                scope: PluginGitScope::Vault,
                max_count: 20,
                skip: None,
                r#ref: None,
                path: Some(path.to_string()),
            })
            .is_err(),
            "history path {path:?} must be refused"
        );
    }
}

/// The three comparisons a surface can ask for describe three different
/// things, and each one is read from the repository rather than inferred.
#[test]
fn worktree_index_and_commit_diffs_describe_their_own_side() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    let note = fixture.vault_root.join("alpha.md");
    fs::write(&note, "one\ntwo\nthree\n").expect("note");
    commit_worktree(&fixture, &["alpha.md"], "Record a synthetic note");
    fs::write(&note, "one\nSTAGED\nthree\n").expect("note");
    run(
        &fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: vec!["alpha.md".to_string()],
        },
        None,
    )
    .expect("stage");
    fs::write(&note, "one\nWORKTREE\nthree\n").expect("note");

    let diff = |target: PluginGitDiffTarget| {
        run(
            &fixture,
            PluginGitRequest::Diff {
                scope: PluginGitScope::Vault,
                target,
                paths: Some(vec!["alpha.md".to_string()]),
            },
            None,
        )
        .expect("diff")
        .stdout
    };

    let worktree = diff(PluginGitDiffTarget::Worktree);
    assert!(worktree.contains("-STAGED"), "{worktree}");
    assert!(worktree.contains("+WORKTREE"), "{worktree}");
    let index = diff(PluginGitDiffTarget::Index);
    assert!(index.contains("-two"), "{index}");
    assert!(index.contains("+STAGED"), "{index}");
    assert!(!index.contains("WORKTREE"), "{index}");

    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"])
        .trim()
        .to_string();
    let commit = diff(PluginGitDiffTarget::Commit {
        commit: head.clone(),
    });
    assert!(commit.contains("new file mode"), "{commit}");
    assert!(commit.contains("+one"), "{commit}");

    // A range against the commit's own parent is empty, because the two sides
    // are the same tree.
    let range = diff(PluginGitDiffTarget::Range {
        from_commit: head.clone(),
        to_commit: head,
    });
    assert_eq!(range.trim(), "", "{range}");
}

/// One commit that adds, renames, copies, deletes, and stores binary content,
/// so the report a surface parses carries every shape at once.
#[test]
fn commit_diffs_report_additions_renames_deletions_and_binary_content() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    let root = &fixture.vault_root;
    fs::write(root.join("old name.md"), "one\ntwo\nthree\n").expect("note");
    fs::write(root.join("removed.md"), "gone\n").expect("note");
    commit_worktree(&fixture, &["old name.md", "removed.md"], "Record notes");

    fs::rename(root.join("old name.md"), root.join("new name.md")).expect("rename");
    fs::remove_file(root.join("removed.md")).expect("remove");
    fs::write(root.join("added.md"), "fresh\n").expect("note");
    // A NUL byte is what makes Git call a file binary, which is also what an
    // encrypted vault's ciphertext looks like.
    fs::write(root.join("sealed.bin"), [0u8, 159, 146, 150]).expect("binary");
    commit_worktree(
        &fixture,
        &[
            "old name.md",
            "new name.md",
            "removed.md",
            "added.md",
            "sealed.bin",
        ],
        "Rename, delete, add, and seal",
    );

    let head = git_output(root, &["rev-parse", "HEAD"]).trim().to_string();
    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit { commit: head },
            paths: None,
        },
        None,
    )
    .expect("diff")
    .stdout;

    assert!(diff.contains("rename from old name.md"), "{diff}");
    assert!(diff.contains("rename to new name.md"), "{diff}");
    assert!(diff.contains("deleted file mode"), "{diff}");
    assert!(diff.contains("new file mode"), "{diff}");
    assert!(diff.contains("Binary files"), "{diff}");
    // The commit's own header and message are not in the report at all, so a
    // surface parses the patch and nothing else.
    assert!(!diff.contains("Rename, delete, add, and seal"), "{diff}");
}

/// `format.pretty` can be set in a repository to print a commit message flush
/// left, where a message that quotes a diff header would read as another
/// changed file. The header and the message are suppressed, so it cannot.
#[test]
fn a_commit_message_cannot_be_read_as_a_changed_file() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    let git = resolve_git_executable(None).expect("git");
    git_config(&git, &fixture.vault_root, "format.pretty", "%s%n%n%b");
    fs::write(fixture.vault_root.join("alpha.md"), "one\n").expect("note");
    commit_worktree(
        &fixture,
        &["alpha.md"],
        "Record a synthetic note\n\ndiff --git a/notes/injected.md b/notes/injected.md",
    );

    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"])
        .trim()
        .to_string();
    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit { commit: head },
            paths: None,
        },
        None,
    )
    .expect("diff")
    .stdout;

    assert!(!diff.contains("notes/injected.md"), "{diff}");
    assert!(!diff.contains("Record a synthetic note"), "{diff}");
    assert!(diff.contains("diff --git a/alpha.md b/alpha.md"), "{diff}");
}

/// A merge has no ordinary one-parent diff: `show` writes a combined diff, and
/// the comparison Denote renders is the range against the first parent.
#[test]
fn merge_commits_are_readable_as_the_range_against_the_first_parent() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    let root = &fixture.vault_root;
    let note = root.join("alpha.md");
    fs::write(&note, "one\ntwo\nthree\n").expect("note");
    commit_worktree(&fixture, &["alpha.md"], "Record a synthetic note");
    run(
        &fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: "topic".to_string(),
            start_point: None,
            checkout: true,
        },
        None,
    )
    .expect("branch");
    fs::write(&note, "one\nTWO\nthree\n").expect("note");
    commit_worktree(&fixture, &["alpha.md"], "Change the middle line");
    run(
        &fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: "main".to_string(),
        },
        None,
    )
    .expect("checkout");
    fs::write(root.join("beta.md"), "beta\n").expect("note");
    commit_worktree(&fixture, &["beta.md"], "Add another note");
    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge");
    assert_eq!(merge.exit_code, 0, "{}", merge.stderr);

    let head = git_output(root, &["rev-parse", "HEAD"]).trim().to_string();
    let first_parent = git_output(root, &["rev-parse", "HEAD^1"])
        .trim()
        .to_string();
    assert_eq!(
        git_output(root, &["rev-list", "--parents", "-n", "1", "HEAD"])
            .split_whitespace()
            .count(),
        3,
        "the fixture must produce a real merge commit"
    );

    let shown = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit {
                commit: head.clone(),
            },
            paths: None,
        },
        None,
    )
    .expect("show")
    .stdout;
    // Git's own report for a merge is the combined diff, which carries no
    // single pair of line numbers.
    assert!(
        !shown.contains("diff --git"),
        "a merge's show output is combined, not ordinary: {shown}"
    );

    let range = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Range {
                from_commit: first_parent,
                to_commit: head,
            },
            paths: None,
        },
        None,
    )
    .expect("range")
    .stdout;
    assert!(
        range.contains("diff --git a/alpha.md b/alpha.md"),
        "{range}"
    );
    assert!(range.contains("+TWO"), "{range}");
}

#[test]
fn empty_commits_report_no_files_at_all() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "one\n").expect("note");
    commit_worktree(&fixture, &["alpha.md"], "Record a synthetic note");
    let empty = run(
        &fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: "Record nothing at all".to_string(),
            amend: false,
            allow_empty: true,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(empty.exit_code, 0, "{}", empty.stderr);

    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"])
        .trim()
        .to_string();
    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit { commit: head },
            paths: None,
        },
        None,
    )
    .expect("diff")
    .stdout;

    // An empty commit has no patch, and the header is not reported, so the
    // report is empty rather than a heading with nothing under it.
    assert_eq!(diff.trim(), "", "{diff}");
}

/// Everything a surface has to render exactly: a quoted non-ASCII name with a
/// space in it, carriage returns, and a file with no final newline.
#[test]
fn diffs_carry_quoted_names_carriage_returns_and_missing_final_newlines() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    let directory = fixture.vault_root.join("sub dir");
    fs::create_dir_all(&directory).expect("directory");
    let note = directory.join("café.md");
    fs::write(&note, "one\r\ntwo\r\nthree").expect("note");
    commit_worktree(&fixture, &["sub dir/café.md"], "Record a synthetic note");
    fs::write(&note, "one\r\nTWO\r\nthree without a newline").expect("note");

    let diff = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Worktree,
            paths: Some(vec!["sub dir/café.md".to_string()]),
        },
        None,
    )
    .expect("diff")
    .stdout;

    // Git C-quotes a non-ASCII name as octal bytes, and quotes the whole name
    // because it also contains a space.
    assert!(diff.contains("\"a/sub dir/caf\\303\\251.md\""), "{diff}");
    assert!(diff.contains("-two\r\n"), "{diff}");
    assert!(diff.contains("+TWO\r\n"), "{diff}");
    assert!(diff.contains("\\ No newline at end of file"), "{diff}");
}

/// An encrypted vault records ciphertext, so its history has no readable
/// lines: every note reads as binary content in every comparison.
#[test]
fn encrypted_history_reports_binary_content_and_never_plaintext() {
    let Some(fixture) = history_fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("alpha.md"), "synthetic note\n").expect("note");
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    commit_worktree(&fixture, &["alpha.md"], "Record an encrypted note");

    let head = git_output(&fixture.vault_root, &["rev-parse", "HEAD"])
        .trim()
        .to_string();
    let commit = run(
        &fixture,
        PluginGitRequest::Diff {
            scope: PluginGitScope::Vault,
            target: PluginGitDiffTarget::Commit { commit: head },
            paths: None,
        },
        None,
    )
    .expect("diff")
    .stdout;

    assert!(commit.contains("Binary files"), "{commit}");
    assert!(!commit.contains("synthetic note"), "{commit}");
    let history = run(
        &fixture,
        PluginGitRequest::ListHistory {
            scope: PluginGitScope::Vault,
            max_count: 5,
            skip: None,
            r#ref: None,
            path: None,
        },
        None,
    )
    .expect("history")
    .stdout;
    assert!(history.contains("Record an encrypted note"), "{history}");
    assert!(!history.contains("synthetic note"), "{history}");
}

// ---------------------------------------------------------------------------
// Advanced operations and conflict recovery
// ---------------------------------------------------------------------------

/// Commits exactly the named paths, so a fixture can build divergent branches
/// without depending on the shape of any other test's repository.
fn commit_paths(fixture: &GitFixture, paths: &[&str], message: &str) {
    run(
        fixture,
        PluginGitRequest::Stage {
            scope: PluginGitScope::Vault,
            paths: paths.iter().map(|path| (*path).to_string()).collect(),
        },
        None,
    )
    .expect("stage");
    let commit = run(
        fixture,
        PluginGitRequest::Commit {
            scope: PluginGitScope::Vault,
            message: message.to_string(),
            amend: false,
            allow_empty: false,
            author_name: None,
            author_email: None,
        },
        None,
    )
    .expect("commit");
    assert_eq!(commit.exit_code, 0, "{}", commit.stderr);
}

fn create_branch(fixture: &GitFixture, name: &str, checkout: bool) {
    run(
        fixture,
        PluginGitRequest::CreateBranch {
            scope: PluginGitScope::Vault,
            name: name.to_string(),
            start_point: None,
            checkout,
        },
        None,
    )
    .expect("create branch");
}

fn checkout(fixture: &GitFixture, name: &str) {
    let result = run(
        fixture,
        PluginGitRequest::CheckoutBranch {
            scope: PluginGitScope::Vault,
            name: name.to_string(),
        },
        None,
    )
    .expect("checkout");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
}

fn head_commit(fixture: &GitFixture) -> String {
    git_output(&fixture.vault_root, &["rev-parse", "HEAD"])
        .trim()
        .to_string()
}

fn operation_state(fixture: &GitFixture) -> String {
    run(
        fixture,
        PluginGitRequest::OperationState {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("operation state")
    .stdout
}

/// Two branches that changed different files, so every advanced operation has
/// something real to replay without conflicting.
fn divergent_fixture() -> Option<GitFixture> {
    let fixture = fixture()?;
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");

    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("beta.md"), "topic note\n").expect("beta");
    commit_paths(&fixture, &["beta.md"], "Record the topic note");

    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("gamma.md"), "main note\n").expect("gamma");
    commit_paths(&fixture, &["gamma.md"], "Record the main note");
    Some(fixture)
}

#[test]
fn maps_conflict_listing_to_a_fixed_template() {
    assert_eq!(
        command_args(PluginGitRequest::ListConflicts {
            scope: PluginGitScope::Vault
        }),
        vec!["ls-files", "--unmerged", "-z"]
    );
}

#[test]
fn lists_every_unmerged_path_with_its_recorded_stages() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    let listing = run(
        &fixture,
        PluginGitRequest::ListConflicts {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("list conflicts");

    assert_eq!(listing.exit_code, 0, "{}", listing.stderr);
    let records: Vec<&str> = listing
        .stdout
        .split('\0')
        .filter(|record| !record.is_empty())
        .collect();
    // Three stages for each of the two conflicted notes, and nothing else.
    assert_eq!(records.len(), 6, "{records:?}");
    for path in ["alpha.md", "notes/delta.md"] {
        for stage in ["1", "2", "3"] {
            assert!(
                records.iter().any(|record| {
                    let Some((meta, name)) = record.split_once('\t') else {
                        return false;
                    };
                    name == path && meta.split_whitespace().last() == Some(stage)
                }),
                "missing stage {stage} of {path} in {records:?}"
            );
        }
    }
    assert!(
        !listing.stdout.contains("gamma.md"),
        "an unconflicted file must not be listed"
    );
}

#[test]
fn merges_replays_and_reverses_commits_on_a_real_repository() {
    let Some(fixture) = divergent_fixture() else {
        return;
    };

    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge");

    assert_eq!(merge.exit_code, 0, "{}", merge.stderr);
    assert!(fixture.vault_root.join("beta.md").exists());
    assert!(fixture.vault_root.join("gamma.md").exists());
    assert!(!fixture.vault_root.join(".git").join("MERGE_HEAD").exists());

    // Reverting the merged commit undoes exactly that commit's change.
    let topic = git_output(&fixture.vault_root, &["rev-parse", "topic"])
        .trim()
        .to_string();
    let revert = run(
        &fixture,
        PluginGitRequest::Revert {
            scope: PluginGitScope::Vault,
            commit: topic.clone(),
        },
        None,
    )
    .expect("revert");
    assert_eq!(revert.exit_code, 0, "{}", revert.stderr);
    assert!(!fixture.vault_root.join("beta.md").exists());

    // Cherry-picking it back restores it as a new commit.
    let before = head_commit(&fixture);
    let cherry = run(
        &fixture,
        PluginGitRequest::CherryPick {
            scope: PluginGitScope::Vault,
            commit: topic,
        },
        None,
    )
    .expect("cherry-pick");
    assert_eq!(cherry.exit_code, 0, "{}", cherry.stderr);
    assert!(fixture.vault_root.join("beta.md").exists());
    assert_ne!(before, head_commit(&fixture));
}

#[test]
fn rebases_a_local_branch_without_contacting_a_remote() {
    let Some(fixture) = divergent_fixture() else {
        return;
    };
    checkout(&fixture, "topic");

    let rebase = run(
        &fixture,
        PluginGitRequest::Rebase {
            scope: PluginGitScope::Vault,
            upstream: "main".to_string(),
        },
        None,
    )
    .expect("rebase");

    assert_eq!(rebase.exit_code, 0, "{}", rebase.stderr);
    // The replayed branch now holds both notes and sits on top of main.
    assert!(fixture.vault_root.join("beta.md").exists());
    assert!(fixture.vault_root.join("gamma.md").exists());
    let ancestor = Command::new(resolve_git_executable(None).expect("git"))
        .arg("-C")
        .arg(&fixture.vault_root)
        .args(["merge-base", "--is-ancestor", "main", "HEAD"])
        .status()
        .expect("merge-base");
    assert!(ancestor.success(), "main must be an ancestor of the rebase");
    assert!(
        !fixture
            .vault_root
            .join(".git")
            .join("rebase-merge")
            .is_dir()
    );
    assert!(
        !fixture
            .vault_root
            .join(".git")
            .join("rebase-apply")
            .is_dir()
    );
}

#[test]
fn refuses_to_start_an_operation_while_another_is_in_progress() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    for request in [
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        PluginGitRequest::Rebase {
            scope: PluginGitScope::Vault,
            upstream: "topic".to_string(),
        },
        PluginGitRequest::CherryPick {
            scope: PluginGitScope::Vault,
            commit: "topic".to_string(),
        },
        PluginGitRequest::Revert {
            scope: PluginGitScope::Vault,
            commit: "HEAD".to_string(),
        },
    ] {
        let error = run(&fixture, request, None).expect_err("second operation");
        assert!(
            error
                .to_string()
                .contains("already has a merge in progress"),
            "unexpected error: {error}"
        );
    }
}

#[test]
fn refuses_to_resume_an_operation_the_repository_is_not_running() {
    let Some(fixture) = divergent_fixture() else {
        return;
    };

    for sequencer in [
        PluginGitSequencer::Merge,
        PluginGitSequencer::Rebase,
        PluginGitSequencer::CherryPick,
        PluginGitSequencer::Revert,
    ] {
        for request in [
            PluginGitRequest::Continue {
                scope: PluginGitScope::Vault,
                sequencer,
            },
            PluginGitRequest::Abort {
                scope: PluginGitScope::Vault,
                sequencer,
            },
        ] {
            let error = run(&fixture, request, None).expect_err("resume");
            assert!(
                error.to_string().contains("no"),
                "unexpected error: {error}"
            );
            assert!(
                error.to_string().contains("in progress"),
                "unexpected error: {error}"
            );
        }
    }
}

#[test]
fn a_conflicted_merge_only_offers_the_controls_that_are_valid_for_it() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    let state = operation_state(&fixture);
    assert!(state.contains("\"mergeInProgress\":true"), "{state}");
    assert!(state.contains("\"rebaseInProgress\":false"), "{state}");

    // A merge cannot be skipped, and no other operation can be resumed.
    let skip = run(
        &fixture,
        PluginGitRequest::Skip {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        },
        None,
    )
    .expect_err("merge skip");
    assert!(skip.to_string().contains("cannot be skipped"), "{skip}");

    let rebase = run(
        &fixture,
        PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Rebase,
        },
        None,
    )
    .expect_err("rebase continue");
    assert!(
        rebase.to_string().contains("no rebase in progress"),
        "{rebase}"
    );
}

#[test]
fn aborting_a_conflicted_merge_restores_the_state_before_it() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };
    let before = head_commit(&fixture);

    let abort = run(
        &fixture,
        PluginGitRequest::Abort {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        },
        None,
    )
    .expect("abort");

    assert_eq!(abort.exit_code, 0, "{}", abort.stderr);
    assert_eq!(head_commit(&fixture), before, "abort must not move HEAD");
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "main side\n",
        "abort must restore the branch's own content"
    );
    assert!(
        git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty(),
        "abort must leave no unmerged paths"
    );
    assert!(!fixture.vault_root.join(".git").join("MERGE_HEAD").exists());
    // The untracked file the fixture left behind is not the merge's to remove.
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("beta.md")).expect("beta"),
        "untracked\n"
    );
}

#[test]
fn continuing_a_merge_is_only_possible_once_every_path_is_resolved() {
    let Some(fixture) = conflicted_fixture() else {
        return;
    };

    // Git itself refuses while paths are unmerged, so a surface that offered
    // Continue too early would fail rather than corrupt anything.
    let early = run(
        &fixture,
        PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        },
        None,
    )
    .expect("early continue");
    assert_ne!(early.exit_code, 0, "{}", early.stdout);

    for path in ["alpha.md", "notes/delta.md"] {
        let resolved = run(
            &fixture,
            PluginGitRequest::ResolveConflict {
                scope: PluginGitScope::Vault,
                path: path.to_string(),
                // "merged\n"
                resolution: PluginGitConflictResolution::Content {
                    content_base64: "bWVyZ2VkCg==".to_string(),
                },
            },
            None,
        )
        .expect("resolve");
        assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);
    }

    let finished = run(
        &fixture,
        PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        },
        None,
    )
    .expect("continue");

    assert_eq!(finished.exit_code, 0, "{}", finished.stderr);
    assert!(!fixture.vault_root.join(".git").join("MERGE_HEAD").exists());
    assert!(git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty());
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "merged\n"
    );
}

/// A rebase that stops on a conflict must stay recoverable across a restart:
/// nothing in Denote holds the state, so the repository itself is asked again.
#[test]
fn a_conflicted_rebase_is_detected_skipped_and_continued() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");
    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("alpha.md"), "topic side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the topic side");
    fs::write(fixture.vault_root.join("beta.md"), "second topic note\n").expect("beta");
    commit_paths(&fixture, &["beta.md"], "Record a second topic note");
    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("alpha.md"), "main side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the main side");
    checkout(&fixture, "topic");

    let rebase = run(
        &fixture,
        PluginGitRequest::Rebase {
            scope: PluginGitScope::Vault,
            upstream: "main".to_string(),
        },
        None,
    )
    .expect("rebase");

    assert_ne!(rebase.exit_code, 0, "the rebase must conflict");
    // A fresh request reads the repository again, exactly as a restarted
    // Denote would.
    let state = operation_state(&fixture);
    assert!(state.contains("\"rebaseInProgress\":true"), "{state}");
    assert!(
        !git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty(),
        "the rebase must leave an unmerged path"
    );

    let skip = run(
        &fixture,
        PluginGitRequest::Skip {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Rebase,
        },
        None,
    )
    .expect("skip");
    assert_eq!(skip.exit_code, 0, "{}", skip.stderr);

    // Skipping the conflicting commit leaves the rest of the branch to replay,
    // and the finished rebase reports nothing in progress.
    let state = operation_state(&fixture);
    assert!(state.contains("\"rebaseInProgress\":false"), "{state}");
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "main side\n"
    );
    assert!(fixture.vault_root.join("beta.md").exists());
}

#[test]
fn a_conflicted_cherry_pick_is_resolved_and_continued() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");
    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("alpha.md"), "topic side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the topic side");
    let topic = head_commit(&fixture);
    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("alpha.md"), "main side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the main side");

    let cherry = run(
        &fixture,
        PluginGitRequest::CherryPick {
            scope: PluginGitScope::Vault,
            commit: topic,
        },
        None,
    )
    .expect("cherry-pick");
    assert_ne!(cherry.exit_code, 0, "the cherry-pick must conflict");
    let state = operation_state(&fixture);
    assert!(state.contains("\"cherryPickInProgress\":true"), "{state}");

    let resolved = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Stage {
                stage: PluginGitConflictStage::Theirs,
            },
        },
        None,
    )
    .expect("resolve");
    assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);

    let finished = run(
        &fixture,
        PluginGitRequest::Continue {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::CherryPick,
        },
        None,
    )
    .expect("continue");
    assert_eq!(finished.exit_code, 0, "{}", finished.stderr);
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "topic side\n"
    );
    let state = operation_state(&fixture);
    assert!(state.contains("\"cherryPickInProgress\":false"), "{state}");
}

#[test]
fn a_conflicted_revert_is_aborted_back_to_where_it_started() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");
    fs::write(fixture.vault_root.join("alpha.md"), "second\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the second version");
    let second = head_commit(&fixture);
    fs::write(fixture.vault_root.join("alpha.md"), "third\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the third version");
    let before = head_commit(&fixture);

    let revert = run(
        &fixture,
        PluginGitRequest::Revert {
            scope: PluginGitScope::Vault,
            commit: second,
        },
        None,
    )
    .expect("revert");
    assert_ne!(revert.exit_code, 0, "the revert must conflict");
    let state = operation_state(&fixture);
    assert!(state.contains("\"revertInProgress\":true"), "{state}");

    let abort = run(
        &fixture,
        PluginGitRequest::Abort {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Revert,
        },
        None,
    )
    .expect("abort");
    assert_eq!(abort.exit_code, 0, "{}", abort.stderr);
    assert_eq!(head_commit(&fixture), before);
    assert_eq!(
        fs::read_to_string(fixture.vault_root.join("alpha.md")).expect("alpha"),
        "third\n"
    );
    let state = operation_state(&fixture);
    assert!(state.contains("\"revertInProgress\":false"), "{state}");
}

#[test]
fn an_added_and_added_conflict_has_no_recorded_base_stage() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("alpha.md"), "base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record synthetic base");
    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("beta.md"), "topic version\n").expect("beta");
    commit_paths(&fixture, &["beta.md"], "Add the note on the topic side");
    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("beta.md"), "main version\n").expect("beta");
    commit_paths(&fixture, &["beta.md"], "Add the note on the main side");

    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge");
    assert_ne!(merge.exit_code, 0, "the merge must conflict");

    let listing = run(
        &fixture,
        PluginGitRequest::ListConflicts {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("list conflicts")
    .stdout;
    let stages: Vec<String> = listing
        .split('\0')
        .filter(|record| !record.is_empty())
        .filter_map(|record| record.split_once('\t'))
        .filter(|(_, path)| *path == "beta.md")
        .filter_map(|(meta, _)| meta.split_whitespace().last().map(str::to_string))
        .collect();
    assert_eq!(stages, vec!["2".to_string(), "3".to_string()]);

    // Reading a stage the index does not hold fails instead of returning
    // content Git never recorded.
    let base = run(
        &fixture,
        PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "beta.md".to_string(),
            stage: PluginGitConflictStage::Base,
        },
        None,
    )
    .expect("read base stage");
    assert_ne!(base.exit_code, 0, "{}", base.stdout);
    assert!(base.stdout.is_empty(), "{}", base.stdout);

    let ours = run(
        &fixture,
        PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "beta.md".to_string(),
            stage: PluginGitConflictStage::Ours,
        },
        None,
    )
    .expect("read our stage");
    assert_eq!(ours.exit_code, 0, "{}", ours.stderr);
    // "main version\n"
    assert_eq!(ours.stdout, "bWFpbiB2ZXJzaW9uCg==");
}

#[test]
fn a_binary_conflict_is_readable_as_bytes_and_resolvable_by_side() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    let base_bytes = [0u8, 1, 2, 3];
    let ours_bytes = [0u8, 1, 2, 9];
    let theirs_bytes = [0u8, 1, 2, 7];
    fs::write(fixture.vault_root.join("sealed.bin"), base_bytes).expect("sealed");
    commit_paths(&fixture, &["sealed.bin"], "Record a synthetic binary note");
    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("sealed.bin"), theirs_bytes).expect("sealed");
    commit_paths(&fixture, &["sealed.bin"], "Change it on the topic side");
    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("sealed.bin"), ours_bytes).expect("sealed");
    commit_paths(&fixture, &["sealed.bin"], "Change it on the main side");

    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge");
    assert_ne!(merge.exit_code, 0, "the merge must conflict");

    let theirs = run(
        &fixture,
        PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "sealed.bin".to_string(),
            stage: PluginGitConflictStage::Theirs,
        },
        None,
    )
    .expect("read their stage");
    assert_eq!(theirs.exit_code, 0, "{}", theirs.stderr);
    assert_eq!(theirs.stdout, "AAECBw==");

    let resolved = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "sealed.bin".to_string(),
            resolution: PluginGitConflictResolution::Stage {
                stage: PluginGitConflictStage::Theirs,
            },
        },
        None,
    )
    .expect("resolve");
    assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);
    assert_eq!(
        fs::read(fixture.vault_root.join("sealed.bin")).expect("sealed"),
        theirs_bytes
    );
}

/// An encrypted vault must never have conflict markers written into its
/// ciphertext: the managed attributes make Git refuse to line-merge it, so a
/// conflict is always a choice between whole recorded sides.
#[test]
fn encrypted_conflicts_are_whole_file_and_never_carry_markers() {
    let Some(fixture) = fixture() else {
        return;
    };
    run(
        &fixture,
        PluginGitRequest::Initialize {
            scope: PluginGitScope::Vault,
            default_branch: "main".to_string(),
        },
        None,
    )
    .expect("initialize");
    identify(&fixture.vault_root);
    let vault_key = encrypt_fixture(&fixture);
    fixture
        .app_state
        .set_vault_key(vault_key)
        .expect("unlock vault");
    // The first request writes the managed attributes for the sealed vault.
    run(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("status");
    fs::write(fixture.vault_root.join("alpha.md"), "sealed base\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record a sealed base");
    create_branch(&fixture, "topic", true);
    fs::write(fixture.vault_root.join("alpha.md"), "sealed topic side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the sealed topic side");
    checkout(&fixture, "main");
    fs::write(fixture.vault_root.join("alpha.md"), "sealed main side\n").expect("alpha");
    commit_paths(&fixture, &["alpha.md"], "Record the sealed main side");

    let merge = run(
        &fixture,
        PluginGitRequest::Merge {
            scope: PluginGitScope::Vault,
            r#ref: "topic".to_string(),
            fast_forward_only: false,
            no_commit: false,
        },
        None,
    )
    .expect("merge");
    assert_ne!(merge.exit_code, 0, "the merge must conflict");

    // The vault is sealed, so every side is ciphertext: the bytes are compared
    // with the stages Git recorded rather than with any plaintext.
    let worktree = fs::read(fixture.vault_root.join("alpha.md")).expect("alpha");
    for marker in [
        b"<<<<<<<".as_slice(),
        b">>>>>>>".as_slice(),
        b"=======".as_slice(),
    ] {
        assert!(
            !worktree
                .windows(marker.len())
                .any(|window| window == marker),
            "an encrypted conflict must never carry markers"
        );
    }
    let ours = run(
        &fixture,
        PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            stage: PluginGitConflictStage::Ours,
        },
        None,
    )
    .expect("read our stage");
    assert_eq!(
        ours.stdout,
        STANDARD.encode(&worktree),
        "the worktree must hold our recorded side untouched"
    );
    let theirs_stage = run(
        &fixture,
        PluginGitRequest::ReadConflictStage {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            stage: PluginGitConflictStage::Theirs,
        },
        None,
    )
    .expect("read their stage")
    .stdout;

    let plaintext = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Content {
                content_base64: "bWVyZ2VkCg==".to_string(),
            },
        },
        None,
    )
    .expect_err("plaintext resolution");
    assert!(plaintext.to_string().contains("whole side"), "{plaintext}");

    let resolved = run(
        &fixture,
        PluginGitRequest::ResolveConflict {
            scope: PluginGitScope::Vault,
            path: "alpha.md".to_string(),
            resolution: PluginGitConflictResolution::Stage {
                stage: PluginGitConflictStage::Theirs,
            },
        },
        None,
    )
    .expect("resolve");
    assert_eq!(resolved.exit_code, 0, "{}", resolved.stderr);
    assert_eq!(
        STANDARD.encode(fs::read(fixture.vault_root.join("alpha.md")).expect("alpha")),
        theirs_stage,
        "choosing a whole side must write exactly that recorded blob"
    );
}

/// Cancelling an abort must leave the repository in a state Denote can still
/// finish: either the merge is still in progress, or it is fully aborted.
/// Nothing may be left half applied, and nothing may run on its own afterwards.
#[test]
fn cancelling_an_abort_leaves_the_repository_recoverable() {
    use super::git::{GitExecution, GitOperationRegistry, run_git_plan};

    let Some(fixture) = conflicted_fixture() else {
        return;
    };
    let git = resolve_git_executable(None).expect("git");
    let directory = TempDir::new().expect("temp");
    let hooks = directory.path().join("hooks");
    fs::create_dir_all(&hooks).expect("hooks");
    let global_config = empty_global_config(directory.path());
    let steps = plan_git_request(&PluginGitRequest::Abort {
        scope: PluginGitScope::Vault,
        sequencer: PluginGitSequencer::Merge,
    })
    .expect("plan");

    let registry = Arc::new(GitOperationRegistry::default());
    let token = registry
        .register(PLUGIN_ID, &new_operation_id())
        .expect("token");
    // The operation is cancelled before the plan starts, which is the only
    // moment a mutating command can be stopped without reaching Git at all.
    registry
        .cancel(PLUGIN_ID, &token.operation_id)
        .expect("cancel");
    let execution = GitExecution {
        executable: &git,
        repository_root: &fixture.vault_root,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let result = run_git_plan(&steps, &execution, &token).expect("abort");
    registry.finish(&token.operation_id);

    assert!(result.cancelled);
    assert!(
        fixture.vault_root.join(".git").join("MERGE_HEAD").exists(),
        "a cancelled abort must leave the merge exactly as it was"
    );
    assert!(
        !git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty(),
        "the conflicted paths must still be unmerged"
    );

    // The same abort still works afterwards, so nothing is stuck.
    let abort = run(
        &fixture,
        PluginGitRequest::Abort {
            scope: PluginGitScope::Vault,
            sequencer: PluginGitSequencer::Merge,
        },
        None,
    )
    .expect("abort");
    assert_eq!(abort.exit_code, 0, "{}", abort.stderr);
    assert!(!fixture.vault_root.join(".git").join("MERGE_HEAD").exists());
    assert!(git_output(&fixture.vault_root, &["ls-files", "--unmerged"]).is_empty());
}
