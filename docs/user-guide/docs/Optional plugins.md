# Optional plugins

Denote keeps the core editor small. Plugin code is not bundled, downloaded, or
run by default. Open **Settings → Plugins** to browse the catalog. You can search, filter by
category or enabled state, inspect permissions, and read each guide before
enabling anything.

Plugin code comes from separately verified GitHub Release assets, not from the
desktop installer. Denote checks each package's pinned size and checksum before
installing it.

Plugin settings can be saved, reset, and imported or exported as versioned JSON.
Older settings exports run the plugin's declared migrations before current
validation.

When you enable a plugin, Denote will verify and install its package, ask for
declared permissions, and then start it. Simply enabling a plugin must not edit
your notes. Actions that change vault content require both your explicit action
and write permission.

Turning a plugin off stops its isolated worker, removes its commands and views,
and deletes its downloaded executable package, cached archive, staging content,
and removal backups. Only its catalog listing remains for a later reinstall. It
never deletes notes or other user-authored content. Plugin settings, generated
data, and saved credentials have separate, clearly described cleanup controls.

If a plugin is behaving badly, use **Disable all plugins** in the same settings
section. The editor remains usable while plugin workers start, and a crashing
plugin is stopped and removed automatically.

If installation reports **HTTP 404 Not Found**, the package named by your
Denote build is not published at its download URL. Check for a completed Denote
release and install that application version; retrying an unpublished release
cannot fix the missing package. Keep the plugin ID, version, and download URL
from the error when reporting it. A failed update preserves the installed
version; do not disable it just to retry the download.

When previously approved plugins have updates, **Update all** appears in the
plugin manager. It first lists the exact plugins and explains that their complete
latest permission sets will be accepted again. Confirming updates only those
listed plugins, one independently verified transaction at a time. Current,
never-approved, incompatible, and unrelated plugins are not downloaded or
changed. An enabled plugin keeps running its installed version until its update
has downloaded, verified, started, and completed. If that fails, Denote removes
the attempted replacement and starts the installed version again.

Plugins that need credentials can request secure storage. Approved credentials
are stored in an isolated plugin namespace backed by the operating-system
keychain. Plugins cannot read Denote credentials or another plugin's entries.

Other permissions are scoped and shown before approval. Workspace reads and
writes are available only while you explicitly run a plugin command, and writes
must use the version returned by the original read. Network access is HTTPS-only
and limited to listed hosts. Clipboard, notifications, and process execution
have separate permissions; process permissions list exact executables for each
supported operating system.

An approved plugin can request `project-context`. For explicit projects and
workspace-discovered implicit projects alike, it receives only a stable opaque
project ID and vault-relative root, plus change events—never an absolute path or
Denote implementation object. A plugin command captures that project identity.
Existing bounded process actions revalidate it and use the current project root
as their working directory. Persistent terminal and language-server APIs remain
future plugin work.

With a focused active project, **Settings → Plugins** shows a non-blocking
**Code tooling** recommendation for Git, Terminal, Language server, Linter,
Compiler, and Code navigation. Each role is labeled unavailable, disabled, or
enabled. Denote never downloads or enables a recommendation automatically, and
core project behavior continues when plugins are missing, disabled, or failed.

Syntax highlighting for supported source files and Markdown fences is core
behavior and remains available before plugins start or when every plugin is
disabled. Plugin API version 1 cannot inject or download grammars. A future
specialized grammar extension would require a separately approved typed,
bundled host contract.
Diff highlighting and interactive diff presentation are intentionally not core
language entries; the optional Git plugin provides them through its
host-rendered source-control view.

## Emoji picker

Enable **Emoji picker** under **Editor and writing** to find and insert standard
Unicode emoji. It is independently installable and off by default. Open it from
the editor toolbar, find **Emoji picker** in the command palette, or press
`Command-Shift-E` on macOS / `Ctrl-Shift-E` on Windows and Linux.

Search by name, keyword, category, or shortcode. Choose recent or favorite
emoji, use the favorite control to save a choice, and choose a skin tone or
another standardized variant. Arrow keys navigate results; Enter inserts;
Escape cancels and restores the editor selection. No result changes a note
until you choose it.

