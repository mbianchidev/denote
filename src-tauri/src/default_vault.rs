use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::error::{AppError, AppResult};

const DEFAULT_VAULT_NAME: &str = "Denote Welcome";
const TEST_FIXTURE_MARKER: &str = ".denote/fixtures/test-v1";
const SEED_FILES: &[(&str, &[u8])] = &[
    (
        "Welcome.md",
        include_bytes!("../resources/default-vault/Welcome.md"),
    ),
    (
        "docs/Getting started.md",
        include_bytes!("../resources/default-vault/docs/Getting started.md"),
    ),
    (
        "docs/Feature reference.md",
        include_bytes!("../resources/default-vault/docs/Feature reference.md"),
    ),
    (
        "docs/Writing and formatting.md",
        include_bytes!("../resources/default-vault/docs/Writing and formatting.md"),
    ),
    (
        "docs/Search and replace.md",
        include_bytes!("../resources/default-vault/docs/Search and replace.md"),
    ),
    (
        "docs/Files, tabs, and vaults.md",
        include_bytes!("../resources/default-vault/docs/Files, tabs, and vaults.md"),
    ),
    (
        "docs/History, trash, and recovery.md",
        include_bytes!("../resources/default-vault/docs/History, trash, and recovery.md"),
    ),
    (
        "docs/Vault encryption.md",
        include_bytes!("../resources/default-vault/docs/Vault encryption.md"),
    ),
    (
        "docs/Editor display.md",
        include_bytes!("../resources/default-vault/docs/Editor display.md"),
    ),
    (
        "docs/Keyboard shortcuts.md",
        include_bytes!("../resources/default-vault/docs/Keyboard shortcuts.md"),
    ),
    (
        "docs/Optional plugins.md",
        include_bytes!("../resources/default-vault/docs/Optional plugins.md"),
    ),
    (
        "assets/orbit.svg",
        include_bytes!("../resources/default-vault/assets/orbit.svg"),
    ),
];
const TEST_FILES: &[(&str, &[u8])] = &[
    (
        "test/日本語 ノート.md",
        include_bytes!("../resources/default-vault/test/日本語 ノート.md"),
    ),
    (
        "test/Русская заметка.md",
        include_bytes!("../resources/default-vault/test/Русская заметка.md"),
    ),
    (
        "test/emoji 🚀 spaces & symbols.md",
        include_bytes!("../resources/default-vault/test/emoji 🚀 spaces & symbols.md"),
    ),
    (
        "test/brackets (draft) [v1].md",
        include_bytes!("../resources/default-vault/test/brackets (draft) [v1].md"),
    ),
    (
        "test/入れ子 папка/混合言語 файл.md",
        include_bytes!("../resources/default-vault/test/入れ子 папка/混合言語 файл.md"),
    ),
    (
        "test/sample 日本語.ts",
        include_bytes!("../resources/default-vault/test/sample 日本語.ts"),
    ),
    (
        "test/links edge cases.md",
        include_bytes!("../resources/default-vault/test/links edge cases.md"),
    ),
];

pub fn ensure(app_data_dir: &Path) -> AppResult<PathBuf> {
    let target = app_data_dir.join(DEFAULT_VAULT_NAME);
    if let Some(existing) = existing_default_vault(&target)? {
        if let Err(error) = add_test_fixtures_once(&existing) {
            eprintln!("Unable to add default-vault test fixtures: {error}");
        }
        return Ok(existing);
    }

    let staging = app_data_dir.join(format!(".denote-welcome-{}", Uuid::new_v4()));
    fs::create_dir(&staging)?;
    if let Err(error) = write_seed_files(&staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        if existing_default_vault(&target)?.is_none() {
            return Err(error.into());
        }
    }
    write_test_fixture_marker(&target)?;
    Ok(fs::canonicalize(target)?)
}

