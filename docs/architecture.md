# Architecture

Denote is a Tauri v2 desktop application with a React 19 and TypeScript
frontend plus a Rust native core.

## Data boundaries

The selected vault is the content boundary. Markdown (`.md`, `.markdown`),
plain text (`.txt`), and supported image files stay in that folder.

The Rust core canonicalizes every path, rejects parent traversal and symlink
escapes, hides Denote's internal `.denote` folder, and limits document and image
sizes before reading them into memory.

Deleted entries move to `.denote/trash` inside the vault. The sidebar restore
action returns them to their original path, choosing a non-conflicting restored
name when necessary.

## SQLite metadata

The application-data database stores:

- known vaults and the most recently opened vault;
- per-note open, edit, and save counters and timestamps;
- bookmarks and explicit sibling ordering;
- the previous 10 distinct saved contents per note;
- trash records used by restore.

Schema changes are tracked in `schema_migrations`. Markdown remains authoritative
if the metadata database is removed.

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

Autosave waits 800 ms after the latest change. Before changed content replaces
the file, the prior content is added to SQLite history. Manual save, tab close,
restore, and trash operations use the same native save path.

## Security

Filesystem operations run through dedicated Tauri commands rather than a broad
frontend filesystem permission. External URLs and file paths use the official
Tauri opener plugin. The content security policy only allows local application
code plus the image sources required for Markdown previews.
