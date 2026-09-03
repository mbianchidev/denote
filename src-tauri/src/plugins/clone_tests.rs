//! Remote, authentication, and clone coverage.
//!
//! Every fixture is synthetic: repositories are created in temporary
//! directories, remote URLs point at reserved example hosts or at local bare
//! repositories, and the GitHub CLI is a small script written by the test. No
//! test reaches a network.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use tempfile::TempDir;

use super::{
    PluginManager,
    askpass::{
        ASKPASS_CONTEXT_ENV, ASKPASS_FILE_ENV, ASKPASS_MODE_ENV, AskpassMaterial, askpass_answer,
        signing_askpass_answer,
    },
    clone::{
        CloneAttempt, PluginGitCloneVaultRequest, clone_arguments, is_github_https_url,
        validate_empty_destination,
    },
    git::{
        GitExecution, GitOperationToken, GitPlanStep, GitRequestTarget, GitTransportPolicy,
        PluginGitAuthMode, PluginGitPullStrategy, PluginGitRequest, PluginGitScope,
        RemoteDirection, apply_environment, git_cli_path, git_cli_path_string, plan_git_request,
        read_remote_urls, resolve_git_executable,
    },
    git_tests::{GitFixture, fixture, identify, new_operation_id},
    github::{
        MAX_REPOSITORY_LIMIT, list_repositories, parse_repository_list, resolve_gh_executable,
    },
};

const PLUGIN_ID: &str = "denote.reference";
const SYNTHETIC_TOKEN: &str = "synthetic-token-0123456789";

// ---------------------------------------------------------------------------
// Synthetic repository helpers
// ---------------------------------------------------------------------------

fn git() -> PathBuf {
    resolve_git_executable(None).expect("git")
}

fn git_in(directory: &Path, args: &[&str]) -> std::process::Output {
    let config = empty_global_config(directory);
    let output = Command::new(git())
        .arg("-C")
        .arg(git_cli_path(directory))
        .args(args)
        .env("GIT_CONFIG_GLOBAL", git_cli_path(&config))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git");
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn stdout_of(output: std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn bare_copy(source: &Path, bare: &Path) {
    let config = empty_global_config(source);
    let output = Command::new(git())
        .args(["clone", "--bare"])
        .arg(git_cli_path(source))
        .arg(git_cli_path(bare))
        .env("GIT_CONFIG_GLOBAL", git_cli_path(&config))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git clone --bare");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Creates a bare repository holding one commit on `main`, used as a local
/// stand-in for a remote so no test needs a network.
fn synthetic_bare_remote(root: &Path) -> PathBuf {
    let source = root.join("synthetic-source");
    fs::create_dir_all(&source).expect("source");
    git_in(&source, &["init", "--initial-branch", "main"]);
    identify(&source);
    fs::write(source.join("alpha.md"), "synthetic remote note\n").expect("note");
    git_in(&source, &["add", "--", "alpha.md"]);
    git_in(&source, &["commit", "--message", "Add synthetic note"]);
    let bare = root.join("synthetic-remote.git");
    bare_copy(&source, &bare);
    bare
}

/// A bare repository has no worktree, so it is always addressed explicitly
/// rather than discovered from a directory.
fn git_bare(bare: &Path, args: &[&str]) -> std::process::Output {
    let config = empty_global_config(bare);
    let output = Command::new(git())
        .arg(format!("--git-dir={}", git_cli_path_string(bare)))
        .args(args)
        .env("GIT_CONFIG_GLOBAL", git_cli_path(&config))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git");
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn empty_global_config(path: &Path) -> PathBuf {
    let root = path.parent().unwrap_or(path);
    let config = root.join("synthetic-global-config");
    if !config.exists() {
        fs::write(&config, b"").expect("global config");
    }
    config
}

/// Runs one typed request against the fixture vault with the local transport
/// tests need to serve a bare repository from a temporary directory.
fn run_local(
    fixture: &GitFixture,
    request: PluginGitRequest,
) -> crate::error::AppResult<super::git::PluginGitResult> {
    fixture.manager.git_request_with_transport(
        PLUGIN_ID,
        request,
        GitRequestTarget {
            repository_root: &fixture.vault_root,
            redacted_roots: vec![fixture.vault_root.clone()],
            encrypted: false,
        },
        &new_operation_id(),
        GitTransportPolicy::AllowLocal,
    )
}

fn initialize_vault_repository(fixture: &GitFixture) {
    git_in(&fixture.vault_root, &["init", "--initial-branch", "main"]);
    identify(&fixture.vault_root);
    fs::write(fixture.vault_root.join("local.md"), "synthetic local\n").expect("note");
    git_in(&fixture.vault_root, &["add", "--", "local.md"]);
    git_in(&fixture.vault_root, &["commit", "--message", "Local note"]);
}

/// Writes a script that answers exactly like the GitHub CLI, so the adapter is
/// exercised end to end without installing or contacting anything. Every
/// invocation is appended to a log beside the script, so a test can prove that
/// a token was never even asked for.
#[cfg(unix)]
fn fake_gh(directory: &Path, repositories_json: &str, token: &str) -> PathBuf {
    fake_gh_script(directory, repositories_json, token, "")
}

/// The same script with an extra shell fragment that runs before `auth token`
/// answers, so a test can make the token read slow, huge, or observable.
#[cfg(unix)]
fn fake_gh_script(
    directory: &Path,
    repositories_json: &str,
    token: &str,
    auth_prelude: &str,
) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = directory.join("gh");
    let log = directory
        .join(GH_INVOCATION_LOG)
        .to_string_lossy()
        .into_owned();
    let script = format!(
        r#"#!/bin/sh
printf '%s\n' "$1 $2" >> "{log}"
if [ "$1" = "version" ]; then
  echo "gh version 2.0.0 (synthetic)"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
{auth_prelude}
  echo "{token}"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
{repositories_json}
JSON
  exit 0
fi
echo "unsupported synthetic gh invocation" >&2
exit 1
"#
    );
    fs::write(&path, script).expect("gh script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("gh mode");
    fs::canonicalize(path).expect("canonical gh")
}

#[cfg(unix)]
const GH_INVOCATION_LOG: &str = "gh-invocations.log";

/// Every invocation the synthetic GitHub CLI recorded.
#[cfg(unix)]
fn gh_invocations(tools: &Path) -> Vec<String> {
    fs::read_to_string(tools.join(GH_INVOCATION_LOG))
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

/// Askpass material currently on disk beside the host's other Git support
/// files. An operation that ended leaves none.
fn askpass_directories(fixture: &GitFixture) -> Vec<PathBuf> {
    let support = fixture.data.path().join("plugins").join("git");
    let Ok(entries) = fs::read_dir(support) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("askpass-"))
        })
        .collect()
}

#[cfg(unix)]
fn configure_github_executable(manager: &PluginManager, path: &Path) {
    let settings = serde_json::json!({
        super::settings::GITHUB_EXECUTABLE_SETTING: path.to_string_lossy(),
    });
    manager
        .set_settings(PLUGIN_ID, settings)
        .expect("github executable setting");
}

fn environment_of(command: &Command) -> Vec<(String, Option<String>)> {
    command
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Remote management
// ---------------------------------------------------------------------------

#[test]
fn adds_changes_and_removes_a_remote_through_fixed_templates() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialize_vault_repository(&fixture);

    let added = run_local(
        &fixture,
        PluginGitRequest::AddRemote {
            scope: PluginGitScope::Vault,
            name: "origin".to_string(),
            url: "https://example.invalid/synthetic.git".to_string(),
        },
    )
    .expect("add remote");
    assert_eq!(added.exit_code, 0, "{}", added.stderr);
    assert_eq!(
        stdout_of(git_in(
            &fixture.vault_root,
            &["remote", "get-url", "origin"]
        )),
        "https://example.invalid/synthetic.git"
    );

    let changed = run_local(
        &fixture,
        PluginGitRequest::SetRemoteUrl {
            scope: PluginGitScope::Vault,
            name: "origin".to_string(),
            url: "https://example.invalid/other.git".to_string(),
        },
    )
    .expect("set remote url");
    assert_eq!(changed.exit_code, 0, "{}", changed.stderr);
    assert_eq!(
        stdout_of(git_in(
            &fixture.vault_root,
            &["remote", "get-url", "origin"]
        )),
        "https://example.invalid/other.git"
    );

    let listed = run_local(
        &fixture,
        PluginGitRequest::ListRemotes {
            scope: PluginGitScope::Vault,
        },
    )
    .expect("list remotes");
    assert!(listed.stdout.contains("origin"));

    let removed = run_local(
        &fixture,
        PluginGitRequest::RemoveRemote {
            scope: PluginGitScope::Vault,
            name: "origin".to_string(),
        },
    )
    .expect("remove remote");
    assert_eq!(removed.exit_code, 0, "{}", removed.stderr);
    let remaining = run_local(
        &fixture,
        PluginGitRequest::ListRemotes {
            scope: PluginGitScope::Vault,
        },
    )
    .expect("list remotes");
    assert!(remaining.stdout.trim().is_empty());
}

#[test]
fn fetches_from_a_local_bare_remote_and_refuses_to_overwrite_it() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let bare = synthetic_bare_remote(remotes.path());
    initialize_vault_repository(&fixture);
    git_in(
        &fixture.vault_root,
        &["remote", "add", "origin", &bare.to_string_lossy()],
    );

    let fetched = run_local(
        &fixture,
        PluginGitRequest::Fetch {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            prune: true,
            auth_mode: PluginGitAuthMode::Public,
        },
    )
    .expect("fetch");
    assert_eq!(fetched.exit_code, 0, "{}", fetched.stderr);
    assert_eq!(
        stdout_of(git_in(
            &fixture.vault_root,
            &["rev-parse", "--verify", "refs/remotes/origin/main"]
        ))
        .len(),
        40
    );

    // The vault history is unrelated to the remote's, so a fast-forward pull
    // is refused rather than forced, and the refusal is reported as an
    // ordinary failure.
    let pulled = run_local(
        &fixture,
        PluginGitRequest::Pull {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            strategy: PluginGitPullStrategy::FastForwardOnly,
            auth_mode: PluginGitAuthMode::Public,
        },
    )
    .expect("pull");
    assert_ne!(pulled.exit_code, 0);
    assert!(!pulled.cancelled);

    let pushed = run_local(
        &fixture,
        PluginGitRequest::Push {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            set_upstream: true,
            mode: None,
            auth_mode: PluginGitAuthMode::Public,
        },
    )
    .expect("push");
    assert_ne!(pushed.exit_code, 0);
    assert_eq!(
        stdout_of(git_bare(&bare, &["log", "-1", "--format=%s", "main"])),
        "Add synthetic note"
    );
}

#[test]
fn pulls_and_pushes_a_shared_history_and_records_the_upstream() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let bare = synthetic_bare_remote(remotes.path());
    let output = Command::new(git())
        .arg("clone")
        .arg(git_cli_path(&bare))
        .arg(git_cli_path(&fixture.vault_root))
        .env(
            "GIT_CONFIG_GLOBAL",
            git_cli_path(&empty_global_config(&bare)),
        )
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git clone");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    identify(&fixture.vault_root);

    let pulled = run_local(
        &fixture,
        PluginGitRequest::Pull {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            strategy: PluginGitPullStrategy::FastForwardOnly,
            auth_mode: PluginGitAuthMode::Public,
        },
    )
    .expect("pull");
    assert_eq!(pulled.exit_code, 0, "{}", pulled.stderr);

    fs::write(
        fixture.vault_root.join("beta.md"),
        "second synthetic note\n",
    )
    .expect("note");
    git_in(&fixture.vault_root, &["add", "--", "beta.md"]);
    git_in(&fixture.vault_root, &["commit", "--message", "Add beta"]);

    let pushed = run_local(
        &fixture,
        PluginGitRequest::Push {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            set_upstream: true,
            mode: None,
            auth_mode: PluginGitAuthMode::Public,
        },
    )
    .expect("push");
    assert_eq!(pushed.exit_code, 0, "{}", pushed.stderr);
    assert_eq!(
        stdout_of(git_bare(&bare, &["log", "-1", "--format=%s", "main"])),
        "Add beta"
    );
    assert_eq!(
        stdout_of(git_in(
            &fixture.vault_root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}"
            ]
        )),
        "origin/main"
    );
}

