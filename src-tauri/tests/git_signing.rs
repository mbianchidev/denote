use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

const PASSWORD: &str = " synthetic signing password ";
const AUTHOR: &str = "Synthetic Signer <signer@example.invalid>";

#[path = "../src/plugins/git/gpg_paths.rs"]
mod gpg_paths;

fn tool(name: &str) -> PathBuf {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    directories.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "C:/Program Files/Git/cmd",
            "C:/Program Files/Git/usr/bin",
            "C:/Program Files/GnuPG/bin",
            "C:/Program Files (x86)/GnuPG/bin",
        ]
        .map(PathBuf::from),
    );
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    directories
        .into_iter()
        .map(|path| path.join(&executable))
        .find(|path| path.is_absolute() && path.is_file())
        .unwrap_or_else(|| panic!("{name} is required for the synthetic signing integration test"))
}

fn command(program: &Path, root: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .current_dir(root)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", root.join("empty-config"))
        .env("GIT_AUTHOR_NAME", "Synthetic Signer")
        .env("GIT_AUTHOR_EMAIL", "signer@example.invalid")
        .env("GIT_COMMITTER_NAME", "Synthetic Signer")
        .env("GIT_COMMITTER_EMAIL", "signer@example.invalid")
        .env("GNUPGHOME", root.join("gnupg"))
        .env_remove("GPG_TTY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    gpg_paths::configure_gpg_home(&mut command, &tool("gpg"));
    command
}

fn run(mut command: Command) -> Output {
    let output = command.output().expect("synthetic command");
    assert!(
        output.status.success(),
        "synthetic command failed: {}",
        String::from_utf8_lossy(&output.stderr),
    );
    output
}

fn git(root: &Path, args: &[&str]) -> Command {
    let mut command = command(&tool("git"), root);
    command.args(args);
    command
}

fn openpgp_sign(root: &Path, gpg: &Path) -> Command {
    let mut command = git(
        root,
        &[
            "-c",
            "gpg.format=openpgp",
            "-c",
            &format!("gpg.openpgp.program={}", env!("CARGO_BIN_EXE_denote")),
            "commit",
            "--gpg-sign",
            "-m",
            "Synthetic signed commit",
        ],
    );
    command
        .env("DENOTE_GPG_SIGNER_MODE", "1")
        .env(
            "DENOTE_GPG_SIGNER_PROGRAM",
            fs::canonicalize(gpg).expect("canonical GPG"),
        )
        .env("DENOTE_GIT_ASKPASS_FILE", root.join("passphrase"));
    command
}

fn fixture() -> tempfile::TempDir {
    let directory = tempfile::tempdir().expect("synthetic directory");
    fs::write(directory.path().join("empty-config"), "").expect("empty config");
    fs::create_dir(directory.path().join("gnupg")).expect("keyring");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            directory.path().join("gnupg"),
            fs::Permissions::from_mode(0o700),
        )
        .expect("private keyring");
    }
    run(git(directory.path(), &["init", "--initial-branch=main"]));
    fs::write(directory.path().join("note.md"), "Synthetic note\n").expect("note");
    run(git(directory.path(), &["add", "note.md"]));
    fs::write(directory.path().join("passphrase"), PASSWORD).expect("passphrase");
    directory
}

struct AgentCleanup(PathBuf);
impl Drop for AgentCleanup {
    fn drop(&mut self) {
        let root = &self.0;
        let output = command(&tool("gpgconf"), root)
            .args(["--kill", "gpg-agent"])
            .output();
        if !output.is_ok_and(|output| output.status.success()) {
            eprintln!("Could not stop the synthetic GPG agent in its temporary GNUPGHOME.");
        }
    }
}

