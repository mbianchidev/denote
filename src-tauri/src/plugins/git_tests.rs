use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, mpsc},
    thread,
    time::Duration,
};

use tempfile::TempDir;

use super::{
    PluginManager,
    git::{
        GitDirectoryState, GitExecution, GitInspection, GitPlanStep, GitTransportPolicy,
        GitWriteSource, PluginGitAuthMode, PluginGitConflictResolution, PluginGitConflictStage,
        PluginGitDiffTarget, PluginGitPullStrategy, PluginGitPushMode, PluginGitRequest,
        PluginGitScope, PluginGitSequencer, PluginGitStashAction, apply_environment,
        assert_repository_config_is_safe, detect_operation_state,
        ensure_encrypted_repository_metadata, hardening_arguments, plan_git_request, redact,
        resolve_git_directory, resolve_git_executable, validate_branch_name, validate_operation_id,
        validate_remote_name, validate_remote_url, validate_revision, validated_path,
    },
    tests::{catalog, manager},
    types::PluginPermission,
};

use crate::{crypto, db, vault};

const PLUGIN_ID: &str = "denote.reference";

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
                base64_output: false,
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
                base64_output: false,
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
    assert!(exclude.contains(".denote/locks/"));
    assert!(exclude.contains(".denote/trash/"));
    assert_eq!(exclude.matches(".denote/locks/").count(), 1);
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
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
        },
        None,
    )
    .expect("discover");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);

    set_git_executable_setting(&fixture, "git");
    let rejected = run(
        &fixture,
        PluginGitRequest::Discover {
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
        PluginGitRequest::Discover {
            scope: PluginGitScope::Vault,
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
    assert_eq!(discover.stdout, r#"{"initialized":false}"#);

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
    assert_eq!(discover.stdout, r#"{"initialized":true}"#);

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
            transport: GitTransportPolicy::RemoteOnly,
        };
        let steps = vec![GitPlanStep::Command {
            args: vec!["status".to_string()],
            mutating: false,
            base64_output: false,
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
            transport: GitTransportPolicy::RemoteOnly,
        };
        let steps = vec![
            GitPlanStep::Command {
                args: vec!["commit".to_string()],
                mutating: true,
                base64_output: false,
            },
            GitPlanStep::Command {
                args: vec!["second".to_string()],
                mutating: true,
                base64_output: false,
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
            base64_output: false,
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
                base64_output: false,
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
                base64_output: false,
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
                base64_output: false,
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