fn existing_default_vault(path: &Path) -> AppResult<Option<PathBuf>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_link(&metadata) => Err(AppError::State(format!(
            "Default vault path cannot be a symbolic link: {}",
            path.display()
        ))),
        Ok(metadata) if metadata.is_dir() => Ok(Some(fs::canonicalize(path)?)),
        Ok(_) => Err(AppError::State(format!(
            "Default vault path is not a folder: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
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

pub fn name() -> &'static str {
    DEFAULT_VAULT_NAME
}

fn write_seed_files(root: &Path) -> AppResult<()> {
    for (relative_path, content) in SEED_FILES.iter().chain(TEST_FILES) {
        let path = root.join(relative_path);
        let parent = path
            .parent()
            .ok_or_else(|| AppError::State(format!("Invalid seed path: {relative_path}")))?;
        fs::create_dir_all(parent)?;
        fs::write(path, content)?;
    }
    Ok(())
}

fn add_test_fixtures_once(root: &Path) -> AppResult<()> {
    let marker = root.join(TEST_FIXTURE_MARKER);
    match fs::symlink_metadata(&marker) {
        Ok(metadata) if metadata_is_link(&metadata) => {
            return Err(AppError::State(format!(
                "Default vault fixture marker cannot be a symbolic link: {}",
                marker.display()
            )));
        }
        Ok(metadata) if metadata.is_file() => return Ok(()),
        Ok(_) => {
            return Err(AppError::State(format!(
                "Default vault fixture marker is not a regular file: {}",
                marker.display()
            )));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if root.join(".denote/encryption.json").exists() {
        return Ok(());
    }
    let target = root.join("test");
    if fs::symlink_metadata(&target).is_ok() {
        write_test_fixture_marker(root)?;
        return Ok(());
    }
    let parent = root
        .parent()
        .ok_or_else(|| AppError::State("Default vault has no parent folder".to_string()))?;
    let staging = parent.join(format!(".denote-test-fixtures-{}", Uuid::new_v4()));
    if let Err(error) = (|| -> AppResult<()> {
        fs::create_dir(&staging)?;
        for (relative_path, content) in TEST_FILES {
            let relative_path = relative_path
                .strip_prefix("test/")
                .ok_or_else(|| AppError::State("Invalid test fixture path".to_string()))?;
            let path = staging.join("test").join(relative_path);
            let parent = path
                .parent()
                .ok_or_else(|| AppError::State("Invalid test fixture parent".to_string()))?;
            fs::create_dir_all(parent)?;
            fs::write(path, content)?;
        }
        fs::rename(staging.join("test"), &target)?;
        write_test_fixture_marker(root)
    })() {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = fs::remove_dir(&staging);
    Ok(())
}

fn write_test_fixture_marker(root: &Path) -> AppResult<()> {
    let marker = root.join(TEST_FIXTURE_MARKER);
    let metadata = root.join(".denote");
    ensure_real_directory(&metadata, "Default vault metadata folder")?;
    let fixtures = metadata.join("fixtures");
    ensure_real_directory(&fixtures, "Default vault fixture folder")?;

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
    {
        Ok(mut file) => {
            file.write_all(b"applied\n")?;
            file.sync_all()?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let marker_metadata = fs::symlink_metadata(&marker)?;
            if metadata_is_link(&marker_metadata) || !marker_metadata.is_file() {
                return Err(AppError::State(format!(
                    "Default vault fixture marker is not a regular file: {}",
                    marker.display()
                )));
            }
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn ensure_real_directory(path: &Path, label: &str) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_link(&metadata) => Err(AppError::State(format!(
            "{label} cannot be a symbolic link: {}",
            path.display()
        ))),
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(AppError::State(format!(
            "{label} is not a folder: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::create_dir(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                ensure_real_directory(path, label)
            }
            Err(error) => Err(error.into()),
        },
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_the_guide_once_without_overwriting_edits() {
        let directory = tempdir().expect("temp directory");

        let vault = ensure(directory.path()).expect("default vault");
        let welcome = vault.join("Welcome.md");
        for (relative_path, content) in SEED_FILES.iter().chain(TEST_FILES) {
            assert_eq!(
                fs::read(vault.join(relative_path)).expect("seeded file"),
                *content
            );
        }
        let initial = fs::read_to_string(&welcome).expect("welcome");
        assert!(initial.contains(">![info]"));
        assert!(initial.contains("```typescript"));
        assert!(vault.join("docs/Keyboard shortcuts.md").is_file());
        assert!(vault.join("assets/orbit.svg").is_file());
        assert!(vault.join("test/日本語 ノート.md").is_file());

        fs::write(&welcome, "My edited welcome").expect("edit welcome");
        assert_eq!(ensure(directory.path()).expect("existing vault"), vault);
        assert_eq!(
            fs::read_to_string(welcome).expect("edited welcome"),
            "My edited welcome"
        );
        fs::remove_dir_all(vault.join("test")).expect("remove test fixtures");
        assert_eq!(ensure(directory.path()).expect("existing vault"), vault);
        assert!(!vault.join("test").exists());
    }

    #[test]
    fn adds_test_fixtures_once_to_an_existing_unencrypted_vault() {
        let directory = tempdir().expect("temp directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir(&vault).expect("old default vault");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");

        let resolved = ensure(directory.path()).expect("updated default vault");
        assert!(resolved.join("test/Русская заметка.md").is_file());
        assert!(resolved.join(TEST_FIXTURE_MARKER).is_file());
        assert_eq!(
            fs::read_to_string(resolved.join("Welcome.md")).expect("welcome"),
            "Existing guide"
        );
    }

    #[test]
    fn defers_test_fixtures_while_the_default_vault_is_encrypted() {
        let directory = tempdir().expect("temp directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join(".denote")).expect("metadata folder");
        fs::write(vault.join("Welcome.md"), "Encrypted guide").expect("welcome");
        fs::write(vault.join(".denote/encryption.json"), "{}").expect("manifest");

        let resolved = ensure(directory.path()).expect("encrypted default vault");
        assert!(!resolved.join("test").exists());
        assert!(!resolved.join(TEST_FIXTURE_MARKER).exists());

        fs::remove_file(resolved.join(".denote/encryption.json")).expect("remove manifest");
        let resolved = ensure(directory.path()).expect("decrypted default vault");
        assert!(resolved.join("test/links edge cases.md").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_default_vault_path() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        symlink(outside.path(), directory.path().join(DEFAULT_VAULT_NAME))
            .expect("default vault symlink");

        assert!(ensure(directory.path()).is_err());
        assert!(!outside.path().join("Welcome.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_an_existing_test_folder_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir(&vault).expect("old default vault");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(outside.path(), vault.join("test")).expect("test folder symlink");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(resolved.join(TEST_FIXTURE_MARKER).is_file());
        assert_eq!(
            fs::read_dir(outside.path())
                .expect("outside folder")
                .count(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_dangling_fixture_marker_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join(".denote/fixtures")).expect("fixture folder");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(
            outside.path().join("marker"),
            vault.join(TEST_FIXTURE_MARKER),
        )
        .expect("fixture marker symlink");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(!resolved.join("test").exists());
        assert!(!outside.path().join("marker").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_live_fixture_marker_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let outside_marker = outside.path().join("marker");
        fs::write(&outside_marker, "outside").expect("outside marker");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join(".denote/fixtures")).expect("fixture folder");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(&outside_marker, vault.join(TEST_FIXTURE_MARKER)).expect("fixture marker symlink");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(!resolved.join("test").exists());
        assert_eq!(
            fs::read_to_string(outside_marker).expect("outside marker"),
            "outside"
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlinked_metadata_folder() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir(&vault).expect("old default vault");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(outside.path(), vault.join(".denote")).expect("metadata symlink");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(resolved.join("test/Русская заметка.md").is_file());
        assert_eq!(
            fs::read_dir(outside.path())
                .expect("outside folder")
                .count(),
            0
        );
    }
}