#[test]
fn encrypted_openpgp_commits_use_the_native_pipe_and_verify() {
    let fixture = fixture();
    let root = fixture.path();
    let _agent = AgentCleanup(root.to_path_buf());
    let gpg = tool("gpg");
    let mut generate = command(&gpg, root);
    generate
        .args([
            "--batch",
            "--pinentry-mode=loopback",
            "--passphrase-fd=0",
            "--quick-generate-key",
            AUTHOR,
            "ed25519",
            "sign",
            "0",
        ])
        .stdin(Stdio::piped());
    let mut child = generate.spawn().expect("generate synthetic GPG key");
    writeln!(child.stdin.take().expect("password pipe"), "{PASSWORD}").expect("password");
    let output = child.wait_with_output().expect("key generation");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // Discard the key generation cache so signing must actually use the supplied password.
    run({
        let mut command = command(&tool("gpgconf"), root);
        command.args(["--kill", "gpg-agent"]);
        command
    });
    let output = run(openpgp_sign(root, &gpg));
    assert!(!String::from_utf8_lossy(&output.stdout).contains(PASSWORD));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(PASSWORD));
    run(git(
        root,
        &[
            "-c",
            &format!("gpg.program={}", gpg.display()),
            "verify-commit",
            "HEAD",
        ],
    ));
    let content = run(git(root, &["show", "HEAD:note.md"]));
    assert_eq!(content.stdout, b"Synthetic note\n");
    let before = run(git(root, &["rev-parse", "HEAD"])).stdout;
    run({
        let mut command = command(&tool("gpgconf"), root);
        command.args(["--kill", "gpg-agent"]);
        command
    });
    fs::write(root.join("note.md"), "Another synthetic edit\n").expect("edit");
    fs::write(root.join("passphrase"), "wrong synthetic password").expect("wrong password");
    run(git(root, &["add", "note.md"]));
    let failed = openpgp_sign(root, &gpg)
        .output()
        .expect("sign with wrong password");
    assert!(
        !failed.status.success(),
        "wrong password must not create an unsigned commit"
    );
    assert!(!String::from_utf8_lossy(&failed.stderr).contains("wrong synthetic password"));
    assert_eq!(run(git(root, &["rev-parse", "HEAD"])).stdout, before);
}

#[test]
fn encrypted_ssh_commits_use_native_askpass_and_verify() {
    let fixture = fixture();
    let root = fixture.path();
    let key = root.join("synthetic-key");
    let keygen = tool("ssh-keygen");
    let mut generate = command(&keygen, root);
    // This password is generated synthetic test data, never a user credential.
    generate
        .args(["-q", "-t", "ed25519", "-N", PASSWORD, "-f"])
        .arg(&key);
    run(generate);
    let public = fs::read_to_string(root.join("synthetic-key.pub")).expect("public key");
    fs::write(
        root.join("allowed-signers"),
        format!("signer@example.invalid {public}"),
    )
    .expect("allowed signer");
    let mut sign = git(
        root,
        &[
            "-c",
            "gpg.format=ssh",
            "-c",
            &format!("gpg.ssh.program={}", keygen.display()),
            "-c",
            &format!("user.signingKey={}", key.display()),
            "commit",
            "--gpg-sign",
            "-m",
            "Synthetic signed commit",
        ],
    );
    sign.env("DENOTE_GIT_ASKPASS_MODE", "1")
        .env("DENOTE_GIT_ASKPASS_CONTEXT", "signing")
        .env("DENOTE_GIT_ASKPASS_FILE", root.join("passphrase"))
        .env("SSH_ASKPASS", env!("CARGO_BIN_EXE_denote"))
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "denote-synthetic");
    let output = run(sign);
    assert!(!String::from_utf8_lossy(&output.stderr).contains(PASSWORD));
    run(git(
        root,
        &[
            "-c",
            "gpg.format=ssh",
            "-c",
            &format!("gpg.ssh.program={}", keygen.display()),
            "-c",
            &format!(
                "gpg.ssh.allowedSignersFile={}",
                root.join("allowed-signers").display()
            ),
            "verify-commit",
            "HEAD",
        ],
    ));
}
