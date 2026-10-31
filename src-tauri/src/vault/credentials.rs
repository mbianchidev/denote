use std::{collections::HashSet, fs, path::Path};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{
    acquire_note_lock, acquire_vault_lock, atomic_write, canonical_vault, encode_file_at_rest,
    ensure_no_symlinks, hash_bytes, read_plain_file,
};
use crate::error::{AppError, AppResult};

pub(crate) const PATH: &str = ".denote/credentials.dncred";
const MAGIC: &[u8; 12] = b"DENOTE-CRED1";
const HEADER_BYTES: usize = MAGIC.len() + 16 + 24;
const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONTAINER_BYTES: usize = MAX_DOCUMENT_BYTES + 4096 + HEADER_BYTES + 16;
const DOMAIN: &[u8] = b"denote-credential-store-v1";

pub(crate) type Key = Zeroizing<[u8; 32]>;

#[derive(Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Entry {
    pub id: String,
    pub service: String,
    pub username: String,
    pub secret: String,
    pub url: String,
    pub notes: String,
}

#[derive(Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Document {
    schema_version: u32,
    owner: String,
    pub entries: Vec<Entry>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            schema_version: 1,
            owner: "denote.credentials".into(),
            entries: Vec::new(),
        }
    }
}

#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EntryView {
    pub id: String,
    pub service: String,
    pub username: String,
    pub url: String,
    pub notes: String,
}

impl Document {
    pub(crate) fn views(&self) -> Vec<EntryView> {
        self.entries
            .iter()
            .map(|entry| EntryView {
                id: entry.id.clone(),
                service: entry.service.clone(),
                username: entry.username.clone(),
                url: entry.url.clone(),
                notes: entry.notes.clone(),
            })
            .collect()
    }

    fn validate(&self) -> AppResult<()> {
        let mut ids = HashSet::new();
        if self.schema_version != 1
            || self.owner != "denote.credentials"
            || self.entries.len() > 1000
            || self.entries.iter().any(|entry| {
                uuid::Uuid::parse_str(&entry.id).is_err()
                    || !ids.insert(&entry.id)
                    || entry.service.trim().is_empty()
                    || entry.service.len() > 1024
                    || entry.username.len() > 4096
                    || entry.secret.len() > 16384
                    || entry.url.len() > 4096
                    || entry.notes.len() > 16384
                    || [
                        &entry.service,
                        &entry.username,
                        &entry.secret,
                        &entry.url,
                        &entry.notes,
                    ]
                    .iter()
                    .any(|value| value.contains('\0'))
            })
        {
            return Err(invalid(
                "Invalid credential entries or unsupported credential schema.",
            ));
        }
        Ok(())
    }

    pub(crate) fn export(&self) -> AppResult<Zeroizing<Vec<u8>>> {
        self.validate()?;
        serde_json::to_vec_pretty(self)
            .map(Zeroizing::new)
            .map_err(|_| invalid("Unable to encode credential entries."))
    }
}

pub(crate) struct Container {
    pub bytes: Vec<u8>,
}

impl Container {
    pub(crate) fn parse(bytes: Vec<u8>) -> AppResult<Self> {
        if bytes.len() < HEADER_BYTES + 16 + 4096
            || bytes.len() > MAX_CONTAINER_BYTES
            || !bytes.starts_with(MAGIC)
            || !(bytes.len() - HEADER_BYTES - 16).is_multiple_of(4096)
        {
            return Err(invalid(
                "Unsupported or damaged credential file. Preserve it and restore an encrypted backup.",
            ));
        }
        Ok(Self { bytes })
    }

    pub(crate) fn hash(&self) -> String {
        hash_bytes(&self.bytes)
    }

    pub(crate) fn unlock(&self, password: &str) -> AppResult<(Key, Document)> {
        let key = derive(password, &self.bytes[MAGIC.len()..MAGIC.len() + 16])?;
        let document = self.decrypt(&key)?;
        Ok((key, document))
    }

