use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) fn configure_gpg_home(command: &mut Command, program: &Path) {
    let home = match command
        .get_envs()
        .find(|(name, _)| *name == OsStr::new("GNUPGHOME"))
    {
        Some((_, value)) => value.map(ToOwned::to_owned),
        None => std::env::var_os("GNUPGHOME"),
    };
    if let Some(home) = home {
        command.env("GNUPGHOME", gpg_home_path(program, Path::new(&home)));
    }
}

pub(crate) fn gpg_home_path(program: &Path, home: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if program
            .parent()
            .is_some_and(|directory| directory.join("msys-2.0.dll").is_file())
            && let Some(home) = home.to_str()
        {
            return PathBuf::from(msys_home(home));
        }
    }
    let _ = program;
    home.to_path_buf()
}

#[cfg(any(windows, test))]
fn msys_home(home: &str) -> String {
    let home = home
        .strip_prefix(r"\\?\UNC\")
        .map(|tail| format!("//{tail}"))
        .unwrap_or_else(|| home.strip_prefix(r"\\?\").unwrap_or(home).to_string())
        .replace('\\', "/");
    let bytes = home.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return format!(
            "/{}{}",
            char::from(bytes[0].to_ascii_lowercase()),
            &home[2..]
        );
    }
    home
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn msys_gpg_home_uses_drive_or_unc_paths_without_changing_posix_paths() {
        assert_eq!(
            msys_home(r"C:\Users\Synthetic\keyring"),
            "/c/Users/Synthetic/keyring"
        );
        assert_eq!(msys_home(r"\\?\D:\Keys\signing"), "/d/Keys/signing");
        assert_eq!(
            msys_home(r"\\?\UNC\server\share\keys"),
            "//server/share/keys"
        );
        assert_eq!(
            msys_home("/c/Users/Synthetic/keys"),
            "/c/Users/Synthetic/keys"
        );
    }

    #[test]
    fn native_gpg_home_keeps_its_original_path() {
        let directory = tempfile::tempdir().expect("directory");
        let program = directory.path().join("gpg.exe");
        let home = Path::new(r"C:\Users\Synthetic\keyring");
        assert_eq!(gpg_home_path(&program, home), home);
    }

    #[cfg(windows)]
    #[test]
    fn msys_runtime_detection_normalizes_explicit_home_values() {
        let directory = tempfile::tempdir().expect("directory");
        std::fs::write(
            directory.path().join("msys-2.0.dll"),
            "synthetic runtime marker",
        )
        .expect("marker");
        let program = directory.path().join("gpg.exe");
        let mut command = Command::new(&program);
        command.env("GNUPGHOME", r"C:\Users\Synthetic\keyring");
        configure_gpg_home(&mut command, &program);
        assert_eq!(
            command
                .get_envs()
                .find(|(key, _)| *key == "GNUPGHOME")
                .and_then(|(_, value)| value),
            Some(OsStr::new("/c/Users/Synthetic/keyring")),
        );
    }
}
