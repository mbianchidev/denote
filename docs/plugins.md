# Optional plugin host

Denote keeps optional capabilities outside the core application. A plugin
implements the typed contract in `src/plugins/api.ts` and declares:

- a stable ID, name, version, and description;
- the capabilities it needs;
- activation and optional deactivation hooks.

The registry rejects duplicate IDs and only activates plugins explicitly
enabled by the host. A plugin receives a limited context rather than direct
access to application internals. Initial extension points cover commands,
sidebar views, editor decorations, and note lifecycle events.

Plugins are expected to:

- remain disabled by default;
- store settings and generated data separately from Markdown content;
- clean up event handlers and resources when disabled;
- surface errors instead of silently failing;
- never receive the unwrapped vault encryption key;
- preserve vault portability when removed.

Content-oriented extension points are unavailable while an encrypted vault is
locked. Plugins must use host APIs rather than reading decrypted temporary
files. The Git plugin is the exception for direct on-disk versioning: it stages
ciphertext only, includes `.denote/encryption.json`, and runs the host's
encryption preflight before committing.

The first release ships no optional plugins. Git, graph view, Kanban, Mermaid,
task lists, reminders, comments, highlighting, speech, calendar, time tracking,
and colorful text are tracked as separate implementation issues.
