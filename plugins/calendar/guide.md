# Calendar and daily notes

## Purpose

Browse a local month calendar and agenda, find notes associated with a date, and
create or open daily notes as ordinary Markdown. Requires Denote 0.6.0 or newer.

## Enablement and permissions

Disabled by default. Enable **Calendar and daily notes** under
**Settings -> Plugins -> Productivity** and approve **Calendar**.

This permission supplies vault-relative Markdown paths, titles, and bounded
leading YAML frontmatter to an isolated local worker. The host owns the calendar
UI and may create a missing daily note only after your explicit action. Existing
notes are never overwritten. There is no general workspace-write, network,
process, clipboard, credential, or encryption-key access.

## Usage

Choose **Calendar** in the activity rail or **Show calendar** in the command
palette. **Month** shows dates and written note counts; **Agenda** lists dated
notes in the displayed month. Choose a listed note to open it normally.

Select a date, then choose **Create daily note** or **Open daily note**. The exact
vault-relative destination appears below the action. Missing folders are created
only with a new daily note. The command palette also offers **Open today's daily
note**. A new note contains a plain `# YYYY-MM-DD` heading.

Arrow keys move by day or week in the month grid. Home/End move within a week;
Page Up/Down change month, and Shift-Page Up/Down change year. Tab leaves the grid.
Selecting dates, changing months, or enabling the plugin never creates notes.

Display dates and weekday names follow your locale. The week starts according to
your locale where the runtime supports that information, otherwise on Monday.
Stored filenames use ASCII Gregorian date tokens. Selected dates stay date-only
identities, so changing time zone or crossing daylight-saving time does not move
a selected note. **Today** uses your current local date when invoked.

Other Markdown notes can opt into the calendar with YAML frontmatter:

```markdown
---
date: 2026-09-01
---
# Planning
```

The optional top-level `date` must be a valid `YYYY-MM-DD` scalar; quotes are
allowed. Timestamps, aliases, custom tags, duplicate keys, and invalid dates are
not interpreted as dates. No metadata is required in ordinary or daily notes.
Configured daily filenames take precedence over metadata.

## Settings

- **Daily-note folder:** defaults to `Daily`; use a vault-relative folder such as
  `Journal/Days`, or leave empty for the vault root.
- **Filename format:** defaults to `YYYY-MM-DD`. Include `YYYY`, `MM`, and `DD`
  exactly once, omit the `.md` extension, and use `-`, `_`, `.`, or spaces as
  separators. Put literal text in brackets, such as `[Day-]DD.MM.YYYY`.
- **Include date metadata:** enabled by default. Turn off to use daily filenames
  alone.

Paths must be portable, relative, and outside `.denote` and `.git`. Save settings
to restart the provider. Changing settings never renames or migrates files.

## Disable behavior

Disabling stops the worker, withdraws the calendar and commands, and deletes its
downloaded executable package and cached archives. Settings remain available
until you explicitly clear them. Notes and folders are never removed or changed.
Vault switching and locking discard derived data and stop the worker; an enabled
plugin starts fresh for the current unlocked vault.

## Troubleshooting

Correct an invalid folder or filename format in plugin settings, then enable
again. Invalid frontmatter is reported without changing the original note.
Use **Refresh current vault** when files changed outside Denote. A failed query
offers **Retry calendar**, while ordinary Markdown editing remains available.

Queries cover at most 42 dates, 5,000 note paths, 8 KiB of frontmatter per note,
and 2 MiB of document data. Results show at most 100 notes per date and 1,000
notes overall. Limits and unavailable metadata are reported, never presented as
a complete calendar. The native create-or-open operation still checks disk and
opens an existing daily note instead of replacing it.

Locked encrypted vaults cannot create or expose note content. New notes in an
unlocked encrypted vault are written directly as ciphertext. Symlinks, vault
escapes, internal paths, and a directory occupying a note path are refused.
