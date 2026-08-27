# Architecture

Denote is a Tauri v2 desktop application with a React 19 and TypeScript
frontend plus a Rust native core.

## Data boundaries

The selected vault is the content boundary. Markdown (`.md`, `.markdown`),
plain text (`.txt`), and supported image files stay in that folder.

The native folder picker establishes the active vault inside Rust. Later IPC
commands do not accept arbitrary vault roots. The Rust core canonicalizes every
path, rejects parent traversal and symlink/reparse-point escapes, hides Denote's
internal `.denote` folder, and limits document and image sizes before reading
them into memory.

Deleted entries move to `.denote/trash` inside the vault. The sidebar restore
action returns them to their original path, choosing a non-conflicting restored
name when necessary. Empty Trash permanently removes both hidden files and
their plugin-free metadata after explicit confirmation.

## SQLite metadata

The application-data database stores:

- known vaults and the most recently opened vault;
- per-note open, edit, and save counters and timestamps;
- bookmarks and explicit sibling ordering;
- the previous 10 distinct saved contents per note;
- trash records used by restore.

Schema changes are tracked in `schema_migrations`. Markdown remains authoritative
if the metadata database is removed.

Rename, trash, and restore operations are recorded in a recovery journal before
the filesystem move. Opening or refreshing a vault reconciles any operation
interrupted between the move and metadata commit.

## Search

Rust scans readable text documents and returns normalized search documents.
The frontend builds an in-memory ZBSearch index. ZBSearch provides ranked,
typo-tolerant full-text retrieval; Denote applies metadata filters and a Unicode
substring fallback so mixed-script queries still find local content.

The index rebuilds when a vault opens and shortly after content or file
structure changes.

## Editing

MDXEditor provides rich single-pane Markdown editing and a source fallback.
Denote translates its compact callout syntax to Markdown directives while the
editor is active and back to `>![type]` blocks before saving.

Autosave waits 800 ms after the latest change. Saves are serialized per note;
tab close, vault switch, restore, trash, and application close all wait for the
latest content to reach disk and stop if persistence fails. Before changed
content replaces the file, the prior content is committed to SQLite history.
The replacement itself uses a same-directory atomic write.

Window close and application-level quit requests use the same frontend flush
barrier, including macOS Dock Quit and Command-Q.

Each save includes the hash of the version originally read. A mismatched hash
surfaces a conflict rather than overwriting edits from another application or
Denote process. A per-note cross-process lock keeps validation and replacement
in one critical section. On Unix systems, extended attributes are copied to the
atomic replacement before commit.

## Security

Filesystem operations run through dedicated Tauri commands rather than a broad
frontend filesystem permission. External URLs and file paths use the official
Tauri opener plugin. The content security policy only allows local application
code plus the image sources required for Markdown previews.
