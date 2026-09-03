# Git vault versioning

## Purpose

This plugin keeps a Git history of your vault and configured projects without
leaving Denote. It adds one source control view that lists every safe detected
repository, then shows the selected repository's working tree changes, branches, remotes, and commit
history, and it lets you initialize a repository, stage and unstage a file or a
single hunk, commit or commit-and-push what you staged, create, switch, rename,
and delete local or remote branches, and review a commit's own diff. It can also
commit tracked changes for you on a timer.

It now works with remotes too: add, change, and remove a remote, fetch, pull,
push, and clone a repository into a new vault. Every one of those is something
you ask for. Nothing here fetches, pulls, or pushes on its own, and an automatic
commit never touches a remote at all.

The plugin never runs a process of its own. Denote owns the Git executable, the
GitHub CLI, the folder chooser, every credential, and every repository write;
the plugin only names an operation and its typed fields.

## Enablement and permissions

Enabling requests these permissions:

- **Commands** registers `Git: Refresh repository` and
  `Git: Initialize repository` in the command surface.
- **Status** shows one short repository state item.
- **Source control** contributes the typed repository view Denote renders
  itself. The plugin supplies data only; it cannot render markup.
- **Project context** supplies host-issued identities for the vault and configured
  projects that contain safe `.git` markers. The plugin receives labels and
  opaque IDs for inactive repositories, not their paths.
- **Git** runs the host's typed Git operations. Denote owns the Git executable,
  the argument templates, and the repository scope; the plugin can only name an
  operation and its structured fields.
- **Automatic local commit** registers one timed local commit when you set an
  interval above zero. The plugin only describes the schedule; Denote owns the
  timer, the repository, and the commit itself, and the plugin never learns
  where your vault is.

The plugin does not request network, process, or workspace-write permission, so
it cannot open a connection of its own, run its own executable, or arbitrarily
edit your notes. Remote work and an explicitly submitted conflict resolution go
through the Git permission: Denote validates and performs the exact operation.

Enabling does not change your vault. After the provider is registered, Denote
runs one read-only refresh so the first Git view already shows repository
status. Registering an automatic commit schedule runs no Git command: the first
automatic commit happens one whole interval later.

## Usage

Open the Git view from the activity rail, select a repository under
**Repositories**, or run `Git: Refresh repository`.

- **Refresh** discovers whether the scope is a repository and, when it is, reads
  status, branches, remotes, the recoverable operation state, and the latest
  commits.
- **Initialize repository** creates a repository in the current scope using the
  configured default branch, then refreshes. Nothing is created until you use
  this action.
- **Stage** and **Unstage** act on the exact file path in the row.
- **Stage all changes** adds every eligible changed or untracked path, and
  **Unstage all changes** resets every staged path.
- **Restore** replaces one tracked staged or unstaged file with the current
  upstream version. **Restore from remote** applies to all tracked changes.
  Both ask for dangerous confirmation and never delete untracked files.
- **Open diff** on a changed or staged row shows that file's hunks, with
  **Stage hunk** and **Unstage hunk** where a hunk can safely be applied on its
  own. The patch opens as a read-only temporary `.diff` tab in the main editor,
  rendered with Pierre Diffs; it is never written into the vault or restored
  next session.
- **Open file** on a changed row, or on a file inside a commit, opens that note
  in the editor.
- **Refresh history**, **Previous**, and **Next** read one bounded page of
  commits at a time; selecting a commit shows its details and its exact diff.
- **Commit** records only what is staged. **Commit and push** records the same
  commit and then performs an ordinary push to the selected remote. The
  per-commit **Sign commit** control is enabled by default and can be turned off.
  Its password field is shown only while signing is requested, applies only to
  encrypted SSH signing keys, is consumed once, and is never stored or sent to
  this plugin.
- The current branch opens one inline, searchable local-and-remote list. Choose a
  local branch to switch, choose a remote branch to create its local tracking
  branch, or type a missing name to create and switch from any listed start
  point. Edit and trash buttons rename or delete the exact local or remote
  branch after host confirmation.
- Compact refresh, sync, stage, restore, diff, and file actions are icons. Their
  full names remain available to screen readers and as hover tooltips.
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

The Repository tab lists every remote with its fetch and push URL, an editable URL
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
- Renaming a remote branch creates its replacement first and deletes the old
  name second. If deletion fails, both names remain and Denote reports the
  partial result. Remote branch deletion is a dangerous confirmed action.
- **Changing a remote's URL** and **removing a remote** each ask for their own
  confirmation, showing the exact remote name and URL. Removing a remote leaves
  your commits and files untouched.

After an operation Denote rereads the state it could have changed. Stage,
unstage, and restore refresh only the working tree and operation state; branch,
remote, history, and diff data are retained unless that action could change
them. When an operation fails, the last known good state stays on screen and the
failure is reported with Git's own message.

### Signing in to a remote

**Remote authentication** decides how a fetch, pull, push, or clone
authenticates. It is a plugin setting, so you change it in Denote's settings for
this plugin. The clone form in **Switch vault** shows the configured mode and
never offers to change it there, so what you see is always what the next remote
operation will use.

