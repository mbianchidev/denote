# Denote

Denote is a local-first Markdown vault for macOS, Windows, and Linux. It pairs
an Obsidian-like file workspace with a Typora-like rich editor while keeping
the selected folder as the source of truth.

<img width="1710" height="1078" alt="Denote Markdown editor" src="https://github.com/user-attachments/assets/b984fc91-d90b-41b1-a11f-67cc076ae55d" />

## Included

- A built-in **Denote Welcome** vault with a feature-rich welcome page and
  complete in-app usage guide
- Rich single-pane Markdown editing with optional source mode and independent
  scrolling for long files
- Every regular file is editable: UTF-8 as text, binary as reversible Base64
- Supported programming and markup files load filename-based CodeMirror syntax
  highlighting in the source editor
- Image preview with an explicit raw-edit toggle
- Autosave and the previous 10 changed revisions per note
- Local SQLite metadata for open, edit, and save counts
- ZBSearch full-text search with filename, path, content, tag, type, bookmark,
  and recency filters
- Command-P / Control-P filename-only quick open across all known available
  vaults
- Rendered hashtags use consistent colored pills across the vault, with an
  accessible color picker beside each active document tag
- Current-note and vault-wide find and replace with selectable preview
- Current-tab file navigation, explicit Command-T/Control-T blank tabs, named
  collapsible groups, reorderable tabs, bulk tab closing, bookmarks, recent
  files, and search navigation
- Per-vault restoration of the last open files, order, groups, collapsed state,
  and active file, enabled by default and configurable in editor settings
- Recent-vault switcher for separate work, music, and personal folders
- Cached near-instant switching for previously opened vaults, followed by a
  background disk/search refresh
- One-click copying of the active file's content, attachment-ready file, or
  absolute path
- File and folder creation, context-menu rename/move/trash, cross-folder drag,
  per-folder pinning/custom order, trash, and restore
- Command-N file creation plus file/folder creation from the sidebar context menu
- Pointer and keyboard resizing for the persistent vault sidebar width
- Permanent empty-trash action with explicit confirmation
- Table of contents, task lists, tables, code blocks with rich-mode copy buttons,
  images, and links
- Code blocks and syntax highlighting that adapt to dark and light themes
- `>![info]`, `>![warning]`, and `>![danger]` callout blocks
- Mixed Unicode scripts and emoji in the same document
- Persistent editor guides for line numbers, spaces/tabs, line endings, and
  trailing whitespace
- Dark mode by default with persistent light mode
- Optional password-based vault encryption with ten one-time recovery codes
- A typed host contract for separately shipped optional plugins

Files remain in the selected vault. Denote's SQLite database lives in the
operating system's application-data directory.

On first launch, Denote atomically creates **Denote Welcome** beside its
application-data database and opens `Welcome.md`. The seed is embedded in the
desktop app, works offline, and is never applied again while that vault folder
exists, so edits and deletions are preserved.

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

HTTP, HTTPS, email, and telephone links always open through the operating
system's default application. Denote never navigates its editor window to an
external website. Relative vault links continue to open inside Denote.

Editor display settings are available from the editor toolbar. The guides are
visual only and never alter saved text. Plain, binary, and MDX files use the
source editor directly; Markdown switches from rich editing to source mode while
any line-number or invisible-character guide is enabled. Rich/source controls
remain visible but disabled, with guidance to turn the display guides off before
switching modes.

Rendered code, editable fenced blocks, Markdown source, and plain-file source
share the same semantic syntax palette. Theme changes update their backgrounds,
gutters, selections, cursors, and token colors immediately. Rich-mode fenced
blocks include a copy button that reads the complete live CodeMirror document,
including lines outside the rendered viewport.

In rich Markdown mode, hashtags such as `#guide` and `#project/日本語` render as
compact colored pills without changing the saved Markdown. Each tag receives a
stable default color. Use the palette control in the document tag bar to choose
a vault-specific color; the same tag then uses that color in notes and search
results.

Use the vault switcher in the sidebar header, or press
<kbd>Shift</kbd>+<kbd>Command</kbd>+<kbd>O</kbd> on macOS and
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> on Windows or Linux. Denote lists
the 50 most recently opened vault folders and marks unavailable folders without
discarding their history.

Clicking a file opens it in the active tab. Press `Command-T` / `Ctrl-T`, or use
the small plus button after the tabs, before choosing a file when you want
another tab. Tabs can be reordered with direct pointer dragging or
`Alt-Shift-Left/Right`. Right-click a tab to create, rename, or change its named
group, or to close all, other, left, or right tabs. Group headers collapse while
keeping the active document reachable. By default, each vault reopens its last
files with their order, groups, collapsed state, and active file; disable this
per vault in editor settings. Each vault also remembers one rich-text/source
choice for all Markdown files. Non-current, non-default vaults can be removed
from the switcher; an explicit option moves the vault folder and all files to
the operating system Trash.

Previously opened vaults use their SQLite-cached file tree so switching does not
wait for a full folder scan or content index. Denote refreshes the tree and
search index in the background. Opening a vault for the first time can still
take longer when its folder is large.

Use the editor toolbar to copy the current in-memory content, copy the active
file as an attachment, or copy its absolute path. Attachment copy includes
unsaved edits. For encrypted vaults, Denote creates a permission-restricted
temporary plaintext file in its application cache; the previous staged copy is
removed when replaced and stale copies are pruned after 24 hours.

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

New ciphertext uses 4 MB authenticated chunks to reduce per-file encryption
overhead. Existing 1 MB chunk files remain fully supported.

Encryption protects file and revision contents at rest. It intentionally leaves
filenames, folder names, file sizes, timestamps, customized tag labels/colors,
and other non-content SQLite metadata visible. Content is available in
application memory while the vault is unlocked.
Other applications see ciphertext while encryption is enabled. Keep
`.denote/encryption.json` with the vault; backups or Git synchronization must
include it. The optional Git plugin is designed to commit the encrypted on-disk
files, not plaintext. Enabling encryption cannot erase plaintext from backups,
filesystem snapshots, or storage history that already existed.

## Search

Press <kbd>Command</kbd>+<kbd>F</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>F</kbd> on Windows and Linux. Search uses ZBSearch locally.
Filters can be combined with ordinary terms:

```text
release notes tag:work file:"project atlas" path:projects
content:"follow up" bookmarked:true recent:7d
type:markdown
```

Supported filters are `tag:`, `file:`/`filename:`, `path:`/`folder:`,
`content:`, `type:`, `bookmarked:`, and `recent:Nd`.

Press <kbd>Command</kbd>+<kbd>P</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>P</kbd> on Windows and Linux for global quick open.
This searches filenames only across every known available vault. Choosing a
result safely switches vaults when needed, then opens the file; encrypted target
vaults request an unlock first.

## Replace

Press <kbd>Option</kbd>+<kbd>Command</kbd>+<kbd>F</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>H</kbd> on Windows and Linux. Replace can target the
current note or the entire vault. Vault-wide changes show every affected file,
occurrence count, and before/after snippet before applying.

## Create and resize

Press <kbd>Command</kbd>+<kbd>N</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>N</kbd> on Windows and Linux to create a file beside the
current selection or inside the selected folder. Right-click the file tree,
folder, or file for contextual **New file** and **New folder** actions.

Drag the divider beside the vault sidebar to resize it. Focus the divider and
use Left/Right arrows for keyboard resizing; Home resets the default width.

Right-click a file or folder to rename it, move it to another folder, or move it
to trash. Drag files and folders directly onto a folder, or onto empty tree space
for the vault root. The context menu's **Move to folder…** action is the keyboard
equivalent.

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
