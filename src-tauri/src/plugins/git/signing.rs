use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult},
    plugins::{
        PluginManager, sandbox::HOST_GIT_SIGNING_SECRET_PREFIX, settings::GitSettingsPolicy,
    },
};

use super::{
    background_command, spawn_background_group,
    transport::{
        GitOperationToken, GitPlanStep, SystemGitSettings, git_cli_path_string,
        read_system_git_settings_at, remove_inherited_environment,
    },
};

const PLUGIN_ID: &str = "denote.git";
const PROBE_LIMIT: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SigningFormat {
    OpenPgp,
    Ssh,
    X509,
}

impl SigningFormat {
    pub(crate) fn parse(value: Option<&str>) -> AppResult<Self> {
        match value.unwrap_or("openpgp").to_ascii_lowercase().as_str() {
            "openpgp" => Ok(Self::OpenPgp),
            "ssh" => Ok(Self::Ssh),
            "x509" => Ok(Self::X509),
            _ => Err(AppError::Plugin(
                "Git signing format must be openpgp, ssh, or x509.".to_string(),
            )),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::OpenPgp => "openpgp",
            Self::Ssh => "ssh",
            Self::X509 => "x509",
        }
    }

    fn program_key(self) -> &'static str {
        match self {
            Self::OpenPgp => "gpg.openpgp.program",
            Self::Ssh => "gpg.ssh.program",
            Self::X509 => "gpg.x509.program",
        }
    }

    fn default_program(self) -> &'static str {
        match self {
            Self::OpenPgp => "gpg",
            Self::Ssh => "ssh-keygen",
            Self::X509 => "gpgsm",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSigningStatus {
    pub(crate) format: SigningFormat,
    pub program: String,
    pub key: Option<String>,
    pub key_source: String,
    pub credential_id: Option<String>,
    pub has_saved_passphrase: bool,
    pub guidance: String,
}

pub(crate) struct SigningSelection {
    pub(crate) status: GitSigningStatus,
    pub(crate) program: PathBuf,
}

pub(crate) fn resolve_signer(
    git: &Path,
    policy: &GitSettingsPolicy,
    settings: &SystemGitSettings,
    repository: Option<&Path>,
    token: &GitOperationToken,
    author_email: Option<&str>,
) -> AppResult<SigningSelection> {
    let format = SigningFormat::parse(settings.last("gpg.format"))?;
    let configured_program = if format == SigningFormat::OpenPgp {
        settings.last_of(&["gpg.program", "gpg.openpgp.program"])
    } else {
        settings.last(format.program_key())
    };
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();
    paths.extend(default_program_directories());
    if let Some(root) = git.parent().and_then(Path::parent) {
        paths.extend([root.join("usr/bin"), root.join("bin")]);
    }
    let program = resolve_program_in_paths(
        configured_program.unwrap_or(format.default_program()),
        &paths,
    )?;
    let configured_key = policy
        .signing_key
        .as_deref()
        .or(settings.last("user.signingkey"));
    let key_source = if policy.signing_key.is_some() {
        "Denote setting"
    } else if configured_key.is_some() {
        "Git configuration"
    } else {
        "Detected signing key"
    };
    let (key, identity, guidance) = match format {
        SigningFormat::OpenPgp => {
            if configured_key.is_some_and(|key| key.contains(['/', '\\'])) {
                return Err(AppError::Plugin(
                    "OpenPGP signing uses an imported key fingerprint, not a key-file path. Run gpg --list-secret-keys --keyid-format=long, or select SSH signing for an SSH private-key file.".to_string(),
                ));
            }
            let selector = configured_key.or(author_email).or(settings.last("user.email"));
            let mut command = background_command(super::transport::git_cli_path(&program));
            command.args([
                "--batch", "--no-tty", "--with-colons", "--with-fingerprint",
                "--list-secret-keys",
            ]);
            if let Some(selector) = selector {
                validate_selector(selector)?;
                command.arg(selector);
            }
            let output = probe(command, token)?;
            let fingerprints = parse_secret_key_fingerprints(&output)?;
            let [fingerprint] = fingerprints.as_slice() else {
                return Err(AppError::Plugin(if fingerprints.is_empty() {
                    "No usable OpenPGP signing key was found in the selected GPG keyring. Run gpg --list-secret-keys --keyid-format=long with the GPG program shown in Settings; on Windows check Gpg4win versus Git's bundled GPG.".to_string()
                } else {
                    "More than one OpenPGP signing key matches. Set user.signingKey in Git or choose a fingerprint in Denote's Signing key setting.".to_string()
                }));
            };
            let key = configured_key.filter(|key| key.ends_with('!')).unwrap_or(fingerprint);
            let home = env::var_os("GNUPGHOME")
                .or_else(|| if cfg!(windows) { env::var_os("APPDATA") } else { None })
                .or_else(|| env::var_os("HOME"))
                .or_else(|| env::var_os("USERPROFILE"))
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            (
                Some(key.to_string()),
                Some(signing_credential_id(format, &program, key, &home)),
                "OpenPGP key from the selected GPG keyring. Without a saved passphrase, GPG agent/pinentry handles unlocking.".to_string(),
            )
        }
        SigningFormat::Ssh => {
            let key = configured_key.ok_or_else(|| AppError::Plugin(
                "SSH signing needs user.signingKey or a Signing key path in Denote. Run git config --show-origin --get user.signingKey; use ssh-add -L to see agent keys.".to_string(),
            ))?;
            validate_selector(key)?;
            if key.starts_with("key::") || key.starts_with("ssh-") || key.ends_with(".pub") {
                (
                    Some(key.to_string()),
                    None,
                    "This SSH public key signs through ssh-agent. Select its private-key file to save a passphrase; Denote never exports keys from the agent.".to_string(),
                )
            } else {
                let path = expand_key_path(key, repository)?;
                let mut file = fs::File::open(&path)?;
                if !file.metadata()?.is_file() || file.metadata()?.len() > PROBE_LIMIT {
                    return Err(AppError::Plugin("The SSH signing key must be a regular file smaller than 1 MiB.".to_string()));
                }
                let mut bytes = Zeroizing::new(Vec::new());
                (&mut file).take(PROBE_LIMIT + 1).read_to_end(&mut bytes)?;
                if bytes.len() as u64 > PROBE_LIMIT {
                    return Err(AppError::Plugin("The SSH signing key exceeds 1 MiB.".to_string()));
                }
                let digest = hex::encode(Sha256::digest(&*bytes));
                let key = git_cli_path_string(&path);
                (
                    Some(key.clone()),
                    Some(signing_credential_id(format, &program, &key, &digest)),
                    "Passphrases are bound to this SSH key file's path and content. Agent-based signing remains available when no passphrase is saved.".to_string(),
                )
            }
        }
        SigningFormat::X509 => (
            configured_key.map(str::to_string),
            None,
            "X.509 signing continues to use the system GPG agent/pinentry; saved passphrases are supported for OpenPGP and SSH.".to_string(),
        ),
    };
    Ok(SigningSelection {
        status: GitSigningStatus {
            format,
            program: git_cli_path_string(&program),
            key,
            key_source: key_source.to_string(),
            credential_id: identity,
            has_saved_passphrase: false,
            guidance,
        },
        program,
    })
}

pub(crate) fn pin_signer(steps: &mut [GitPlanStep], selection: &SigningSelection) -> AppResult<()> {
    for step in steps {
        let GitPlanStep::Command { args, .. } = step else {
            continue;
        };
        let index = args
            .iter()
            .position(|argument| argument == "commit")
            .ok_or_else(|| {
                AppError::Plugin("The signing plan has no commit command.".to_string())
            })?;
        let mut config = vec![
            "-c".to_string(),
            format!("gpg.format={}", selection.status.format.as_str()),
            "-c".to_string(),
            format!(
                "{}={}",
                selection.status.format.program_key(),
                selection.status.program
            ),
        ];
        if let Some(key) = &selection.status.key {
            config.extend(["-c".to_string(), format!("user.signingKey={key}")]);
            for arg in &mut args[index + 1..] {
                if arg.starts_with("--gpg-sign=") {
                    *arg = "--gpg-sign".to_string();
                }
            }
        }
        args.splice(index..index, config);
    }
    Ok(())
}

pub(crate) fn resolve_program_in_paths(value: &str, paths: &[PathBuf]) -> AppResult<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() {
        return regular_program(path);
    }
    if value.is_empty() || value.contains(['/', '\\']) || value.chars().any(char::is_whitespace) {
        return Err(AppError::Plugin(
            "The signing program must be an absolute executable path or a plain program name."
                .to_string(),
        ));
    }
    for directory in paths.iter().filter(|path| path.is_absolute()) {
        let candidate = directory.join(value);
        #[cfg(windows)]
        let candidate = if candidate.extension().is_none() {
            candidate.with_extension("exe")
        } else {
            candidate
        };
        if candidate.is_file() {
            return regular_program(&candidate);
        }
    }
    Err(AppError::Plugin(format!(
        "Signing program {value} was not found. Install GnuPG/Gpg4win or configure an absolute gpg.program path in your system Git settings."
    )))
}