#[test]
fn an_ordinary_push_never_forces() {
    let steps = plan_git_request(&PluginGitRequest::Push {
        scope: PluginGitScope::Vault,
        remote: "origin".to_string(),
        branch: "main".to_string(),
        set_upstream: false,
        mode: None,
        auth_mode: PluginGitAuthMode::Public,
    })
    .expect("plan");
    let GitPlanStep::Command { args, .. } = &steps[0] else {
        panic!("expected a command step");
    };

    assert!(!args.iter().any(|argument| argument.contains("force")));
}

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

#[test]
fn parses_only_bounded_repository_metadata() {
    let repositories = parse_repository_list(
        r#"[
          {
            "nameWithOwner": "synthetic-owner/synthetic-notes",
            "url": "https://github.com/synthetic-owner/synthetic-notes",
            "sshUrl": "ssh://git@github.com/synthetic-owner/synthetic-notes.git",
            "defaultBranchRef": { "name": "main" },
            "isPrivate": true
          },
          {
            "nameWithOwner": "synthetic-owner/rejected",
            "url": "ext::whoami",
            "sshUrl": "ssh://git@github.com/synthetic-owner/rejected.git",
            "defaultBranchRef": { "name": "main" },
            "isPrivate": false
          }
        ]"#,
        10,
    )
    .expect("parse");

    assert_eq!(repositories.len(), 1);
    let entry = &repositories[0];
    assert_eq!(entry.name_with_owner, "synthetic-owner/synthetic-notes");
    assert_eq!(
        entry.https_url,
        "https://github.com/synthetic-owner/synthetic-notes"
    );
    assert_eq!(entry.default_branch.as_deref(), Some("main"));
    assert!(entry.private);
}

#[cfg(unix)]
#[test]
fn lists_repositories_through_a_pinned_github_executable() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let gh = fake_gh(
        tools.path(),
        r#"[{"nameWithOwner":"synthetic-owner/synthetic-notes","url":"https://github.com/synthetic-owner/synthetic-notes","sshUrl":"ssh://git@github.com/synthetic-owner/synthetic-notes.git","defaultBranchRef":{"name":"main"},"isPrivate":false}]"#,
        SYNTHETIC_TOKEN,
    );
    configure_github_executable(&fixture.manager, &gh);

    let executable = resolve_gh_executable(
        fixture
            .manager
            .github_executable_setting(PLUGIN_ID)
            .expect("setting")
            .as_deref(),
    )
    .expect("resolve gh");
    let repositories = list_repositories(&executable, 5, None).expect("list");

    assert_eq!(repositories.len(), 1);
    assert_eq!(
        repositories[0].name_with_owner,
        "synthetic-owner/synthetic-notes"
    );
    // Listing is metadata only: no field carries the token the adapter used.
    let encoded = serde_json::to_string(&repositories).expect("encode");
    assert!(!encoded.contains(SYNTHETIC_TOKEN));
}

#[test]
fn refuses_a_relative_github_executable() {
    let error = resolve_gh_executable(Some("gh")).expect_err("relative path");

    assert!(error.to_string().contains("absolute"));
}

