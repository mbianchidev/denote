# Git vault versioning

## Purpose

This plugin keeps a Git history of your vault, or of the active project inside
it, without leaving Denote. It adds one source control view that shows the
repository, its working tree changes, its branches, its remotes, and its latest
commits, and it lets you initialize a repository, stage and unstage a file or a
single hunk, commit what you staged, and create, switch, rename, and delete
branches. It can also commit tracked changes for you on a timer.

It now works with remotes too: add, change, and remove a remote, fetch, pull,
push, and clone a repository into a new vault. Every one of those is something
you ask for. Nothing here fetches, pulls, or pushes on its own, and an automatic
commit never touches a remote at all.

The plugin never runs a process of its own and never writes note content.
Denote owns the Git executable, the GitHub CLI, the folder chooser, and every
credential; the plugin only names an operation and its fields.

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
- **Automatic local commit** registers one timed local commit when you set an
  interval above zero. The plugin only describes the schedule; Denote owns the
  timer, the repository, and the commit itself, and the plugin never learns
  where your vault is.

The plugin does not request network, process, or workspace-write permission, so
it cannot open a connection of its own, run its own executable, or edit your
notes. Remote work goes through the same Git permission: Denote runs Git and the
GitHub CLI itself.

Enabling alone does not run Git and does not change your vault. The first model
reports that a refresh is required and makes no claim about the repository until
you refresh. Registering an automatic commit schedule runs no Git command
either: the first automatic commit happens one whole interval later.

## Usage

Open the Git view from the activity rail, or run `Git: Refresh repository`.

- **Refresh** discovers whether the scope is a repository and, when it is, reads
  status, branches, remotes, the recoverable operation state, and the latest
  commits.
- **Initialize repository** creates a repository in the current scope using the
  configured default branch, then refreshes. Nothing is created until you use
  this action.
- **Stage** and **Unstage** act on the exact file path in the row.
- **Open diff** on a changed or staged row shows that file's hunks, with
  **Stage hunk** and **Unstage hunk** where a hunk can safely be applied on its
  own.
- **Commit staged changes** commits only what is staged, using the message you
  typed and the configured author identity when one is set.
- **Cancel operation** stops the Git operation that is running, including a
  clone and a GitHub browse. It targets the
  operation Denote is actually running, not the one the button was drawn for,
  so a fast sequence cannot leave the button pointing at a step that already
  finished. Cancelling leaves the last known repository state on screen and
  stays retryable, and if nothing matched, the view says so rather than
  appearing to do nothing.
- **Last remote operation** reviews what the previous fetch, pull, push, remote
  change, or clone did, and offers Retry where retrying makes sense.

### Remotes

The Branches tab lists every remote with its fetch and push URL, an editable URL
field, and a Remove button, plus a form to add a new remote. The repository
section has Fetch, Pull, and Push, and a remote picker when there is more than
one remote to choose from.

- **Fetch** is explicit. Nothing in this plugin fetches on a timer, on
  activation, or before another action.
- **Pull** and **Push** ask for confirmation first, naming the exact remote and
  branch. A pull can change files in your vault, so Denote saves your open notes
  and holds the workspace while it runs. Push publishes only the branch named in
  the confirmation, and records an upstream the first time a branch is pushed.
- **Only ordinary pushes** are offered. There is no force push, with or without
  a lease.
- **Changing a remote's URL** and **removing a remote** each ask for their own
  confirmation, showing the exact remote name and URL. Removing a remote leaves
  your commits and files untouched.

After every operation the repository is read again, so what is on screen is
never older than the action you just took. When an operation fails, the last
known good state stays on screen and the failure is reported with Git's own
message.

### Signing in to a remote

**Remote authentication** decides how a fetch, pull, push, or clone
authenticates. It is a plugin setting, so you change it in Denote's settings for
this plugin. The Git view shows the configured mode beside the clone form and
never offers to change it there, so what you see is always what the next remote
operation will use.

- **Public repository** uses no credentials at all.
- **SSH agent** uses the agent already running on your machine. Denote never
  prompts, so an agent that is not set up fails with Git's own error instead of
  hanging.
- **GitHub sign-in** uses the GitHub CLI (`gh`) on your machine. Denote resolves
  `gh` itself, asks it for a token, hands that token to Git through a private
  file that only Denote can read, and deletes it as soon as the operation ends,
  whether it succeeded, failed, or was cancelled. The token is never stored in
  plugin settings, never written into your repository's configuration, never put
  into a URL or a command line, and never appears in output, a log, or anything
  this plugin can read. GitHub sign-in only applies to `https://github.com`
  remotes; anything else is refused rather than sent a token. Denote checks the
  URL it will really contact, so a remote that fetches from GitHub but pushes
  somewhere else is refused on push rather than sent your token.