While writing Markdown, typing just `:sm` shows matching Unicode emoji such as
`:smile:` 😄. You do not need to finish the word or type a closing colon.
Choosing it replaces `:sm` with the actual Unicode character `😄`, not an image
or custom Markdown. Accept one explicitly or press Escape to keep the literal text.
An ordinary colon, code span, fenced code block, or IME composition does not
trigger suggestions. Turn **Shortcode suggestions** off in plugin settings
to keep only the picker.

The plugin works in editable Rich and Source modes, including project Markdown,
and uses normal undo/redo. It is unavailable while a vault is locked, while
Denote is changing vault content, and in read mode. Inserted sequences are
ordinary Unicode, including joined emoji and skin tones, not custom Markdown.
They stay unchanged when the plugin is disabled or removed.

The dataset, searches, recent choices, and favorites stay entirely local. Recent
and favorite lists plus your tone choice live in plugin settings, not notes.
Settings reset clears the lists; disabling alone retains them for reinstall.
The plugin has no direct filesystem, encryption-key, or network access. It
does not replace the operating system's emoji picker.

## Other optional features

These capabilities are planned as separately enabled plugins:

- graph view;
- Kanban boards;
- Mermaid diagrams;
- task lists and reminders;
- note comments and highlighting;
- text-to-speech and dictation;
- calendar and time tracking;
- colorful text.

**Git vault versioning** is now in the catalog. Enable it to get one Git view in
the activity rail that lists the vault root and every configured project root
with a safe `.git` marker. Select one repository. Denote performs one read-only
refresh when you first open the Git view in a vault, so Git does not compete
with vault loading while you are writing; you can still refresh or initialize
it with your configured
default branch, stage and unstage a file, commit staged changes with an optional
configured author identity, and cancel a running operation. Enabling it does not
run Git or change your vault, and it asks for no network, process, or
note-writing permission. Switching projects, or switching vaults, resets the
view and asks for a refresh, so it never shows one repository's state as if it
belonged to another.

Set **Automatic commit interval** above zero to let Denote commit for you on a
timer. Denote saves your open notes first, then commits only tracked files that
changed and match your include and exclude prefixes. It never adds a new file
you have not tracked yourself, never contacts a remote, and waits for the next
interval when work is already staged, a merge is unfinished, the vault is
locked, or Denote is busy. Nothing happens the moment you enable it: the first
automatic commit is one full interval later. If a run cannot finish, whatever
you had staged is left exactly as it was, and if another Git tool changed your
index in the meantime Denote leaves that index untouched and tells you so.
Changing any plugin setting reloads the plugin so the new interval, message, or
prefixes apply straight away. The default message is
`Denote automatic commit {timestamp}`. `{timestamp}` becomes the current local
time in `yyyy-mm-dd hh:mm` format when the commit runs.

You can also work with remotes. The Repository tab adds a remote, changes a
remote's URL, and removes one, and the repository section fetches, pulls, and
pushes. Denote never does any of that on its own. A pull, a push, a URL change,
and a remote removal each ask you first and name the exact remote, URL, and
branch involved, and only an ordinary push is offered: there is no force push.

Choose how Denote signs in under **Remote authentication**, in the plugin's
settings. *System Git credentials* is the default and uses your configured
credential helper or OS keychain. *Public repository* needs no credentials, *SSH agent* uses the agent
you already have running, and *GitHub sign-in* uses the GitHub CLI on your
machine. The Git view shows the mode you configured and sends you to Settings to
change it, so it always matches what the next fetch, pull, push, or clone will
use. With GitHub sign-in you can browse your repositories and pick one to clone.
Denote reads the token itself, uses it only for that one Git command, and
deletes it straight afterwards; it is never stored in plugin settings, written
into your repository's configuration, or shown in a message or log. Denote also
checks the address it is really about to contact, so a remote that fetches from
GitHub but pushes somewhere else is refused rather than sent your token. If a
mode is not set up, Denote says so instead of leaving Git waiting for a
password.

