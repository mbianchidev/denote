# Architecture

Denote is a Tauri v2 desktop application with a React 19 and TypeScript
frontend plus a Rust native core.

Vite injects the package version and full `git rev-parse HEAD` SHA as compile-time
constants. The About dialog therefore reports the exact desktop artifact build,
not a later runtime checkout or mutable environment value.

## Data boundaries

The selected vault is the content boundary. Every regular file up to 25 MB can
be opened. Markdown (`.md`, `.markdown`, `.mdx`) gets the rich/source editor,
other valid UTF-8 files use the plain editor, and invalid UTF-8 uses a
byte-preserving Base64 representation. Images keep their visual preview and
offer a raw-edit toggle.

Consistent LF, CRLF, and CR files are normalized in the editor and restored to
their original line-ending style when saved. Mixed line endings use Base64 so
no newline information is discarded.

At startup, Rust atomically seeds an embedded **Denote Welcome** folder beside
the application-data database if that folder does not exist. The complete
directory is written to a random staging path and renamed into place, so a crash
cannot expose a partial guide. Existing files are never merged or overwritten.
The vault is registered as the built-in default, used when no valid last vault
exists, and its `Welcome.md` page opens after the workspace is ready.

A versioned marker under `.denote/fixtures` adds the multilingual `test` folder
once to older unencrypted Welcome vaults. Existing `test` entries are preserved,
symlinks are never traversed, and encrypted vaults defer the addition until the
encryption manifest is removed.

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

File contents use chunked XChaCha20-Poly1305. New files use 4 MB chunks to reduce
allocation, AEAD, and write-call overhead; existing 1 MB chunk files remain
readable. Every chunk has a nonce derived from a random per-file prefix and its
chunk index, and
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
timestamps, trash paths, counters, bookmarks, customized tag labels/colors, and
other non-content metadata remain observable. The application-data SQLite file
is not a password vault: revision contents are encrypted, but operational
metadata is not. Encryption also does not protect plaintext already exposed to
another process while the vault is unlocked.

SQLite connections enable secure deletion. Completing initial encryption
checkpoints and truncates the WAL, then vacuums the metadata database so prior
plaintext revision rows are not left in active database pages. This cannot
erase independent backups, filesystem snapshots, journal history, or storage
device remnants created before encryption was enabled.

## SQLite metadata

The application-data database stores:

- known vaults and the most recently opened vault;
- per-note open, edit, and save counters and timestamps;
- each vault's persisted rich-text/source preference;
- serialized file-tree caches for previously opened vaults;
- each vault's restore-tabs preference and validated serialized tab session;
- bookmarks, per-folder pins, and explicit sibling ordering;
- per-vault tag color overrides keyed by normalized tag;
- the previous 10 distinct saved contents per note, encrypted when vault
  encryption is enabled;
- trash records used by restore.

Schema changes are tracked in `schema_migrations`. Markdown remains authoritative
if the metadata database is removed.

Tree ordering is evaluated independently for each parent folder: pinned entries
come first, then explicit custom positions, then the folders-first/name fallback.
The up/down controls reorder only inside the selected entry's pinned or unpinned
section, so ordinary entries cannot move above pins accidentally.

The vault switcher reads the 50 most recently opened rows from SQLite and opens
them by trusted database ID rather than accepting a new arbitrary path from the
frontend. Missing folders remain visible but disabled. Switching uses the same
save/attachment flush barrier as closing the application, clears the prior
vault's tabs and search index, seals an unlocked encrypted source vault before
discarding its key, and then either opens the target workspace or its password
screen.
The built-in guide is always included in this list and labeled separately.
User vaults can be removed from SQLite only, or moved to the operating system
Trash before their metadata is deleted. The current vault, built-in guide,
filesystem and mount roots, shallow system paths, the home folder,
symlinks/reparse points, and ancestors of Denote's application-data directory
are rejected as deletion targets.