    pub(crate) fn decrypt(&self, key: &[u8; 32]) -> AppResult<Document> {
        let header = &self.bytes[..HEADER_BYTES];
        let nonce = XNonce::try_from(&header[MAGIC.len() + 16..])
            .map_err(|_| invalid("Invalid credential nonce."))?;
        let plaintext = Zeroizing::new(
            XChaCha20Poly1305::new(key.into())
                .decrypt(
                    &nonce,
                    Payload {
                        msg: &self.bytes[HEADER_BYTES..],
                        aad: &associated_data(header),
                    },
                )
                .map_err(|_| invalid("Credential authentication failed. Check the master password or restore an encrypted backup."))?,
        );
        let length = u32::from_le_bytes(
            plaintext[..4]
                .try_into()
                .map_err(|_| invalid("Invalid credential document length."))?,
        ) as usize;
        if length == 0 || length > MAX_DOCUMENT_BYTES || length > plaintext.len() - 4 {
            return Err(invalid("Invalid credential document length."));
        }
        let document: Document =
            serde_json::from_slice(&plaintext[4..4 + length]).map_err(|_| {
                invalid("Invalid credential document. Preserve it and restore an encrypted backup.")
            })?;
        document.validate()?;
        Ok(document)
    }

    pub(crate) fn replace(&self, key: &[u8; 32], document: &Document) -> AppResult<Self> {
        encrypt(key, &self.bytes[MAGIC.len()..MAGIC.len() + 16], document)
    }
}

pub(crate) fn create(password: &str) -> AppResult<(Container, Key)> {
    if password.chars().count() < 12 {
        return Err(invalid(
            "Use a master password with at least 12 characters.",
        ));
    }
    let mut salt = [0; 16];
    getrandom::fill(&mut salt).map_err(|_| invalid("Secure randomness is unavailable."))?;
    let key = derive(password, &salt)?;
    Ok((encrypt(&key, &salt, &Document::default())?, key))
}

fn derive(password: &str, salt: &[u8]) -> AppResult<Key> {
    if password.is_empty() || password.len() > 1024 {
        return Err(invalid(
            "The master password must fit within 1024 UTF-8 bytes.",
        ));
    }
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|_| invalid("Credential key derivation is unavailable."))?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| invalid("Unable to derive the credential key."))?;
    Ok(key)
}

fn associated_data(header: &[u8]) -> Vec<u8> {
    [DOMAIN, header].concat()
}

fn encrypt(key: &[u8; 32], salt: &[u8], document: &Document) -> AppResult<Container> {
    document.validate()?;
    let encoded = Zeroizing::new(
        serde_json::to_vec(document)
            .map_err(|_| invalid("Unable to encode credential entries."))?,
    );
    if encoded.len() > MAX_DOCUMENT_BYTES {
        return Err(invalid("Credentials exceed the 4 MiB document limit."));
    }
    let mut plaintext = Zeroizing::new(vec![0; (encoded.len() + 4).div_ceil(4096) * 4096]);
    plaintext[..4].copy_from_slice(&(encoded.len() as u32).to_le_bytes());
    plaintext[4..4 + encoded.len()].copy_from_slice(&encoded);
    let mut nonce = [0; 24];
    getrandom::fill(&mut nonce).map_err(|_| invalid("Secure randomness is unavailable."))?;
    let mut bytes = [MAGIC.as_slice(), salt, &nonce].concat();
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &plaintext,
                aad: &associated_data(&bytes),
            },
        )
        .map_err(|_| invalid("Unable to encrypt credential entries."))?;
    bytes.extend_from_slice(&ciphertext);
    Container::parse(bytes)
}

pub(crate) fn read(vault_path: &str, vault_key: Option<&[u8; 32]>) -> AppResult<Option<Container>> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _file_lock = acquire_note_lock(&root, PATH)?;
    read_at(&root, vault_key)
}

fn read_at(root: &Path, vault_key: Option<&[u8; 32]>) -> AppResult<Option<Container>> {
    if crate::crypto::manifest_exists(root) && vault_key.is_none() {
        return Err(AppError::Locked);
    }
    let path = root.join(PATH);
    ensure_no_symlinks(root, &path, true)?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(invalid("Unable to read the credential file.")),
        Ok(metadata) => {
            if !metadata.is_file() || metadata.len() > MAX_CONTAINER_BYTES as u64 + 1024 {
                return Err(invalid(
                    "The credential file is not a regular file within the size limit.",
                ));
            }
            Container::parse(read_plain_file(&path, vault_key).map_err(|_| {
                invalid("Unable to read the credential file. Check vault unlock state.")
            })?)
            .map(Some)
        }
    }
}