#[cfg(unix)]
#[test]
fn refuses_an_executable_that_is_not_the_github_cli() {
    use std::os::unix::fs::PermissionsExt;

    let tools = TempDir::new().expect("tools");
    let path = tools.path().join("not-gh");
    fs::write(&path, "#!/bin/sh\necho not the github cli\n").expect("script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("mode");
    let path = fs::canonicalize(path).expect("canonical");

    let error = resolve_gh_executable(Some(&path.to_string_lossy())).expect_err("rejected");

    assert!(error.to_string().contains("GitHub CLI"));
}

// ---------------------------------------------------------------------------
// Askpass credential transport
// ---------------------------------------------------------------------------

#[test]
fn answers_a_username_prompt_without_reading_the_secret() {
    let answer = askpass_answer("Username for 'https://github.com': ", None);

    assert_eq!(answer, super::askpass::GITHUB_TOKEN_USERNAME);
}

#[test]
fn answers_a_password_prompt_from_the_private_file_only() {
    let directory = TempDir::new().expect("directory");
    let file = directory.path().join("secret");
    fs::write(&file, format!("{SYNTHETIC_TOKEN}\n")).expect("secret");

    assert_eq!(
        askpass_answer("Password for 'https://github.com': ", Some(&file)),
        SYNTHETIC_TOKEN
    );
    // Without the file there is no answer, so Git fails with its own
    // authentication error instead of falling back to an interactive prompt.
    assert_eq!(
        askpass_answer("Password for 'https://github.com': ", None),
        ""
    );
}

#[test]
fn answers_only_signing_passphrase_prompts_from_the_private_file() {
    let directory = TempDir::new().expect("directory");
    let file = directory.path().join("secret");
    fs::write(&file, "synthetic-passphrase").expect("secret");

    assert_eq!(
        signing_askpass_answer(
            "Enter passphrase for \"/synthetic/id_ed25519\": ",
            Some(&file),
        ),
        "synthetic-passphrase"
    );
    assert_eq!(
        signing_askpass_answer("Password for 'https://github.com': ", Some(&file)),
        ""
    );
}

/// Every prompt shape Git can produce for a target Denote is willing to
/// authenticate to. The host in the prompt is the authority, so a token is
/// offered to these and to nothing else.
#[test]
fn answers_only_prompts_bound_to_a_github_https_host() {
    let directory = TempDir::new().expect("directory");
    let file = directory.path().join("secret");
    fs::write(&file, format!("{SYNTHETIC_TOKEN}\n")).expect("secret");

    for target in [
        "https://github.com",
        "https://www.github.com",
        // Git echoes the host as the URL spelled it, and a host is
        // case-insensitive.
        "https://GitHub.com",
        // Git prepends the username it already knows, and adds the path when
        // `credential.useHttpPath` is set.
        "https://x-access-token@github.com",
        "https://github.com/synthetic-owner/synthetic-notes.git",
        "https://x-access-token@github.com/synthetic-owner/synthetic-notes.git",
    ] {
        assert_eq!(
            askpass_answer(&format!("Username for '{target}': "), Some(&file)),
            super::askpass::GITHUB_TOKEN_USERNAME,
            "username prompt for {target}"
        );
        assert_eq!(
            askpass_answer(&format!("Password for '{target}': "), Some(&file)),
            SYNTHETIC_TOKEN,
            "password prompt for {target}"
        );
    }
}

/// The secret exists and is readable for every one of these, so an empty
/// answer can only come from the prompt binding itself.
#[test]
fn refuses_every_prompt_that_is_not_exactly_a_github_https_target() {
    let directory = TempDir::new().expect("directory");
    let file = directory.path().join("secret");
    fs::write(&file, format!("{SYNTHETIC_TOKEN}\n")).expect("secret");

    for target in [
        // Not GitHub at all.
        "https://example.invalid",
        "https://example.invalid/synthetic-owner/synthetic-notes.git",
        // Suffix and prefix lookalikes, and a subdomain.
        "https://github.com.example.invalid",
        "https://github.company.invalid",
        "https://notgithub.com",
        "https://github.com.",
        "https://api.github.com",
        "https://raw.githubusercontent.com",
        // Userinfo confusion: the real host is the one after the last `@`.
        "https://github.com@example.invalid",
        "https://github.com@example.invalid/synthetic.git",
        "https://user@github.com@example.invalid",
        // A value shaped to be read two ways.
        "https://user@evil.invalid@github.com",
        "https://user:token@github.com",
        // Port confusion.
        "https://github.com:8443",
        "https://github.com:443",
        "https://github.com:443@example.invalid",
        "https://example.invalid:github.com",
        // Not HTTPS.
        "http://github.com",
        "ssh://git@github.com/synthetic-owner/synthetic-notes.git",
        "git://github.com/synthetic-owner/synthetic-notes.git",
        "file:///synthetic/github.com",
        // Malformed.
        "https://",
        "https:///synthetic-owner",
        "github.com",
        "",
    ] {
        assert_eq!(
            askpass_answer(&format!("Username for '{target}': "), Some(&file)),
            "",
            "username prompt for {target}"
        );
        assert_eq!(
            askpass_answer(&format!("Password for '{target}': "), Some(&file)),
            "",
            "password prompt for {target}"
        );
    }
}

/// A prompt Denote cannot bind to a host is answered with nothing, whatever
/// else it says.
#[test]
fn refuses_a_prompt_with_no_single_quoted_target() {
    let directory = TempDir::new().expect("directory");
    let file = directory.path().join("secret");
    fs::write(&file, format!("{SYNTHETIC_TOKEN}\n")).expect("secret");

    for prompt in [
        // Git asks like this when it has no URL to describe.
        "Password: ",
        "Username: ",
        "",
        // A target that is quoted twice cannot be resolved to one host.
        "Password for 'https://github.com' or 'https://example.invalid': ",
        // Neither a username nor a password prompt.
        "Enter passphrase for key '/synthetic/id_ed25519': ",
        "Are you sure you want to continue connecting for 'https://github.com'? ",
        // The word only appears inside the target, so it decides nothing.
        "Confirm for 'https://username@github.com': ",
    ] {
        assert_eq!(askpass_answer(prompt, Some(&file)), "", "prompt {prompt:?}");
    }
}

/// A password prompt for the right host still answers with nothing when the
/// private file is missing, unreadable, oversized, or a link.
#[test]
fn a_bound_password_prompt_still_depends_on_the_private_file() {
    let directory = TempDir::new().expect("directory");
    let missing = directory.path().join("absent");
    let oversized = directory.path().join("oversized");
    fs::write(&oversized, "x".repeat(17 * 1024)).expect("oversized");
    let prompt = "Password for 'https://github.com': ";

    assert_eq!(askpass_answer(prompt, Some(&missing)), "");
    assert_eq!(askpass_answer(prompt, Some(&oversized)), "");
    assert_eq!(askpass_answer(prompt, Some(directory.path())), "");
}

#[cfg(unix)]
#[test]
fn askpass_material_is_private_and_is_removed_when_it_is_dropped() {
    use std::os::unix::fs::PermissionsExt;

    let support = TempDir::new().expect("support");
    let file;
    {
        let material = AskpassMaterial::create(
            support.path(),
            PathBuf::from("/usr/bin/true"),
            SYNTHETIC_TOKEN,
        )
        .expect("material");
        file = material.file().to_path_buf();
        assert_eq!(fs::read_to_string(&file).expect("secret"), SYNTHETIC_TOKEN);
        let mode = fs::metadata(&file).expect("metadata").permissions().mode();
        assert_eq!(mode & 0o077, 0, "the secret file is readable by others");
    }

    assert!(!file.exists(), "the secret survived the operation");
    assert!(
        !file.parent().expect("parent").exists(),
        "the secret directory survived the operation"
    );
}

#[test]
fn only_an_authenticated_invocation_sees_the_askpass_marker() {
    let directory = TempDir::new().expect("directory");
    let hooks = directory.path().join("hooks");
    let global_config = directory.path().join("empty-global-config");
    let material = AskpassMaterial::create(
        directory.path(),
        PathBuf::from("/usr/bin/true"),
        SYNTHETIC_TOKEN,
    )
    .expect("material");
    let authenticated = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: Some(&material),
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let plain = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };

    let mut authenticated_command = Command::new("/usr/bin/git");
    apply_environment(&mut authenticated_command, &authenticated);
    let mut plain_command = Command::new("/usr/bin/git");
    // An ambient marker must not survive into an ordinary local command.
    plain_command.env(ASKPASS_MODE_ENV, "1");
    plain_command.env(ASKPASS_FILE_ENV, "/nonexistent/secret");
    apply_environment(&mut plain_command, &plain);

    let authenticated_environment = environment_of(&authenticated_command);
    assert_eq!(
        authenticated_environment
            .iter()
            .find(|(name, _)| name == ASKPASS_MODE_ENV)
            .map(|(_, value)| value.clone()),
        Some(Some("1".to_string()))
    );
    assert!(
        authenticated_environment
            .iter()
            .any(|(name, _)| name == "GIT_ASKPASS")
    );
    // The token is never an environment value, only the path of a private file.
    assert!(
        !authenticated_environment
            .iter()
            .any(|(_, value)| value.as_deref() == Some(SYNTHETIC_TOKEN))
    );
    let plain_environment = environment_of(&plain_command);
    for name in [ASKPASS_MODE_ENV, ASKPASS_FILE_ENV] {
        assert_eq!(
            plain_environment
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, value)| value.clone()),
            Some(None),
            "{name} was not stripped from an unauthenticated command"
        );
    }
}

