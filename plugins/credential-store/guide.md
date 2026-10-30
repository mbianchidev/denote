# Encrypted credential store

## Purpose

Keep service names, usernames, passwords/tokens, URLs, and private entry notes
inside one independently encrypted file, never a Markdown credential table.

## Enablement and permissions

Disabled by default. The isolated credential-store permission opens trusted
host controls. Downloaded plugin code never receives entries, passwords, keys,
clipboard contents, or filesystem access. Enabling does not create a store.

## Usage

Open Credential store from the command palette. Create a master password of at
least 12 characters, independent of whole-vault encryption, or unlock the
existing store. Forgotten passwords cannot be recovered.
Create, edit, delete, search, and sort entries after unlocking. Secrets are
masked until Show and hide automatically. Copy username and Copy secret are
separate actions. Clipboard contents may be read or retained by other apps.

Back up the vault's hidden `.denote/credentials.dncred` file. Encrypted backup
and import retain every field as ciphertext. Replacing a store requires
authentication and explicit confirmation. Plaintext export separately requires
the current master password and a risk confirmation every time. The export
remains plaintext outside Denote's cleanup.

## Settings

Choose the bounded inactivity timeout and clipboard-clear timeout in the host
panel. Lock now ends the session immediately. Application deactivation, vault
lock/switch, plugin removal, and exit also lock it. No password remembrance or
keychain recovery mechanism is silently enabled.

## Disable behavior

Disabling clears the active view and native key, removes plugin code, and
leaves the encrypted credential file intact. Plugin-generated-data cleanup
does not delete it. Turning whole-vault encryption off never decrypts its
independent inner container. Keep the master password and encrypted backup.

## Troubleshooting

Authentication, damaged data, unknown formats, changed files, clipboard failures,
and cancelled transfers are explicit errors, never an empty replacement store.
Preserve a damaged file and restore a verified encrypted backup.
The store uses Argon2id and XChaCha20-Poly1305. All entry fields are encrypted;
the format, random salt/nonce, fixed filename, and padded file size are visible.
Denote does not write entry plaintext into indexes, revisions, logs, or temporary
files. An unlocked device, debugger, clipboard history, screen capture, swap,
or OS crash dump remains outside that guarantee.
