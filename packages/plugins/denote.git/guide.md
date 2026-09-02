# Git vault versioning

## Purpose

This plugin keeps a local Git history of your vault, or of the active project
inside it, without leaving Denote. It adds one source control view that shows
the repository, its working tree changes, its branches, its remotes, and its
latest commits, and it lets you initialize a repository, stage and unstage a
file, and commit what you staged.

Everything in this version is local. The plugin never contacts a network, never
runs a process of its own, and never writes note content.

## Enablement and permissions

Enabling requests these permissions:

- **Commands** registers `Git: Refresh repository` and
  `Git: Initialize repository` in the command surface.
- **Status** shows one short repository state item.
- **Source control** contributes the typed repository view Denote renders
  itself. The plugin supplies data only; it cannot render markup.
- **Project context** scopes the view to the active project when one is marked,
  and to the vault when none is.
- **Git** runs the host's typed Git operations. Denote owns the Git executable,
  the argument templates, and the repository scope; the plugin can only name an
  operation and its structured fields.
- **Automatic local commit** is reserved for scheduled local commits. It is not
  used yet: this version never commits without an explicit action.

The plugin does not request network, process, or workspace-write permission, so
it cannot reach a remote host, run its own executable, or edit your notes.

Enabling alone does not run Git and does not change your vault. The first model
reports that a refresh is required and makes no claim about the repository until
you refresh.

## Usage

Open the Git view from the activity rail, or run `Git: Refresh repository`.

- **Refresh** discovers whether the scope is a repository and, when it is, reads
  status, branches, remotes, the recoverable operation state, and the latest
  commits.
- **Initialize repository** creates a repository in the current scope using the
  configured default branch, then refreshes. Nothing is created until you use
  this action.
- **Stage** and **Unstage** act on the exact file path in the row.
- **Commit staged changes** commits only what is staged, using the message you
  typed and the configured author identity when one is set.
- **Cancel operation** stops the Git operation that is running. It targets the
  operation Denote is actually running, not the one the button was drawn for,
  so a fast sequence cannot leave the button pointing at a step that already
  finished. Cancelling leaves the last known repository state on screen and
  stays retryable, and if nothing matched, the view says so rather than
  appearing to do nothing.

Switching the active project resets the view to the new repository and asks for
a refresh, so results from the previous scope are never shown as if they
belonged to the new one. Switching vaults resets it the same way, even when
neither vault has a project marked, because the two are different repositories
that would otherwise look alike.

Fetch, pull, push, branch switching, branch and remote editing, commit and file
diffs, and conflict resolution are **not implemented yet**. Branches, remotes,
and recent commits are displayed as read-only summary data, and a repository
with a merge, rebase, cherry-pick, or revert in progress is reported so you can
finish it with your own Git tooling.

## Settings

- **Git executable** is an absolute path to Git. Leave it empty to use the Git
  the host finds in its own fixed locations. Denote reads this key itself; the
  plugin never sees or sends an executable path.
- **Default branch** names the branch used by `Git: Initialize repository`. It
  defaults to `main`.
- **Commit author name** and **Commit author email** are optional. When both are
  set, Denote records that identity on commits it creates, overriding repository
  configuration. Leave them empty to use the repository's own Git identity.
- **Automatic commit interval**, in minutes, and **Automatic commit message**
  configure scheduled local commits. The interval defaults to `0`, which
  disables them; scheduled commits are not implemented in this version.
- **Include patterns** and **Exclude patterns** are comma-separated relative
  path prefixes reserved for scheduled commits. Both default to empty.

## Disable behavior

Disabling unregisters the source control view, the status item, and both
commands, unloads the runtime, and deletes the downloaded package. Your
repository, its history, its configuration, and every note stay exactly as they
are: the plugin never deletes a repository and never edits vault content.
Plugin settings remain in Denote's plugin settings store, so re-enabling
restores them.

## Troubleshooting

- **"refresh required" beside the repository name** means no Git command has
  run yet, so Denote is not claiming anything about the repository. Use Refresh.
- **"Not initialized"** after a refresh means this vault or project has no
  repository. Use `Git: Initialize repository`, or open one that already has a
  repository.
- **A Git failure** reports the exit code and Git's own error output, and keeps
  the last stable view on screen. Fix the reported cause, then use Refresh.
- **No Git executable** means Denote could not find Git in its fixed locations.
  Install Git, or set the Git executable setting to an absolute path.
- **Repositories that use a `.git` file**, such as linked worktrees and
  submodules, are refused by the host rather than modified.
- **Encrypted vaults** must be unlocked and pass the host's encryption check
  before Git runs. Content stays encrypted in commits, so line-level diffs of
  encrypted files are not meaningful.
- **A commit that fails with an identity error** needs either the author
  settings above or a Git identity configured in the repository.
