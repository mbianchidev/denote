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
const EXAMPLE_FIXTURE_MARKER: &str = ".denote/fixtures/examples-v1";
const SEED_FILES: &[(&str, &[u8])] = &[
    (
        ".denote.md",
        include_bytes!("../../docs/user-guide/Welcome.md"),
    ),
    (
        "Welcome.md",
        include_bytes!("../../docs/user-guide/Welcome.md"),
    ),
    (
        "docs/Getting started.md",
        include_bytes!("../../docs/user-guide/docs/Getting started.md"),
    ),
    (
        "docs/Feature reference.md",
        include_bytes!("../../docs/user-guide/docs/Feature reference.md"),
    ),
    (
        "docs/Writing and formatting.md",
        include_bytes!("../../docs/user-guide/docs/Writing and formatting.md"),
    ),
    (
        "docs/Search and replace.md",
        include_bytes!("../../docs/user-guide/docs/Search and replace.md"),
    ),
    (
        "docs/Files, tabs, and vaults.md",
        include_bytes!("../../docs/user-guide/docs/Files, tabs, and vaults.md"),
    ),
    (
        "docs/History, trash, and recovery.md",
        include_bytes!("../../docs/user-guide/docs/History, trash, and recovery.md"),
    ),
    (
        "docs/Vault encryption.md",
        include_bytes!("../../docs/user-guide/docs/Vault encryption.md"),
    ),
    (
        "docs/Editor display.md",
        include_bytes!("../../docs/user-guide/docs/Editor display.md"),
    ),
    (
        "docs/Keyboard shortcuts.md",
        include_bytes!("../../docs/user-guide/docs/Keyboard shortcuts.md"),
    ),
    (
        "docs/Optional plugins.md",
        include_bytes!("../../docs/user-guide/docs/Optional plugins.md"),
    ),
    (
        "assets/orbit.svg",
        include_bytes!("../../docs/user-guide/assets/orbit.svg"),
    ),
    (
        "examples/Mermaid diagram.md",
        include_bytes!("../../docs/user-guide/examples/Mermaid diagram.md"),
    ),
    (
        "examples/Hello document.pdf",
        include_bytes!("../../docs/user-guide/examples/Hello document.pdf"),
    ),
    (
        "examples/Sample data.json",
        include_bytes!("../../docs/user-guide/examples/Sample data.json"),
    ),
    (
        "examples/Sample data.yaml",
        include_bytes!("../../docs/user-guide/examples/Sample data.yaml"),
    ),
    (
        "code/README.md",
        include_bytes!("../../docs/user-guide/code/README.md"),
    ),
    (
        "code/hello.js",
        include_bytes!("../../docs/user-guide/code/hello.js"),
    ),
    (
        "code/hello.jsx",
        include_bytes!("../../docs/user-guide/code/hello.jsx"),
    ),
    (
        "code/hello.ts",
        include_bytes!("../../docs/user-guide/code/hello.ts"),
    ),
    (
        "code/hello.tsx",
        include_bytes!("../../docs/user-guide/code/hello.tsx"),
    ),
    (
        "code/Hello.java",
        include_bytes!("../../docs/user-guide/code/Hello.java"),
    ),
    (
        "code/hello.jsp",
        include_bytes!("../../docs/user-guide/code/hello.jsp"),
    ),
    (
        "code/hello.go",
        include_bytes!("../../docs/user-guide/code/hello.go"),
    ),
    (
        "code/go.mod",
        include_bytes!("../../docs/user-guide/code/go.mod"),
    ),
    (
        "code/hello.rs",
        include_bytes!("../../docs/user-guide/code/hello.rs"),
    ),
    (
        "code/hello.py",
        include_bytes!("../../docs/user-guide/code/hello.py"),
    ),
    (
        "code/BUILD.bazel",
        include_bytes!("../../docs/user-guide/code/BUILD.bazel"),
    ),
    (
        "code/hello.c",
        include_bytes!("../../docs/user-guide/code/hello.c"),
    ),
    (
        "code/hello.cpp",
        include_bytes!("../../docs/user-guide/code/hello.cpp"),
    ),
    (
        "code/Hello.cs",
        include_bytes!("../../docs/user-guide/code/Hello.cs"),
    ),
    (
        "code/hello.kt",
        include_bytes!("../../docs/user-guide/code/hello.kt"),
    ),
    (
        "code/hello.swift",
        include_bytes!("../../docs/user-guide/code/hello.swift"),
    ),
    (
        "code/hello.rb",
        include_bytes!("../../docs/user-guide/code/hello.rb"),
    ),
    (
        "code/Gemfile",
        include_bytes!("../../docs/user-guide/code/Gemfile"),
    ),
    (
        "code/hello.php",
        include_bytes!("../../docs/user-guide/code/hello.php"),
    ),
    (
        "code/hello.dart",
        include_bytes!("../../docs/user-guide/code/hello.dart"),
    ),
    (
        "code/hello.lua",
        include_bytes!("../../docs/user-guide/code/hello.lua"),
    ),
    (
        "code/hello.r",
        include_bytes!("../../docs/user-guide/code/hello.r"),
    ),
    (
        "code/hello.scala",
        include_bytes!("../../docs/user-guide/code/hello.scala"),
    ),
    (
        "code/hello.ex",
        include_bytes!("../../docs/user-guide/code/hello.ex"),
    ),
    (
        "code/hello.tf",
        include_bytes!("../../docs/user-guide/code/hello.tf"),
    ),
    (
        "code/_helpers.tpl",
        include_bytes!("../../docs/user-guide/code/_helpers.tpl"),
    ),
    (
        "code/hello.json",
        include_bytes!("../../docs/user-guide/code/hello.json"),
    ),
    (
        "code/Pipfile.lock",
        include_bytes!("../../docs/user-guide/code/Pipfile.lock"),
    ),
    (
        "code/hello.xml",
        include_bytes!("../../docs/user-guide/code/hello.xml"),
    ),
    (
        "code/hello.html",
        include_bytes!("../../docs/user-guide/code/hello.html"),
    ),
    (
        "code/hello.css",
        include_bytes!("../../docs/user-guide/code/hello.css"),
    ),
    (
        "code/hello.scss",
        include_bytes!("../../docs/user-guide/code/hello.scss"),
    ),
    (
        "code/hello.less",
        include_bytes!("../../docs/user-guide/code/hello.less"),
    ),
    (
        "code/hello.md",
        include_bytes!("../../docs/user-guide/code/hello.md"),
    ),
    (
        "code/hello.sh",
        include_bytes!("../../docs/user-guide/code/hello.sh"),
    ),
    (
        "code/Procfile",
        include_bytes!("../../docs/user-guide/code/Procfile"),
    ),
    (
        "code/.env.example",
        include_bytes!("../../docs/user-guide/code/.env.example"),
    ),
    (
        "code/hello.ps1",
        include_bytes!("../../docs/user-guide/code/hello.ps1"),
    ),
    (
        "code/hello.yaml",
        include_bytes!("../../docs/user-guide/code/hello.yaml"),
    ),
    (
        "code/hello.toml",
        include_bytes!("../../docs/user-guide/code/hello.toml"),
    ),
    (
        "code/Cargo.lock",
        include_bytes!("../../docs/user-guide/code/Cargo.lock"),
    ),
    (
        "code/hello.sql",
        include_bytes!("../../docs/user-guide/code/hello.sql"),
    ),
    (
        "code/hello.psql",
        include_bytes!("../../docs/user-guide/code/hello.psql"),
    ),
    (
        "code/hello.mysql",
        include_bytes!("../../docs/user-guide/code/hello.mysql"),
    ),
    (
        "code/hello.mariadb.sql",
        include_bytes!("../../docs/user-guide/code/hello.mariadb.sql"),
    ),
    (
        "code/hello.mssql.sql",
        include_bytes!("../../docs/user-guide/code/hello.mssql.sql"),
    ),
    (
        "code/hello.pls",
        include_bytes!("../../docs/user-guide/code/hello.pls"),
    ),
    (
        "code/hello.sqlite.sql",
        include_bytes!("../../docs/user-guide/code/hello.sqlite.sql"),
    ),
    (
        "code/hello.cql",
        include_bytes!("../../docs/user-guide/code/hello.cql"),
    ),
    (
        "code/hello.tex",
        include_bytes!("../../docs/user-guide/code/hello.tex"),
    ),
    (
        "code/hello.j2",
        include_bytes!("../../docs/user-guide/code/hello.j2"),
    ),
    (
        "code/hello.vue",
        include_bytes!("../../docs/user-guide/code/hello.vue"),
    ),
    (
        "code/hello.component.html",
        include_bytes!("../../docs/user-guide/code/hello.component.html"),
    ),
    (
        "code/hello.hs",
        include_bytes!("../../docs/user-guide/code/hello.hs"),
    ),
    (
        "code/hello.clj",
        include_bytes!("../../docs/user-guide/code/hello.clj"),
    ),
    (
        "code/hello.lisp",
        include_bytes!("../../docs/user-guide/code/hello.lisp"),
    ),
    (
        "code/hello.cljs",
        include_bytes!("../../docs/user-guide/code/hello.cljs"),
    ),
    (
        "code/hello.erl",
        include_bytes!("../../docs/user-guide/code/hello.erl"),
    ),
    (
        "code/hello.ml",
        include_bytes!("../../docs/user-guide/code/hello.ml"),
    ),
    (
        "code/hello.fs",
        include_bytes!("../../docs/user-guide/code/hello.fs"),
    ),
    (
        "code/hello.f90",
        include_bytes!("../../docs/user-guide/code/hello.f90"),
    ),
    (
        "code/hello.jl",
        include_bytes!("../../docs/user-guide/code/hello.jl"),
    ),
    (
        "code/hello.pl",
        include_bytes!("../../docs/user-guide/code/hello.pl"),
    ),
    (
        "code/hello.pas",
        include_bytes!("../../docs/user-guide/code/hello.pas"),
    ),
    (
        "code/hello.vb",
        include_bytes!("../../docs/user-guide/code/hello.vb"),
    ),
    (
        "code/hello.cob",
        include_bytes!("../../docs/user-guide/code/hello.cob"),
    ),
    (
        "code/hello.pp",
        include_bytes!("../../docs/user-guide/code/hello.pp"),
    ),
    (
        "code/Dockerfile",
        include_bytes!("../../docs/user-guide/code/Dockerfile"),
    ),
    (
        "code/CMakeLists.txt",
        include_bytes!("../../docs/user-guide/code/CMakeLists.txt"),
    ),
    (
        "code/Makefile",
        include_bytes!("../../docs/user-guide/code/Makefile"),
    ),
    (
        "code/Jenkinsfile",
        include_bytes!("../../docs/user-guide/code/Jenkinsfile"),
    ),
    (
        "code/.editorconfig",
        include_bytes!("../../docs/user-guide/code/.editorconfig"),
    ),
    (
        "code/hello.proto",
        include_bytes!("../../docs/user-guide/code/hello.proto"),
    ),
    (
        "code/hello.sln",
        include_bytes!("../../docs/user-guide/code/hello.sln"),
    ),
    (
        "code/meson.build",
        include_bytes!("../../docs/user-guide/code/meson.build"),
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
        if let Err(error) = add_missing_examples_once(&existing, None) {
            eprintln!("Unable to add default-vault examples: {error}");
        }
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
    write_example_fixture_marker(&target, None)?;
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

pub(crate) fn add_missing_examples_after_unlock(
    db_path: &Path,
    root: &Path,
    vault_key: &[u8; 32],
) -> AppResult<()> {
    let app_data_dir = db_path.parent().ok_or_else(|| {
        AppError::State("Default vault database has no parent folder".to_string())
    })?;
    let default_vault = app_data_dir.join(DEFAULT_VAULT_NAME);
    let Some(default_vault) = existing_default_vault(&default_vault)? else {
        return Ok(());
    };
    if fs::canonicalize(root)? != default_vault {
        return Ok(());
    }
    add_missing_examples_once(&default_vault, Some(vault_key))
}

fn add_missing_examples_once(root: &Path, vault_key: Option<&[u8; 32]>) -> AppResult<()> {
    let metadata = root.join(".denote");
    ensure_real_directory(&metadata, "Default vault metadata folder")?;
    let fixtures = metadata.join("fixtures");
    ensure_real_directory(&fixtures, "Default vault fixture folder")?;
    let marker = root.join(EXAMPLE_FIXTURE_MARKER);
    match fs::symlink_metadata(&marker) {
        Ok(metadata) if metadata_is_link(&metadata) => {
            return Err(AppError::State(format!(
                "Default vault example marker cannot be a symbolic link: {}",
                marker.display()
            )));
        }
        Ok(metadata) if metadata.is_file() => return Ok(()),
        Ok(_) => {
            return Err(AppError::State(format!(
                "Default vault example marker is not a regular file: {}",
                marker.display()
            )));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let encryption_manifest = metadata.join("encryption.json");
    let encrypted = match fs::symlink_metadata(&encryption_manifest) {
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => {
            return Err(AppError::State(format!(
                "Default vault encryption manifest is not a regular file: {}",
                encryption_manifest.display()
            )));
        }
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if encrypted && vault_key.is_none() {
        return Ok(());
    }
    for (relative_path, content) in SEED_FILES
        .iter()
        .filter(|(path, _)| path.starts_with("examples/") || path.starts_with("code/"))
    {
        let path = root.join(relative_path);
        let parent = path
            .parent()
            .ok_or_else(|| AppError::State(format!("Invalid seed path: {relative_path}")))?;
        ensure_real_directory(parent, "Default vault example folder")?;
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => {
                return Err(AppError::State(format!(
                    "Default vault example is not a regular file: {}",
                    path.display()
                )));
            }
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let stored = if encrypted {
            crate::crypto::encrypt_file_content(vault_key.ok_or(AppError::Locked)?, content)?
        } else {
            content.to_vec()
        };
        write_new_file(&path, &stored)?;
    }
    write_example_fixture_marker(root, vault_key)
}

fn write_new_file(path: &Path, content: &[u8]) -> AppResult<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = (|| -> AppResult<()> {
        file.write_all(content)?;
        file.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn write_example_fixture_marker(root: &Path, vault_key: Option<&[u8; 32]>) -> AppResult<()> {
    let encrypted = root.join(".denote/encryption.json").exists();
    let content = if encrypted {
        crate::crypto::encrypt_file_content(vault_key.ok_or(AppError::Locked)?, b"applied\n")?
    } else {
        b"applied\n".to_vec()
    };
    write_fixture_marker(
        root,
        EXAMPLE_FIXTURE_MARKER,
        &content,
        "Default vault example marker",
    )
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
    write_fixture_marker(
        root,
        TEST_FIXTURE_MARKER,
        b"applied\n",
        "Default vault fixture marker",
    )
}

fn write_fixture_marker(
    root: &Path,
    relative_path: &str,
    content: &[u8],
    label: &str,
) -> AppResult<()> {
    let marker = root.join(relative_path);
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
            file.write_all(content)?;
            file.sync_all()?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let marker_metadata = fs::symlink_metadata(&marker)?;
            if metadata_is_link(&marker_metadata) || !marker_metadata.is_file() {
                return Err(AppError::State(format!(
                    "{label} is not a regular file: {}",
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
    use std::collections::BTreeSet;
    use tempfile::tempdir;

    #[test]
    fn creates_the_guide_once_without_overwriting_edits() {
        let directory = tempdir().expect("temp directory");

        let vault = ensure(directory.path()).expect("default vault");
        let welcome = vault.join("Welcome.md");
        let vault_welcome = vault.join(".denote.md");
        for (relative_path, content) in SEED_FILES.iter().chain(TEST_FILES) {
            assert_eq!(
                fs::read(vault.join(relative_path)).expect("seeded file"),
                *content
            );
        }
        let initial = fs::read_to_string(&welcome).expect("welcome");
        assert_eq!(
            fs::read_to_string(&vault_welcome).expect("vault welcome"),
            initial
        );
        assert!(initial.contains(">![info]"));
        assert!(initial.contains("```typescript"));
        assert!(vault.join("docs/Keyboard shortcuts.md").is_file());
        assert!(vault.join("assets/orbit.svg").is_file());
        assert!(vault.join("examples/Mermaid diagram.md").is_file());
        assert!(vault.join("examples/Hello document.pdf").is_file());
        assert!(vault.join("examples/Sample data.json").is_file());
        assert!(vault.join("examples/Sample data.yaml").is_file());
        assert!(vault.join("code/Dockerfile").is_file());
        assert!(vault.join("code/hello.pp").is_file());
        assert!(vault.join("test/日本語 ノート.md").is_file());

        fs::write(&welcome, "My edited welcome").expect("edit welcome");
        let diagram = vault.join("examples/Mermaid diagram.md");
        fs::write(&diagram, "My edited diagram example").expect("edit diagram");
        assert_eq!(ensure(directory.path()).expect("existing vault"), vault);
        assert_eq!(
            fs::read_to_string(welcome).expect("edited welcome"),
            "My edited welcome"
        );
        assert_eq!(
            fs::read_to_string(diagram).expect("edited diagram"),
            "My edited diagram example"
        );
        fs::remove_dir_all(vault.join("test")).expect("remove test fixtures");
        assert_eq!(ensure(directory.path()).expect("existing vault"), vault);
        assert!(!vault.join("test").exists());
    }

    #[test]
    fn canonical_source_inventory_matches_seed_files() {
        let source_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root")
            .join("docs/user-guide");
        let mut source_files = BTreeSet::new();
        collect_files(&source_root, &source_root, &mut source_files);
        let seeded_files = SEED_FILES
            .iter()
            .map(|(path, _)| path.to_string())
            .filter(|path| *path != ".denote.md")
            .collect::<BTreeSet<_>>();

        assert_eq!(seeded_files, source_files);
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
        assert!(!resolved.join(".denote.md").exists());
    }

    #[test]
    fn adds_missing_examples_once_without_overwriting_existing_files() {
        let directory = tempdir().expect("temp directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join("examples")).expect("examples folder");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        fs::write(
            vault.join("examples/Mermaid diagram.md"),
            "Existing diagram example",
        )
        .expect("existing diagram");
        fs::write(vault.join("personal.txt"), "Keep me").expect("personal file");

        let resolved = ensure(directory.path()).expect("updated default vault");

        assert_eq!(
            fs::read_to_string(resolved.join("examples/Mermaid diagram.md"))
                .expect("preserved diagram"),
            "Existing diagram example"
        );
        assert_eq!(
            fs::read_to_string(resolved.join("personal.txt")).expect("personal file"),
            "Keep me"
        );
        assert!(resolved.join("examples/Hello document.pdf").is_file());
        assert!(resolved.join("examples/Sample data.json").is_file());
        assert!(resolved.join("examples/Sample data.yaml").is_file());
        assert!(resolved.join("code/Dockerfile").is_file());
        assert!(resolved.join("code/hello.sln").is_file());
        assert!(resolved.join(EXAMPLE_FIXTURE_MARKER).is_file());

        fs::remove_dir_all(resolved.join("code")).expect("remove migrated code");
        assert_eq!(ensure(directory.path()).expect("existing vault"), resolved);
        assert!(!resolved.join("code").exists());
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

    #[test]
    fn adds_missing_examples_as_ciphertext_after_unlock() {
        let directory = tempdir().expect("temp directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join(".denote")).expect("metadata folder");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        let (mut manifest, vault_key, _) =
            crate::crypto::create_manifest("synthetic example password").expect("manifest");
        manifest.phase = crate::crypto::EncryptionPhase::Encrypted;
        crate::crypto::save_manifest(&vault, &manifest).expect("save manifest");

        let resolved = ensure(directory.path()).expect("locked default vault");
        assert!(!resolved.join("examples").exists());
        assert!(!resolved.join(EXAMPLE_FIXTURE_MARKER).exists());

        let key = vault_key.copy_bytes();
        add_missing_examples_after_unlock(
            &directory.path().join("denote.sqlite3"),
            &resolved,
            &key,
        )
        .expect("add encrypted examples");
        let encrypted =
            fs::read(resolved.join("examples/Mermaid diagram.md")).expect("encrypted example");
        assert_ne!(
            encrypted,
            include_bytes!("../../docs/user-guide/examples/Mermaid diagram.md")
        );
        assert_eq!(
            crate::crypto::decrypt_file_content(&key, &encrypted).expect("decrypt example"),
            include_bytes!("../../docs/user-guide/examples/Mermaid diagram.md")
        );
        assert!(resolved.join("code/hello.js").is_file());
        assert!(resolved.join(EXAMPLE_FIXTURE_MARKER).is_file());
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
    fn does_not_follow_an_existing_examples_folder_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir(&vault).expect("old default vault");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(outside.path(), vault.join("examples")).expect("examples folder symlink");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(!resolved.join(EXAMPLE_FIXTURE_MARKER).exists());
        assert_eq!(
            fs::read_dir(outside.path())
                .expect("outside folder")
                .count(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlinked_fixture_folder_for_examples() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let outside = tempdir().expect("outside directory");
        let vault = directory.path().join(DEFAULT_VAULT_NAME);
        fs::create_dir_all(vault.join(".denote")).expect("metadata folder");
        fs::write(vault.join("Welcome.md"), "Existing guide").expect("welcome");
        symlink(outside.path(), vault.join(".denote/fixtures")).expect("fixture folder symlink");
        fs::write(outside.path().join("examples-v1"), "outside").expect("outside marker");

        let resolved = ensure(directory.path()).expect("existing default vault");

        assert!(!resolved.join("examples").exists());
        assert_eq!(
            fs::read_to_string(outside.path().join("examples-v1")).expect("outside marker"),
            "outside"
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

    fn collect_files(root: &Path, directory: &Path, files: &mut BTreeSet<String>) {
        for entry in fs::read_dir(directory).expect("guide directory") {
            let entry = entry.expect("guide entry");
            let path = entry.path();
            if path.is_dir() {
                collect_files(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root)
                        .expect("guide-relative path")
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
}
