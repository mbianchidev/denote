# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who keep a personal or professional knowledge base in plain Markdown and
want a focused desktop editor without giving up direct ownership of their
files.

## Product Purpose

Denote is a local-first Markdown workspace for macOS, Windows, and Linux. It
opens a user-selected folder as a vault, supports rich single-pane editing, and
keeps navigation, search, metadata, and recovery close to the writing flow.
Success means users can create, find, edit, connect, and recover notes without
moving their content into a proprietary format or hosted service.

## Positioning

Denote combines an Obsidian-like vault and file workflow with a Typora-like
single-pane Markdown editing experience. The selected folder remains the source
of truth while optional workspace metadata is stored locally in SQLite.

## Operating Context

Users work with existing or new folders containing arbitrary files. UTF-8
content opens as text, while binary content opens as a reversible Base64
representation. Notes may mix any Unicode languages and emoji in the same document.
Users commonly switch among several notes, browse folders, search by content
or metadata, follow links, and recover earlier content after an unwanted edit.

## Capabilities and Constraints

- Tauri desktop application with React and TypeScript.
- macOS, Windows, and Linux support.
- A user-selected local folder is the active vault.
- Every installation includes an offline Denote Welcome vault with an editable
  feature tour and task-focused documentation; seeded files are never
  overwritten after creation.
- Up to 50 recently opened vault folders are available from a quick switcher,
  while the native folder picker adds new vaults.
- Previously opened vaults use a cached file tree for immediate switching, then
  refresh disk state and search content in the background. First-time vault
  registration may perform the slower complete scan.
- Non-current user vaults can be removed from the recent list, with a separate
  explicit option to move the folder and all contents to system Trash.
- Every regular file up to 25 MB can be opened and edited.
- Valid UTF-8 content edits as text. Invalid UTF-8 content edits as reversible
  Base64 so unchanged bytes round-trip exactly.
- Source-only programming and markup files use filename-driven CodeMirror
  language support when the language catalog recognizes them.
- Images retain their visual preview and can switch to raw editing.
- Rich single-pane Markdown editing is the default.
- Long rich-text and source documents scroll inside the editor without moving
  the caret to reveal later content.
- Hashtags render as colored pills in rich mode. Each normalized tag has one
  stable default or user-selected color within its vault.
- Each vault keeps one rich-text or source-mode choice across all Markdown files
  and restores it after app restarts unless file safety or display guides require
  source mode.
- File navigation replaces the active tab by default. Explicit blank tabs come
  from Command-T / Control-T or the tab-row plus button and can be reordered by
  pointer or keyboard.
- Tabs can be organized into named collapsible groups. Their context menu can
  close all, other, left, or right tabs, and move tabs between groups.
- Each vault restores its last real file tabs, order, group membership, group
  names, collapse state, and active file by default. This setting is optional
  per vault; temporary blank tabs are never persisted.
- Autosave is available and keeps the previous 10 changed revisions by
  default.
- SQLite stores local workspace metadata, including open, edit, and save
  counters, bookmarks, recent activity, ordering, tag color overrides, trash
  records, and revision history.
- ZBSearch provides local full-text search with filters for tags, filename,
  path, content, file type, bookmarks, and recency.
- The standard Command-F / Control-F shortcut opens vault search; platform
  replace shortcuts remain distinct.
- Command-P / Control-P opens a unified command palette containing contextual
  application actions and their assigned shortcuts. Typing a filename directly
  retains filename-only search across all known available vaults and switches
  vaults before opening a selected result.
- Find and replace works in the current note or across the vault, with a
  selectable preview before vault-wide changes are applied.
- The active file's validated absolute path can be copied to the system
  clipboard from the editor toolbar.
- The active in-memory content or a native attachment-ready file can also be
  copied. Encrypted vault attachments use a temporary plaintext cache file.
- Command-N / Control-N and the file-tree context menu create files or folders
  relative to the current target.
- The vault sidebar width is pointer- and keyboard-resizable and persists across
  launches.
- Files and folders can be pinned above their siblings and manually ordered
  within the pinned or unpinned section of each parent folder.
- Files and folders can move between folders by pointer drag or the
  keyboard-accessible context action. Rename and trash are also available from
  the file-tree context menu.
- External links always use the operating system's default browser or handler;
  the Denote editor window never becomes a web browser.
- Persistent editor settings include a 12–24 px font size shared by rich and
  source editors plus line numbers, spaces and tabs, exact line-ending style,
  and trailing whitespace without modifying content.
- Command/Control `+`, `-`, and `0` increase, decrease, and reset editor text
  size without changing the surrounding application chrome.
- Display guides visibly disable rich/source controls and explain that guides
  must be turned off before mode switching.
- Code blocks, syntax highlighting, gutters, and selections use complete dark
  and light palettes rather than a fixed editor theme.
- Rich-mode fenced code blocks expose a copy action that reads the complete live
  code document rather than only visible lines.
- Vault encryption is optional and encrypts file contents plus saved revision
  contents while leaving paths visible. It uses a password, ten one-time
  recovery codes, and resumable full-vault encryption and decryption.
- Disabling vault encryption requires every encrypted file and revision to be
  decrypted successfully first.
- The core application stays minimal. Additional capabilities are tracked as
  optional plugins rather than bundled into the first release.
- No cloud account, synchronization service, telemetry, or remote content
  storage is part of the initial product.

## Brand Commitments

The product name is Denote. The interface is dark by default and also provides
a persistent light mode. Its interaction model should feel familiar beside
Obsidian and Typora without copying their branding.

## Evidence on Hand

No customer claims, benchmarks, testimonials, or production assets are
available. Future work must not fabricate them.

## Product Principles

1. Files first: the vault on disk is always the durable source of truth, either
   as directly editable content or explicitly enabled ciphertext.
2. Writing stays central: editing should feel immediate and visually calm.
3. Recovery is routine: autosave, history, and trash prevent avoidable loss.
4. Search is local and fast: useful retrieval does not require a server.
5. Capability is optional: advanced workflows belong in explicitly enabled
   plugins.

## Accessibility & Inclusion

Core workflows must be keyboard operable with visible focus, semantic controls,
and accessible names. Text handling must preserve full Unicode content and
emoji without language-specific restrictions.
