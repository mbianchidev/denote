# Optional plugins

Denote keeps the core editor small. Plugin code is not bundled, downloaded, or
run by default. Open **Settings → Plugins** to browse the catalog. You can search, filter by
category or enabled state, inspect permissions, and read each guide before
enabling anything.

Plugin settings can be saved, reset, and imported or exported as versioned JSON.
Older settings exports run the plugin's declared migrations before current
validation.

When you enable a plugin, Denote will verify and install its package, ask for
declared permissions, and then start it. Simply enabling a plugin must not edit
your notes. Actions that change vault content require both your explicit action
and write permission.

Turning a plugin off stops its isolated worker, removes its commands and views,
and deletes its
downloaded executable package. It never deletes notes or other user-authored
content. Plugin settings, generated data, and saved credentials have separate,
clearly described cleanup controls.

If a plugin is behaving badly, use **Disable all plugins** in the same settings
section. The editor remains usable while plugin workers start, and a crashing
plugin is stopped and removed automatically.

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
language entries; they belong to the future Git plugin.

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
the activity rail for the active project, or for the vault when no project is
marked. It can refresh the repository, initialize one with your configured
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
prefixes apply straight away.

You can also work with remotes. The Branches tab adds a remote, changes a
remote's URL, and removes one, and the repository section fetches, pulls, and
pushes. Denote never does any of that on its own. A pull, a push, a URL change,
and a remote removal each ask you first and name the exact remote, URL, and
branch involved, and only an ordinary push is offered: there is no force push.

Choose how Denote signs in under **Remote authentication**, in the plugin's
settings. *Public repository* needs no credentials, *SSH agent* uses the agent
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

**Clone a repository** asks you to choose an empty folder, clones into it,
checks the result, and only then opens it as a vault. Your open notes are saved
before the clone starts, so nothing you typed in the current vault is lost when
the clone replaces it. Cancelling the folder chooser does nothing at all, and
Cancel stops a clone or a repository browse while it is still running. If the clone fails, the folder is left exactly as
it is: you can retry, or use **Clean incomplete clone**, which asks for a
separate confirmation and deletes only that one folder. Denote never cleans it
up for you. A cloned vault that is encrypted opens on the usual unlock screen,
so no note is shown before you unlock it.

Switching branches, file and commit diffs, and conflict resolution are not
implemented in this version. Branches and recent commits appear as read-only
information, and an interrupted merge or rebase is reported so you can finish it
with your own Git tooling.

The Git plugin is designed to commit ciphertext when vault encryption is enabled
and must run an encryption sweep before committing.

The current catalog also includes a development reference plugin that proves
download, verification, isolated activation, command registration, disablement,
sidebar and status contributions, note events, source-editor decorations,
keychain isolation, restart restoration, and package removal. Remaining
production feature plugins are tracked separately.

[Back to Welcome](<../Welcome.md>)

#guide #plugins