A full vault scan serializes the ordered file tree into SQLite. Known-vault open
commands deserialize that cache, overlay current bookmark/pin/order metadata,
and return immediately. The frontend releases the switch barrier without
waiting for content indexing, then performs a generation-guarded full disk scan
and ZBSearch rebuild in the background. Missing or invalid caches fall back to a
full scan once and are replaced. Pending filesystem recovery operations also
force a full scan before a cached tree can be used.

Full tree, search-document, editable-document, and global filename scans run on
Tauri blocking workers after capturing the active vault/key, so they do not hold
the global workspace guard or the native UI thread. Each full tree scan reserves
a per-vault generation in SQLite and updates the cache only if that generation
is still current, preventing an older concurrent scan from replacing newer
results.

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
Index insertion is split into overlapping chunks no larger than roughly 512 KB
and yields to the webview between batches, including for individual files near
the 10 MB search limit.

The index rebuilds when a vault opens and shortly after content or file
structure changes. Search requests keep text, a location glob, and visual filter
state separate. `*` includes every indexed document; glob matching without a
slash targets basenames (`*.html`), while path patterns and exact relative paths
match the full vault-relative path. Existing inline filters are merged with the
visual filter model before result scoring and filtering.

Command-F on macOS and Control-F on Windows/Linux are captured before browser or
CodeMirror find handlers, set the active file as the location, and select that
field. The macOS Option-Command-F and Windows/Linux Control-H replace shortcuts
are evaluated separately and remain unchanged.

Command-P on macOS and Control-P on Windows/Linux opens a unified command
palette. The frontend contributes contextual action descriptors with labels,
categories, keywords, disabled state, and shortcut text. The same input also
filters filename results, while a dedicated command switches to a file-only
view. Rust walks up to 25,000 regular files across the 50 trusted SQLite-known
vault roots, skips unavailable vaults, symlinks, and each internal `.denote`
folder, and never reads file contents. Selecting a file uses its trusted vault
ID, runs the ordinary save-and-seal switch barrier, and opens the relative path
after the target vault is ready. If that vault is encrypted, the path remains
pending until unlock. An explicitly selected palette file takes precedence over
restoring that vault's previous tab session.

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

Exact paired `<!-- toc -->` and `<!-- /toc -->` marker lines are accepted only
around one root link-only list, including nested link-only items. MDXEditor
omits comments from its rich tree, so Denote snapshots list/item order, link
fingerprints, and neighboring block context, then restores only verified marker
boundaries after Rich serialization. Snapshots refresh after each edit.
Switching to Source synchronizes the latest marker-preserving Markdown through a
non-history CodeMirror transaction; subsequent Source edits replace or
invalidate the snapshot so explicit marker deletion remains authoritative.
Other HTML comments stay source-only.

Rendered headings receive deterministic Unicode-aware IDs; duplicates add
numeric suffixes. Internal fragment navigation retries while a newly opened
editor renders, highlights the rich heading when available, and otherwise
selects the matching Markdown heading line in CodeMirror source.

MDX parser messages discard their underlying positional cause, so Denote
replays the MDX JSX/Markdown tokenizer against the reported source to recover a
verified line and column. A stable CodeMirror StateField receives diagnostics
without remounting the editor. Parse failures temporarily select source mode
without writing the vault-wide preference; the error banner can scroll, select,
and focus the marked position. Error state is keyed to the active path and is
discarded when file navigation changes that path.

The editor opts into MDXEditor's full-height flex chain so its rich-text wrapper
owns vertical overflow. Source and plain-file CodeMirror instances keep their
own scroll containers. Long files therefore scroll independently of caret
movement while the workspace shell remains fixed.

