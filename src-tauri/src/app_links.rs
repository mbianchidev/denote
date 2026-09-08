use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::Url;

use crate::{
    db,
    error::{AppError, AppResult},
    models::WorkspaceSnapshot,
    vault,
};

const APP_LINK_SCHEME: &str = "denote";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AppLinkResolution {
    Known {
        #[serde(rename = "vaultId")]
        vault_id: i64,
        #[serde(rename = "vaultPath")]
        vault_path: String,
        path: String,
    },
    ImportRequired,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAppLink {
    pub snapshot: WorkspaceSnapshot,
    pub path: String,
}

pub fn resolve(db_path: &Path, uri: &str) -> AppResult<AppLinkResolution> {
    let target = linked_file(uri)?;
    let connection = db::open(db_path)?;
    let best_match = db::list_all_known_vaults(&connection)?
        .into_iter()
        .filter_map(|known| {
            available_vault_root(&known.path)
                .filter(|root| target.starts_with(root))
                .map(|root| (known.id, root))
        })
        .max_by_key(|(_, root)| root.components().count());

    let Some((vault_id, root)) = best_match else {
        return Ok(AppLinkResolution::ImportRequired);
    };
    let path = vault::app_link_file_path(&root, &target)?;
    Ok(AppLinkResolution::Known {
        vault_id,
        vault_path: root.to_string_lossy().into_owned(),
        path,
    })
}

pub fn linked_file(uri: &str) -> AppResult<PathBuf> {
    let url = Url::parse(uri)
        .map_err(|error| AppError::InvalidData(format!("Invalid Denote app link: {error}")))?;
    if url.scheme() != APP_LINK_SCHEME {
        return Err(AppError::InvalidData(
            "App links must use the denote scheme".to_string(),
        ));
    }
    if url.host_str().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(AppError::InvalidData(
            "Denote app links must use an absolute local path after denote:///".to_string(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::InvalidData(
            "Denote app links cannot contain a query or fragment".to_string(),
        ));
    }
    let (_, location) = uri
        .split_once(':')
        .ok_or_else(|| AppError::InvalidData("Denote app link is missing its path".to_string()))?;
    let file_url = Url::parse(&format!("file:{location}")).map_err(|error| {
        AppError::InvalidData(format!(
            "Unable to convert the Denote app link to a local path: {error}"
        ))
    })?;
    let path = file_url.to_file_path().map_err(|_| {
        AppError::InvalidPath("Denote app links must contain an absolute local path".to_string())
    })?;
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        AppError::NotFound(format!(
            "The file from the Denote app link is unavailable: {} ({error})",
            path.display()
        ))
    })?;
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err(AppError::InvalidPath(format!(
            "The Denote app link does not name a regular file: {}",
            path.display()
        )));
    }
    Ok(fs::canonicalize(path)?)
}

pub fn vault_file_target(vault_path: &Path, target: &Path) -> AppResult<(PathBuf, String)> {
    let root = fs::canonicalize(vault_path)?;
    if !root.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{} is not a folder",
            vault_path.display()
        )));
    }
    if !target.starts_with(&root) {
        return Err(AppError::InvalidPath(
            "Choose a vault folder that contains the linked file".to_string(),
        ));
    }
    let path = vault::app_link_file_path(&root, target)?;
    Ok((root, path))
}

fn available_vault_root(path: &str) -> Option<PathBuf> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return None;
    }
    fs::canonicalize(path).ok()
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn app_link(path: &Path) -> String {
        let url = Url::from_file_path(path).expect("file URL").to_string();
        format!("{APP_LINK_SCHEME}:{}", &url["file:".len()..])
    }

    #[test]
    fn resolves_the_most_specific_known_vault() {
        let directory = tempdir().expect("temporary directory");
        let outer = directory.path().join("synthetic-vault");
        let nested = outer.join("nested-vault");
        fs::create_dir_all(&nested).expect("nested vault");
        let note = nested.join("linked note.md");
        fs::write(&note, "Synthetic note").expect("note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database");
        vault::open_vault(&db_path, &outer.to_string_lossy()).expect("outer vault");
        let nested_snapshot =
            vault::open_vault(&db_path, &nested.to_string_lossy()).expect("nested vault");
        let connection = db::open(&db_path).expect("connection");
        let nested_id = db::list_all_known_vaults(&connection)
            .expect("known vaults")
            .into_iter()
            .find(|known| known.path == nested_snapshot.vault_path)
            .expect("nested record")
            .id;

        assert_eq!(
            resolve(&db_path, &app_link(&note)).expect("resolution"),
            AppLinkResolution::Known {
                vault_id: nested_id,
                vault_path: nested_snapshot.vault_path,
                path: "linked note.md".to_string(),
            }
        );
    }

    #[test]
    fn asks_for_a_vault_when_no_known_vault_contains_the_file() {
        let directory = tempdir().expect("temporary directory");
        let note = directory.path().join("outside.md");
        fs::write(&note, "Synthetic note").expect("note");
        let db_path = directory.path().join("denote.sqlite3");
        db::initialize(&db_path).expect("database");

        assert_eq!(
            resolve(&db_path, &app_link(&note)).expect("resolution"),
            AppLinkResolution::ImportRequired
        );
    }

    #[test]
    fn validates_the_imported_vault_boundary() {
        let directory = tempdir().expect("temporary directory");
        let vault_root = directory.path().join("synthetic-vault");
        fs::create_dir(&vault_root).expect("vault");
        let note = vault_root.join("folder").join("linked.md");
        fs::create_dir(note.parent().expect("note parent")).expect("folder");
        fs::write(&note, "Synthetic note").expect("note");
        let target = linked_file(&app_link(&note)).expect("linked file");

        let (root, path) = vault_file_target(&vault_root, &target).expect("vault file target");

        assert_eq!(root, fs::canonicalize(vault_root).expect("canonical vault"));
        assert_eq!(path, "folder/linked.md");
        assert!(vault_file_target(directory.path().join("other").as_path(), &target).is_err());
    }

    #[test]
    fn rejects_ambiguous_or_non_file_links() {
        let directory = tempdir().expect("temporary directory");
        let note = directory.path().join("linked.md");
        fs::write(&note, "Synthetic note").expect("note");
        let mut with_query = app_link(&note);
        with_query.push_str("?mode=edit");

        assert!(linked_file("https:///tmp/linked.md").is_err());
        assert!(linked_file("denote://example.test/linked.md").is_err());
        assert!(linked_file(&with_query).is_err());
        assert!(linked_file(&app_link(directory.path())).is_err());
    }
}
