use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{
    acquire_note_lock, acquire_vault_lock, canonical_vault, create_file_no_replace,
    decode_file_content, encode_file_at_rest, ensure_no_symlinks, existing_entry,
    file_plaintext_len, hash_bytes, normalized_relative, path_to_forward_slashes, read_plain_file,
    resolve_image_source, save_note,
};
use crate::{
    error::{AppError, AppResult},
    models::{FileEncoding, NoteDocument},
};

const JOURNAL: &str = ".denote/speech-attachments";
const MAX_BYTES: u64 = 25 * 1024 * 1024;
static ACTIVE: OnceLock<Mutex<HashSet<(PathBuf, String)>>> = OnceLock::new();

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    version: u32,
    entries: Vec<PendingEntry>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingEntry {
    id: String,
    note: String,
    audio: String,
    hash: String,
    link: String,
}

struct Active(PathBuf, String);
impl Active {
    fn new(root: &Path, id: String) -> AppResult<Self> {
        ACTIVE
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| invalid("Audio attachment state is unavailable."))?
            .insert((root.into(), id.clone()));
        Ok(Self(root.into(), id))
    }
}
impl Drop for Active {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(Mutex::default).lock() {
            active.remove(&(self.0.clone(), self.1.clone()));
        } else {
            eprintln!("Audio attachment recovery lease cleanup failed.");
        }
    }
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidData(message.into())
}

fn load(database: &Path, root: &Path) -> AppResult<Pending> {
    let Some(document) =
        crate::db::load_pending_speech_attachments(database, &root.to_string_lossy())?
    else {
        return Ok(Pending {
            version: 1,
            entries: vec![],
        });
    };
    if document.len() > 128 * 1024 {
        return Err(invalid(
            "Invalid unfinished-audio metadata. No files were removed.",
        ));
    }
    let pending: Pending = serde_json::from_str(&document)
        .map_err(|_| invalid("Invalid unfinished-audio metadata. No files were removed."))?;
    let mut ids = HashSet::new();
    if pending.version != 1 || pending.entries.len() > 32 {
        return Err(invalid("Unsupported audio attachment recovery metadata."));
    }
    for entry in &pending.entries {
        normalized_relative(&entry.note, false)
            .map_err(|_| invalid("Invalid audio recovery note path. Nothing was removed."))?;
        normalized_relative(&entry.audio, false)
            .map_err(|_| invalid("Invalid audio recovery file path. Nothing was removed."))?;
        let note = Path::new(&entry.note);
        let expected = note
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join("assets")
            .join(format!("voice-{}.wav", entry.id));
        if uuid::Uuid::parse_str(&entry.id).is_err()
            || !ids.insert(&entry.id)
            || !is_markdown(note)
            || path_to_forward_slashes(&expected) != entry.audio
            || entry.hash.len() != 64
            || !entry.hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || entry.link != format!("[Voice note](assets/voice-{}.wav)", entry.id)
        {
            return Err(invalid(
                "Invalid audio attachment recovery record. Nothing was removed.",
            ));
        }
    }
    Ok(pending)
}

fn store(database: &Path, root: &Path, pending: &Pending) -> AppResult<()> {
    if pending.entries.is_empty() {
        return crate::db::store_pending_speech_attachments(
            database,
            &root.to_string_lossy(),
            None,
        );
    }
    let document = serde_json::to_string(pending)
        .map_err(|_| invalid("Unable to encode audio recovery metadata."))?;
    if document.len() > 128 * 1024 {
        return Err(invalid("Audio recovery metadata exceeds 128 KiB."));
    }
    crate::db::store_pending_speech_attachments(database, &root.to_string_lossy(), Some(&document))
}

fn is_markdown(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
    })
}

fn byte_offset(source: &str, utf16: usize) -> AppResult<usize> {
    let mut units = 0;
    for (byte, character) in source.char_indices() {
        if units == utf16 {
            return Ok(byte);
        }
        units += character.len_utf16();
        if units > utf16 {
            return Err(invalid(
                "The insertion position splits a Unicode character. Select the position again.",
            ));
        }
    }
    if units == utf16 {
        Ok(source.len())
    } else {
        Err(invalid("The insertion position is outside the note."))
    }
}