Lexical's hashtag entity support recognizes the same NFC-normalized Unicode,
slash, underscore, and hyphen syntax as search indexing. Inline and fenced code
plus escaped hashes remain literal rather than becoming tags. Hashtag nodes
export through the ordinary text visitor, and Denote restores Markdown's
line-leading tag syntax after rich export, so visual pills never alter source.
SQLite stores only explicit per-vault color overrides; deterministic palette
colors cover tags without an override. CSS mixes the chosen color into the
current theme surface while retaining normal theme text, keeping dark and light
contrast stable.

Editor display preferences are stored locally and applied immediately. A
clamped 12–24 px CSS custom property sizes rich Markdown, Markdown source,
programming files, plain text, and binary Base64 while leaving workspace chrome
unchanged. Command/Control `+`, `-`, and `0` update the same persisted setting.
Plain text, binary Base64, and MDX source use a shared CodeMirror surface.
Markdown source mode receives the same CodeMirror extensions. A persisted
two/four-space setting configures CodeMirror's tab width, indentation unit, and
Tab command for Markdown source, plain/programming files, and rich fenced code
blocks; CodeMirror's Escape-then-Tab behavior still provides a keyboard exit.
Line numbers, whitespace markers, trailing-whitespace emphasis, and LF/CRLF/CR
widgets are decorations only; document text and save hashes never include them.
Because rendered rich Markdown has no stable one-to-one source-line mapping,
enabling any guide temporarily constrains Markdown editing to source mode.
Disabled rich/source controls remain visible and point back to the display
settings.

The most recent rich-text/source choice remains the fallback for vaults without
a saved preference. Each vault stores one mode in its SQLite row, and every
Markdown file in that vault receives it. A post-initialization realm write
prevents MDXEditor's previous global cell value from leaking across vaults. A
realm observer records only actual user mode changes; initial source mode
required by unsupported syntax or display guides does not overwrite the vault
preference.

Tab order and named groups are frontend session state. Ordinary file navigation
flushes and replaces the active tab; Command-T / Control-T and the plus button
append an explicit placeholder tab that the next file selection fills. Pointer
events and `Alt-Shift-Left/Right` update the same group-contiguous order used by
activation, `Ctrl-Tab`, bulk close ranges, close-next selection, rendering, and
persistence. Dragging across a group boundary changes the dragged tab's group.
Collapsed groups keep their active tab rendered so keyboard focus and tab
semantics remain valid.

Real file tabs are serialized to SQLite after a 400 ms debounce and at workspace
barriers. The state includes order, group IDs and names, collapsed state, and the
active path; placeholders are excluded. Restore is enabled by default per vault,
loads at most 100 tabs and 50 groups, skips missing files, and clears malformed or
semantically invalid saved state. Explicit cross-vault file opens bypass restore.
Session metadata failures are surfaced but never block saving note content,
closing tabs, switching vaults, or exiting.

Plain UTF-8 files remain source-only. The frontend resolves their filenames
against CodeMirror's language catalog and asynchronously reconfigures a language
compartment, so JavaScript, TypeScript, Python, and other recognized programming
or markup files receive syntax highlighting without remounting the editor.
Rich fenced blocks share a central catalog of common aliases, including `js`,
`ts`, PHP, Java, C/C++, C#, Go, Ruby, Kotlin, Swift, Scala, shell, web, data, and
configuration formats, and autoload the same CodeMirror language support.

Markdown source mode registers a highest-precedence Command-K / Control-K
CodeMirror command. It wraps a range as `[selected text]()` or inserts `[]()` at
a caret without opening a dialog. Rich mode uses MDXEditor's link dialog and
prevents toolbar pointer focus from collapsing the active Lexical selection.

After a short edit debounce, a cancellable Web Worker parses the active UTF-8
document into MDAST to collect and deduplicate inline, autolink, and referenced
HTTP(S) destinations without blocking editor keystrokes. The open-all action
passes them sequentially through the same exact-domain/wildcard policy as
ordinary clicks. Encountering an unknown domain stores the remaining queue in
dialog state; approval resumes it and cancellation discards it. Individual
native-open failures are counted and do not stop later trusted URLs.

