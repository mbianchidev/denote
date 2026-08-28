# Denote

Denote is a local-first Markdown vault for macOS, Windows, and Linux. It pairs
an Obsidian-like file workspace with a Typora-like rich editor while keeping
the selected folder as the source of truth.

<img width="1710" height="1078" alt="Denote Markdown editor" src="https://github.com/user-attachments/assets/b984fc91-d90b-41b1-a11f-67cc076ae55d" />

## Included

- Rich single-pane Markdown editing with optional source mode
- Every regular file is editable: UTF-8 as text, binary as reversible Base64
- Image preview with an explicit raw-edit toggle
- Autosave and the previous 10 changed revisions per note
- Local SQLite metadata for open, edit, and save counts
- ZBSearch full-text search with filename, path, content, tag, type, bookmark,
  and recency filters
- Current-note and vault-wide find and replace with selectable preview
- Tabs, bookmarks, recently opened files, and search navigation
- File and folder creation, rename, reorder, trash, and restore
- Permanent empty-trash action with explicit confirmation
- Table of contents, task lists, tables, code blocks, images, and links
- `>![info]`, `>![warning]`, and `>![danger]` callout blocks
- Mixed Unicode scripts and emoji in the same document
- Dark mode by default with persistent light mode
- Optional password-based vault encryption with ten one-time recovery codes
- A typed host contract for separately shipped optional plugins

Files remain in the selected vault. Denote's SQLite database lives in the
operating system's application-data directory.

Files up to 25 MB can be edited regardless of extension. Invalid UTF-8 is shown
as Base64; mixed line-ending files also use Base64 to preserve every byte.
Malformed Base64 is rejected rather than written. Search indexes
file content up to 10 MB, while vault-wide replace can include editable files up
to the full 25 MB limit.

MDX files always remain in source mode so JSX and ESM syntax cannot be
round-tripped through the rich Markdown renderer.

Notes containing raw HTML, footnotes, or math open in source mode by default so
unsupported rich-editor transforms cannot silently rewrite that syntax.
If another application changes an open note, Denote rejects the stale autosave
instead of overwriting the external edit.

## Vault encryption

Vault encryption is optional. When enabled, Denote encrypts every vault content
file, including files in Denote Trash, plus saved revision contents. A random
256-bit vault key is protected by a password and ten independently wrapped,
one-time recovery codes. Save the recovery codes when shown: Denote cannot
recover a lost password without an unused code.

Files are encrypted with chunked XChaCha20-Poly1305 so large files can be
transformed without being loaded fully into memory. The password wrapping key
uses Argon2id. Locking or closing Denote performs a final encryption sweep, and
interrupted encryption or decryption resumes after the next successful unlock.
Disabling encryption always decrypts the complete vault before removing the
encryption manifest.

Encryption protects file and revision contents at rest. It intentionally leaves
filenames, folder names, file sizes, timestamps, and non-content SQLite metadata
visible. Content is available in application memory while the vault is unlocked.
Other applications see ciphertext while encryption is enabled. Keep
`.denote/encryption.json` with the vault; backups or Git synchronization must
include it. The optional Git plugin is designed to commit the encrypted on-disk
files, not plaintext. Enabling encryption cannot erase plaintext from backups,
filesystem snapshots, or storage history that already existed.

## Search

Search uses ZBSearch locally. Filters can be combined with ordinary terms:

```text
release notes tag:work file:"project atlas" path:projects
content:"follow up" bookmarked:true recent:7d
type:markdown
```

Supported filters are `tag:`, `file:`/`filename:`, `path:`/`folder:`,
`content:`, `type:`, `bookmarked:`, and `recent:Nd`.

## Replace

Press <kbd>Option</kbd>+<kbd>Command</kbd>+<kbd>F</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>H</kbd> on Windows and Linux. Replace can target the
current note or the entire vault. Vault-wide changes show every affected file,
occurrence count, and before/after snippet before applying.

## Callouts

```markdown
>![warning]
> This note needs attention.

>![info]
> Markdown works inside the callout.
```

## Development

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 20 or newer, and stable Rust.

```bash
npm install
npm run tauri dev
```

Run the focused checks:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Build a desktop bundle:

```bash
npm run tauri build
```

## Documentation

- [Architecture](docs/architecture.md)
- [Optional plugin host](docs/plugins.md)