#[test]
fn signing_invocation_sees_only_the_ssh_askpass_channel() {
    let directory = TempDir::new().expect("directory");
    let hooks = directory.path().join("hooks");
    let global_config = directory.path().join("empty-global-config");
    let material = AskpassMaterial::create_signing(
        directory.path(),
        PathBuf::from("/usr/bin/true"),
        "synthetic-passphrase",
    )
    .expect("material");
    let execution = GitExecution {
        executable: Path::new("/usr/bin/git"),
        repository_root: directory.path(),
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![],
        askpass: Some(&material),
        encrypted: false,
        transport: GitTransportPolicy::RemoteOnly,
    };
    let mut command = Command::new("/usr/bin/git");
    apply_environment(&mut command, &execution);
    let environment = environment_of(&command);

    assert!(environment.iter().any(|(name, _)| name == "SSH_ASKPASS"));
    assert!(environment.iter().any(|(name, value)| {
        name == "SSH_ASKPASS_REQUIRE" && value.as_deref() == Some("force")
    }));
    assert!(environment.iter().any(|(name, value)| {
        name == ASKPASS_CONTEXT_ENV && value.as_deref() == Some("signing")
    }));
    assert!(
        !environment
            .iter()
            .any(|(name, value)| name == "GIT_ASKPASS" && value.is_some())
    );
    assert!(
        !environment
            .iter()
            .any(|(_, value)| value.as_deref() == Some("synthetic-passphrase"))
    );
}

#[test]
fn github_sign_in_is_refused_for_a_remote_that_is_not_github() {
    let Some(fixture) = fixture() else {
        return;
    };

    let error = fixture
        .manager
        .authentication_material(
            PLUGIN_ID,
            PluginGitAuthMode::GithubHttps,
            &["https://example.invalid/synthetic.git".to_string()],
            None,
        )
        .expect_err("refused");

    assert!(error.to_string().contains("github.com"));
}

#[test]
fn recognises_only_github_https_urls() {
    assert!(is_github_https_url(
        "https://github.com/owner/repository.git"
    ));
    assert!(is_github_https_url(
        "https://git@github.com/owner/repository.git"
    ));
    assert!(!is_github_https_url(
        "https://github.com.example.invalid/owner/repository.git"
    ));
    assert!(!is_github_https_url(
        "ssh://git@github.com/owner/repository.git"
    ));
}

#[cfg(unix)]
#[test]
fn github_sign_in_keeps_the_token_out_of_arguments_and_cleans_it_up() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let gh = fake_gh(tools.path(), "[]", SYNTHETIC_TOKEN);
    configure_github_executable(&fixture.manager, &gh);

    let material = fixture
        .manager
        .authentication_material(
            PLUGIN_ID,
            PluginGitAuthMode::GithubHttps,
            &["https://github.com/synthetic-owner/synthetic-notes.git".to_string()],
            None,
        )
        .expect("material")
        .expect("GitHub sign-in always produces credential material");
    let file = material.file().to_path_buf();
    assert_eq!(fs::read_to_string(&file).expect("secret"), SYNTHETIC_TOKEN);

    let request = PluginGitCloneVaultRequest {
        url: "https://github.com/synthetic-owner/synthetic-notes.git".to_string(),
        auth_mode: PluginGitAuthMode::GithubHttps,
        branch: None,
    };
    let arguments = clone_arguments(&request, Path::new("/synthetic/destination"));
    assert!(
        !arguments
            .iter()
            .any(|argument| argument.contains(SYNTHETIC_TOKEN))
    );

    drop(material);
    assert!(!file.exists(), "the token survived the operation");
}

// ---------------------------------------------------------------------------
// Clone destinations
// ---------------------------------------------------------------------------

#[test]
fn refuses_a_destination_that_is_not_an_empty_folder() {
    let root = TempDir::new().expect("root");
    let file = root.path().join("note.md");
    fs::write(&file, "synthetic").expect("note");
    let occupied = root.path().join("occupied");
    fs::create_dir_all(&occupied).expect("occupied");
    fs::write(occupied.join("existing.md"), "synthetic").expect("existing");
    let empty = root.path().join("empty");
    fs::create_dir_all(&empty).expect("empty");

    assert!(validate_empty_destination(&file).is_err());
    assert!(
        validate_empty_destination(&occupied)
            .expect_err("non-empty")
            .to_string()
            .contains("empty")
    );
    assert!(validate_empty_destination(&root.path().join("missing")).is_err());
    assert!(validate_empty_destination(&empty).is_ok());
}

#[cfg(unix)]
#[test]
fn refuses_a_destination_that_is_a_symbolic_link() {
    let root = TempDir::new().expect("root");
    let target = root.path().join("target");
    fs::create_dir_all(&target).expect("target");
    let link = root.path().join("link");
    std::os::unix::fs::symlink(&target, &link).expect("symlink");

    let error = validate_empty_destination(&link).expect_err("symlink");

    assert!(error.to_string().contains("symbolic link"));
}

#[test]
fn clones_a_local_bare_remote_into_an_empty_destination() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let bare = synthetic_bare_remote(remotes.path());
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("cloned-vault");
    fs::create_dir_all(&destination).expect("destination");

    let attempt = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: bare.to_string_lossy().into_owned(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &new_operation_id(),
            GitTransportPolicy::AllowLocal,
        )
        .expect("clone");

    let CloneAttempt::Cloned(clone) = attempt else {
        panic!("expected a successful clone");
    };
    assert_eq!(clone.label, "cloned-vault");
    assert_eq!(clone.branch.as_deref(), Some("main"));
    assert_eq!(clone.default_branch.as_deref(), Some("main"));
    assert_eq!(clone.upstream.as_deref(), Some("origin/main"));
    assert_eq!(clone.remote_url, bare.to_string_lossy());
    assert!(destination.join("alpha.md").is_file());
    assert!(destination.join(".git").is_dir());
    // The origin URL is preserved exactly as it was supplied.
    assert_eq!(
        stdout_of(git_in(&destination, &["remote", "get-url", "origin"])),
        bare.to_string_lossy()
    );
}

#[test]
fn refuses_a_url_that_is_not_https_or_ssh_before_anything_is_created() {
    let Some(fixture) = fixture() else {
        return;
    };
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("cloned-vault");
    fs::create_dir_all(&destination).expect("destination");

    let error = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: "ext::whoami".to_string(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &new_operation_id(),
            GitTransportPolicy::AllowLocal,
        )
        .expect_err("refused");

    assert!(error.to_string().contains("https:// or ssh://"));
    assert!(fs::read_dir(&destination).expect("read").next().is_none());
}

#[cfg(unix)]
#[test]
fn refuses_a_checkout_with_a_link_that_escapes_the_destination() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let source = remotes.path().join("hostile-source");
    fs::create_dir_all(&source).expect("source");
    git_in(&source, &["init", "--initial-branch", "main"]);
    identify(&source);
    std::os::unix::fs::symlink("../outside-the-vault", source.join("escape")).expect("symlink");
    git_in(&source, &["add", "--", "escape"]);
    git_in(&source, &["commit", "--message", "Add escape"]);
    let bare = remotes.path().join("hostile.git");
    bare_copy(&source, &bare);
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("hostile-clone");
    fs::create_dir_all(&destination).expect("destination");

    let attempt = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: bare.to_string_lossy().into_owned(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &new_operation_id(),
            GitTransportPolicy::AllowLocal,
        )
        .expect("clone");

    let CloneAttempt::Failed {
        message,
        cleanup_token,
    } = attempt
    else {
        panic!("expected the hostile checkout to be refused");
    };
    assert!(message.contains("points outside"), "{message}");
    // The destination is left recoverable, and the token is the only handle to
    // it.
    assert!(cleanup_token.is_some());
    assert!(destination.join(".git").is_dir());
}

