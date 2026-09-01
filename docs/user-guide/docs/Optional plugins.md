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

These capabilities are planned as separately enabled plugins:

- Git vault versioning and optional timed commits;
- graph view;
- Kanban boards;
- Mermaid diagrams;
- task lists and reminders;
- note comments and highlighting;
- text-to-speech and dictation;
- calendar and time tracking;
- colorful text.

The Git plugin is designed to commit ciphertext when vault encryption is enabled
and must run an encryption sweep before committing.

The current catalog includes a development reference plugin that proves
download, verification, isolated activation, command registration, disablement,
sidebar and status contributions, note events, source-editor decorations,
keychain isolation, restart restoration, and package removal. Production
feature plugins remain tracked separately.

[Back to Welcome](<../Welcome.md>)

#guide #plugins
