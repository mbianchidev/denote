use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::{
    acquire_note_lock, acquire_vault_lock, atomic_write, canonical_vault, crypto,
    encode_file_at_rest, ensure_no_symlinks, existing_entry, fs, hash_bytes, normalized_relative,
    read_plain_file,
};
use crate::error::{AppError, AppResult};

const SIDECAR: &str = ".denote/note-comments.json";
const MAX_SIDECAR_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COMMENTS: usize = 500;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCommentAnchor {
    pub from: usize,
    pub to: usize,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub match_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteComment {
    pub id: String,
    pub body: String,
    pub anchor: Option<NoteCommentAnchor>,
    pub resolved: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCommentsDocument {
    pub schema_version: u32,
    pub owner: String,
    pub notes: BTreeMap<String, Vec<NoteComment>>,
}

impl Default for NoteCommentsDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            owner: "denote.note-comments".into(),
            notes: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommentsSnapshot {
    pub content_hash: String,
    pub document: NoteCommentsDocument,
}

pub fn read_note_comments(
    vault_path: &str,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteCommentsSnapshot> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    read_snapshot(&root, vault_key)
}

pub fn save_note_comments(
    vault_path: &str,
    note_path: &str,
    expected_note_hash: &str,
    expected_hash: &str,
    document: NoteCommentsDocument,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteCommentsSnapshot> {
    validate_document(&document)?;
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _sidecar_lock = acquire_note_lock(&root, SIDECAR)?;
    let _note_lock = acquire_note_lock(&root, note_path)?;
    validate_note_path(note_path)?;
    let note = existing_entry(&root, note_path)?;
    if !note.is_file() || fs::metadata(&note)?.len() > 25 * 1024 * 1024 {
        return Err(AppError::InvalidData(
            "The comment target is not a supported note".into(),
        ));
    }
    if hash_bytes(&read_plain_file(&note, vault_key)?) != expected_note_hash {
        return Err(AppError::InvalidData(
            "The note changed on disk. Reload it before saving comments; no comments were overwritten.".into(),
        ));
    }
    let current = read_snapshot(&root, vault_key)?;
    if current.content_hash != expected_hash {
        return Err(AppError::InvalidData(
            "Comments changed in another window or application. Reload comments before retrying; no comments were overwritten.".into(),
        ));
    }
    let plaintext = serde_json::to_vec_pretty(&document)
        .map_err(|error| AppError::InvalidData(format!("Unable to encode comments: {error}")))?;
    if plaintext.len() as u64 > MAX_SIDECAR_BYTES {
        return Err(AppError::InvalidData(
            "Comments exceed the 2 MiB sidecar limit".into(),
        ));
    }
    let path = root.join(SIDECAR);
    ensure_no_symlinks(&root, &path, true)?;
    let stored = encode_file_at_rest(&root, &plaintext, vault_key)?;
    atomic_write(&path, &stored)?;
    Ok(NoteCommentsSnapshot {
        content_hash: hash_bytes(&plaintext),
        document,
    })
}

fn read_snapshot(
    root: &std::path::Path,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<NoteCommentsSnapshot> {
    if crypto::manifest_exists(root) && vault_key.is_none() {
        return Err(AppError::Locked);
    }
    let path = root.join(SIDECAR);
    ensure_no_symlinks(root, &path, true)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(NoteCommentsSnapshot {
                content_hash: hash_bytes(b""),
                document: NoteCommentsDocument::default(),
            });
        }
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || metadata.len() > MAX_SIDECAR_BYTES + 1024 {
        return Err(AppError::InvalidData(
            "The comments sidecar is not a regular file within the 2 MiB limit".into(),
        ));
    }
    let plaintext = read_plain_file(&path, vault_key)?;
    if plaintext.len() as u64 > MAX_SIDECAR_BYTES {
        return Err(AppError::InvalidData(
            "The comments sidecar exceeds 2 MiB".into(),
        ));
    }
    let document: NoteCommentsDocument = serde_json::from_slice(&plaintext).map_err(|error| {
        AppError::InvalidData(format!(
            "Unable to read comments: {error}. Preserve the sidecar and restore a valid backup."
        ))
    })?;
    validate_document(&document)?;
    Ok(NoteCommentsSnapshot {
        content_hash: hash_bytes(&plaintext),
        document,
    })
}

fn validate_note_path(path: &str) -> AppResult<()> {
    normalized_relative(path, false)?;
    if path.contains('\\')
        || path.len() > 4096
        || !std::path::Path::new(path)
            .extension()
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
            })
    {
        return Err(AppError::InvalidPath(
            "Comments require a vault-relative Markdown path".into(),
        ));
    }
    Ok(())
}

fn validate_document(document: &NoteCommentsDocument) -> AppResult<()> {
    if document.schema_version != 1 || document.owner != "denote.note-comments" {
        return Err(AppError::InvalidData(
            "Unsupported comments sidecar version or owner. Preserve it and use a compatible Denote version.".into(),
        ));
    }
    let mut ids = HashSet::new();
    let mut count = 0;
    for (path, comments) in &document.notes {
        validate_note_path(path)?;
        if comments.is_empty() {
            return Err(AppError::InvalidData(
                "Comments sidecar contains an empty note entry".into(),
            ));
        }
        for comment in comments {
            count += 1;
            if count > MAX_COMMENTS
                || uuid::Uuid::parse_str(&comment.id).is_err()
                || !ids.insert(&comment.id)
                || comment.body.trim().is_empty()
                || comment.body.len() > 4096
                || comment.body.contains('\0')
                || comment.created_at == 0
                || comment.updated_at < comment.created_at
            {
                return Err(AppError::InvalidData(
                    "Invalid comment record or the 500-comment vault limit was exceeded".into(),
                ));
            }
            if let Some(anchor) = &comment.anchor {
                if anchor.quote.is_empty()
                    || anchor.quote.len() > 4096
                    || anchor.prefix.len() > 96
                    || anchor.suffix.len() > 96
                    || anchor.to < anchor.from
                    || anchor.to > 4 * 1024 * 1024
                    || anchor.to - anchor.from != anchor.quote.encode_utf16().count()
                    || anchor.match_count == 0
                    || anchor.quote.contains('\0')
                {
                    return Err(AppError::InvalidData(
                        "Invalid comment source anchor".into(),
                    ));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn comment() -> NoteComment {
        NoteComment {
            id: "11111111-2222-4333-8444-555555555555".into(),
            body: "An invented review comment.".into(),
            anchor: None,
            resolved: false,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn note_comments_preserve_markdown_and_refuse_stale_sidecar_and_note_writes() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("vault");
        fs::create_dir(&root).unwrap();
        let markdown = b"# Synthetic note\r\n\r\nKeep **all** bytes.  \r\n";
        fs::write(root.join("Example.md"), markdown).unwrap();
        let initial = read_note_comments(root.to_str().unwrap(), None).unwrap();
        assert!(!root.join(SIDECAR).exists());
        let mut document = initial.document.clone();
        document.notes.insert("Example.md".into(), vec![comment()]);
        let saved = save_note_comments(
            root.to_str().unwrap(),
            "Example.md",
            &hash_bytes(markdown),
            &initial.content_hash,
            document.clone(),
            None,
        )
        .unwrap();
        assert_eq!(fs::read(root.join("Example.md")).unwrap(), markdown);
        assert_eq!(saved.document.notes["Example.md"], vec![comment()]);
        assert!(
            save_note_comments(
                root.to_str().unwrap(),
                "Example.md",
                &hash_bytes(markdown),
                &initial.content_hash,
                document.clone(),
                None
            )
            .is_err()
        );
        fs::write(root.join("Example.md"), b"External edit").unwrap();
        assert!(
            save_note_comments(
                root.to_str().unwrap(),
                "Example.md",
                &hash_bytes(markdown),
                &saved.content_hash,
                document,
                None
            )
            .is_err()
        );
        assert_eq!(
            read_note_comments(root.to_str().unwrap(), None)
                .unwrap()
                .content_hash,
            saved.content_hash
        );
    }

    #[test]
    fn note_comments_fail_closed_on_foreign_corrupt_or_future_owned_data() {
        let directory = tempdir().unwrap();
        fs::create_dir_all(directory.path().join(".denote")).unwrap();
        for bytes in [
            b"not json".as_slice(),
            br#"{"schemaVersion":2,"owner":"denote.note-comments","notes":{}}"#,
            br#"{"schemaVersion":1,"owner":"another.plugin","notes":{}}"#,
            br#"{"schemaVersion":1,"owner":"denote.note-comments","notes":{},"future":true}"#,
        ] {
            fs::write(directory.path().join(SIDECAR), bytes).unwrap();
            assert!(read_note_comments(directory.path().to_str().unwrap(), None).is_err());
            assert_eq!(fs::read(directory.path().join(SIDECAR)).unwrap(), bytes);
        }
    }

    #[test]
    fn note_comments_are_encrypted_at_rest_and_participate_in_encryption_sweeps() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("metadata.sqlite3");
        crate::db::initialize(&database).unwrap();
        let root = directory.path().join("vault");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("Example.md"), b"# Example").unwrap();
        let initial = read_note_comments(root.to_str().unwrap(), None).unwrap();
        let mut document = initial.document;
        document.notes.insert("Example.md".into(), vec![comment()]);
        save_note_comments(
            root.to_str().unwrap(),
            "Example.md",
            &hash_bytes(b"# Example"),
            &initial.content_hash,
            document,
            None,
        )
        .unwrap();
        let key = [7u8; 32];
        super::super::encrypt_vault_contents(&database, root.to_str().unwrap(), &key).unwrap();
        assert!(crypto::is_encrypted_file(
            &fs::read(root.join(SIDECAR)).unwrap()
        ));
        assert!(read_note_comments(root.to_str().unwrap(), None).is_err());
        let saved = read_note_comments(root.to_str().unwrap(), Some(&key)).unwrap();
        assert_eq!(saved.document.notes["Example.md"][0].body, comment().body);
    }

    #[cfg(unix)]
    #[test]
    fn note_comments_refuse_symlinked_sidecars_and_internal_or_traversal_owners() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let root = directory.path().join("vault");
        fs::create_dir_all(root.join(".denote")).unwrap();
        let outside = directory.path().join("outside.json");
        fs::write(&outside, b"keep outside").unwrap();
        symlink(&outside, root.join(SIDECAR)).unwrap();
        assert!(read_note_comments(root.to_str().unwrap(), None).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"keep outside");
        for path in [
            "../Other.md",
            ".denote/Other.md",
            "/Other.md",
            "folder\\Other.md",
        ] {
            assert!(validate_note_path(path).is_err());
        }
    }
}
