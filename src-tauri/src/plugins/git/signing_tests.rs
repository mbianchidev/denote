use std::{fs, path::Path};

use super::signing::{
    SigningFormat, parse_secret_key_fingerprints, resolve_program_in_paths, signing_credential_id,
};
use super::transport::SystemGitSettings;
use super::{askpass::AskpassMaterial, gpg_signer::signer_command};

#[test]
fn repository_signing_overrides_do_not_import_commands_or_reject_unrelated_identity_text() {
    let mut settings = SystemGitSettings::from_pairs([
        ("gpg.format", "openpgp"),
        ("user.signingkey", "SYSTEM"),
        ("gpg.program", "/synthetic/system-gpg"),
    ]);
    settings.append_repository_signing(
        "user.name\nSynthetic\tAuthor\0gpg.format\nssh\0user.signingkey\n/synthetic/key\0gpg.program\nuntrusted-program\0"
    ).expect("safe local settings");
    assert_eq!(settings.last("gpg.format"), Some("ssh"));
    assert_eq!(settings.last("user.signingkey"), Some("/synthetic/key"));
    assert_eq!(settings.last("gpg.program"), Some("/synthetic/system-gpg"));
    assert!(settings.last("user.name").is_none());
}

#[test]
fn signing_program_resolution_uses_absolute_search_paths_without_repository_fallback() {
    let root = tempfile::tempdir().expect("directory");
    let intended = root.path().join("GnuPG").join("bin");
    let bundled = root.path().join("Git").join("usr").join("bin");
    fs::create_dir_all(&intended).expect("intended");
    fs::create_dir_all(&bundled).expect("bundled");
    let name = if cfg!(windows) { "gpg.exe" } else { "gpg" };
    for directory in [&intended, &bundled] {
        fs::write(directory.join(name), "synthetic executable").expect("program");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory.join(name), fs::Permissions::from_mode(0o700))
                .expect("executable");
        }
    }
    assert_eq!(
        resolve_program_in_paths("gpg", &[intended.clone(), bundled]).expect("resolution"),
        fs::canonicalize(intended.join(name)).expect("canonical program"),
    );
    assert!(resolve_program_in_paths("gpg", &[Path::new(".").to_path_buf()]).is_err());
    assert!(resolve_program_in_paths("./gpg", &[intended]).is_err());
}

#[test]
fn gpg_discovery_uses_complete_valid_primary_fingerprints_not_user_text() {
    let first = "A".repeat(40);
    let second = "B".repeat(40);
    let output = format!(
        "sec:u:255:22:1111111111111111:1:0:::::scSC:\nfpr:::::::::{first}:\nuid:u::::1::fake::Synthetic <author@example.invalid>:\nssb:u:255:18:2222222222222222:1:0:::::e:\nfpr:::::::::{}:\nsec:r:255:22:3333333333333333:1:0:::::scSC:\nfpr:::::::::{second}:\n",
        "C".repeat(40),
    );
    assert_eq!(
        parse_secret_key_fingerprints(&output).expect("fingerprints"),
        vec![first]
    );
    assert!(parse_secret_key_fingerprints("sec:u:255:22:bad:1:0:::::s:\n").is_err());
}

#[test]
fn saved_passphrases_are_bound_to_format_program_key_and_home() {
    let base = signing_credential_id(
        SigningFormat::OpenPgp,
        Path::new("/synthetic/gpg"),
        "A",
        "home",
    );
    for changed in [
        signing_credential_id(SigningFormat::Ssh, Path::new("/synthetic/gpg"), "A", "home"),
        signing_credential_id(
            SigningFormat::OpenPgp,
            Path::new("/synthetic/other"),
            "A",
            "home",
        ),
        signing_credential_id(
            SigningFormat::OpenPgp,
            Path::new("/synthetic/gpg"),
            "B",
            "home",
        ),
        signing_credential_id(
            SigningFormat::OpenPgp,
            Path::new("/synthetic/gpg"),
            "A",
            "other",
        ),
    ] {
        assert_ne!(base, changed);
    }
    assert_eq!(base.len(), 64);
    assert!(base.chars().all(|character| character.is_ascii_hexdigit()));
}

#[test]
fn signing_passphrase_material_is_private_ephemeral_and_not_a_command_argument() {
    let root = tempfile::tempdir().expect("directory");
    let program = root.path().join("synthetic-gpg");
    fs::write(&program, "synthetic executable").expect("program");
    let material = AskpassMaterial::create_openpgp(
        root.path(),
        program.clone(),
        program.clone(),
        " synthetic secret ",
    )
    .expect("secret");
    let path = material.file().to_path_buf();
    assert_eq!(
        &*super::askpass::read_signing_secret(&path).expect("read"),
        " synthetic secret "
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(path.parent().expect("parent"))
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    let command = signer_command(
        &program,
        &[
            "--status-fd=2".to_string(),
            "-bsau".to_string(),
            "A".repeat(40),
        ],
    )
    .expect("command");
    assert!(!format!("{command:?}").contains("synthetic secret"));
    assert!(signer_command(&program, &["--decrypt".to_string()]).is_err());
    drop(material);
    assert!(!path.exists());
    assert!(!path.parent().expect("parent").exists());
}