fn regular_program(path: &Path) -> AppResult<PathBuf> {
    let path = fs::canonicalize(path).map_err(|error| {
        AppError::Plugin(format!(
            "Cannot locate the configured signing program: {error}"
        ))
    })?;
    if !path.is_file() {
        return Err(AppError::Plugin(
            "The signing program is not a regular file.".to_string(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(&path)?.permissions().mode() & 0o111 == 0 {
            return Err(AppError::Plugin(
                "The signing program is not executable.".to_string(),
            ));
        }
    }
    Ok(path)
}

fn default_program_directories() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut paths = Vec::new();
        for name in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(root) = env::var_os(name) {
                let root = PathBuf::from(root);
                paths.extend([root.join("GnuPG/bin"), root.join("Gpg4win/bin")]);
            }
        }
        if let Some(root) = env::var_os("SystemRoot") {
            paths.push(PathBuf::from(root).join("System32/OpenSSH"));
        }
        paths
    }
    #[cfg(not(windows))]
    {
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
            .map(PathBuf::from)
            .to_vec()
    }
}

fn expand_key_path(value: &str, repository: Option<&Path>) -> AppResult<PathBuf> {
    let path = if let Some(relative) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        let home = env::var_os("HOME")
            .or_else(|| env::var_os("USERPROFILE"))
            .ok_or_else(|| {
                AppError::Plugin("Cannot resolve the home directory for the SSH key.".to_string())
            })?;
        PathBuf::from(home).join(relative)
    } else {
        PathBuf::from(value)
    };
    let path = if path.is_absolute() {
        path
    } else {
        repository
            .ok_or_else(|| {
                AppError::Plugin(
                    "Use an absolute SSH key path in Git or Denote settings.".to_string(),
                )
            })?
            .join(path)
    };
    fs::canonicalize(path)
        .map_err(|error| AppError::Plugin(format!("Cannot locate the SSH signing key: {error}")))
}

