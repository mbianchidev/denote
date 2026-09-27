# Advanced task lists

## Purpose

Collect standard Markdown checkboxes from the current vault into one local task
view. Tasks remain ordinary portable Markdown and continue to work when the
plugin is disabled. Requires Denote 0.7.0 or newer.

## Enablement and permissions

Disabled by default. Enable **Advanced task lists** under
**Settings -> Plugins -> Productivity** and approve **Task list**.

The permission supplies bounded vault-relative Markdown paths, note titles, and
source to an isolated local worker. The worker returns declarative task data and
may propose one checkbox-marker change after an explicit toggle. Denote verifies
that exactly one `[ ]`, `[x]`, or `[X]` marker changed and owns the save,
revision, conflict, encryption, and open-editor behavior. The plugin receives no
absolute vault path, raw encryption key, network, process, clipboard, or general
workspace-read/write capability.

## Usage

Choose **Advanced task lists** in the activity rail. Filter the consolidated
list by:

- **Status:** open, completed, or all tasks.
- **Tag:** a hashtag such as `#work` found in the task text.
- **Path:** a case-insensitive vault-relative path fragment.
- **Due:** overdue, today, upcoming, undated, or any due state.

Due dates use the portable plain-text token `due:YYYY-MM-DD`:

```markdown
## Release

- [ ] Ship the installer #work due:2026-10-01
- [x] Publish the notes #docs
```

The view shows the note path, one-based source line, and enclosing Markdown
heading path. Choose the note title to open the source normally. Toggle the
native checkbox with a pointer or Space. If the note is already open, Denote
changes the current editor buffer and follows ordinary autosave behavior. If it
is closed, Denote reads and saves it with the existing content hash, encoding,
line endings, revision history, and vault-generation guards.

Task identity never relies only on a line number. The plugin relocates the exact
task line under the same heading and checks the number and occurrence of
identical tasks. Nearby inserted or removed lines are safe. Changed, missing, or
ambiguous task content reports a conflict instead of overwriting the note.

Filters, note links, and checkboxes follow normal Tab order. Checkboxes use
native keyboard behavior, focus remains visible, and when a completed toggle
leaves the current filter Denote moves focus to the nearest remaining task.

Recurring-task syntax is intentionally not interpreted in this version.
Recurrence remains plain Markdown so notes stay portable and no task is
recreated unexpectedly.

## Settings

This plugin has no settings.

## Disable behavior

Disabling stops the worker, withdraws the task view, clears its in-memory index,
and deletes downloaded package code and cached archives. It never removes or
rewrites task Markdown. Standard task lists remain editable in every Markdown
mode.

## Troubleshooting

Use **Refresh current vault** after external file changes. If a toggle reports a
conflict, open the named note, review the checkbox, and try again after the task
view refreshes. Identical task lines under one heading remain toggleable while
their count and order are unchanged; changing that group causes a safe conflict.

Only UTF-8 `.md` and `.markdown` files enter the index. YAML frontmatter, fenced
code, and indented code blocks are ignored. Each note is capped at 256 KiB, the
index at 5,000 notes and 8 MiB, and each query at 1,000 visible tasks. Bounds and
skipped or malformed notes are reported instead of presented as a complete
index. Locked encrypted vaults expose no task content and stop the worker until
unlock.