pub(crate) fn save(
    vault_path: &str,
    expected_hash: Option<&str>,
    container: &Container,
    vault_key: Option<&[u8; 32]>,
) -> AppResult<()> {
    let root = canonical_vault(vault_path)?;
    let _vault_lock = acquire_vault_lock(&root, false)?;
    let _file_lock = acquire_note_lock(&root, PATH)?;
    let current = read_at(&root, vault_key)?;
    if current.as_ref().map(Container::hash).as_deref() != expected_hash {
        return Err(invalid(
            "The credential file changed. Lock and unlock it again; nothing was overwritten.",
        ));
    }
    let destination = root.join(PATH);
    ensure_no_symlinks(&root, &destination, true)?;
    let stored = encode_file_at_rest(&root, &container.bytes, vault_key)?;
    atomic_write(&destination, &stored).map_err(|_| {
        invalid("Unable to save the encrypted credential file. The previous file is preserved.")
    })
}

fn invalid(message: &str) -> AppError {
    AppError::Crypto(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const PASSWORD: &str = "invented master password";
    const CANARIES: [&str; 5] = [
        "synthetic service canary",
        "synthetic username canary",
        "synthetic secret canary",
        "https://synthetic.invalid/credential",
        "synthetic private note canary",
    ];

    fn document() -> Document {
        let mut document = Document::default();
        document.entries = vec![Entry {
            id: "11111111-2222-4333-8444-555555555555".into(),
            service: CANARIES[0].into(),
            username: CANARIES[1].into(),
            secret: CANARIES[2].into(),
            url: CANARIES[3].into(),
            notes: CANARIES[4].into(),
        }];
        document
    }

    #[test]
    fn credentials_authenticate_every_field_and_never_serialize_secrets_in_listings() {
        let (empty, key) = create(PASSWORD).unwrap();
        let populated = empty.replace(&key, &document()).unwrap();
        let (opened_key, opened) = populated.unlock(PASSWORD).unwrap();
        assert_eq!(*opened_key, *key);
        assert_eq!(opened.entries[0].secret, CANARIES[2]);
        let views = serde_json::to_string(&opened.views()).unwrap();
        assert!(!views.contains(CANARIES[2]));
        assert!(!views.contains("secret"));
        for canary in CANARIES {
            assert!(
                !populated
                    .bytes
                    .windows(canary.len())
                    .any(|bytes| bytes == canary.as_bytes())
            );
        }
        assert!(populated.unlock("incorrect invented password").is_err());
    }

    #[test]
    fn credentials_refuse_header_ciphertext_and_tag_tampering_without_exposing_values() {
        let (container, key) = create(PASSWORD).unwrap();
        let container = container.replace(&key, &document()).unwrap();
        for offset in [
            0,
            MAGIC.len(),
            HEADER_BYTES - 1,
            HEADER_BYTES,
            container.bytes.len() - 1,
        ] {
            let mut corrupted = container.bytes.clone();
            corrupted[offset] ^= 1;
            let error = match Container::parse(corrupted) {
                Ok(container) => container.decrypt(&key).err().unwrap().to_string(),
                Err(error) => error.to_string(),
            };
            for canary in CANARIES {
                assert!(!error.contains(canary));
            }
        }
    }

    #[test]
    fn credentials_use_fresh_nonces_size_buckets_and_bounded_password_work() {
        let (container, key) = create(PASSWORD).unwrap();
        let first = container.replace(&key, &document()).unwrap();
        let second = first.replace(&key, &document()).unwrap();
        assert_ne!(first.bytes, second.bytes);
        assert_eq!(first.bytes.len(), second.bytes.len());
        assert_eq!((first.bytes.len() - HEADER_BYTES - 16) % 4096, 0);
        assert!(create("short").is_err());
        assert!(create(&"a".repeat(1025)).is_err());
        assert!(Container::parse(vec![0; MAX_CONTAINER_BYTES + 1]).is_err());
        assert!(Container::parse(vec![]).is_err());
    }

    #[test]
    fn credentials_persist_only_ciphertext_and_refuse_stale_or_corrupt_replacement() {
        let directory = tempdir().unwrap();
        let root = directory.path().to_str().unwrap();
        let (container, key) = create(PASSWORD).unwrap();
        save(root, None, &container, None).unwrap();
        let next = container.replace(&key, &document()).unwrap();
        save(root, Some(&container.hash()), &next, None).unwrap();
        assert!(save(root, Some(&container.hash()), &container, None).is_err());
        assert!(save(root, None, &container, None).is_err());
        let stored = fs::read(directory.path().join(PATH)).unwrap();
        assert_eq!(stored, next.bytes);
        for entry in walkdir::WalkDir::new(directory.path()) {
            let entry = entry.unwrap();
            if !entry.file_type().is_file() {
                continue;
            }
            let bytes = fs::read(entry.path()).unwrap();
            for canary in CANARIES {
                assert!(
                    !bytes
                        .windows(canary.len())
                        .any(|part| part == canary.as_bytes())
                );
            }
        }
        fs::write(directory.path().join(PATH), b"corrupt synthetic container").unwrap();
        assert!(read(root, None).is_err());
        assert!(save(root, None, &container, None).is_err());
        assert_eq!(
            fs::read(directory.path().join(PATH)).unwrap(),
            b"corrupt synthetic container"
        );
    }

    #[test]
    fn credentials_survive_whole_vault_sweeps_without_exposing_values_to_notes_or_database_files() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("synthetic.sqlite3");
        crate::db::initialize(&database).unwrap();
        let root = directory.path().join("vault");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("Synthetic.md"), b"# Invented note\n").unwrap();
        let (container, key) = create(PASSWORD).unwrap();
        let container = container.replace(&key, &document()).unwrap();
        save(root.to_str().unwrap(), None, &container, None).unwrap();
        let outer = [7u8; 32];
        super::super::encrypt_vault_contents(&database, root.to_str().unwrap(), &outer).unwrap();
        assert!(crate::crypto::is_encrypted_file(
            &fs::read(root.join(PATH)).unwrap()
        ));
        assert_eq!(
            read(root.to_str().unwrap(), Some(&outer))
                .unwrap()
                .unwrap()
                .decrypt(&key)
                .unwrap()
                .entries[0]
                .secret,
            CANARIES[2]
        );
        super::super::decrypt_vault_contents(&database, root.to_str().unwrap(), &outer).unwrap();
        assert_eq!(fs::read(root.join(PATH)).unwrap(), container.bytes);
        assert!(super::super::read_note(&database, root.to_str().unwrap(), PATH, None).is_err());
        for file in walkdir::WalkDir::new(directory.path()) {
            let file = file.unwrap();
            if !file.file_type().is_file() {
                continue;
            }
            let bytes = fs::read(file.path()).unwrap();
            for canary in CANARIES {
                assert!(
                    !bytes
                        .windows(canary.len())
                        .any(|part| part == canary.as_bytes())
                );
            }
        }
    }

    #[test]
    fn credentials_remain_independently_encrypted_inside_whole_vault_encryption() {
        let directory = tempdir().unwrap();
        let root = directory.path().to_str().unwrap();
        let (container, key) = create(PASSWORD).unwrap();
        let container = container.replace(&key, &document()).unwrap();
        let (manifest, outer_key, _) =
            crate::crypto::create_manifest("invented outer vault password").unwrap();
        crate::crypto::save_manifest(directory.path(), &manifest).unwrap();
        let outer = outer_key.copy_bytes();
        save(root, None, &container, Some(&outer)).unwrap();
        let stored = fs::read(directory.path().join(PATH)).unwrap();
        assert!(crate::crypto::is_encrypted_file(&stored));
        assert!(read(root, None).is_err());
        let read = read(root, Some(&outer)).unwrap().unwrap();
        assert_eq!(read.bytes, container.bytes);
        assert_eq!(read.decrypt(&key).unwrap().entries[0].secret, CANARIES[2]);
    }

    #[cfg(unix)]
    #[test]
    fn credentials_refuse_symbolic_links_without_touching_the_target() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let external = tempdir().unwrap();
        fs::create_dir(directory.path().join(".denote")).unwrap();
        fs::write(
            external.path().join("synthetic.dncred"),
            b"keep synthetic bytes",
        )
        .unwrap();
        symlink(
            external.path().join("synthetic.dncred"),
            directory.path().join(PATH),
        )
        .unwrap();
        assert!(read(directory.path().to_str().unwrap(), None).is_err());
        assert_eq!(
            fs::read(external.path().join("synthetic.dncred")).unwrap(),
            b"keep synthetic bytes"
        );
    }
}
