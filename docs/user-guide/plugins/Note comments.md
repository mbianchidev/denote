# Note comments practice

Enable **Note comments** in **Settings → Plugins** first. No comment or sidecar
is created merely by opening this file.

The invented lantern needs a wider base.

Select **invented lantern**, open **Comments**, and add a short annotation.
Close Comments and add a new paragraph before the sentence. Reopen Comments:
the unique exact quote should still attach, with its updated source line.

Copy **invented lantern** onto another line. The changed duplicate count should
produce **Orphaned: ambiguous text**, not a guessed attachment. Close Comments,
select the intended range, reopen it, choose **Selected text**, and use
**Attach to selected text**. Resolve and reopen the comment, then try confirmed
deletion using only Tab, Enter, and Space.

Comments live in hidden `.denote/note-comments.json`. Include that file with
vault backups; encrypted backups also need `.denote/encryption.json`.
Disabling the plugin leaves this note and its user-authored comments intact.

[Comment ownership and recovery](<../docs/Optional plugins.md#note-comments>)

#guide #plugins #synthetic
