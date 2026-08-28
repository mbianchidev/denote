use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

use argon2::{Algorithm, Argon2, Params, Version};
use atomic_write_file::AtomicWriteFile;
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{AppError, AppResult};

const FILE_MAGIC_V1: &[u8; 12] = b"DENOTE-ENC1\0";
const FILE_MAGIC_V2: &[u8; 12] = b"DENOTE-ENC2\0";
const FILE_AAD_V1: &[u8] = b"denote-file-v1";
const FILE_AAD_V2: &[u8] = b"denote-file-v2";
const LEGACY_FILE_CHUNK_BYTES: usize = 1024 * 1024;
const FILE_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const FILE_HEADER_BYTES: usize = FILE_MAGIC_V2.len() + 16 + 4 + 8;
const MAX_LEGACY_FILE_BYTES: usize = 256 * 1024 * 1024;
const HISTORY_AAD: &[u8] = b"denote-history-v1";
const KEY_AAD_PREFIX: &str = "denote-key-v1:";
const MANIFEST_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const RECOVERY_CODE_COUNT: usize = 10;
const PASSWORD_MIN_LENGTH: usize = 12;

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct VaultKey([u8; 32]);

impl VaultKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn copy_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.0)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EncryptionPhase {
    Encrypting,
    Encrypted,
    Decrypting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionManifest {
    pub version: u32,
    pub phase: EncryptionPhase,
    pub kdf: KdfConfig,
    pub password: WrappedKey,
    pub recovery: Vec<RecoverySlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfConfig {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfConfig {
    fn default() -> Self {
        Self {
            memory_kib: 19 * 1024,
            iterations: 2,
            parallelism: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverySlot {
    pub id: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(".denote").join("encryption.json")
}

pub fn manifest_exists(root: &Path) -> bool {
    manifest_path(root).is_file()
}

pub fn load_manifest(root: &Path) -> AppResult<Option<EncryptionManifest>> {
    let path = manifest_path(root);
    if !path.exists() {
        return Ok(None);
    }
    ensure_manifest_path_safe(root)?;
    if fs::metadata(&path)?.len() > MAX_MANIFEST_BYTES {
        return Err(AppError::Crypto(
            "Encryption manifest is larger than 1 MB".to_string(),
        ));
    }
    let content = fs::read_to_string(&path)?;
    let manifest: EncryptionManifest = serde_json::from_str(&content)
        .map_err(|error| AppError::Crypto(format!("Invalid encryption manifest: {error}")))?;
    if manifest.version != MANIFEST_VERSION {
        return Err(AppError::Crypto(format!(
            "Unsupported encryption manifest version {}",
            manifest.version
        )));
    }
    validate_manifest(&manifest)?;
    Ok(Some(manifest))
}

pub fn save_manifest(root: &Path, manifest: &EncryptionManifest) -> AppResult<()> {
    validate_manifest(manifest)?;
    ensure_manifest_path_safe(root)?;
    let path = manifest_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Crypto("Encryption manifest has no parent".to_string()))?;
    fs::create_dir_all(parent)?;
    let content = serde_json::to_vec_pretty(manifest).map_err(|error| {
        AppError::Crypto(format!("Unable to encode encryption manifest: {error}"))
    })?;
    let mut file = AtomicWriteFile::options().open(path)?;
    file.write_all(&content)?;
    file.commit()?;
    Ok(())
}

pub fn remove_manifest(root: &Path) -> AppResult<()> {
    ensure_manifest_path_safe(root)?;
    let path = manifest_path(root);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn validate_manifest(manifest: &EncryptionManifest) -> AppResult<()> {
    if !(8 * 1024..=1024 * 1024).contains(&manifest.kdf.memory_kib)
        || !(1..=10).contains(&manifest.kdf.iterations)
        || !(1..=16).contains(&manifest.kdf.parallelism)
    {
        return Err(AppError::Crypto(
            "Encryption manifest has unsafe Argon2 parameters".to_string(),
        ));
    }
    if manifest.recovery.len() > RECOVERY_CODE_COUNT {
        return Err(AppError::Crypto(
            "Encryption manifest has too many recovery slots".to_string(),
        ));
    }
    Ok(())
}

fn ensure_manifest_path_safe(root: &Path) -> AppResult<()> {
    for path in [root.join(".denote"), manifest_path(root)] {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata_is_link(&metadata) => {
                return Err(AppError::Crypto(format!(
                    "Encryption control path cannot be a symbolic link: {}",
                    path.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
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

pub fn create_manifest(password: &str) -> AppResult<(EncryptionManifest, VaultKey, Vec<String>)> {
    validate_password(password)?;
    let vault_key = Zeroizing::new(random_array::<32>()?);
    let kdf = KdfConfig::default();
    let password_slot = wrap_password_key(password, &vault_key, &kdf)?;
    let (recovery, recovery_codes) = create_recovery_slots(&vault_key)?;
    Ok((
        EncryptionManifest {
            version: MANIFEST_VERSION,
            phase: EncryptionPhase::Encrypting,
            kdf,
            password: password_slot,
            recovery,
        },
        VaultKey::from_bytes(*vault_key),
        recovery_codes,
    ))
}

pub fn unlock_with_password(manifest: &EncryptionManifest, password: &str) -> AppResult<VaultKey> {
    let key = derive_password_key(
        password.as_bytes(),
        &decode_fixed::<16>(&manifest.password.salt, "password salt")?,
        &manifest.kdf,
    )?;
    unwrap_key(
        &key,
        &manifest.password.nonce,
        &manifest.password.ciphertext,
        "password",
    )
}

pub fn unlock_with_recovery_code(
    manifest: &mut EncryptionManifest,
    recovery_code: &str,
) -> AppResult<VaultKey> {
    let normalized = Zeroizing::new(normalize_recovery_code(recovery_code));
    let id = recovery_code_id(&normalized);
    let index = manifest
        .recovery
        .iter()
        .position(|slot| slot.id == id)
        .ok_or_else(|| AppError::Crypto("Recovery code is invalid or already used".to_string()))?;
    let slot = &manifest.recovery[index];
    let salt = decode_fixed::<16>(&slot.salt, "recovery salt")?;
    let key = Zeroizing::new(derive_recovery_key(&normalized, &salt));
    let vault_key = unwrap_key(&key, &slot.nonce, &slot.ciphertext, &slot.id)?;
    manifest.recovery.remove(index);
    Ok(vault_key)
}

pub fn change_password(
    manifest: &mut EncryptionManifest,
    vault_key: &[u8; 32],
    password: &str,
) -> AppResult<()> {
    validate_password(password)?;
    manifest.password = wrap_password_key(password, vault_key, &manifest.kdf)?;
    Ok(())
}

pub fn regenerate_recovery_codes(
    manifest: &mut EncryptionManifest,
    vault_key: &[u8; 32],
) -> AppResult<Vec<String>> {
    let (slots, codes) = create_recovery_slots(vault_key)?;
    manifest.recovery = slots;
    Ok(codes)
}

pub fn is_encrypted_file(content: &[u8]) -> bool {
    content.starts_with(FILE_MAGIC_V1) || content.starts_with(FILE_MAGIC_V2)
}

pub fn encrypted_file_plaintext_len(header: &[u8], stored_len: u64) -> AppResult<Option<u64>> {
    if header.starts_with(FILE_MAGIC_V1) {
        let overhead = (FILE_MAGIC_V1.len() + 24 + 16) as u64;
        return stored_len
            .checked_sub(overhead)
            .map(Some)
            .ok_or_else(|| AppError::Crypto("Encrypted file is too short".to_string()));
    }
    if !header.starts_with(FILE_MAGIC_V2) {
        return Ok(None);
    }
    if header.len() < FILE_HEADER_BYTES {
        return Err(AppError::Crypto(
            "Encrypted file header is incomplete".to_string(),
        ));
    }
    let chunk_bytes = u32::from_le_bytes(
        header[28..32]
            .try_into()
            .map_err(|_| AppError::Crypto("Invalid file chunk size".to_string()))?,
    ) as usize;
    if !supported_file_chunk_bytes(chunk_bytes) {
        return Err(AppError::Crypto(
            "Unsupported encrypted file chunk size".to_string(),
        ));
    }
    let plaintext_len = u64::from_le_bytes(
        header[32..40]
            .try_into()
            .map_err(|_| AppError::Crypto("Invalid file length".to_string()))?,
    );
    let chunk_count = plaintext_len.div_ceil(chunk_bytes as u64).max(1);
    let expected_len = (FILE_HEADER_BYTES as u64)
        .checked_add(plaintext_len)
        .and_then(|length| length.checked_add(chunk_count.checked_mul(16)?))
        .ok_or_else(|| AppError::Crypto("Encrypted file length is invalid".to_string()))?;
    if expected_len != stored_len {
        return Err(AppError::Crypto(
            "Encrypted file length does not match its header".to_string(),
        ));
    }
    Ok(Some(plaintext_len))
}

pub fn encrypt_file_content(vault_key: &[u8; 32], plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let mut result = Vec::with_capacity(plaintext.len() + FILE_HEADER_BYTES + 16);
    encrypt_file_stream(
        vault_key,
        &mut Cursor::new(plaintext),
        plaintext.len() as u64,
        &mut result,
    )?;
    Ok(result)
}

pub fn decrypt_file_content(vault_key: &[u8; 32], encrypted: &[u8]) -> AppResult<Vec<u8>> {
    if encrypted.starts_with(FILE_MAGIC_V2) {
        let mut result = Vec::new();
        decrypt_file_stream(vault_key, &mut Cursor::new(encrypted), &mut result)?;
        return Ok(result);
    }
    if !encrypted.starts_with(FILE_MAGIC_V1)
        || encrypted.len() < FILE_MAGIC_V1.len() + 24 + 16
        || encrypted.len() > MAX_LEGACY_FILE_BYTES
    {
        return Err(AppError::Crypto(
            "File is not valid Denote ciphertext".to_string(),
        ));
    }
    let nonce_start = FILE_MAGIC_V1.len();
    let nonce_end = nonce_start + 24;
    decrypt(
        vault_key,
        &encrypted[nonce_start..nonce_end],
        &encrypted[nonce_end..],
        FILE_AAD_V1,
    )
}

pub fn encrypt_file_stream<R: Read, W: Write + ?Sized>(
    vault_key: &[u8; 32],
    reader: &mut R,
    plaintext_len: u64,
    writer: &mut W,
) -> AppResult<()> {
    encrypt_file_stream_with_chunk_bytes(vault_key, reader, plaintext_len, FILE_CHUNK_BYTES, writer)
}

fn encrypt_file_stream_with_chunk_bytes<R: Read, W: Write + ?Sized>(
    vault_key: &[u8; 32],
    reader: &mut R,
    plaintext_len: u64,
    chunk_bytes: usize,
    writer: &mut W,
) -> AppResult<()> {
    if !supported_file_chunk_bytes(chunk_bytes) {
        return Err(AppError::Crypto(
            "Unsupported encrypted file chunk size".to_string(),
        ));
    }
    let nonce_prefix = random_array::<16>()?;
    let mut header = Vec::with_capacity(FILE_HEADER_BYTES);
    header.extend_from_slice(FILE_MAGIC_V2);
    header.extend_from_slice(&nonce_prefix);
    header.extend_from_slice(&(chunk_bytes as u32).to_le_bytes());
    header.extend_from_slice(&plaintext_len.to_le_bytes());
    writer.write_all(&header)?;

    let chunk_count = plaintext_len.div_ceil(chunk_bytes as u64).max(1);
    let mut remaining = plaintext_len;
    for index in 0..chunk_count {
        let plaintext_bytes = remaining.min(chunk_bytes as u64) as usize;
        let mut chunk = Zeroizing::new(vec![0; plaintext_bytes]);
        reader.read_exact(&mut chunk)?;
        let nonce = file_chunk_nonce(nonce_prefix, index);
        let aad = file_chunk_aad(&header, index);
        writer.write_all(&encrypt(vault_key, &nonce, &chunk, &aad)?)?;
        remaining -= plaintext_bytes as u64;
    }
    let mut trailing = [0u8; 1];
    if reader.read(&mut trailing)? != 0 {
        return Err(AppError::Crypto(
            "File changed while it was being encrypted".to_string(),
        ));
    }
    Ok(())
}

pub fn decrypt_file_stream<R: Read, W: Write + ?Sized>(
    vault_key: &[u8; 32],
    reader: &mut R,
    writer: &mut W,
) -> AppResult<()> {
    let mut magic = [0u8; 12];
    reader.read_exact(&mut magic)?;
    if &magic == FILE_MAGIC_V1 {
        let mut encrypted = magic.to_vec();
        reader
            .take((MAX_LEGACY_FILE_BYTES + 1 - magic.len()) as u64)
            .read_to_end(&mut encrypted)?;
        if encrypted.len() > MAX_LEGACY_FILE_BYTES {
            return Err(AppError::Crypto(
                "Legacy encrypted file is larger than 256 MB".to_string(),
            ));
        }
        writer.write_all(&decrypt_file_content(vault_key, &encrypted)?)?;
        return Ok(());
    }
    if &magic != FILE_MAGIC_V2 {
        return Err(AppError::Crypto(
            "File is not valid Denote ciphertext".to_string(),
        ));
    }

    let mut header_tail = [0u8; FILE_HEADER_BYTES - 12];
    reader.read_exact(&mut header_tail)?;
    let mut header = magic.to_vec();
    header.extend_from_slice(&header_tail);
    let nonce_prefix: [u8; 16] = header_tail[..16]
        .try_into()
        .map_err(|_| AppError::Crypto("Invalid file nonce".to_string()))?;
    let chunk_bytes = u32::from_le_bytes(
        header_tail[16..20]
            .try_into()
            .map_err(|_| AppError::Crypto("Invalid file chunk size".to_string()))?,
    ) as usize;
    if !supported_file_chunk_bytes(chunk_bytes) {
        return Err(AppError::Crypto(
            "Unsupported encrypted file chunk size".to_string(),
        ));
    }
    let plaintext_len = u64::from_le_bytes(
        header_tail[20..28]
            .try_into()
            .map_err(|_| AppError::Crypto("Invalid file length".to_string()))?,
    );
    let chunk_count = plaintext_len.div_ceil(chunk_bytes as u64).max(1);
    let mut remaining = plaintext_len;
    for index in 0..chunk_count {
        let plaintext_bytes = remaining.min(chunk_bytes as u64) as usize;
        let mut ciphertext = vec![0; plaintext_bytes + 16];
        reader.read_exact(&mut ciphertext)?;
        let nonce = file_chunk_nonce(nonce_prefix, index);
        let aad = file_chunk_aad(&header, index);
        let plaintext = Zeroizing::new(decrypt(vault_key, &nonce, &ciphertext, &aad)?);
        writer.write_all(&plaintext)?;
        remaining -= plaintext_bytes as u64;
    }
    let mut trailing = [0u8; 1];
    if reader.read(&mut trailing)? != 0 {
        return Err(AppError::Crypto(
            "Encrypted file has unexpected trailing data".to_string(),
        ));
    }
    Ok(())
}

fn supported_file_chunk_bytes(chunk_bytes: usize) -> bool {
    matches!(chunk_bytes, LEGACY_FILE_CHUNK_BYTES | FILE_CHUNK_BYTES)
}

fn file_chunk_nonce(prefix: [u8; 16], index: u64) -> [u8; 24] {
    let mut nonce = [0u8; 24];
    nonce[..16].copy_from_slice(&prefix);
    nonce[16..].copy_from_slice(&index.to_le_bytes());
    nonce
}

fn file_chunk_aad(header: &[u8], index: u64) -> Vec<u8> {
    let mut aad = Vec::with_capacity(FILE_AAD_V2.len() + header.len() + 8);
    aad.extend_from_slice(FILE_AAD_V2);
    aad.extend_from_slice(header);
    aad.extend_from_slice(&index.to_le_bytes());
    aad
}

pub fn encrypt_history_content(vault_key: &[u8; 32], plaintext: &str) -> AppResult<String> {
    let nonce = random_array::<24>()?;
    let ciphertext = encrypt(vault_key, &nonce, plaintext.as_bytes(), HISTORY_AAD)?;
    let mut encoded = nonce.to_vec();
    encoded.extend_from_slice(&ciphertext);
    Ok(format!("v1:{}", STANDARD.encode(encoded)))
}

pub fn decrypt_history_content(vault_key: &[u8; 32], encrypted: &str) -> AppResult<String> {
    let encoded = encrypted
        .strip_prefix("v1:")
        .ok_or_else(|| AppError::Crypto("Invalid encrypted history record".to_string()))?;
    let content = STANDARD
        .decode(encoded)
        .map_err(|error| AppError::Crypto(format!("Invalid history encoding: {error}")))?;
    if content.len() < 24 + 16 {
        return Err(AppError::Crypto(
            "Encrypted history record is too short".to_string(),
        ));
    }
    let plaintext = decrypt(vault_key, &content[..24], &content[24..], HISTORY_AAD)?;
    String::from_utf8(plaintext)
        .map_err(|error| AppError::Crypto(format!("History is not valid UTF-8: {error}")))
}

fn create_recovery_slots(vault_key: &[u8; 32]) -> AppResult<(Vec<RecoverySlot>, Vec<String>)> {
    let mut slots = Vec::with_capacity(RECOVERY_CODE_COUNT);
    let mut codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    for _ in 0..RECOVERY_CODE_COUNT {
        let code_bytes = Zeroizing::new(random_array::<16>()?);
        let code = format_recovery_code(&code_bytes);
        let normalized = Zeroizing::new(normalize_recovery_code(&code));
        let id = recovery_code_id(&normalized);
        let salt = random_array::<16>()?;
        let nonce = random_array::<24>()?;
        let recovery_key = Zeroizing::new(derive_recovery_key(&normalized, &salt));
        let ciphertext = encrypt(
            &recovery_key,
            &nonce,
            vault_key,
            format!("{KEY_AAD_PREFIX}{id}").as_bytes(),
        )?;
        slots.push(RecoverySlot {
            id,
            salt: STANDARD.encode(salt),
            nonce: STANDARD.encode(nonce),
            ciphertext: STANDARD.encode(ciphertext),
        });
        codes.push(code);
    }
    Ok((slots, codes))
}

fn wrap_password_key(
    password: &str,
    vault_key: &[u8; 32],
    kdf: &KdfConfig,
) -> AppResult<WrappedKey> {
    let salt = random_array::<16>()?;
    let nonce = random_array::<24>()?;
    let key = derive_password_key(password.as_bytes(), &salt, kdf)?;
    let ciphertext = encrypt(
        &key,
        &nonce,
        vault_key,
        format!("{KEY_AAD_PREFIX}password").as_bytes(),
    )?;
    Ok(WrappedKey {
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

fn derive_password_key(
    password: &[u8],
    salt: &[u8; 16],
    kdf: &KdfConfig,
) -> AppResult<Zeroizing<[u8; 32]>> {
    let params = Params::new(kdf.memory_kib, kdf.iterations, kdf.parallelism, Some(32))
        .map_err(|error| AppError::Crypto(format!("Invalid Argon2 parameters: {error}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password, salt, &mut *key)
        .map_err(|error| AppError::Crypto(format!("Password derivation failed: {error}")))?;
    Ok(key)
}

fn derive_recovery_key(code: &str, salt: &[u8; 16]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"denote-recovery-v1");
    hasher.update(salt);
    hasher.update(code.as_bytes());
    hasher.finalize().into()
}

fn unwrap_key(key: &[u8; 32], nonce: &str, ciphertext: &str, slot_id: &str) -> AppResult<VaultKey> {
    let nonce = decode_fixed::<24>(nonce, "key nonce")?;
    let ciphertext = STANDARD
        .decode(ciphertext)
        .map_err(|error| AppError::Crypto(format!("Invalid wrapped key: {error}")))?;
    let plaintext = Zeroizing::new(
        decrypt(
            key,
            &nonce,
            &ciphertext,
            format!("{KEY_AAD_PREFIX}{slot_id}").as_bytes(),
        )
        .map_err(|_| AppError::Crypto("Password or recovery code is incorrect".to_string()))?,
    );
    let bytes = plaintext
        .as_slice()
        .try_into()
        .map_err(|_| AppError::Crypto("Wrapped vault key has an invalid length".to_string()))?;
    Ok(VaultKey::from_bytes(bytes))
}

fn encrypt(key: &[u8; 32], nonce: &[u8], plaintext: &[u8], aad: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| AppError::Crypto(format!("Invalid encryption key: {error}")))?;
    let nonce = XNonce::try_from(nonce)
        .map_err(|_| AppError::Crypto("Invalid encryption nonce length".to_string()))?;
    cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto("Encryption failed".to_string()))
}

fn decrypt(key: &[u8; 32], nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| AppError::Crypto(format!("Invalid encryption key: {error}")))?;
    let nonce = XNonce::try_from(nonce)
        .map_err(|_| AppError::Crypto("Invalid encryption nonce length".to_string()))?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto("Encrypted content failed authentication".to_string()))
}

fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < PASSWORD_MIN_LENGTH {
        return Err(AppError::Crypto(format!(
            "Password must contain at least {PASSWORD_MIN_LENGTH} characters"
        )));
    }
    if password.trim().is_empty() {
        return Err(AppError::Crypto(
            "Password cannot contain only whitespace".to_string(),
        ));
    }
    Ok(())
}

fn random_array<const N: usize>() -> AppResult<[u8; N]> {
    let mut value = [0u8; N];
    getrandom::fill(&mut value)
        .map_err(|error| AppError::Crypto(format!("Secure random generation failed: {error}")))?;
    Ok(value)
}

fn decode_fixed<const N: usize>(value: &str, label: &str) -> AppResult<[u8; N]> {
    STANDARD
        .decode(value)
        .map_err(|error| AppError::Crypto(format!("Invalid {label}: {error}")))?
        .try_into()
        .map_err(|_| AppError::Crypto(format!("Invalid {label} length")))
}

fn normalize_recovery_code(code: &str) -> String {
    code.chars()
        .filter(|value| value.is_ascii_hexdigit())
        .map(|value| value.to_ascii_uppercase())
        .collect()
}

fn format_recovery_code(bytes: &[u8; 16]) -> String {
    hex::encode_upper(bytes)
        .as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk))
        .collect::<Vec<_>>()
        .join("-")
}

fn recovery_code_id(code: &str) -> String {
    let hash = hex::encode(Sha256::digest(code.as_bytes()));
    hash[..16].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn password_and_recovery_codes_unlock_the_same_vault_key() {
        let (manifest, vault_key, codes) =
            create_manifest("correct horse battery staple").expect("manifest");
        let password_key =
            unlock_with_password(&manifest, "correct horse battery staple").expect("password");
        assert_eq!(&*password_key.copy_bytes(), &*vault_key.copy_bytes());

        let mut recovery_manifest = manifest.clone();
        let recovery_key =
            unlock_with_recovery_code(&mut recovery_manifest, &codes[0]).expect("recovery");
        assert_eq!(&*recovery_key.copy_bytes(), &*vault_key.copy_bytes());
        assert_eq!(recovery_manifest.recovery.len(), 9);
        assert!(unlock_with_recovery_code(&mut recovery_manifest, &codes[0]).is_err());
    }

    #[test]
    fn password_changes_and_recovery_regeneration_invalidate_old_credentials() {
        let (mut manifest, vault_key, old_codes) =
            create_manifest("correct horse battery staple").expect("manifest");
        assert!(unlock_with_password(&manifest, "incorrect password").is_err());

        let key = vault_key.copy_bytes();
        change_password(&mut manifest, &key, "a different secure password")
            .expect("change password");
        assert!(unlock_with_password(&manifest, "correct horse battery staple").is_err());
        assert!(unlock_with_password(&manifest, "a different secure password").is_ok());

        let new_codes =
            regenerate_recovery_codes(&mut manifest, &key).expect("regenerate recovery codes");
        assert!(unlock_with_recovery_code(&mut manifest.clone(), &old_codes[0]).is_err());
        assert!(unlock_with_recovery_code(&mut manifest, &new_codes[0]).is_ok());
    }

    #[test]
    fn encrypted_files_detect_tampering() {
        let key = random_array::<32>().expect("key");
        let encrypted = encrypt_file_content(&key, b"secret").expect("encrypt");
        assert_eq!(
            decrypt_file_content(&key, &encrypted).expect("decrypt"),
            b"secret"
        );
        let mut tampered = encrypted;
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(decrypt_file_content(&key, &tampered).is_err());
    }

    #[test]
    fn chunked_files_round_trip_across_boundaries() {
        let key = random_array::<32>().expect("key");
        let plaintext = (0..(FILE_CHUNK_BYTES * 2 + 37))
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let encrypted = encrypt_file_content(&key, &plaintext).expect("encrypt");
        assert!(encrypted.starts_with(FILE_MAGIC_V2));
        assert_eq!(
            encrypted_file_plaintext_len(&encrypted[..FILE_HEADER_BYTES], encrypted.len() as u64)
                .expect("inspect"),
            Some(plaintext.len() as u64)
        );
        assert_eq!(
            decrypt_file_content(&key, &encrypted).expect("decrypt"),
            plaintext
        );
    }

    #[test]
    fn decrypts_existing_one_megabyte_chunk_files() {
        let key = [7u8; 32];
        let plaintext = vec![b'x'; LEGACY_FILE_CHUNK_BYTES + 17];
        let mut encrypted = Vec::new();
        encrypt_file_stream_with_chunk_bytes(
            &key,
            &mut Cursor::new(&plaintext),
            plaintext.len() as u64,
            LEGACY_FILE_CHUNK_BYTES,
            &mut encrypted,
        )
        .expect("legacy chunk encryption");

        assert_eq!(
            decrypt_file_content(&key, &encrypted).expect("legacy chunk decrypt"),
            plaintext
        );
    }

    #[test]
    fn empty_encrypted_files_are_authenticated() {
        let key = random_array::<32>().expect("key");
        let mut encrypted = encrypt_file_content(&key, &[]).expect("encrypt");
        assert_eq!(
            decrypt_file_content(&key, &encrypted).expect("decrypt"),
            Vec::<u8>::new()
        );
        encrypted.truncate(encrypted.len() - 1);
        assert!(decrypt_file_content(&key, &encrypted).is_err());
    }

    #[test]
    fn manifest_round_trips_without_plaintext_keys() {
        let directory = tempdir().expect("temp directory");
        let (manifest, _, codes) =
            create_manifest("correct horse battery staple").expect("manifest");
        save_manifest(directory.path(), &manifest).expect("save");
        let serialized =
            fs::read_to_string(manifest_path(directory.path())).expect("manifest content");
        assert!(!serialized.contains(&codes[0]));
        assert_eq!(
            load_manifest(directory.path())
                .expect("load")
                .expect("manifest")
                .recovery
                .len(),
            10
        );
    }
}
