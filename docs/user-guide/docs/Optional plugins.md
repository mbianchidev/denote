# Optional plugins

Denote keeps the core editor small. Plugin code is not bundled, downloaded, or
run by default. The plugin manager will show catalog descriptions, permissions,
and guides before you enable anything.

When you enable a plugin, Denote will verify and install its package, ask for
declared permissions, and then start it. Simply enabling a plugin must not edit
your notes. Actions that change vault content require both your explicit action
and write permission.

Turning a plugin off stops it, removes its commands and views, and deletes its
downloaded executable package. It never deletes notes or other user-authored
content. Plugin settings, generated data, and saved credentials have separate,
clearly described cleanup controls.

Plugins that need credentials can request secure storage. Approved credentials
are stored in an isolated plugin namespace backed by the operating-system
keychain. Plugins cannot read Denote credentials or another plugin's entries.

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

The plugin manager and downloadable production plugins are not available yet.

[Back to Welcome](<../Welcome.md>)

#guide #plugins
