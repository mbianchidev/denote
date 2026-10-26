# Note comments

## Purpose

Keep local whole-note and text-range comments without adding annotation markers
to Markdown. This is not a hosted discussion or real-time collaboration
service. The plugin is optional and off by default.

## Enablement and permissions

Enable Note comments in Settings → Plugins. Note comments permission grants
bounded source-anchor processing. The host alone reads and atomically saves the
vault-owned sidecar after an explicit comment action. The worker receives
source and anchors, not comment bodies, a filesystem path, or encryption keys.

## Usage

Open a Markdown note and choose Comments, or Command-Option-M on macOS /
Ctrl-Alt-M on Windows and Linux. Select text first to attach a range; otherwise
choose Whole note. Enter a comment and choose Add comment.

Each row offers Edit, Resolve/Reopen, confirmed Delete, and Show text when its
range is still attached. Open and Resolved are separate views. Orphaned finds
ranges whose original text is missing or ambiguous. To reattach, close Comments,
select the intended text, reopen Comments, choose Selected text, then Attach to
selected text. Attach to whole note explicitly removes the range anchor.

Re-anchoring requires an exact quote and unchanged duplicate count. A unique
quote can move after nearby edits. Repeated quotes additionally require one
unambiguous original prefix/suffix context. Changed counts and indistinguishable
matches become orphans; the plugin never chooses a nearest-looking match.
Re-anchoring for display does not write a note or the sidecar.

Comments belong to exact vault-relative paths, not copied note contents.
Renaming or moving a note does not guess a new owner. Open Comments → Other
notes in the destination and explicitly attach its retained comments. Deleting
a note retains its comments for recovery; reusing the original path exposes
that path's retained records. Duplicating a note does not copy its comments.

## Settings

There are no plugin settings. A vault can hold 500 comments in a 2 MiB sidecar.
Each body and quoted selection is at most 4 KiB; source is at most 4 MiB.

## Disable behavior

Disabling removes downloaded code and derived anchors, not comments or notes.
Delete saved plugin data does not delete this user-authored vault sidecar.
Delete individual comments explicitly if needed.

Back up the entire vault, including hidden `.denote/note-comments.json`.
Its UTF-8 JSON format has schemaVersion 1, owner `denote.note-comments`, and a
notes mapping from relative Markdown paths to comment arrays. Records contain
id, body, anchor or null, resolved, createdAt, and updatedAt. Anchors retain
from/to UTF-16 offsets in the host's normalized source, quote, prefix, suffix,
and matchCount; original disk line endings stay unchanged. Timestamps
are Unix milliseconds. Unknown versions, owners, fields, or corrupt data are
refused without resetting or overwriting the file.

In encrypted vaults the sidecar is authenticated ciphertext under the existing
vault key, including during initial encryption and unlock sweeps. Include
`.denote/encryption.json` with encrypted backups. No decrypted temporary sidecar
is created. Locking or switching vaults closes the view and stops its worker.

## Troubleshooting

A failed save keeps the draft and error visible. Reload comments after a sidecar
conflict, then retry against the current records. A note conflict must be
resolved before saving comments. The host flushes the current note and checks
both its saved hash and the sidecar hash, so neither external edit is silently
overwritten. For corrupt or future-format sidecars, preserve the file and
restore a valid backup; enabling the plugin never replaces it with an empty one.