With GitHub sign-in selected, **Browse GitHub repositories** lists the
repositories your `gh` account can reach. Only the name, the HTTPS and SSH URLs,
the default branch, and whether it is private are shown. Selecting one fills in
the clone form.

### Cloning a repository into a vault

**Clone a repository** takes a URL and an optional branch, then asks you to
choose a folder.

- The folder must be **empty**, and must be a real folder rather than a link.
- Closing the chooser cancels the clone and changes nothing.
- Denote clones with hooks, filters, submodules, and unsafe protocols disabled,
  then checks the result before doing anything with it: an ordinary `.git`
  directory, safe repository configuration, no link pointing outside the folder,
  and none of Denote's own control folders arriving as tracked content.
- Only after those checks does Denote close the current vault and open the clone
  as your vault, keeping the origin URL, the branch, and the upstream the clone
  set up. An encrypted clone opens on the usual password and recovery screen, so
  no note is shown before you unlock it.

If a clone does not finish, **the folder is left exactly as it is**. The view
offers Retry and **Clean incomplete clone**. The clean-up asks for its own
confirmation, deletes only that one folder, refuses if the folder is now a live
vault or holds files that did not come from the failed clone, and cannot be used
twice. Nothing is ever cleaned up automatically.

Switching the active project resets the view to the new repository and asks for
a refresh, so results from the previous scope are never shown as if they
belonged to the new one. Switching vaults resets it the same way, even when
neither vault has a project marked, because the two are different repositories
that would otherwise look alike.

### Automatic commits

Set **Automatic commit interval** above zero to commit on a timer. Each run
applies to the same scope the view uses: the active project, or the vault when
none is marked.

Before it commits, Denote saves your open notes and settles pending writes, so
the commit matches what you see. It then commits **only tracked files that
changed** and match your include and exclude prefixes, using your configured
message and author identity. It never adds an untracked file, never touches a
remote, and never switches, merges, or rewrites anything.

A run is skipped, and simply waits for the next interval, when there is no
repository or no commit on `HEAD` yet, when a merge, rebase, cherry-pick, or
revert is in progress, when a conflict is unresolved, when anything is already
staged, when the vault is locked or mid-encryption, when Denote is busy, or when
another automatic run is still going. If nothing eligible changed, the run
reports no changes and creates nothing.

If a run cannot finish, your index is put back exactly as it was, so nothing you
staged by hand is lost or committed by accident. If another Git tool changed the
index while the run was working, Denote leaves that index alone instead and says
so, so a commit or a staged change made elsewhere is never overwritten.
Automatic runs stop when you disable the plugin and when Denote closes. Each
outcome is reported in the status area, and a failure is reported like any other
Denote error.

### Branches

The Branches tab lists every local and remote-tracking branch, and the branch
selector at the top of the view is always there.

- **Create branch** takes a name, a start point — the branch you are on, another
  local branch, or a remote-tracking branch — and an optional *Check out the new
  branch straight away*. Creating without checking out changes nothing in your
  vault.
- **Switch** checks out a local branch.
- **Check out** on a remote-tracking branch creates a local branch that follows
  it. Denote proposes the name by dropping the remote, lets you edit it, and
  tells you when that name already exists instead of quietly reusing an
  existing branch.
- **Rename** and **Delete** work on local branches only. Denote refuses to
  delete the branch you are on.
- Nothing switches on its own. A fetch, a remote update, and starting Denote all
  leave the current branch exactly where it is.

Each of these asks for confirmation first and names the exact branch you are
leaving and the one you are going to. Deleting asks a dangerous confirmation.

### Switching with work in progress

Denote reads the working tree again before every checkout and refuses to run one
that would disturb your work.

- **Unresolved conflicts** stop a checkout outright. Finish or abort that
  operation with your own Git tooling, then refresh.
- **Anything staged, changed, or untracked** produces a review that lists every
  affected path and offers exactly three answers.
  - **Commit all and switch** stages exactly the listed paths and commits them
    with the message you type and your configured author identity.
  - **Stash and switch** puts them in the repository's stash. Untracked files
    are included only when the vault is not encrypted; while an encrypted vault
    has untracked files, stashing is unavailable and the view explains why,
    because stashing them would remove the vault's encryption manifest.
  - **Cancel switch** does nothing at all.

Denote never discards your work. If the checkout still fails after your work was
committed or stashed, the message says exactly where that work is.