fn validate_selector(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.starts_with('-')
        || value.len() > 4096
        || value.chars().any(char::is_control)
    {
        return Err(AppError::Plugin(
            "The signing key selector is invalid.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn parse_secret_key_fingerprints(output: &str) -> AppResult<Vec<String>> {
    let mut fingerprints = Vec::new();
    let mut primary = false;
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    for line in output.lines() {
        let fields: Vec<_> = line.split(':').collect();
        match fields.first().copied() {
            Some("sec") => {
                let valid = fields
                    .get(1)
                    .is_some_and(|validity| !["r", "e", "d", "i"].contains(validity));
                let expires = fields
                    .get(6)
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0);
                primary = valid
                    && (expires == 0 || expires > now)
                    && fields.get(11).is_some_and(|caps| caps.contains(['s', 'S']));
            }
            Some("ssb") => primary = false,
            Some("fpr") if primary => {
                let fingerprint = fields
                    .get(9)
                    .filter(|value| {
                        matches!(value.len(), 40 | 64)
                            && value.chars().all(|character| character.is_ascii_hexdigit())
                    })
                    .ok_or_else(|| {
                        AppError::Plugin(
                            "GPG returned an invalid signing-key fingerprint.".to_string(),
                        )
                    })?;
                fingerprints.push(fingerprint.to_ascii_uppercase());
                primary = false;
                if fingerprints.len() > 256 {
                    return Err(AppError::Plugin("GPG reported more than 256 signing keys; configure a specific fingerprint.".to_string()));
                }
            }
            _ => {}
        }
    }
    if primary {
        return Err(AppError::Plugin(
            "GPG returned an incomplete signing-key record.".to_string(),
        ));
    }
    Ok(fingerprints)
}

pub(crate) fn signing_credential_id(
    format: SigningFormat,
    program: &Path,
    key: &str,
    binding: &str,
) -> String {
    let mut hash = Sha256::new();
    for value in [format.as_str(), &git_cli_path_string(program), key, binding] {
        hash.update(value.as_bytes());
        hash.update([0]);
    }
    hex::encode(hash.finalize())
}

pub(crate) fn probe(mut command: Command, token: &GitOperationToken) -> AppResult<String> {
    remove_inherited_environment(&mut command);
    let program = PathBuf::from(command.get_program());
    super::gpg_paths::configure_gpg_home(&mut command, &program);
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout.try_clone()?))
        .stderr(Stdio::from(stderr.try_clone()?));
    let mut child = spawn_background_group(&mut command).map_err(|error| {
        AppError::Plugin(format!(
            "Cannot start the signing configuration probe: {error}"
        ))
    })?;
    let deadline = Instant::now() + Duration::from_secs(15);
    let result = (|| {
        loop {
            if token.is_cancelled() {
                return Err(AppError::Plugin(
                    "Signing key detection was cancelled.".to_string(),
                ));
            }
            if stdout.metadata()?.len() > PROBE_LIMIT || stderr.metadata()?.len() > PROBE_LIMIT {
                return Err(AppError::Plugin(
                    "Signing key detection exceeded its output limit.".to_string(),
                ));
            }
            if Instant::now() >= deadline {
                return Err(AppError::Plugin(
                    "Signing key detection timed out after 15 seconds.".to_string(),
                ));
            }
            if let Some(status) = child.inner().try_wait()? {
                if !status.success() {
                    stderr.seek(SeekFrom::Start(0))?;
                    let mut message = String::new();
                    (&mut stderr).take(4096).read_to_string(&mut message)?;
                    return Err(AppError::Plugin(format!(
                        "Signing key detection failed: {}. Check the signing program and keyring in Settings.",
                        message.lines().take(3).collect::<Vec<_>>().join(" ")
                    )));
                }
                stdout.seek(SeekFrom::Start(0))?;
                let mut output = String::new();
                (&mut stdout)
                    .take(PROBE_LIMIT + 1)
                    .read_to_string(&mut output)?;
                if output.len() as u64 > PROBE_LIMIT {
                    return Err(AppError::Plugin(
                        "Signing key detection exceeded its output limit.".to_string(),
                    ));
                }
                return Ok(output);
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    let _ = child.kill();
    let _ = child.wait();
    result
}

pub(crate) fn read_repository_signing(
    settings: &mut SystemGitSettings,
    git: &Path,
    root: &Path,
    token: &GitOperationToken,
) -> AppResult<()> {
    if super::transport::resolve_git_directory(root)?
        != super::transport::GitDirectoryState::Directory
    {
        return Ok(());
    }
    super::transport::assert_repository_config_is_safe(&root.join(".git"))?;
    let mut command = background_command(git);
    command
        .current_dir(root)
        .args(["config", "--local", "--no-includes", "--null", "--list"]);
    settings.append_repository_signing(&probe(command, token)?)
}

impl PluginManager {
    fn signing_selection_for_settings(
        &self,
        repository: Option<&Path>,
    ) -> AppResult<SigningSelection> {
        self.catalog_entry(PLUGIN_ID)?;
        let operation =
            self.register_git_operation(PLUGIN_ID, &uuid::Uuid::new_v4().to_string())?;
        let git = self.resolve_git_executable_for_plugin(PLUGIN_ID)?;
        let policy = self.git_settings_policy(PLUGIN_ID)?;
        let mut settings = if policy.use_system_settings {
            read_system_git_settings_at(&git, repository)?
        } else {
            SystemGitSettings::default()
        };
        if let Some(root) = repository {
            read_repository_signing(&mut settings, &git, root, operation.token())?;
        }
        let plugin_settings = self.settings(PLUGIN_ID)?;
        let author_email = plugin_settings
            .get("authorEmail")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty());
        resolve_signer(
            &git,
            &policy,
            &settings,
            repository,
            operation.token(),
            author_email,
        )
    }

    pub(crate) fn git_signing_status(
        &self,
        repository: Option<&Path>,
    ) -> AppResult<GitSigningStatus> {
        let mut selection = self.signing_selection_for_settings(repository)?;
        selection.status.has_saved_passphrase = self
            .saved_signing_passphrase(PLUGIN_ID, &selection)?
            .is_some();
        Ok(selection.status)
    }

    pub(crate) fn save_git_signing_passphrase(
        &self,
        credential_id: &str,
        passphrase: &str,
        repository: Option<&Path>,
    ) -> AppResult<GitSigningStatus> {
        let _operation = self.begin_operation(PLUGIN_ID)?;
        validate_passphrase(passphrase)?;
        let mut selection = self.signing_selection_for_settings(repository)?;
        require_matching_credential(&selection, credential_id)?;
        self.host_secret_set(
            PLUGIN_ID,
            &format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{credential_id}"),
            passphrase,
        )?;
        selection.status.has_saved_passphrase = true;
        Ok(selection.status)
    }

    pub(crate) fn delete_git_signing_passphrase(&self, credential_id: &str) -> AppResult<()> {
        let _operation = self.begin_operation(PLUGIN_ID)?;
        if credential_id.len() != 64
            || !credential_id
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(AppError::Plugin(
                "Invalid signing credential identifier.".to_string(),
            ));
        }
        self.host_secret_delete(
            PLUGIN_ID,
            &format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{credential_id}"),
        )
    }

    pub(crate) fn saved_signing_passphrase(
        &self,
        plugin_id: &str,
        selection: &SigningSelection,
    ) -> AppResult<Option<Zeroizing<String>>> {
        let Some(id) = &selection.status.credential_id else {
            return Ok(None);
        };
        let key = format!("{HOST_GIT_SIGNING_SECRET_PREFIX}{id}");
        let state = self.state()?;
        let tracked = state
            .credential_keys
            .get(plugin_id)
            .is_some_and(|keys| keys.contains(&key))
            || state
                .pending_credential_keys
                .get(plugin_id)
                .is_some_and(|keys| keys.contains(&key));
        drop(state);
        if !tracked {
            return Ok(None);
        }
        let secret = self.host_secret_get(plugin_id, &key)?.map(Zeroizing::new);
        if let Some(value) = &secret {
            validate_passphrase(value)?;
        }
        Ok(secret)
    }
}

fn require_matching_credential(selection: &SigningSelection, credential_id: &str) -> AppResult<()> {
    if selection.status.credential_id.as_deref() != Some(credential_id) {
        return Err(AppError::Plugin(
            "The signing key changed. Detect it again before saving its passphrase.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_passphrase(passphrase: &str) -> AppResult<()> {
    if passphrase.is_empty() || passphrase.len() > 4096 || passphrase.chars().any(char::is_control)
    {
        return Err(AppError::Plugin("The signing passphrase must be non-empty, at most 4096 bytes, and contain no line breaks or control characters.".to_string()));
    }
    Ok(())
}
