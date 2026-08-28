# Vault encryption

#guide #security

Vault encryption is optional. It protects file contents, Denote Trash, and saved
revision contents while leaving filenames and folder structure visible.

## Enable encryption

1. Open **Vault encryption** in the sidebar header.
2. Choose a password with at least 12 characters.
3. Save all ten one-time recovery codes outside the vault.

Files use chunked XChaCha20-Poly1305. The random vault key is wrapped with an
Argon2id password key and independently by each recovery code.

## Lock and recover

Locking, switching vaults, and closing Denote flush pending work and seal the
vault. A recovery code unlocks the vault once and is then removed. Replacing
recovery codes invalidates every unused old code.

## Disable encryption

Denote must decrypt every file and saved revision successfully before it removes
the encryption manifest. Keep `.denote/encryption.json` with encrypted backups
or Git commits; it contains wrapped keys, never the password or plaintext key.

Encryption does not hide paths, sizes, timestamps, or operational metadata, and
cannot erase plaintext from backups or storage snapshots created earlier.

[Next: Editor display](<Editor display.md>)
