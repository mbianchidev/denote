# Architecture

Denote is a Tauri v2 desktop application with a React 19 and TypeScript
frontend plus a Rust native core.

## Data boundaries

The selected vault is the content boundary. Every regular file up to 25 MB can
be opened. Markdown (`.md`, `.markdown`, `.mdx`) gets the rich/source editor,
other valid UTF-8 files use the plain editor, and invalid UTF-8 uses a
byte-preserving Base64 representation. Images keep their visual preview and
offer a raw-edit toggle.

Consistent LF, CRLF, and CR files are normalized in the editor and restored to
their original line-ending style when saved. Mixed line endings use Base64 so
no newline information is discarded.

The native folder picker establishes the active vault inside Rust. Later IPC
commands do not accept arbitrary vault roots. The Rust core canonicalizes every
path, rejects parent traversal and symlink/reparse-point escapes, hides Denote's
internal `.denote` folder, and limits document and image sizes before reading
them into memory.

Deleted entries move to `.denote/trash` inside the vault. The sidebar restore
action returns them to their original path, choosing a non-conflicting restored
name when necessary. Empty Trash permanently removes both hidden files and
their plugin-free metadata after explicit confirmation.

## Vault encryption

Encryption is a vault-level, optional state. Denote generates a random 256-bit
data key and stores only wrapped copies in `.denote/encryption.json`. The
password wrapper uses Argon2id with a per-vault salt. Ten high-entropy,
one-time recovery codes each have an independent salt and wrapped copy of the
same data key. Successfully using a recovery code removes its slot from the
manifest before the vault is unlocked.

File contents use chunked XChaCha20-Poly1305 with 1 MB chunks. Every chunk has a
nonce derived from a random per-file prefix and its chunk index, and
authenticates the file header and index as additional data. Streaming
transforms use the same atomic replacement path as ordinary saves, so large
files do not need to fit in memory. Existing version-one whole-file ciphertext
remains readable.

The manifest records `encrypting`, `encrypted`, or `decrypting`. Each file and
history row is transformed atomically and checked before work is repeated, so
an interrupted operation resumes after password or recovery-code unlock.
The manifest is removed only after every encrypted file and history record has
been decrypted. Denote Trash is encrypted with the rest of the vault; only the
manifest and internal lock files remain plaintext control data.

The unwrapped data key lives only in zeroizing native memory while the vault is
unlocked. Search, previews, history, saves, and attachments cross the native
boundary as plaintext only after unlock. Tabs, history previews, replace
previews, and the in-memory search index are cleared when the vault locks.
Unlock, explicit lock, and application exit also sweep files created externally
while Denote was not actively writing.

Paths are intentionally not encrypted. Filenames, folder structure, file sizes,
timestamps, trash paths, counters, bookmarks, and other non-content metadata
remain observable. The application-data SQLite file is not a password vault:
revision contents are encrypted, but operational metadata is not. Encryption
also does not protect plaintext already exposed to another process while the
vault is unlocked.

SQLite connections enable secure deletion. Completing initial encryption
checkpoints and truncates the WAL, then vacuums the metadata database so prior
plaintext revision rows are not left in active database pages. This cannot
erase independent backups, filesystem snapshots, journal history, or storage
device remnants created before encryption was enabled.

## SQLite metadata

The application-data database stores:

- known vaults and the most recently opened vault;
- per-note open, edit, and save counters and timestamps;
- bookmarks, per-folder pins, and explicit sibling ordering;
- the previous 10 distinct saved contents per note, encrypted when vault
  encryption is enabled;
- trash records used by restore.

Schema changes are tracked in `schema_migrations`. Markdown remains authoritative
if the metadata database is removed.

Tree ordering is evaluated independently for each parent folder: pinned entries
come first, then explicit custom positions, then the folders-first/name fallback.
The up/down controls reorder only inside the selected entry's pinned or unpinned
section, so ordinary entries cannot move above pins accidentally.

Rename, trash, and restore operations are recorded in a recovery journal before
the filesystem move. Opening or refreshing a vault reconciles any operation
interrupted between the move and metadata commit.

## Search

Rust scans regular files up to 10 MB and returns normalized search documents.
Binary content is indexed in its Base64 representation. Unreadable files are
reported and skipped individually; the automatic index stops at a 64 MB
aggregate content budget.
The frontend builds an in-memory ZBSearch index. ZBSearch provides ranked,
typo-tolerant full-text retrieval; Denote applies metadata filters and a Unicode
substring fallback so mixed-script queries still find local content.

The index rebuilds when a vault opens and shortly after content or file
structure changes.

## Replace

Replace previews are calculated from Markdown source rather than rendered
editor text. Current-file replacement uses the open tab content. Vault-wide
replacement flushes open tabs first, then previews all editable files up to 25
MB, including Base64 binary content.
Each selected file is saved with its preview-time content hash, so files changed
externally after preview fail individually instead of being overwritten.

## Editing

MDXEditor provides rich single-pane Markdown editing and a source fallback.
Denote translates its compact callout syntax to Markdown directives while the
editor is active and back to `>![type]` blocks before saving.

Editor display preferences are stored locally and applied immediately. Plain
text, binary Base64, and MDX source use a shared CodeMirror surface. Markdown
source mode receives the same CodeMirror extensions. Line numbers, whitespace
markers, trailing-whitespace emphasis, and LF/CRLF/CR widgets are decorations
only; document text and save hashes never include them. Because rendered rich
Markdown has no stable one-to-one source-line mapping, enabling any guide
temporarily constrains Markdown editing to source mode.

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
atomic replacement before commit. On Windows, Denote writes and syncs a sibling
temporary file, then uses `ReplaceFileW` so replacement stays atomic while
preserving ACLs, DOS attributes, and alternate data streams.

## Security

Filesystem operations run through dedicated Tauri commands rather than a broad
frontend filesystem permission. External URLs and file paths use the official
Tauri opener plugin. Copying a file path resolves the selected entry inside the
canonical vault boundary before the native clipboard plugin writes its absolute
path. The content security policy only allows local application code plus the
image sources required for Markdown previews. Encrypted vaults must be unlocked
before content commands receive a data key, and incomplete encryption state
blocks ordinary content operations until the resumable transformation finishes.