pub(crate) fn attach(
    db: &Path,
    vault: &str,
    note_path: &str,
    expected_hash: &str,
    from: usize,
    to: usize,
    wav: &[u8],
    key: Option<&[u8; 32]>,
) -> AppResult<NoteDocument> {
    if wav.len() as u64 > MAX_BYTES || !wav.starts_with(b"RIFF") || from > to {
        return Err(invalid("Invalid voice-note audio or insertion position."));
    }
    recover(db, vault, key, None)?;
    let root = canonical_vault(vault)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let note = existing_entry(&root, note_path)?;
    if !is_markdown(&note) || file_plaintext_len(&note)? > 4 * 1024 * 1024 {
        return Err(invalid("Voice notes require a Markdown note up to 4 MiB."));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let active = Active::new(&root, id.clone())?;
    let link = format!("[Voice note](assets/voice-{id}.wav)");
    let parent = note
        .parent()
        .ok_or_else(|| invalid("The note folder is unavailable."))?;
    let destination = parent.join("assets").join(format!("voice-{id}.wav"));
    let audio_path = path_to_forward_slashes(
        destination
            .strip_prefix(&root)
            .map_err(|_| invalid("Invalid audio attachment path."))?,
    );
    let (source, encoding, ending, next) = {
        let _note_lock = acquire_note_lock(&root, note_path)?;
        let bytes = Zeroizing::new(read_plain_file(&note, key)?);
        if hash_bytes(&bytes) != expected_hash {
            return Err(invalid(
                "The note changed on disk. Reload it before saving the voice note.",
            ));
        }
        let (source, encoding, ending) = decode_file_content(&bytes);
        if encoding != FileEncoding::Utf8 {
            return Err(invalid("Voice notes require UTF-8 Markdown."));
        }
        let start = byte_offset(&source, from)?;
        let end = byte_offset(&source, to)?;
        let next = format!("{}{}{}", &source[..start], link, &source[end..]);
        (source, encoding, ending, next)
    };
    let creation = (|| {
        let _journal_lock = acquire_note_lock(&root, JOURNAL)?;
        let mut pending = load(db, &root)?;
        if pending.entries.len() >= 32 {
            return Err(invalid(
                "Recover pending audio attachments before adding another voice note.",
            ));
        }
        pending.entries.push(PendingEntry {
            id: id.clone(),
            note: note_path.into(),
            audio: audio_path.clone(),
            hash: hash_bytes(wav),
            link,
        });
        store(db, &root, &pending)?;
        ensure_no_symlinks(&root, &destination, true)?;
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| invalid("The audio folder is unavailable."))?,
        )?;
        let stored = Zeroizing::new(encode_file_at_rest(&root, wav, key)?);
        create_file_no_replace(&destination, &stored)
    })();
    if let Err(error) = creation {
        drop(active);
        recover(db, vault, key, Some(&id))?;
        return Err(error);
    }
    let outcome = save_note(
        db,
        vault,
        note_path,
        &next,
        encoding,
        ending,
        "voice-note",
        Some(expected_hash),
        key,
    );
    drop(active);
    // Recovery inspects actual note bytes: save_note may fail after its file commit.
    recover(db, vault, key, Some(&id))?;
    let outcome = outcome.map_err(|_| invalid("The voice-note save did not complete. Reload the note to review its saved state; retry only after recovery."))?;
    drop(source);
    Ok(NoteDocument {
        path: note_path.into(),
        content: next,
        content_hash: outcome.content_hash,
        encoding,
        line_ending: ending,
        stats: outcome.stats,
    })
}