After a successful switch, Denote saves your open notes first, then reads the
vault again and reloads every open tab from disk. Panes, tab order, tab groups,
and each tab's language and view choices are kept. Only tabs whose files are not
on the new branch are closed, and Denote names them.

### Staging part of a file

**Open diff** on a changed or a staged file reads that file's diff and shows its
hunks. **Stage hunk** and **Unstage hunk** apply exactly that one hunk of that
one file to the staging area; the file on disk is not touched, and the diff and
the status are read again straight afterwards.

Denote sends the structured hunk, never patch text: the line numbers and the
lines you can see. The host rebuilds the patch for that exact path itself and
applies it to the index alone, so a hunk that does not match leaves the staging
area exactly as it was. A binary, added, deleted, renamed, or copied change has
no matching pair of text sides to split into hunks, so Denote stages it as a
whole file and says so. An untracked file has nothing to compare with yet; stage
it first. An encrypted vault stages whole files as well, because Git records the
ciphertext and a hunk of it is not a change Denote can apply.

Commit and file diffs from history, and conflict resolution, are **not
implemented yet**. Recent commits are displayed as read-only summary data, and a
repository with a merge, rebase, cherry-pick, or revert in progress is reported
so you can finish it with your own Git tooling.

## Settings

- **Git executable** is an absolute path to Git. Leave it empty to use the Git
  the host finds in its own fixed locations. Denote reads this key itself; the
  plugin never sees or sends an executable path.
- **GitHub CLI executable** is the same kind of setting for `gh`, and is used
  only when authentication is set to GitHub sign-in.
- **Remote authentication** is `Public repository`, `SSH agent`, or
  `GitHub sign-in`, and it is set here rather than in the Git view. Only the
  choice is stored. No token, password, or key is ever kept in plugin settings
  or plugin storage.
- **Pull strategy** is `Fast-forward only`, `Merge`, or `Rebase`. Fast-forward
  only never creates a merge commit and never rewrites history, so it is the
  default.
- **Default branch** names the branch used by `Git: Initialize repository`. It
  defaults to `main`.
- **Commit author name** and **Commit author email** are optional. When both are
  set, Denote records that identity on commits it creates, overriding repository
  configuration. Leave them empty to use the repository's own Git identity.
- **Automatic commit interval**, in whole minutes up to 1440, enables scheduled
  local commits. It defaults to `0`, which disables them entirely, and no timer
  exists while it is zero.
- **Automatic commit message** is the message used for each automatic commit.
- **Include patterns** and **Exclude patterns** are comma-separated relative
  path prefixes for automatic commits. An empty include list means the whole
  scope; excludes always win. Prefixes match whole path segments, so `notes`
  covers `notes/alpha.md` but not `notesbook/alpha.md`. A value that is not a
  plain relative prefix, such as an absolute path or one containing `..`, is
  ignored.

Changing any of these settings reloads the plugin so the new values apply
immediately. Nothing is reinstalled and no permission is asked for again.

## Disable behavior

Disabling unregisters the source control view, the status item, both commands,
and any automatic commit schedule, cancels a standing run that is in flight,
stops any Git or GitHub CLI process it started, removes any credential file
those processes were using, drops any clean-up token it was holding, unloads the
runtime, and deletes the downloaded package. Your
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
- **"Choose a remote first"** means the repository has no remote yet. Add one on
  the Branches tab.
- **A fetch, pull, or push that fails to authenticate** usually means the mode
  does not match the remote: a private HTTPS remote needs GitHub sign-in, and an
  SSH remote needs a running agent. Denote never falls back to a prompt.
- **"The GitHub CLI is not authenticated"** means `gh auth login` has not been
  run for this machine, or `gh` is not where Denote looks. Set the GitHub CLI
  executable setting to its absolute path.
- **"GitHub sign-in only applies to https://github.com remotes"** protects the
  token: choose public or SSH agent authentication for that remote instead.
- **A clone that fails** leaves the folder untouched. Retry it, or use Clean
  incomplete clone, which asks for its own confirmation. If the clean-up refuses,
  the folder is no longer the failed clone and Denote will not delete it.
- **"Automatic commit skipped"** names the reason: no repository, no first
  commit yet, an unfinished merge or rebase, an unresolved conflict, changes you
  already staged, or a locked vault. Resolve the reason, and the next interval
  proceeds.
- **"Automatic commit: no changes"** means no tracked file matching your
  patterns had changed, so nothing was committed.
- **No automatic commits at all** usually means the interval is `0`, the vault
  is locked, or the plugin is disabled. The first commit is always one whole
  interval after enabling, unlocking, or switching vault or project.