The activity rail, resizable vault sidebar, divider, and editor are separate CSS
grid columns. Sidebar width is clamped to 210–480px, updates continuously during
pointer drag, supports arrow/Home/End keys through an ARIA separator, and is
stored in local storage.

Command-N / Control-N resolves the selected folder or selected file's parent and
uses the existing validated create command. The file tree exposes the same
parent-resolution logic through a keyboard-operable contextual menu; right-click
on empty tree space targets the vault root.

Cross-folder moves resolve a folder or vault-root destination inside the
canonical vault, reject self/descendant folder moves and conflicts, then reuse
the rename recovery journal around one filesystem rename plus transactional
metadata path rekeying. The frontend flushes affected tabs first and rewrites
their paths after the move. Pointer capture plus coordinate hit-testing drives
folder/root drop targets; **Move to folder…** is the keyboard alternative.

After a successful rename or move, Rust returns a bounded batch containing only
UTF-8 `.md` and `.markdown` files up to 1 MB each and 32 MB total. A bundled Web
Worker parses those files and rewrites inline links, images, and reference
definitions by resolving against pre-move source paths and recalculating paths
after both source and target moves. MDX is excluded. Updated files use ordinary
hash-checked saves and revision history; oversized, unreadable, truncated, or
conflicting rewrites are surfaced without reverting the completed filesystem
move. A dedicated cross-process link-rewrite lease starts before the filesystem
move and remains held through those saves, preventing another Denote process
from interleaving a second topology change.

Each open tab keeps an in-memory path history and cursor. Ordinary navigation
appends after the cursor and truncates its forward branch. Back/forward loads use
the same serialized save barrier as file selection. Rename/move rekeys history
paths, while trash removes invalid entries. Session persistence intentionally
stores only the current tab layout, not transient navigation history.

All CodeMirror surfaces receive one highest-precedence Denote theme extension.
The extension uses CSS semantic tokens, so editable code blocks, Markdown
source, plain files, gutters, selections, active lines, matching brackets, and
syntax tokens update immediately when the root theme changes. Static `pre` and
inline `code` rendering uses the same code-surface tokens. Rich-mode code-copy
buttons are React portals attached to MDXEditor's code wrappers. Editable blocks
copy `EditorView.state.doc`, not virtualized DOM lines, so off-screen content is
included without changing Lexical or Markdown state.

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
frontend filesystem permission. Copying a file path resolves the selected entry
inside the canonical vault boundary before the native clipboard plugin writes
its absolute path. Every no-scheme link resolves relative to the current note and
stays inside the vault. Hostless local `file:///` links use the associated
desktop application; remote file hosts are rejected.
HTTP(S) schemes are normalized to lowercase and unknown exact domains require
confirmation; trust is local-only and can be exact or wildcard. Mail, telephone,
and custom `scheme://` links use a native validator and opener, with custom
schemes requiring one-time confirmation. `javascript`, `data`, `vbscript`,
`blob`, `about`, and `file` are blocked from that generic URI command. The
content security policy only allows local application code plus the image
sources required for Markdown previews. Encrypted vaults must be unlocked before
content commands receive a data key, and incomplete encryption state blocks
ordinary content operations until the resumable transformation finishes.

Clipboard content copy sends the current in-memory text through the native
clipboard plugin. Attachment copy reconstructs the current file bytes, including
unsaved edits and original line endings, in a UUID-scoped application-cache
folder and places that path on the OS file-list clipboard. Encrypted vault copies
therefore stage plaintext outside the vault with owner-only Unix permissions.
One application-lifetime clipboard context serializes staging, clipboard update,
and cleanup so concurrent copies cannot delete the file currently advertised by
the clipboard. Replacing the clipboard file removes prior staging folders;
startup and future copies prune entries older than 24 hours. Cache roots reject
symlinks/reparse points before cleanup, and partial failures remove the new
private staging directory.