#[test]
fn refuses_a_checkout_that_tracks_denote_control_paths() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let source = remotes.path().join("control-source");
    fs::create_dir_all(source.join(".denote").join("locks")).expect("control");
    git_in(&source, &["init", "--initial-branch", "main"]);
    identify(&source);
    fs::write(source.join(".denote").join("locks").join("held"), "1").expect("lock");
    git_in(&source, &["add", "--all"]);
    git_in(&source, &["commit", "--message", "Add control paths"]);
    let bare = remotes.path().join("control.git");
    bare_copy(&source, &bare);
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("control-clone");
    fs::create_dir_all(&destination).expect("destination");

    let attempt = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: bare.to_string_lossy().into_owned(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &new_operation_id(),
            GitTransportPolicy::AllowLocal,
        )
        .expect("clone");

    let CloneAttempt::Failed { message, .. } = attempt else {
        panic!("expected the control paths to be refused");
    };
    assert!(message.contains(".denote/locks"), "{message}");
}

#[test]
fn accepts_a_checkout_that_carries_an_encryption_manifest() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    let source = remotes.path().join("encrypted-source");
    fs::create_dir_all(source.join(".denote")).expect("control");
    git_in(&source, &["init", "--initial-branch", "main"]);
    identify(&source);
    fs::write(
        source.join(".denote").join("encryption.json"),
        "{\"phase\":\"encrypted\"}\n",
    )
    .expect("manifest");
    git_in(&source, &["add", "--all"]);
    git_in(&source, &["commit", "--message", "Add manifest"]);
    let bare = remotes.path().join("encrypted.git");
    bare_copy(&source, &bare);
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("encrypted-clone");
    fs::create_dir_all(&destination).expect("destination");

    let attempt = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: bare.to_string_lossy().into_owned(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &new_operation_id(),
            GitTransportPolicy::AllowLocal,
        )
        .expect("clone");

    // An encrypted vault clones like any other repository. It is the renderer
    // that shows the unlock screen before any content.
    assert!(matches!(attempt, CloneAttempt::Cloned(_)));
    assert!(
        destination
            .join(".denote")
            .join("encryption.json")
            .is_file()
    );
}

// ---------------------------------------------------------------------------
// Clean-up tokens
// ---------------------------------------------------------------------------

#[test]
fn a_cleanup_token_deletes_only_its_own_failed_destination() {
    let Some(fixture) = fixture() else {
        return;
    };
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("failed-clone");
    fs::create_dir_all(destination.join(".git")).expect("partial clone");
    let unrelated = destinations.path().join("unrelated");
    fs::create_dir_all(&unrelated).expect("unrelated");
    fs::write(unrelated.join("note.md"), "synthetic").expect("note");
    let destination = fs::canonicalize(&destination).expect("canonical");
    let token = fixture
        .manager
        .mint_cleanup_token(PLUGIN_ID, &destination)
        .expect("token");

    let outcome = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("cleanup");

    assert!(outcome.cleaned, "{}", outcome.message);
    assert!(!destination.exists());
    assert!(unrelated.join("note.md").is_file());

    let reused = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("reuse");
    assert!(!reused.cleaned);
}

#[test]
fn a_cleanup_token_refuses_a_destination_that_is_no_longer_the_failed_clone() {
    let Some(fixture) = fixture() else {
        return;
    };
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("failed-clone");
    fs::create_dir_all(destination.join(".git")).expect("partial clone");
    let destination = fs::canonicalize(&destination).expect("canonical");
    let token = fixture
        .manager
        .mint_cleanup_token(PLUGIN_ID, &destination)
        .expect("token");
    // Real work arrived in the folder after the failure.
    fs::write(destination.join("notes.md"), "synthetic note").expect("note");

    let outcome = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("cleanup");

    assert!(!outcome.cleaned);
    assert!(destination.join("notes.md").is_file());
}

#[test]
fn a_cleanup_token_never_deletes_the_active_vault() {
    let Some(fixture) = fixture() else {
        return;
    };
    fs::write(fixture.vault_root.join("kept.md"), "synthetic").expect("note");
    let token = fixture
        .manager
        .mint_cleanup_token(PLUGIN_ID, &fixture.vault_root)
        .expect("token");

    let outcome = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("cleanup");

    assert!(!outcome.cleaned);
    assert!(fixture.vault_root.join("kept.md").is_file());
}

#[test]
fn a_cleanup_token_belongs_to_the_plugin_that_created_it() {
    let Some(fixture) = fixture() else {
        return;
    };
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("failed-clone");
    fs::create_dir_all(destination.join(".git")).expect("partial clone");
    let destination = fs::canonicalize(&destination).expect("canonical");
    let token = fixture
        .manager
        .mint_cleanup_token("denote.other", &destination)
        .expect("token");

    let outcome = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("cleanup");

    assert!(!outcome.cleaned);
    assert!(destination.join(".git").is_dir());
}

#[test]
fn repeated_disable_and_shutdown_drop_every_clone_handle() {
    let Some(fixture) = fixture() else {
        return;
    };
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("failed-clone");
    fs::create_dir_all(destination.join(".git")).expect("partial clone");
    let destination = fs::canonicalize(&destination).expect("canonical");
    let token = fixture
        .manager
        .mint_cleanup_token(PLUGIN_ID, &destination)
        .expect("token");

    // Disable is idempotent: repeating it keeps cancelling processes and
    // dropping handles instead of failing.
    fixture.manager.cancel_git_operations(PLUGIN_ID);
    fixture.manager.cancel_git_operations(PLUGIN_ID);
    fixture.manager.cancel_all_git_operations();

    let outcome = fixture
        .manager
        .clean_failed_clone(PLUGIN_ID, &token, std::slice::from_ref(&fixture.vault_root))
        .expect("cleanup");
    assert!(!outcome.cleaned);
    assert!(destination.join(".git").is_dir());
}

// ---------------------------------------------------------------------------
// Credentials are bound to the URL the operation really contacts
// ---------------------------------------------------------------------------

/// A remote whose push URL points somewhere else entirely. Reading only the
/// fetch URL would decide that GitHub sign-in applies and hand a GitHub token
/// to the other host.
#[cfg(unix)]
fn remote_with_divergent_push_url(fixture: &GitFixture) {
    initialize_vault_repository(fixture);
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/synthetic-owner/synthetic-notes.git",
        ],
    );
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "set-url",
            "--push",
            "origin",
            "https://example.invalid/synthetic.git",
        ],
    );
}

#[cfg(unix)]
#[test]
fn reads_the_push_url_for_a_push_and_the_fetch_url_for_a_fetch() {
    let Some(fixture) = fixture() else {
        return;
    };
    remote_with_divergent_push_url(&fixture);
    let executable = resolve_git_executable(None).expect("git");
    let support = TempDir::new().expect("support");
    let hooks = support.path().join("hooks");
    let global_config = support.path().join("empty-global-config");
    fs::create_dir_all(&hooks).expect("hooks");
    fs::write(&global_config, "").expect("global config");
    let execution = GitExecution {
        executable: &executable,
        repository_root: &fixture.vault_root,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![fixture.vault_root.clone()],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::AllowLocal,
    };
    let token = GitOperationToken::detached();

    assert_eq!(
        read_remote_urls(&execution, "origin", RemoteDirection::Fetch, &token).expect("fetch url"),
        vec!["https://github.com/synthetic-owner/synthetic-notes.git".to_string()]
    );
    assert_eq!(
        read_remote_urls(&execution, "origin", RemoteDirection::Push, &token).expect("push url"),
        vec!["https://example.invalid/synthetic.git".to_string()]
    );
}

#[cfg(unix)]
#[test]
fn a_push_to_a_non_github_push_url_never_asks_for_a_github_token() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let gh = fake_gh(tools.path(), "[]", SYNTHETIC_TOKEN);
    configure_github_executable(&fixture.manager, &gh);
    remote_with_divergent_push_url(&fixture);

    let error = run_local(
        &fixture,
        PluginGitRequest::Push {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            set_upstream: false,
            mode: None,
            auth_mode: PluginGitAuthMode::GithubHttps,
        },
    )
    .expect_err("a push to another host is refused before anything is read");

    assert!(error.to_string().contains("github.com"), "{error}");
    // The GitHub CLI was never reached, so no token was read at all. Only the
    // version probe that pinned the executable ran.
    assert!(
        !gh_invocations(tools.path())
            .iter()
            .any(|invocation| invocation.starts_with("auth token")),
        "a token was requested for a push that would contact another host"
    );
    assert!(
        askpass_directories(&fixture).is_empty(),
        "askpass material was created for a push that would contact another host"
    );
}

