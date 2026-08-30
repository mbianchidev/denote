# Denote

Denote is a local-first Markdown vault for macOS, Windows, and Linux. It pairs
an Obsidian-like file workspace with a Typora-like rich editor while keeping
the selected folder as the source of truth.

<img width="1710" height="1078" alt="Denote Markdown editor" src="https://github.com/user-attachments/assets/b984fc91-d90b-41b1-a11f-67cc076ae55d" />

## Included

- A built-in **Denote Welcome** vault with a feature-rich welcome page and
  complete in-app usage guide plus multilingual edge-case fixtures
- Rich single-pane Markdown editing with optional source mode and independent
  scrolling for long files
- Every regular file is editable: UTF-8 as text, binary as reversible Base64
- Supported programming and markup files load filename-based CodeMirror syntax
  highlighting in the source editor
- Image preview with an explicit raw-edit toggle
- Autosave and the previous 10 changed revisions per note
- Local SQLite metadata for open, edit, and save counts
- ZBSearch full-text search with a separate file/path glob, keyboard-accessible
  visual filters for filename, path, content, tag, type, bookmark, and recency
- Command-P / Control-P command palette with contextual actions, visible
  shortcuts, and filename-only search across all known available vaults
- Rendered hashtags use consistent colored pills across the vault, with an
  accessible color picker beside each active document tag
- Current-note and vault-wide find and replace with selectable preview
- Current-tab file navigation, explicit Command-T/Control-T blank tabs, named
  collapsible groups, reorderable tabs, bulk tab closing, bookmarks, recent
  files, and search navigation
- Per-tab back/forward file history with branching and move/delete-safe path
  updates
- Per-vault restoration of the last open files, order, groups, collapsed state,
  and active file, enabled by default and configurable in editor settings
- Recent-vault switcher for separate work, music, and personal folders
- Cached near-instant switching for previously opened vaults, followed by a
  background disk/search refresh
- One-click copying of the active file's content, attachment-ready file, or
  absolute path
- File and folder creation, context-menu rename/move/trash, cross-folder drag,
  automatic relative Markdown-link rewrites, per-folder pinning/custom order,
  trash, and restore
- Command-N file creation plus file/folder creation from the sidebar context menu
- Pointer and keyboard resizing for the persistent vault sidebar width
- Permanent empty-trash action with explicit confirmation
- Table of contents, task lists, tables, code blocks with rich-mode copy buttons,
  images, and links
- Generated `<!-- toc -->` / `<!-- /toc -->` link lists render as labeled Rich
  mode navigation panels while their exact markers survive Rich and Source edits
- Thematic breaks such as `---` render as full-width document separators
- Command-K / Control-K link creation that wraps rich-text selections or inserts
  Markdown link syntax directly in source mode
- File and same-page heading anchors with retrying rich/source navigation
- One action to open every unique HTTP(S) link in the active file through the
  existing external-domain trust flow
- Code blocks and source files with adaptive highlighting for JavaScript,
  TypeScript, PHP, Java, C/C++, C#, Go, Python, Ruby, Kotlin, Swift, Scala,
  shells, web formats, and more
- `>![info]`, `>![warning]`, and `>![danger]` callout blocks
- Mixed Unicode scripts and emoji in the same document
- Persistent 12–24 px editor font sizing with Command/Control `+`, `-`, and `0`
  zoom shortcuts
- Persistent editor guides for line numbers, spaces/tabs, line endings, and
  trailing whitespace
- Persistent two- or four-space Tab indentation across source and code editors
- Markdown parser errors with line/column reporting, highlighted source, and a
  **Navigate to error** action
- Dark mode by default with persistent light mode
- About Denote dialog with the packaged version and exact Git commit hash
- Optional password-based vault encryption with ten one-time recovery codes
- A typed host contract for separately shipped optional plugins

Files remain in the selected vault. Denote's SQLite database lives in the
operating system's application-data directory.

On first launch, Denote atomically creates **Denote Welcome** beside its
application-data database and opens `Welcome.md`. The seed is embedded in the
desktop app, works offline, and is never applied again while that vault folder
exists, so edits and deletions are preserved.

The guide also includes a `test` folder with Japanese, Russian, mixed-script,
emoji, punctuation, nested-path, link, and source-code fixtures. Existing
unencrypted Welcome vaults receive this folder once without replacing any
existing `test` entry; encrypted guide vaults receive it after decryption.

Files up to 25 MB can be edited regardless of extension. Invalid UTF-8 is shown
as Base64; mixed line-ending files also use Base64 to preserve every byte.
Malformed Base64 is rejected rather than written. Search indexes
file content up to 10 MB, while vault-wide replace can include editable files up
to the full 25 MB limit.