- **System Git credentials** is the default. It uses the credential helpers and
  stored credentials from your global Git configuration while terminal prompts
  remain disabled.
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
the Switch vault clone form.

### Cloning a repository into a vault

Open **Switch vault** and choose **Clone repo as vault**. Enter a URL and
optional branch there, then choose a folder.

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

Changing editor focus does not move an explicit repository selection. A removed
repository disappears from the list, and switching vaults replaces the complete
list and state, so results from the previous vault are never shown under the new
one.

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

The branch selector at the top of the view expands inside the plugin into one
searchable list of Local and Remote branches.

- Selecting a local branch switches to it.
- Selecting a remote-tracking branch creates a local branch that follows it.
  Denote proposes the name by dropping the remote and reports a collision
  instead of reusing an existing branch.
- When search has no exact match, **Create and switch** creates that name from
  any listed local or remote start point.
- Edit and trash buttons rename or delete the exact local or remote branch.
  Denote refuses to delete the local branch you are on. Remote rename creates
  the replacement first; if deleting the old name fails, both remain and the
  partial result is reported.
- Nothing switches on its own. A fetch, a remote update, and starting Denote all
  leave the current branch exactly where it is.

Each of these asks for confirmation first and names the exact branch you are
leaving and the one you are going to. Deleting asks a dangerous confirmation.

### Switching with work in progress

Denote reads the working tree again before every checkout and refuses to run one
that would disturb your work.

- **Unresolved conflicts** stop a checkout outright. Resolve them and continue,
  or abort the operation, then try the checkout again.
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

When the same file is both staged and changed, **Working tree** and **Staged**
switch between its two diffs, and the heading always names the side on screen.
Changing tab, opening a commit, or switching repository clears the diff rather
than leaving it for the next view to show.

### History and commit diffs

The History tab reads one page of commits at a time, newest first.

- **Refresh history** reads the page that is open again.
- **Previous** and **Next** move one page. Each is offered only when that page
  exists: Denote reads one commit beyond the page to know, and never shows it.
  The status line says which page is on screen and how many commits it holds.
- A full **Refresh** returns to the newest page, because it describes the
  repository as it is now.

Selecting a commit reads that commit's own diff and shows its summary, short ID,
author, date, parents, refs, and every file it changed, with the hunk headers,
the change kind, the old and new line numbers, and the exact content of each
line. A renamed or copied file names the path it came from. A binary file — and
every file in an encrypted vault, because Git records ciphertext — is reported
as binary with no line-level content.

- A **merge commit** is compared with its first parent. This shows what the
  merge brought into that branch, but it does not distinguish cleanly merged
  changes from edits made while resolving the merge.
- A commit that **changed no files** says exactly that.
- A commit's diff is **read-only**. There is no hunk action on it, because a
  commit records what already happened.
- A diff larger than Denote will parse is **refused with a message** rather than
  shown cut short, so a hunk you cannot see is never offered for staging.
- A commit stays selected across a refresh while the page still lists it, and
  its diff is not read twice: a commit is named by the hash of its own content,
  so that content cannot change.

### Opening a file

**Open file** appears on a changed row and on a file inside a commit. Denote
opens the note in the editor itself: the plugin only names a repository-relative
path, and no Git command is involved in opening anything.

- The path opened is the one the file has **now**, so a file a commit renamed
  opens under its current name.
- A file that was **deleted** is still shown in the commit, and offers no way to
  open it.
- A file that is **no longer in the vault** is reported instead of opening
  nothing.

### Merging, rebasing, cherry-picking, and reverting

**Merge and rebase** on the Repository tab act on a branch this repository already
has, so neither needs a network. **Review cherry-pick** and **Review revert** on
an open commit act on that exact commit.

Nothing starts when you press one of those. Denote reads the repository again
and shows a review that names the operation, its source, the branch it would
change, what it risks, and the files it expects to touch. A merge and a rebase
list the files that differ between the two branches, and say so, because that is
a wider list than the operation may actually change; a cherry-pick and a revert
list the commit's own files exactly.

**Start** then asks for confirmation. A rebase asks a dangerous confirmation,
because it rewrites the commits on your branch: they are recorded again with new
identities, and anyone who already has them sees a different history. Denote
never resets anything and never force-pushes.

Before an operation runs, the working tree goes through the same review a
checkout does: anything staged, changed, or untracked is listed, and you choose
to commit it, stash it, or cancel. A repository that already has an operation in
progress refuses to start another one, and so does one with unresolved
conflicts.

**Cancel** on the review cancels the operation completely: the commit-or-stash
question goes with it, so nothing is left on screen that could still run it.

A review describes one comparison, read from one branch at one commit. Checking
out, pulling, committing, finishing an interrupted operation, or a change made
outside Denote moves one of them, and the review is dropped rather than run
from: Denote asks you to preview the operation again from where the repository
now is.

### Finishing an interrupted operation

Denote reads the repository's own state, so an operation that stopped is still
there after a restart, a refresh, or a crash. Nothing resumes on its own.

The view shows the operation Git reports and only the controls that are valid
for it:

- **Continue** stays disabled, with the reason on screen, until Git reports no
  unmerged paths.
- **Skip** appears for a rebase, a cherry-pick, and a revert. Git cannot skip a
  merge, so a merge never offers one. Skipping asks a dangerous confirmation,
  because the commit being replayed is dropped.
- **Abort** puts the repository back where it was before the operation started,
  and asks a dangerous confirmation, because every resolution made inside the
  operation goes with it.

Cancelling one of these leaves the repository exactly as Git left it: the index
and the working tree are never split apart, and the operation can be finished or
aborted afterwards.

### Resolving a conflict

**Open conflict** on a conflicted file checks with the index that the file is
still unmerged, then reads the three sides Git recorded for it — the common
ancestor, your side, and the incoming side. Nothing is read out of the working
tree copy, so a note that legitimately contains `<<<<<<<` is never mistaken for
a conflict marker, and the labels name what each side is for the operation that
is running.

For ordinary text, Denote merges the three sides itself:

- Changes only one side made are already in the merged result.
- Changes both sides made differently are listed one at a time, with **Base**,
  **Ours**, and **Theirs** for each. Every side is kept on screen whichever one
  you choose, so nothing is dropped.
- **Use base**, **Use ours**, and **Use theirs** take one whole side as the
  result.
- The **Merged result** is editable, so you can write the resolution by hand.
- **Mark resolved** writes that result into the vault and stages it. It is
  unavailable while a change has no side chosen.

A side the index does not hold — an ancestor that never existed, for instance —
is shown as not recorded rather than as empty content.

Binary files and encrypted vaults never show line content and never receive
plaintext. They offer the recorded sides as whole-file choices instead, and
Denote writes the exact blob Git holds for the side you pick.

Every other conflicted file stays exactly as it is: resolving one file resolves
one file. Leaving the editor with a result you have not saved is refused rather
than done quietly; **Discard result** puts the merge Denote derived back.

## Settings

- **Git source** is `Bundled` by default, or explicitly `System` or `Custom`.
  Bundled downloads the signed release archive only when a Git operation first
  requires it. System and Custom never download that archive. There is no
  fallback between them. Custom requires an absolute path that identifies itself
  as Git.
- **GitHub CLI source** is `Disabled` by default, or explicitly `Bundled`,
  `System`, or `Custom`. Its Bundled archive is downloaded only when that mode is
  selected and a GitHub-specific action requires it. Disabled, System, and
  Custom never download it. Ordinary Git never resolves or runs `gh`.
- Each executable setting shows the selected source, resolved canonical path,
  version, validation result, prerequisite guidance, and an accessible native
  path picker for Custom mode.
- **Remote authentication** defaults to `System Git credentials`; `Public
  repository`, `SSH agent`, and `GitHub sign-in` remain available. It is set here
  rather than in the Git view. No remote token or password is stored in plugin
  settings or plugin storage.
- **Commit signing** follows the system default, always signs manual commits, or
  never signs them. **GPG signing key** is an optional masked key ID,
  fingerprint, or identity. The system GPG agent or pinentry owns the
  passphrase; Denote never stores it. Automatic commits are always unsigned.
  SSH-format signing can instead use the one-shot password field beside the
  manual commit message.
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

- **"refresh required" beside the repository name** appears only until the
  host's first read-only refresh finishes. Use Refresh to retry a failed read.
- **"Not initialized"** after a refresh means this vault or project has no
  repository. Use `Git: Initialize repository`, or open one that already has a
  repository.
- **A Git failure** reports the exit code and Git's own error output, and keeps
  the last stable view on screen. Fix the reported cause, then use Refresh.
- **No Git executable** reports the selected source. Reinstall Denote for a
  corrupt Bundled source, install Git for System, or choose a valid absolute
  executable for Custom. Denote never silently tries another source.
- **Repositories that use a `.git` file**, such as linked worktrees and
  submodules, are refused by the host rather than modified.
- **Encrypted vaults** must be unlocked and pass the host's encryption check
  before Git runs. Content stays encrypted in commits, so line-level diffs of
  encrypted files are not meaningful.
- **Commits created before vault encryption** can still contain plaintext. Git
  cannot encrypt old objects in place, and Denote never rewrites that history
  automatically. Review or explicitly replace it before publishing the
  repository when it may contain sensitive content.
- **A commit that fails with an identity error** needs either the author
  settings above or a Git identity configured in the repository.
- **"Choose a remote first"** means the repository has no remote yet. Add one on
  the Repository tab.
- **A fetch, pull, or push that fails to authenticate** usually means the mode
  does not match the remote: a private HTTPS remote needs GitHub sign-in, and an
  SSH remote needs a running agent. Denote never falls back to a prompt.
- **"GitHub CLI is disabled"** means a GitHub-only action needs it. Choose
  Bundled, System, or Custom, then run `gh auth login` when authentication is
  still required. Local Git, public remotes, and SSH remain available.
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
- **Use system Git settings** defaults on. Denote imports only bounded,
  allowlisted global identity, credential-helper, line-ending, and signing values
  into its otherwise isolated Git process.