#[cfg(unix)]
#[test]
fn every_url_of_a_multi_url_remote_has_to_be_github() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let gh = fake_gh(tools.path(), "[]", SYNTHETIC_TOKEN);
    configure_github_executable(&fixture.manager, &gh);
    initialize_vault_repository(&fixture);
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/synthetic-owner/synthetic-notes.git",
        ],
    );
    // A second push URL is an ordinary Git feature, and Git contacts both.
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "set-url",
            "--push",
            "--add",
            "origin",
            "https://github.com/synthetic-owner/synthetic-notes.git",
        ],
    );
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "set-url",
            "--push",
            "--add",
            "origin",
            "https://example.invalid/mirror.git",
        ],
    );

    let error = run_local(
        &fixture,
        PluginGitRequest::Push {
            scope: PluginGitScope::Vault,
            remote: "origin".to_string(),
            branch: "main".to_string(),
            set_upstream: false,
            mode: None,
            auth_mode: PluginGitAuthMode::GithubHttps,
        },
    )
    .expect_err("one non-GitHub mirror refuses the whole push");

    assert!(error.to_string().contains("github.com"), "{error}");
    assert!(
        !gh_invocations(tools.path())
            .iter()
            .any(|invocation| invocation.starts_with("auth token"))
    );
    assert!(askpass_directories(&fixture).is_empty());
}

#[test]
fn a_url_list_that_is_not_entirely_github_produces_no_material() {
    let Some(fixture) = fixture() else {
        return;
    };

    let error = fixture
        .manager
        .authentication_material(
            PLUGIN_ID,
            PluginGitAuthMode::GithubHttps,
            &[
                "https://github.com/synthetic-owner/synthetic-notes.git".to_string(),
                "https://example.invalid/mirror.git".to_string(),
            ],
            None,
        )
        .expect_err("refused");

    assert!(error.to_string().contains("github.com"));
    assert!(askpass_directories(&fixture).is_empty());
}

/// A remote that is repointed *after* Denote validated its URL and *before*
/// Git asks for a credential.
///
/// The preflight cannot see a change that lands later, so the prompt is the
/// only authority left. The synthetic GitHub CLI performs the repoint while
/// the token is being read, which is exactly the window between the two, and
/// the live secret is then offered a prompt for the host Git would really
/// contact.
#[cfg(unix)]
#[test]
fn a_remote_repointed_after_validation_never_receives_the_token() {
    let Some(fixture) = fixture() else {
        return;
    };
    let repointed = "https://github.com.synthetic-lookalike.invalid/synthetic.git";
    let tools = TempDir::new().expect("tools");
    let prelude = format!(
        "  \"{git}\" -C \"{vault}\" remote set-url origin {repointed}\n",
        git = git().display(),
        vault = fixture.vault_root.display(),
    );
    let gh = fake_gh_script(tools.path(), "[]", SYNTHETIC_TOKEN, &prelude);
    configure_github_executable(&fixture.manager, &gh);
    initialize_vault_repository(&fixture);
    git_in(
        &fixture.vault_root,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/synthetic-owner/synthetic-notes.git",
        ],
    );
    let executable = resolve_git_executable(None).expect("git");
    let support = TempDir::new().expect("support");
    let hooks = support.path().join("hooks");
    let global_config = support.path().join("empty-global-config");
    fs::create_dir_all(&hooks).expect("hooks");
    fs::write(&global_config, "").expect("global config");
    let execution = GitExecution {
        executable: &executable,
        repository_root: &fixture.vault_root,
        hooks_directory: &hooks,
        global_config: &global_config,
        redacted_roots: vec![fixture.vault_root.clone()],
        askpass: None,
        encrypted: false,
        transport: GitTransportPolicy::AllowLocal,
    };
    let cancellation = GitOperationToken::detached();

    // Stage one: the host reads the URLs the push will contact and proves
    // every one of them is GitHub.
    let validated = read_remote_urls(&execution, "origin", RemoteDirection::Push, &cancellation)
        .expect("push url");
    assert!(validated.iter().all(|url| is_github_https_url(url)));

    // Stage two: the token is read, and the remote is repointed while it is.
    let material = fixture
        .manager
        .authentication_material(
            PLUGIN_ID,
            PluginGitAuthMode::GithubHttps,
            &validated,
            Some(&cancellation),
        )
        .expect("material")
        .expect("github sign-in produces material");
    assert!(
        gh_invocations(tools.path())
            .iter()
            .any(|invocation| invocation.starts_with("auth token")),
        "the race never reached the token read it depends on"
    );
    let current = read_remote_urls(&execution, "origin", RemoteDirection::Push, &cancellation)
        .expect("repointed url");
    assert_eq!(current, vec![repointed.to_string()], "the repoint was lost");
    assert!(!is_github_https_url(repointed));

    // Stage three: Git prompts for the host it is really contacting. The
    // secret is live and readable, so an empty answer can only be the prompt
    // binding refusing this host.
    for prompt in [
        "Username for 'https://github.com.synthetic-lookalike.invalid': ".to_string(),
        "Password for 'https://github.com.synthetic-lookalike.invalid': ".to_string(),
        format!("Password for '{repointed}': "),
    ] {
        assert_eq!(
            askpass_answer(&prompt, Some(material.file())),
            "",
            "the token was offered to a repointed remote: {prompt}"
        );
    }
    // The same live file answers the target that was actually validated, so
    // the refusals above are the binding and not a missing secret.
    assert_eq!(
        askpass_answer("Password for 'https://github.com': ", Some(material.file())),
        SYNTHETIC_TOKEN
    );

    drop(material);
    assert!(askpass_directories(&fixture).is_empty());
}

// ---------------------------------------------------------------------------
// Diagnostics survive multi-byte output
// ---------------------------------------------------------------------------

#[test]
fn a_long_multibyte_diagnostic_is_cut_on_a_character_boundary() {
    // Every character here is three bytes, so a 200 byte cut lands inside one
    // of them and a byte slice would panic.
    let line = "\u{3053}".repeat(300);
    let reduced = super::git::first_line(&format!("\n  {line}\nsecond line\n"));

    assert!(reduced.ends_with('…'));
    assert!(reduced.len() <= super::git::MAX_DIAGNOSTIC_BYTES + '…'.len_utf8());
    assert!(
        reduced
            .trim_end_matches('…')
            .chars()
            .all(|c| c == '\u{3053}')
    );
    // A short multi-byte line is reported whole.
    assert_eq!(
        super::git::first_line("\u{3053}\u{3054}"),
        "\u{3053}\u{3054}"
    );
    assert_eq!(super::git::first_line("   \n\n"), "");
}

#[test]
fn a_clone_that_fails_with_multibyte_output_reports_it_and_releases_the_operation() {
    let Some(fixture) = fixture() else {
        return;
    };
    let remotes = TempDir::new().expect("remotes");
    // A long multi-byte directory name that is not a repository. Git repeats
    // the whole path back in its diagnostic, so the failure message is well
    // past the 200 byte limit and every boundary in it is mid-character.
    let name = "\u{3053}".repeat(70);
    let source = remotes.path().join(&name);
    fs::create_dir_all(&source).expect("source");
    let source = fs::canonicalize(&source).expect("canonical source");
    let destinations = TempDir::new().expect("destinations");
    let destination = destinations.path().join("clone");
    fs::create_dir_all(&destination).expect("destination");
    let operation_id = new_operation_id();

    let attempt = fixture
        .manager
        .clone_into_destination(
            PLUGIN_ID,
            &PluginGitCloneVaultRequest {
                url: source.to_string_lossy().into_owned(),
                auth_mode: PluginGitAuthMode::Public,
                branch: None,
            },
            &destination,
            &operation_id,
            GitTransportPolicy::AllowLocal,
        )
        .expect("a failed clone is an outcome, not a panic");

    match attempt {
        CloneAttempt::Failed { message, .. } => {
            assert!(message.contains("Git could not clone this repository."));
            assert!(message.chars().count() > 0);
        }
        CloneAttempt::Cloned(_) => panic!("a folder that is not a repository cannot be cloned"),
    }
    // The operation was released however it ended, so nothing is left
    // registered under its ID.
    let cancelled = run_local(
        &fixture,
        PluginGitRequest::Cancel {
            operation_id: operation_id.clone(),
        },
    )
    .expect("cancel");
    assert!(
        !cancelled.cancelled,
        "the failed clone left its operation registered"
    );
    assert!(askpass_directories(&fixture).is_empty());
}

