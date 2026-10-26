# History, trash, and recovery

## Autosave and counters

Autosave runs about 800 milliseconds after the latest edit. SQLite metadata
tracks how many times each file was opened, edited, and saved.

## Revision history

Denote keeps the previous ten distinct saved contents per file. Open **History**
from the editor toolbar to inspect previews and restore a revision. Restoring
also preserves the content being replaced as another revision.

## Trash

Delete moves files and folders into hidden Denote Trash inside the vault.
Restore returns an item to its original location, choosing a safe non-conflicting
name if necessary. **Empty Trash** permanently removes its contents.

Saves use same-directory atomic replacement. If another application changes an
open file, Denote reports a conflict instead of overwriting that edit.

## Back up note comments

Optional Note comments stores user-authored annotations in hidden
`.denote/note-comments.json`. Note revision history does not contain this
sidecar. Include it when copying, archiving, synchronizing, or backing up the
vault. In encrypted vaults it is ciphertext; retain `.denote/encryption.json`
alongside it.

Comments are owned by exact relative note paths. Renamed/moved notes recover
their annotations through **Comments → Other notes** and explicit reattachment.
Deleted notes retain comments; reusing an old path exposes its retained
records. Disabling the plugin or clearing generated plugin data never removes
annotations. Corrupt or unsupported sidecars are preserved rather than reset;
restore a valid backup before retrying.

## Git history and interrupted operations

The optional Git plugin keeps repository history separate from Denote's ten
saved revisions. Its History tab pages through commits and shows bounded,
read-only commit diffs. Denote revisions remain available even when a file has
not been committed.

An interrupted merge, rebase, cherry-pick, or revert stays in Git's repository
state across refresh, restart, cancellation, or crash. The plugin detects it and
offers only the valid Continue, Skip, or Abort controls. Unresolved text files
open in a three-way Base/Ours/Theirs editor; binary and encrypted files use
whole-file choices. Resolving one file never marks another resolved.

[Next: Vault encryption](<Vault encryption.md>)

#guide #recovery
