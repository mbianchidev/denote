# Vault encryption

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

## Git vault versioning

The optional Git plugin commits the ciphertext already stored on disk. Before
status, staging, diffs, commits, or worktree-changing operations, Denote verifies
that the vault is unlocked, encryption is in its stable `encrypted` phase, and
every applicable file passes an encryption sweep. The operation stops if that
check cannot finish.

Keep `.denote/encryption.json` in Git. It contains the wrapped vault key needed
to unlock a clone, but never the password, a recovery code, or the unwrapped
key. Git repository metadata under `.git` remains plaintext and is never
encrypted; this includes paths, refs, commit messages, and repository history.
Automatic commit messages therefore contain no note text or file paths.

Encrypted files are treated as binary by Git. Denote does not show line-level
diffs or write textual conflict markers into ciphertext. Conflict resolution
offers only the complete Base, Ours, or Theirs blob. If a repository already had
plaintext commits before encryption was enabled, those old commits remain
plaintext until you explicitly replace or rewrite that history. Review, archive,
or replace it before publishing when it may contain sensitive content; Denote
never rewrites it automatically.

[Next: Editor display](<Editor display.md>)

#guide #security