MDX files always remain in source mode so JSX and ESM syntax cannot be
round-tripped through the rich Markdown renderer.

Notes containing raw HTML, footnotes, or math remain locked in source mode so
unsupported rich-editor transforms cannot silently rewrite that syntax.
Ordinary `.md` files use standard Markdown angle-bracket rules, so comparisons,
hearts, and placeholders such as `<100k`, `<3`, and `<account-slug>` remain
literal text. `.mdx` and `.jsx` stay source-only with JSX-aware highlighting and
are never executed.
Canonical paired TOC marker comments are the only HTML-comment exception: the
block must contain one link-only Markdown list. Lone, altered, mixed-content, or
other comments remain source-only.
If another application changes an open note, Denote rejects the stale autosave
instead of overwriting the external edit.

Links without a protocol always resolve inside the vault relative to the current
file, including `../` paths and image files. HTTP and HTTPS schemes are
normalized to lowercase before opening. Unknown web domains require confirmation
before Denote uses the operating system browser; allow one exact domain or all
domains, then manage the list in **Settings**. Email, telephone, hostless local
`file:///`, and confirmed custom `app-name://` links use the operating system
handler. Remote file hosts and dangerous schemes such as `javascript:`, `data:`,
and `vbscript:` are blocked.

Heading fragments remain inside Denote. A link such as
`[About](Welcome.md#what-is-denote)` opens the file and highlights the matching
heading; `[#section](#section)` works in the current file. Duplicate heading
anchors receive stable `-1`, `-2`, and later suffixes.

Editor settings are available from the editor toolbar. Font size applies
immediately to rich text, Markdown source, programming files, plain text, and
Base64 editors, and persists across launches. Use `Command/Ctrl +`, `-`, or `0`
to increase, decrease, or reset it. Choose two- or four-space indentation for
Tab in Markdown source, plain/programming editors, and rich fenced code blocks.
Press Escape then Tab to move focus out of a CodeMirror editor. Display guides
are visual only and never alter saved text. Plain, binary, and MDX files use the
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

Each tab keeps its own navigation history. Use the back and forward arrows beside
the tabs to revisit files opened in that tab. Opening a new file after going back
discards only that tab's forward branch.

Use `Command-K` / `Ctrl-K` to create a link. Rich mode opens the link dialog and
keeps highlighted text as the anchor. Source mode immediately wraps highlighted
text as `[text]()` or inserts `[]()` with the caret ready for typing. When the
active file contains HTTP(S) links, use **Open all external links** in the editor
toolbar or command palette. URLs are deduplicated, trusted domains open directly,
and unknown domains pause the queue for confirmation.

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
<kbd>Ctrl</kbd>+<kbd>F</kbd> on Windows and Linux. Search uses ZBSearch locally
and selects the active file in **Where to search**. Replace it with `*` for the
whole vault, an exact relative path for one file, or a glob such as `*.html`.

The separate search-text field accepts ordinary terms. Open **Filters** for
keyboard-accessible tag, file type, recency, bookmark, filename, path, and
content controls. Inline filter syntax remains available:

```text
release notes tag:work file:"project atlas" path:projects
content:"follow up" bookmarked:true recent:7d
type:markdown
```

Supported filters are `tag:`, `file:`/`filename:`, `path:`/`folder:`,
`content:`, `type:`, `bookmarked:`, and `recent:Nd`.

If Markdown cannot be parsed, Denote reports the line and column, switches to
source safely without changing the vault-wide mode preference, highlights the
line and character, and offers **Navigate to error**. The error stays attached
to that file: switching files hides it, returning shows it again, and fixing or
dismissing it clears it. Link-navigation failures use a short fading alert.

Press <kbd>Command</kbd>+<kbd>P</kbd> on macOS or
<kbd>Ctrl</kbd>+<kbd>P</kbd> on Windows and Linux for the command palette.
It lists available commands, shows each assigned shortcut, and filters by title,
description, category, and keywords. Type a filename directly, or choose
**Find file across vaults**, to search filenames only across every known
available vault. Choosing a file safely switches vaults when needed; encrypted
targets request an unlock first.

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
equivalent. After a rename or move, Denote updates relative inline links, images,
and reference definitions in small UTF-8 Markdown files. Large, unreadable, or
conflicting files are reported instead of being changed silently.

## Callouts

```markdown
>![warning]
> This note needs attention.

>![info]
> Markdown works inside the callout.
```

## Development

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 24.15 or newer, and stable Rust.

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
