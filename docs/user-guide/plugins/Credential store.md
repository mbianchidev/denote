# Credential store practice

Use invented values for this exercise. Never put a real password in this note.
Opening it does not enable a plugin or create a credential store.

Enable **Encrypted credential store** in **Settings → Plugins**, then choose
**Credential store** in the activity rail or command palette. Create an independent master
password of at least 12 characters. Forgotten master passwords cannot be recovered.

Create a practice entry using service `Practice service`, username
`example-user`, and a fake password such as `not-a-real-credential`.
Give it the invented URL `https://example.invalid/account`.
Try the sidebar table's search, sort, edit without replacing the secret,
explicit show/hide, service/username/secret copy, and confirmed deletion.
Open the service link from its row; new link approval is one-time and never
saves its address to allowed domains. Returning from a browser requires unlocking
again. Use Tab, Shift-Tab, Enter, Space, and Escape.

Choose **Encrypted backup** to preserve the encrypted container. **Plaintext
export** separately asks for the current master password and a risk confirmation.
The exported file is intentionally unencrypted and outside Denote cleanup.

**Lock now**, inactivity, focus loss, vault lock/switch, and plugin removal clear
the view and native key. Clipboard history and OS memory dumps remain outside
Denote's protection.

Disabling never decrypts or deletes `.denote/credentials.dncred`. Keep this hidden
file with the vault and retain its master password.

[Optional plugin guide](<../docs/Optional plugins.md#encrypted-credential-store>)