// ---------------------------------------------------------------------------
// Startup recovery of askpass residue
// ---------------------------------------------------------------------------

#[test]
fn startup_removes_askpass_residue_a_crash_left_behind() {
    let support = TempDir::new().expect("support");
    let residue = support
        .path()
        .join("askpass-11111111-2222-4333-8444-555555555555");
    fs::create_dir_all(&residue).expect("residue");
    fs::write(residue.join("secret"), SYNTHETIC_TOKEN).expect("secret");
    let keep = support.path().join("hooks");
    fs::create_dir_all(&keep).expect("hooks");
    fs::write(support.path().join("config"), "").expect("config");

    super::askpass::remove_stale_material(support.path());

    assert!(!residue.exists(), "crash residue survived startup");
    // Nothing else the host owns is touched.
    assert!(keep.is_dir());
    assert!(support.path().join("config").is_file());
}

#[test]
fn startup_leaves_a_directory_that_only_borrowed_the_reserved_name() {
    let support = TempDir::new().expect("support");
    let borrowed = support.path().join("askpass-notes");
    fs::create_dir_all(&borrowed).expect("borrowed");
    fs::write(borrowed.join("alpha.md"), "synthetic note\n").expect("note");

    super::askpass::remove_stale_material(support.path());

    assert!(
        borrowed.join("alpha.md").is_file(),
        "startup deleted a folder that was not askpass material"
    );
}

#[cfg(unix)]
#[test]
fn startup_never_follows_a_link_planted_under_the_reserved_name() {
    let root = TempDir::new().expect("root");
    let support = root.path().join("git");
    fs::create_dir_all(&support).expect("support");
    let victim = root.path().join("victim");
    fs::create_dir_all(&victim).expect("victim");
    fs::write(victim.join("important.md"), "synthetic note\n").expect("note");
    let link = support.join("askpass-11111111-2222-4333-8444-555555555555");
    std::os::unix::fs::symlink(&victim, &link).expect("symlink");

    super::askpass::remove_stale_material(&support);

    // The link itself is unlinked, and nothing it pointed at is touched.
    assert!(!link.exists());
    assert!(fs::symlink_metadata(&link).is_err());
    assert!(
        victim.is_dir(),
        "startup followed a link out of the support directory"
    );
    assert!(victim.join("important.md").is_file());
}

#[cfg(unix)]
#[test]
fn startup_leaves_material_whose_secret_is_itself_a_link() {
    let root = TempDir::new().expect("root");
    let support = root.path().join("git");
    fs::create_dir_all(&support).expect("support");
    let victim = root.path().join("victim.md");
    fs::write(&victim, "synthetic note\n").expect("victim");
    let residue = support.join("askpass-11111111-2222-4333-8444-555555555555");
    fs::create_dir_all(&residue).expect("residue");
    std::os::unix::fs::symlink(&victim, residue.join("secret")).expect("symlink");

    super::askpass::remove_stale_material(&support);

    assert!(residue.is_dir());
    assert!(victim.is_file());
}

#[test]
fn an_ordinary_operation_never_sweeps_live_askpass_material() {
    let Some(fixture) = fixture() else {
        return;
    };
    initialize_vault_repository(&fixture);
    let support = fixture
        .manager
        .git_support_directory()
        .expect("support directory");
    let material =
        AskpassMaterial::create(&support, PathBuf::from("/usr/bin/true"), SYNTHETIC_TOKEN)
            .expect("material");

    // Recovery runs at startup and nowhere else, so an ordinary request that
    // happens while another operation holds a secret leaves that secret alone.
    let status = run_local(
        &fixture,
        PluginGitRequest::Status {
            scope: PluginGitScope::Vault,
        },
    )
    .expect("status");
    assert_eq!(status.exit_code, 0, "{}", status.stderr);

    assert!(
        material.file().is_file(),
        "an ordinary operation removed the secret of a live operation"
    );
    assert_eq!(
        fs::read_to_string(material.file()).expect("secret"),
        SYNTHETIC_TOKEN
    );

    let file = material.file().to_path_buf();
    drop(material);
    assert!(!file.exists(), "the secret survived its own operation");
}

/// A second Denote that cannot take the manager lock must behave as though it
/// never started: recovery belongs to the instance that owns the lock, and the
/// material on disk belongs to the live instance that is authenticating with
/// it right now.
#[test]
fn a_second_manager_that_loses_the_lock_leaves_live_askpass_material_alone() {
    let data = TempDir::new().expect("data");
    let cache = TempDir::new().expect("cache");
    let live = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());
    assert!(
        live.list().is_ok(),
        "the first manager did not take the lock"
    );
    let support = live.git_support_directory().expect("support directory");
    let material =
        AskpassMaterial::create(&support, PathBuf::from("/usr/bin/true"), SYNTHETIC_TOKEN)
            .expect("material");

    let second = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());

    let error = second
        .list()
        .expect_err("a second manager must not manage the same plugins");
    assert!(
        error.to_string().contains("Another Denote process"),
        "{error}"
    );
    assert!(
        material.file().is_file(),
        "a manager that lost the lock deleted the live instance's secret"
    );
    assert_eq!(
        fs::read_to_string(material.file()).expect("secret"),
        SYNTHETIC_TOKEN
    );

    let file = material.file().to_path_buf();
    drop(material);
    assert!(!file.exists());
    // Recovery still belongs to a manager that does take the lock, so residue
    // is swept once the live instance is gone.
    let residue = support.join("askpass-11111111-2222-4333-8444-555555555555");
    fs::create_dir_all(&residue).expect("residue");
    fs::write(residue.join("secret"), SYNTHETIC_TOKEN).expect("secret");
    drop(live);
    let restarted = PluginManager::new(data.path().to_path_buf(), cache.path().to_path_buf());

    assert!(restarted.list().is_ok());
    assert!(!residue.exists(), "crash residue survived a restart");
}

// ---------------------------------------------------------------------------
// Cancellation reaches credential acquisition
// ---------------------------------------------------------------------------

/// A stand-in Git that records only the sub-command it was asked to run, so a
/// test can prove that a remote command never started. It answers the version
/// probe and the one configuration read authentication needs, and nothing
/// else, so no network is reachable from it at all.
#[cfg(unix)]
fn fake_git(directory: &Path, remote_url: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = directory.join("git");
    let log = directory
        .join(GIT_INVOCATION_LOG)
        .to_string_lossy()
        .into_owned();
    let script = format!(
        r#"#!/bin/sh
skip=0
sub=""
for arg in "$@"; do
  if [ "$skip" = "1" ]; then skip=0; continue; fi
  case "$arg" in
    --version) echo "git version 2.99.0 (synthetic)"; exit 0 ;;
    -C|-c) skip=1 ;;
    -*) : ;;
    *) sub="$arg"; break ;;
  esac
done
printf '%s\n' "$sub" >> "{log}"
if [ "$sub" = "remote" ]; then
  echo "{remote_url}"
  exit 0
fi
exit 0
"#
    );
    fs::write(&path, script).expect("git script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("git mode");
    fs::canonicalize(path).expect("canonical git")
}

#[cfg(unix)]
const GIT_INVOCATION_LOG: &str = "git-invocations.log";

#[cfg(unix)]
fn git_invocations(tools: &Path) -> Vec<String> {
    fs::read_to_string(tools.join(GIT_INVOCATION_LOG))
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(unix)]
fn configure_git_executable(manager: &PluginManager, git: &Path, gh: &Path) {
    let settings = serde_json::json!({
        super::settings::GIT_EXECUTABLE_SETTING: git.to_string_lossy(),
        super::settings::GITHUB_EXECUTABLE_SETTING: gh.to_string_lossy(),
    });
    manager
        .set_settings(PLUGIN_ID, settings)
        .expect("executable settings");
}