pub(crate) fn recover(
    database: &Path,
    vault: &str,
    key: Option<&[u8; 32]>,
    rollback: Option<&str>,
) -> AppResult<()> {
    let root = canonical_vault(vault)?;
    if crate::crypto::manifest_exists(&root) && key.is_none() {
        return Ok(());
    }
    if load(database, &root)?.entries.is_empty() {
        return Ok(());
    }
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _journal_lock = acquire_note_lock(&root, JOURNAL)?;
    let mut pending = load(database, &root)?;
    let active = ACTIVE
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| invalid("Audio attachment recovery state is unavailable."))?;
    let mut completed = HashSet::new();
    for entry in &pending.entries {
        if active.contains(&(root.clone(), entry.id.clone())) {
            continue;
        }
        clean_staged_audio(&root, entry)?;
        let _note_lock = acquire_note_lock(&root, &entry.note)?;
        let note = root.join(&entry.note);
        ensure_no_symlinks(&root, &note, true)?;
        let linked = match fs::symlink_metadata(&note) {
            Ok(metadata)
                if metadata.is_file() && file_plaintext_len(&note)? <= 25 * 1024 * 1024 =>
            {
                String::from_utf8_lossy(&Zeroizing::new(read_plain_file(&note, key)?))
                    .contains(&format!("voice-{}.wav", entry.id))
            }
            Ok(_) => {
                return Err(invalid(
                    "The audio recovery target is no longer a regular note. Nothing was removed.",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(invalid("Unable to inspect the audio recovery target.")),
        };
        if !linked {
            let audio = root.join(&entry.audio);
            ensure_no_symlinks(&root, &audio, true)?;
            match fs::symlink_metadata(&audio) {
                Ok(metadata) if metadata.is_file() && file_plaintext_len(&audio)? <= MAX_BYTES => {
                    if hash_bytes(&Zeroizing::new(read_plain_file(&audio, key)?)) != entry.hash {
                        return Err(invalid(
                            "An unfinished audio attachment was changed externally. Preserve it and resolve the recovery record manually.",
                        ));
                    }
                    if rollback != Some(entry.id.as_str()) {
                        return Err(invalid(
                            "An unfinished voice note was preserved. Choose Keep unfinished audio in Speech before recording again.",
                        ));
                    }
                    fs::remove_file(&audio)?;
                }
                Ok(_) => {
                    return Err(invalid(
                        "An unfinished audio attachment is not a regular file. Nothing was removed.",
                    ));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        completed.insert(entry.id.clone());
    }
    drop(active);
    pending
        .entries
        .retain(|entry| !completed.contains(&entry.id));
    store(database, &root, &pending)
}

pub(crate) fn keep_unfinished(database: &Path, vault: &str) -> AppResult<()> {
    let root = canonical_vault(vault)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _journal_lock = acquire_note_lock(&root, JOURNAL)?;
    if ACTIVE
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| invalid("Audio recovery state is unavailable."))?
        .iter()
        .any(|(active_root, _)| active_root == &root)
    {
        return Err(invalid(
            "Wait for the current voice-note save before changing recovery metadata.",
        ));
    }
    crate::db::store_pending_speech_attachments(database, &root.to_string_lossy(), None)
}

fn clean_staged_audio(root: &Path, entry: &PendingEntry) -> AppResult<()> {
    let audio = root.join(&entry.audio);
    let parent = audio
        .parent()
        .ok_or_else(|| invalid("Invalid audio recovery folder."))?;
    ensure_no_symlinks(root, parent, true)?;
    let directory = match fs::read_dir(parent) {
        Ok(directory) => directory,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(invalid("Unable to clean unfinished audio staging files.")),
    };
    let prefix = format!(".voice-{}.wav.", entry.id);
    for (index, candidate) in directory.enumerate() {
        if index >= 25000 {
            return Err(invalid(
                "Audio recovery requires a smaller assets folder. Preserve the recovery metadata and resolve its staged files manually.",
            ));
        }
        let candidate =
            candidate.map_err(|_| invalid("Unable to inspect unfinished audio staging files."))?;
        let name = candidate.file_name();
        let Some(token) = name
            .to_str()
            .and_then(|name| name.strip_prefix(&prefix))
            .and_then(|name| name.strip_suffix(".denote-create"))
        else {
            continue;
        };
        if !uuid::Uuid::parse_str(token).is_ok_and(|id| id.get_version_num() == 4) {
            continue;
        }
        let path = candidate.path();
        ensure_no_symlinks(root, &path, false)?;
        if !candidate.file_type()?.is_file() {
            return Err(invalid(
                "An audio staging path is not a regular file. Nothing was removed.",
            ));
        }
        fs::remove_file(path).map_err(|_| invalid("Unable to remove an unfinished audio staging file. Preserve the recovery metadata and retry cleanup."))?;
    }
    Ok(())
}

pub(crate) fn read_audio(
    vault: &str,
    note_path: &str,
    href: &str,
    key: Option<&[u8; 32]>,
) -> AppResult<Zeroizing<Vec<u8>>> {
    if href.starts_with(['/', '\\']) || href.contains([':', '\\', '\0']) {
        return Err(invalid(
            "Audio players accept only ordinary relative local links.",
        ));
    }
    let root = canonical_vault(vault)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let path = resolve_image_source(&root, Some(note_path), href)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["wav", "mp3", "m4a", "aac", "ogg", "opus", "flac", "webm"].contains(&extension.as_str())
        || !path.is_file()
        || file_plaintext_len(&path)? > MAX_BYTES
    {
        return Err(invalid("Choose a supported local audio file up to 25 MB."));
    }
    Ok(Zeroizing::new(read_plain_file(&path, key)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_note_save_preserves_unrelated_markdown_and_original_line_endings() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let db_path = root.join("synthetic.sqlite3");
        crate::db::initialize(&db_path).unwrap();
        let vault = root.join("vault");
        fs::create_dir(&vault).unwrap();
        let original =
            "---\r\ntitle: Invented\r\n---\r\n\r\nKeep **this**.  \r\n\r\nInsert here.\r\n";
        fs::write(vault.join("Synthetic.md"), original).unwrap();
        let normalized = original.replace("\r\n", "\n");
        let at = normalized.find("here").unwrap();
        let outcome = attach(
            &db_path,
            vault.to_str().unwrap(),
            "Synthetic.md",
            &hash_bytes(original.as_bytes()),
            at,
            at,
            b"RIFFsynthetic mock audio",
            None,
        )
        .unwrap();
        let saved = fs::read_to_string(vault.join("Synthetic.md")).unwrap();
        let marker = outcome.content.find("[Voice note]").unwrap();
        let end = outcome.content[marker..].find(')').unwrap() + marker + 1;
        let link = &outcome.content[marker..end];
        assert_eq!(saved.replace(&link.replace('\n', "\r\n"), ""), original);
        assert!(
            crate::db::load_pending_speech_attachments(
                &db_path,
                &vault.canonicalize().unwrap().to_string_lossy()
            )
            .unwrap()
            .is_none()
        );
        assert!(saved.contains("Keep **this**.  \r\n"));
        assert!(
            attach(
                &db_path,
                vault.to_str().unwrap(),
                "Synthetic.md",
                "stale",
                at,
                at,
                b"RIFFsynthetic",
                None
            )
            .is_err()
        );
        assert_eq!(fs::read_dir(vault.join("assets")).unwrap().count(), 1);
    }

    #[test]
    fn voice_note_recovery_removes_only_unlinked_hash_matching_pending_audio() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let database = root.join("synthetic.sqlite3");
        crate::db::initialize(&database).unwrap();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join(".denote")).unwrap();
        fs::write(root.join("Synthetic.md"), "# Invented note\n").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let audio = format!("assets/voice-{id}.wav");
        fs::write(root.join(&audio), b"synthetic pending audio").unwrap();
        let staged = root.join(format!(
            "assets/.voice-{id}.wav.{}.denote-create",
            uuid::Uuid::new_v4()
        ));
        fs::write(&staged, b"synthetic partial staging").unwrap();
        fs::write(root.join("assets/keep.txt"), b"keep invented user content").unwrap();
        store(
            &database,
            &root,
            &Pending {
                version: 1,
                entries: vec![PendingEntry {
                    id: id.clone(),
                    note: "Synthetic.md".into(),
                    audio: audio.clone(),
                    hash: hash_bytes(b"synthetic pending audio"),
                    link: format!("[Voice note](assets/voice-{id}.wav)"),
                }],
            },
        )
        .unwrap();
        assert!(recover(&database, root.to_str().unwrap(), None, None).is_err());
        assert!(root.join(&audio).exists());
        assert!(!staged.exists());
        recover(&database, root.to_str().unwrap(), None, Some(&id)).unwrap();
        assert!(!root.join(audio).exists());
        assert!(
            crate::db::load_pending_speech_attachments(&database, &root.to_string_lossy())
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fs::read_to_string(root.join("Synthetic.md")).unwrap(),
            "# Invented note\n"
        );
        assert_eq!(
            fs::read(root.join("assets/keep.txt")).unwrap(),
            b"keep invented user content"
        );
    }

    #[test]
    fn voice_note_recovery_never_trusts_vault_supplied_deletion_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let database = root.join("synthetic.sqlite3");
        crate::db::initialize(&database).unwrap();
        fs::create_dir_all(root.join(".denote")).unwrap();
        fs::create_dir(root.join("assets")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let audio = format!("assets/voice-{id}.wav");
        fs::write(root.join(&audio), b"retained synthetic audio").unwrap();
        let forged = Pending {
            version: 1,
            entries: vec![PendingEntry {
                id: id.clone(),
                note: "Synthetic.md".into(),
                audio: audio.clone(),
                hash: hash_bytes(b"retained synthetic audio"),
                link: format!("[Voice note](assets/voice-{id}.wav)"),
            }],
        };
        fs::write(
            root.join(".denote/speech-pending.json"),
            serde_json::to_vec(&forged).unwrap(),
        )
        .unwrap();
        recover(&database, root.to_str().unwrap(), None, None).unwrap();
        assert_eq!(
            fs::read(root.join(&audio)).unwrap(),
            b"retained synthetic audio"
        );
        store(&database, &root, &forged).unwrap();
        assert!(recover(&database, root.to_str().unwrap(), None, None).is_err());
        keep_unfinished(&database, root.to_str().unwrap()).unwrap();
        assert_eq!(
            fs::read(root.join(&audio)).unwrap(),
            b"retained synthetic audio"
        );
    }
}
