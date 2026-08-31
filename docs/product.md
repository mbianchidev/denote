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
opens a user-selected folder as a vault, supports rich editing in up to four
independent panes, and keeps navigation, search, metadata, and recovery close to
the writing flow.
Success means users can create, find, edit, connect, and recover notes without
moving their content into a proprietary format or hosted service.

## Positioning

Denote combines an Obsidian-like vault and file workflow with a Typora-like
focused Markdown editing experience. The selected folder remains the source
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
- The vault root and any existing subfolder can independently be marked or
  unmarked as an explicit project root, a multi-project workspace, or both
  through separate folder/root context actions or command-palette commands.
- Each safe, real direct child folder of a workspace is discovered as an
  implicit project. Nested content belongs to that child project, while files
  directly in the workspace container need a separate explicit project root.
  New direct child folders are discovered automatically.
- Explicit and implicit project roots may be nested. The closest available root
  of the focused file is active, so an explicit nested project wins over its
  workspace child ancestor. No focused project file means no active project.
- The active project appears in the status bar. Workspace child projects keep
  stable local identities through Denote rename/move and can be promoted to
  explicit projects. Unmarking a workspace removes only implicit-only children.
- Missing project and workspace folders remain as unavailable local metadata
  until removed through the command palette. Denote Trash clears affected
  project/workspace metadata; restoring a direct child under a still-marked
  workspace discovers it as a new implicit project.
- When an otherwise unmarked vault root safely contains a `.git` file or
  directory, Denote suggests—but never automatically applies—**Mark as
  project**. **No thanks** permanently dismisses the suggestion for that vault;
  manually marking the root as a project or workspace also dismisses it.
- Every installation includes an offline Denote Welcome vault with an editable
  feature tour and task-focused documentation; seeded files are never
  overwritten after creation.
- A vault can provide a root `.denote.md` welcome page or designate another
  Markdown file locally. The page opens when no saved tab session or explicit
  cross-vault file takes priority.
- The Welcome vault includes a one-time, non-destructive `test` folder covering
  Japanese, Russian, mixed scripts, emoji, punctuation, nested paths, links, and
  highlighted source files.
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
- Rich Markdown editing is the default in every pane.
- Full, collapsed, and shortcut Markdown reference links render and remain
  editable in Rich mode. Definitions stay invisible and retain their exact
  source formatting and ordering.
- `.md` files treat ordinary angle-bracket comparisons and placeholders as
  Markdown text rather than MDX JSX. `.mdx` and `.jsx` remain non-executing,
  JSX-highlighted source files.
- Canonical `<!-- toc -->` / `<!-- /toc -->` blocks containing link-only
  Markdown lists render as tables of contents in Rich mode while
  retaining their generator markers through Rich and Source edits. Other
  comments remain locked to source mode.
- Well-formed `<details>` blocks with a plain `<summary>` line render as native,
  keyboard-operable disclosure sections while preserving Markdown content
  inside. A separately validated README-style subset of paragraphs, headings,
  links, strong text, and local or HTTP(S) images renders as atomic Rich blocks
  while preserving its raw source exactly. Other raw HTML remains source-only.
- Markdown thematic breaks render as consistent full-width document separators.
- Long rich-text and source documents scroll inside the editor without moving
  the caret to reveal later content.
- A tag-only final line renders its hashtags as colored pills in rich mode.
  Each normalized tag has one stable default or user-selected color within its
  vault.
- Each vault keeps one rich-text or source-mode choice across all Markdown files
  and restores it after app restarts unless file safety or display guides require
  source mode.
- File navigation replaces the active tab by default. Explicit blank tabs come
  from Command-T / Control-T or the tab-row plus button and can be reordered by
  pointer or keyboard.
- Tabs can be organized into named collapsible groups. Their context menu can
  close all, other, left, or right tabs, and move tabs between groups or panes.
- Each tab maintains an independent back/forward file-navigation history. New
  navigation after going back truncates that tab's forward branch.
- The editor supports one to four independently focusable and resizable panes.
  Two-pane layouts can be horizontal or vertical; three panes support equal and
  mirrored asymmetric layouts; four panes support grid, horizontal, and
  vertical layouts.
- Dragging a tab over a pane exposes center and edge docking targets. Center or
  empty tab-strip drops move the tab into that pane; edge drops create or
  rearrange the valid pane layout without requiring a separate layout control.
- Tabs retain unsaved edits when moved between panes or when a pane is closed
  into a neighboring pane. Search, commands, links, history, and file actions
  follow the focused pane.
- Each vault restores its pane layout and sizes plus its last real file tabs,
  pane assignments, order, group membership, group names, collapse state,
  focused pane, and active files by default. This setting is optional per vault;
  temporary blank tabs are never persisted.
- Autosave is available and keeps the previous 10 changed revisions by
  default.
- SQLite stores local workspace metadata, including open, edit, and save
  counters, bookmarks, recent activity, ordering, tag color overrides, trash
  records, revision history, stable project/workspace identities and paths, and
  Git-suggestion dismissal. These records never alter vault or project files.
