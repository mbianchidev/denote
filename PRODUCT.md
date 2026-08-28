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
- Non-current user vaults can be removed from the recent list, with a separate
  explicit option to move the folder and all contents to system Trash.
- Every regular file up to 25 MB can be opened and edited.
- Valid UTF-8 content edits as text. Invalid UTF-8 content edits as reversible
  Base64 so unchanged bytes round-trip exactly.
- Images retain their visual preview and can switch to raw editing.
- Rich single-pane Markdown editing is the default.
- Long rich-text and source documents scroll inside the editor without moving
  the caret to reveal later content.
- Hashtags render as colored pills in rich mode. Each normalized tag has one
  stable default or user-selected color within its vault.
- Each Markdown file keeps its own rich-text or source-mode choice within its
  vault and restores it after app restarts unless file safety or display guides
  require source mode.
- Open tabs can be reordered by direct pointer drag or keyboard without changing
  file order.
- Autosave is available and keeps the previous 10 changed revisions by
  default.
- SQLite stores local workspace metadata, including open, edit, and save
  counters, bookmarks, recent activity, ordering, tag color overrides, trash
  records, and revision history.
- ZBSearch provides local full-text search with filters for tags, filename,
  path, content, file type, bookmarks, and recency.
- The standard Command-F / Control-F shortcut opens vault search; platform
  replace shortcuts remain distinct.
- Command-P / Control-P opens a filename-only quick search across all known
  available vaults and switches vaults before opening a selected result.
- Find and replace works in the current note or across the vault, with a
  selectable preview before vault-wide changes are applied.
- The active file's validated absolute path can be copied to the system
  clipboard from the editor toolbar.
- Files and folders can be pinned above their siblings and manually ordered
  within the pinned or unpinned section of each parent folder.
- External links always use the operating system's default browser or handler;
  the Denote editor window never becomes a web browser.
- Persistent editor display settings can show line numbers, spaces and tabs,
  exact line-ending style, and trailing whitespace without modifying content.
- Code blocks, syntax highlighting, gutters, and selections use complete dark
  and light palettes rather than a fixed editor theme.
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