/// Waits for a synthetic tool to report that it started.
#[cfg(unix)]
fn wait_for(marker: &Path) -> bool {
    for _ in 0..600 {
        if marker.exists() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    false
}

#[cfg(unix)]
#[test]
fn cancelling_during_token_acquisition_stops_before_the_remote_command() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let started = tools.path().join("token-started");
    // The token read blocks until it is killed, so cancellation always lands
    // while the credential is being acquired.
    let gh = fake_gh_script(
        tools.path(),
        "[]",
        SYNTHETIC_TOKEN,
        &format!("  : > \"{}\"\n  sleep 30", started.to_string_lossy()),
    );
    let git = fake_git(
        tools.path(),
        "https://github.com/synthetic-owner/synthetic-notes.git",
    );
    configure_git_executable(&fixture.manager, &git, &gh);
    initialize_vault_repository(&fixture);
    let operation_id = new_operation_id();

    let canceller = {
        let manager = fixture.manager.clone();
        let operation_id = operation_id.clone();
        let started = started.clone();
        std::thread::spawn(move || {
            assert!(wait_for(&started), "the synthetic GitHub CLI never started");
            manager
                .git_request_with_transport(
                    PLUGIN_ID,
                    PluginGitRequest::Cancel {
                        operation_id: operation_id.clone(),
                    },
                    GitRequestTarget {
                        repository_root: Path::new(""),
                        redacted_roots: Vec::new(),
                        encrypted: false,
                    },
                    &new_operation_id(),
                    GitTransportPolicy::AllowLocal,
                )
                .expect("cancel")
        })
    };

    let error = fixture
        .manager
        .git_request_with_transport(
            PLUGIN_ID,
            PluginGitRequest::Fetch {
                scope: PluginGitScope::Vault,
                remote: "origin".to_string(),
                prune: true,
                auth_mode: PluginGitAuthMode::GithubHttps,
            },
            GitRequestTarget {
                repository_root: &fixture.vault_root,
                redacted_roots: vec![fixture.vault_root.clone()],
                encrypted: false,
            },
            &operation_id,
            GitTransportPolicy::AllowLocal,
        )
        .expect_err("a cancelled credential read stops the operation");
    let cancellation = canceller.join().expect("canceller");

    assert!(
        cancellation.cancelled,
        "the operation was not registered yet"
    );
    assert!(error.to_string().contains("cancelled"), "{error}");
    // The operation was registered before the credential was read, so the
    // cancel found it. Git only ever read the remote's URL; the fetch itself
    // never started.
    let invocations = git_invocations(tools.path());
    assert!(
        invocations.contains(&"remote".to_string()),
        "the remote URL was never read: {invocations:?}"
    );
    assert!(
        !invocations.contains(&"fetch".to_string()),
        "a remote command ran after the credential read was cancelled: {invocations:?}"
    );
    assert!(
        askpass_directories(&fixture).is_empty(),
        "cancelled credential acquisition left material behind"
    );
    // Nothing stayed registered, so the ID can no longer be cancelled.
    let again = run_local(
        &fixture,
        PluginGitRequest::Cancel {
            operation_id: operation_id.clone(),
        },
    )
    .expect("cancel");
    assert!(!again.cancelled);
}

#[cfg(unix)]
#[test]
fn a_repository_listing_runs_under_the_operation_id_the_caller_published() {
    let Some(fixture) = fixture() else {
        return;
    };
    let tools = TempDir::new().expect("tools");
    let started = tools.path().join("list-started");
    let gh = {
        use std::os::unix::fs::PermissionsExt;
        let path = tools.path().join("gh");
        let script = format!(
            r#"#!/bin/sh
if [ "$1" = "version" ]; then
  echo "gh version 2.0.0 (synthetic)"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "list" ]; then
  : > "{}"
  sleep 30
fi
exit 1
"#,
            started.to_string_lossy()
        );
        fs::write(&path, script).expect("gh script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("gh mode");
        fs::canonicalize(path).expect("canonical gh")
    };
    configure_github_executable(&fixture.manager, &gh);
    let operation_id = new_operation_id();

    let canceller = {
        let manager = fixture.manager.clone();
        let operation_id = operation_id.clone();
        let started = started.clone();
        std::thread::spawn(move || {
            assert!(wait_for(&started), "the synthetic listing never started");
            manager
                .git_request_with_transport(
                    PLUGIN_ID,
                    PluginGitRequest::Cancel {
                        operation_id: operation_id.clone(),
                    },
                    GitRequestTarget {
                        repository_root: Path::new(""),
                        redacted_roots: Vec::new(),
                        encrypted: false,
                    },
                    &new_operation_id(),
                    GitTransportPolicy::AllowLocal,
                )
                .expect("cancel")
        })
    };

    let error = fixture
        .manager
        .list_github_repositories(PLUGIN_ID, 50, &operation_id)
        .expect_err("a cancelled listing reports it");
    let cancellation = canceller.join().expect("canceller");

    assert!(
        cancellation.cancelled,
        "the listing was not registered under the caller's ID"
    );
    assert!(error.to_string().contains("cancelled"), "{error}");
    // A listing that ended releases its ID like any other operation.
    let again = run_local(
        &fixture,
        PluginGitRequest::Cancel {
            operation_id: operation_id.clone(),
        },
    )
    .expect("cancel");
    assert!(!again.cancelled);
}

// ---------------------------------------------------------------------------
// The GitHub adapter never blocks on its own output
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn a_fast_flood_of_github_output_is_bounded_instead_of_deadlocking() {
    let Some(_fixture) = fixture() else {
        return;
    };
    use std::os::unix::fs::PermissionsExt;

    let tools = TempDir::new().expect("tools");
    let path = tools.path().join("gh");
    // Two MiB written as fast as the shell can, before the process exits. A
    // pipe would fill and stall the child while this thread waited for it.
    let script = r#"#!/bin/sh
if [ "$1" = "version" ]; then
  echo "gh version 2.0.0 (synthetic)"
  exit 0
fi
line=$(printf '%01024d' 0)
i=0
while [ "$i" -lt 2048 ]; do
  printf '%s\n' "$line"
  i=$((i + 1))
done
exit 0
"#;
    fs::write(&path, script).expect("gh script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("gh mode");
    let gh = fs::canonicalize(&path).expect("canonical gh");
    let gh = resolve_gh_executable(Some(&gh.to_string_lossy())).expect("gh");

    let error = list_repositories(&gh, 200, None).expect_err("bounded");

    assert!(error.to_string().contains("1 MiB"), "{error}");
}

#[cfg(unix)]
#[test]
fn a_full_bounded_listing_is_read_without_stalling() {
    let Some(fixture) = fixture() else {
        return;
    };
    let entries: Vec<String> = (0..MAX_REPOSITORY_LIMIT)
        .map(|index| {
            format!(
                r#"{{"nameWithOwner":"synthetic-owner/notes-{index}","url":"https://github.com/synthetic-owner/notes-{index}.git","sshUrl":"ssh://git@github.com/synthetic-owner/notes-{index}.git","defaultBranchRef":{{"name":"main"}},"isPrivate":false}}"#
            )
        })
        .collect();
    let tools = TempDir::new().expect("tools");
    let gh = fake_gh(
        tools.path(),
        &format!("[{}]", entries.join(",")),
        SYNTHETIC_TOKEN,
    );
    configure_github_executable(&fixture.manager, &gh);

    let repositories = fixture
        .manager
        .list_github_repositories(PLUGIN_ID, MAX_REPOSITORY_LIMIT, &new_operation_id())
        .expect("listing");

    assert_eq!(repositories.len(), MAX_REPOSITORY_LIMIT as usize);
    assert_eq!(
        repositories[0].name_with_owner,
        "synthetic-owner/notes-0".to_string()
    );
    // The ceiling is the host's, not the caller's.
    assert!(
        fixture
            .manager
            .list_github_repositories(PLUGIN_ID, MAX_REPOSITORY_LIMIT + 1, &new_operation_id())
            .is_err()
    );
}
