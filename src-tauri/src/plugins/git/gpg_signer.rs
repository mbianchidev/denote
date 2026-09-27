use std::{
    env,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

use super::{askpass::ASKPASS_FILE_ENV, background_command, signing::validate_passphrase};

pub(crate) const GPG_SIGNER_MODE_ENV: &str = "DENOTE_GPG_SIGNER_MODE";
pub(crate) const GPG_SIGNER_PROGRAM_ENV: &str = "DENOTE_GPG_SIGNER_PROGRAM";
const MAX_SIGNING_INPUT: u64 = 1024 * 1024;

/// Git invokes this mode before any application state or window is initialized.
pub fn run_gpg_signer_if_requested() -> Option<i32> {
    if env::var(GPG_SIGNER_MODE_ENV).as_deref() != Ok("1") {
        return None;
    }
    let result = (|| {
        let program = env::var_os(GPG_SIGNER_PROGRAM_ENV)
            .ok_or_else(|| AppError::Plugin("Missing GPG signing program.".to_string()))?;
        let file = env::var_os(ASKPASS_FILE_ENV)
            .ok_or_else(|| AppError::Plugin("Missing signing passphrase channel.".to_string()))?;
        let passphrase = super::askpass::read_signing_secret(Path::new(&file))?;
        validate_passphrase(&passphrase)?;
        let mut input = Zeroizing::new(Vec::new());
        std::io::stdin()
            .take(MAX_SIGNING_INPUT + 1)
            .read_to_end(&mut input)?;
        if input.len() as u64 > MAX_SIGNING_INPUT {
            return Err(AppError::Plugin(
                "Git signing input exceeds 1 MiB.".to_string(),
            ));
        }
        let args: Vec<_> = env::args().skip(1).collect();
        sign(
            Path::new(&program),
            &args,
            &input,
            &passphrase,
            Stdio::inherit(),
            Stdio::inherit(),
        )
    })();
    Some(match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!(
                "Denote signing failed: {error}. Check the selected key and replace or delete its saved passphrase in Settings."
            );
            1
        }
    })
}

pub(crate) fn signer_command(program: &Path, args: &[String]) -> AppResult<Command> {
    if !program.is_absolute()
        || !program.is_file()
        || args.len() != 3
        || args[0] != "--status-fd=2"
        || args[1] != "-bsau"
        || args[2].is_empty()
        || args[2].starts_with('-')
        || args[2].len() > 4096
        || args[2].chars().any(char::is_control)
    {
        return Err(AppError::Plugin(
            "Invalid OpenPGP signing invocation.".to_string(),
        ));
    }
    let mut command = background_command(program);
    super::transport::remove_inherited_environment(&mut command);
    command
        .args([
            "--batch",
            "--no-tty",
            "--pinentry-mode=loopback",
            "--passphrase-fd=0",
        ])
        .args(args);
    Ok(command)
}

pub(crate) fn sign(
    program: &Path,
    args: &[String],
    input: &[u8],
    passphrase: &str,
    stdout: Stdio,
    stderr: Stdio,
) -> AppResult<i32> {
    validate_passphrase(passphrase)?;
    let mut command = signer_command(program, args)?;
    command.stdin(Stdio::piped()).stdout(stdout).stderr(stderr);
    // The child stays in Git's process group/job, including on Windows.
    let mut child = command.spawn()?;
    let mut pipe = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Plugin("Cannot open the GPG passphrase pipe.".to_string()))?;
    let mut payload = Zeroizing::new(Vec::with_capacity(passphrase.len() + input.len() + 1));
    payload.extend_from_slice(passphrase.as_bytes());
    payload.push(b'\n');
    payload.extend_from_slice(input);
    let writer = thread::spawn(move || pipe.write_all(&payload));
    let deadline = Instant::now() + Duration::from_secs(60);
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code().unwrap_or(1)),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => break Err(AppError::Plugin("GPG signing timed out.".to_string())),
            Err(error) => break Err(error.into()),
        }
    };
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let written = writer
        .join()
        .map_err(|_| AppError::Plugin("GPG input writer failed.".to_string()))?;
    let code = result?;
    if code == 0 {
        written?;
    }
    Ok(code)
}
