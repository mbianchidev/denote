use std::{
    fs,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::error::{AppError, AppResult};

const DEFAULT_VAULT_NAME: &str = "Denote Welcome";
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

pub fn ensure(app_data_dir: &Path) -> AppResult<PathBuf> {
    let target = app_data_dir.join(DEFAULT_VAULT_NAME);
    if let Some(existing) = existing_default_vault(&target)? {
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
    for (relative_path, content) in SEED_FILES {
        let path = root.join(relative_path);
        let parent = path
            .parent()
            .ok_or_else(|| AppError::State(format!("Invalid seed path: {relative_path}")))?;
        fs::create_dir_all(parent)?;
        fs::write(path, content)?;
    }
    Ok(())
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
        for (relative_path, content) in SEED_FILES {
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

        fs::write(&welcome, "My edited welcome").expect("edit welcome");
        assert_eq!(ensure(directory.path()).expect("existing vault"), vault);
        assert_eq!(
            fs::read_to_string(welcome).expect("edited welcome"),
            "My edited welcome"
        );
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
}