- Denote rename and move operations preserve explicit and implicit project
  identities while updating their paths. Moving a marked folder or its ancestor
  to Denote Trash removes affected project/workspace metadata.
- ZBSearch provides local full-text search with a separate location glob and
  visual filters for tags, filename, path, content, file type, bookmarks, and
  recency.
- Command-F / Control-F opens search with the active file selected in the
  location field and keyboard focus in the search-text field. Every content
  occurrence has its own result and navigates to that exact term. `*` searches
  the vault and patterns such as `*.html` limit results by filename; platform
  replace shortcuts remain distinct.
- Command-P / Control-P opens a unified command palette containing contextual
  application actions and their assigned shortcuts. Typing a filename directly
  retains filename-only search across all known available vaults and switches
  vaults before opening a selected result.
- On macOS, native application menus expose the matching file, search, view,
  pane, and editor actions. Settings opens with Command-comma.
- Find and replace works in the current note or across the vault, with a
  selectable preview before vault-wide changes are applied.
- The active file's validated absolute path can be copied to the system
  clipboard from the editor toolbar.
- A per-file read mode disables editing without changing the file or its
  rich/source presentation.
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
- File context menus can duplicate, bookmark, copy the validated path, open
  version history, open in a new tab, and reveal the file in the operating
  system file manager. The focused file exposes the same menu from a three-dot
  control and closes it when focus changes to another file.
- One file-tree control expands every folder except `.git` and `node_modules`,
  which stay collapsed unless opened directly, or collapses the complete tree.
- Renaming or moving a file/folder updates relative inline links, images, and
  reference definitions in eligible Markdown files; skipped or conflicting
  rewrites are surfaced.
- No-protocol links always resolve relative to the current file inside the vault.
- File and same-file `#heading` fragments navigate to stable rendered heading
  anchors or the matching Markdown source line.
- HTTP(S) links normalize protocol case and require confirmation for unknown
  exact domains. Users can allow one domain or all domains and manage that list
  in Settings.
- The active file can open every unique HTTP(S) link in one queued action that
  pauses at each untrusted domain and resumes after approval.
- Email, telephone, file, and confirmed custom application protocols use the
  operating system handler; dangerous URI schemes remain blocked.
- Command-K / Control-K preserves selected rich text in the link dialog and
  inserts editable Markdown link syntax directly in source mode.
- Persistent editor settings include a 12–24 px font size shared by rich and
  source editors, two- or four-space Tab indentation, line numbers, spaces and
  tabs, exact line-ending style, and trailing whitespace without modifying
  content.
- Command/Control `+`, `-`, and `0` increase, decrease, and reset editor text
  size without changing the surrounding application chrome.
- Display guides visibly disable rich/source controls and explain that guides
  must be turned off before mode switching.
- Files inside an explicit or implicit project temporarily force line numbers.
  Project Markdown uses the byte-preserving source editor so opening a code
  project cannot normalize stored Markdown syntax. Leaving the project or
  removing its governing mark restores the saved line-number setting and vault
  Markdown preference immediately; these constraints never persist as editor
  preferences.
- Markdown parser failures expose line and column details, force a temporary
  source fallback without changing the vault preference, highlight the failing
  line, and provide keyboard-accessible error navigation. Errors remain scoped
  to their file and hide when another file is active; link failures fade
  automatically.
- Code blocks, syntax highlighting, gutters, and selections use complete dark
  and light palettes rather than a fixed editor theme.
- Rich fenced blocks and source files recognize common JavaScript/TypeScript
  aliases plus PHP, Java, C/C++, C#, Go, Ruby, Kotlin, Swift, Scala, shell,
  web, data, and configuration languages.
- Rich-mode fenced code blocks expose a copy action that reads the complete live
  code document rather than only visible lines.
- About Denote exposes the packaged semantic version and immutable Git commit
  hash from both the activity rail and command palette.
- Vault encryption is optional and encrypts file contents plus saved revision
  contents while leaving paths visible. It uses a password, ten one-time
  recovery codes, and resumable full-vault encryption and decryption.
- Disabling vault encryption requires every encrypted file and revision to be
  decrypted successfully first.
- The core application stays minimal. Additional capabilities are tracked as
  optional plugins rather than bundled into the first release.
- Approved plugins may request the additive API version 1 `project-context`
  capability. It exposes only a stable opaque project ID, a vault-relative root,
  and context-change events, never an absolute path or editor implementation.
- Plugin command leases capture the current project identity. Existing bounded
  process execution validates that identity again and uses the current project
  root as its working directory. Persistent terminal and language-server APIs
  remain separate future plugin work.
- **Settings → Plugins** shows a non-blocking **Code tooling** recommendation
  only when the focused file has an active explicit or implicit project. Git,
  Terminal, Language server, Linter, Compiler, and Code navigation roles show
  unavailable, disabled, or enabled status; Denote never downloads or enables
  them automatically, and core project behavior does not depend on plugins.
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
accessible names, and screen-reader status updates. Separate folder project and
workspace actions are available with Shift-F10 or the Context Menu key;
whole-vault and unavailable project/workspace roots remain operable through the
command palette. Text handling must preserve full Unicode content and emoji
without language-specific restrictions.