Open **Switch vault**, choose **Clone repo as vault**, and enter the repository
there. Denote asks you to choose an empty folder, clones into it,
checks the result, and only then opens it as a vault. Your open notes are saved
before the clone starts, so nothing you typed in the current vault is lost when
the clone replaces it. Cancelling the folder chooser does nothing at all, and
Cancel stops a clone or a repository browse while it is still running. If the clone fails, the folder is left exactly as
it is: you can retry, or use **Clean incomplete clone**, which asks for a
separate confirmation and deletes only that one folder. Denote never cleans it
up for you. A cloned vault that is encrypted opens on the usual unlock screen,
so no note is shown before you unlock it.

The current branch control does branch work inside the Git view. You can create
from the branch you are on, another local branch, or a remote-tracking branch,
and switch immediately. The single searchable list labels Local and Remote
entries. Edit and trash buttons rename or delete either kind after confirmation.
Denote refuses to delete the local branch you are on. A remote rename creates
the replacement first and reports a partial result if removing the old name
fails. Nothing switches on its own after a fetch, remote update, or startup.

The main Changes view keeps common work close together: select or create and
switch a branch, pull, stage or unstage one file or all eligible files, type a
commit message, commit, and push. **Restore** replaces one tracked file with the
current upstream version; **Restore from remote** does the same for all tracked
staged and unstaged changes. Both require a dangerous confirmation and never
delete untracked files.

Select the current branch button to open the branch picker inside the Git view.
It is one searchable list with explicit Local and Remote labels. Select a local
branch to switch, choose a remote branch to create its proposed local tracking
branch, or type a new name and choose any local or remote **Create from** point.
Edit and trash buttons rename or delete the exact local or remote branch after
confirmation. Creating always switches to the new branch. Denote still
saves open notes, reviews dirty work, and asks for confirmation before the
checkout changes files.

Compact actions use icons; hover them for the full label, and screen readers
receive the same name. **Open diff** opens a read-only temporary `.diff` tab in
the main editor using Pierre Diffs. File and hunk stage/unstage actions stay
above the patch. Closing the tab closes the provider's diff selection, and the
tab is not saved into the vault or restored next session.

Under plugin settings, **Git source** defaults to **Bundled** and can be changed
explicitly to **System** or **Custom**. **GitHub CLI source** defaults to
**Disabled** and can be changed to **Bundled**, **System**, or **Custom**.
Denote never falls back between sources. A Bundled archive is downloaded only
when that mode is selected and an action first needs the tool. System, Custom,
and Disabled never download it. Before then, settings show the locked version
as **not downloaded**. Custom paths must be absolute and pass a version probe.
Generic Git actions never require GitHub CLI; GitHub-only actions tell you when
to enable and configure it.

**Use system Git settings** is on by default. Denote
imports only bounded allowlisted identity, credential-helper, line-ending, and
GPG values into its hardened Git process. Manual commits can follow the system
signing default, always sign, or never sign. The optional GPG key field is masked;
your system GPG agent or pinentry asks for the passphrase, which Denote never
stores. Automatic commits remain unsigned.

The manual commit form provides **Sign commit**, enabled by default for each
submission, plus **Commit** and **Commit and push**. Turn signing off for an
unsigned commit. If you leave the message blank, Denote uses
`Denote manual commit {timestamp}` and resolves the placeholder to the current
local time in `yyyy-mm-dd hh:mm` format. For an encrypted SSH signing key, enter its passphrase in the
password-style field that appears while signing is selected. Denote uses it for
that commit only and clears it immediately; the plugin never receives it. Leave
it empty when your SSH agent already has the key, or when OpenPGP/X.509 signing
uses the system GPG agent or pinentry.

Plugin icons in the activity rail can be reordered by dragging. **Organize
plugins** also provides keyboard move controls, optional group names, group
collapse/expand controls, and a **Hidden plugins** section for restoring hidden
entries. These preferences affect only the local sidebar.

Development builds have a **Load local plugin archive** action in this section.
It accepts a locally built `.tgz`, labels it as a local development archive, and
still requires permission approval before enablement. Disable it before loading
a rebuilt archive with the same ID. Installed releases do not expose this
action.

If switching would disturb work, Denote does not switch. It reads the working
tree again first. Unresolved conflicts stop a checkout outright: resolve them and
continue, or abort the operation, then try again. Otherwise Denote lists
every staged, changed, and untracked file and offers you three answers.
**Commit all and switch** stages exactly those files and commits them with the
message you type. **Stash and switch** puts them in the repository's stash;
untracked files are included only when the vault is not encrypted, and while an
encrypted vault has untracked files stashing is unavailable and says why.
**Cancel switch** does nothing at all. Denote never discards your work: once it
has committed or stashed, anything that goes wrong afterwards — the switch
failing, you cancelling it, or opening another vault while it runs — is reported
with a message that says exactly where your work is.

After a switch, Denote saves your open notes first, then reads the vault again
and reloads every open tab from disk. Your panes, tab order, tab groups, and
each tab's language and view choices stay as they were. Only tabs whose files do
not exist on the new branch are closed, and Denote names them.

You can also stage part of a file. **Open diff** on a changed or staged file
shows its hunks, and **Stage hunk** and **Unstage hunk** apply exactly that one
hunk to the staging area without touching the file on disk. A binary, added,
deleted, renamed, or copied change has no pair of matching text sides to split,
so Denote stages it as a whole file and says so. An encrypted vault stages whole
files too: Git records the ciphertext, so there are no lines in it to choose
between. When the same file is both staged and changed, **Working tree** and
**Staged** switch between its two diffs, and the heading always names the side
you are looking at.

The History tab reads one page of commits at a time. **Refresh history** reads
the page again, and **Previous** and **Next** move a page at a time; each button
is offered only when that page exists, and the status line says which page is on
screen. Selecting a commit shows its author, date, parents, refs, and the exact
diff Git reports for it, file by file. A merge commit is shown compared with its
first parent, which includes what the merge brought into that branch but does
not distinguish cleanly merged changes from merge-resolution edits. A commit
that changed no files says exactly that. History is
read-only: there is no hunk action on a commit's diff, because a commit records
what already happened.

**Open file** on a changed row, or on a file in a commit, opens that note in the
editor. Denote opens the file at the path it has now, so a file that a commit
renamed opens under its current name, and a file that has been deleted since is
still shown in the commit but cannot be opened. If the file is no longer in the
vault, Denote says so instead of opening nothing.

Merge and rebase act on a branch the repository already has, and cherry-pick and
revert act on the commit you selected in the History tab. None of them starts
when you press the button: Denote reads the repository again and shows a review
naming the operation, its source, the branch it changes, what it risks, and the
files it expects to touch. Starting one asks for confirmation, and a rebase asks
a dangerous confirmation because it rewrites the commits on your branch. Work in
the vault goes through the same commit-or-stash review a branch switch uses, and
an operation never starts while another one is in progress. Cancelling the
review cancels the whole operation, including the commit-or-stash question, and
a review stops being valid once the branch it named moves: after a checkout, a
pull, a commit, or a change made outside Denote, you are asked to preview the
operation again rather than run the one you read about somewhere else.

An operation that stopped stays where Git left it. Denote reads that state on
every refresh and after a restart, and offers only the controls Git allows:
**Continue** stays disabled until no file is unmerged, **Skip** appears only for
a rebase, cherry-pick, or revert, and **Abort** puts the repository back where it
was. Nothing resumes on its own.

**Open conflict** reads the three sides Git recorded for a conflicted file — the
common ancestor, your side, and the incoming side — from the index rather than
from the file on disk, so a note that contains conflict-marker characters is
never mistaken for one. Denote merges the sides itself: a change only one side
made is already in the result, and a change both sides made differently is listed
with **Base**, **Ours**, and **Theirs** to choose from. You can also take one
whole side, or edit the merged result yourself, and **Mark resolved** writes it
into the vault and stages it. A side the index does not hold is shown as not
recorded rather than as empty content.

Binary files and encrypted vaults never show line content and never receive
plaintext: they offer the recorded sides as whole-file choices, and Denote writes
the exact content Git holds for the side you pick. Resolving one file resolves
only that file, and leaving the editor with an unsaved result is refused rather
than done quietly.

The Git plugin is designed to commit ciphertext when vault encryption is enabled
and must run an encryption sweep before committing.

The current catalog also includes a development reference plugin that proves
download, verification, isolated activation, command registration, disablement,
sidebar and status contributions, note events, source-editor decorations,
keychain isolation, restart restoration, and package removal. Remaining
production feature plugins are tracked separately.

[Back to Welcome](<../Welcome.md>)

#guide #plugins
