# Optional plugins

Denote keeps the core editor small. Plugin code is not bundled, downloaded, or
run by default. Open **Settings → Plugins** to browse the catalog. You can search, filter by
category or enabled state, inspect permissions, and read each guide before
enabling anything.

Each plugin starts as a compact row showing only its name and current status.
Open the row to see its description, version, publisher, permissions, guide,
settings, and enable, update, disable, or cleanup actions. Entries with an error
open automatically so the failure stays visible.
Disabled plugins show **Disabled**, without update notices, including in Denote
Development. Choose **Enable** only when you want to start one.
**Enabled · update available** means the installed version is still active.

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

When enabled, previously approved plugins have updates, **Update all** appears in
the plugin manager. It first lists the exact plugins and explains that their complete
latest permission sets will be accepted again. Confirming updates only those
listed plugins, one independently verified transaction at a time. Disabled,
current, never-approved, incompatible, and unrelated plugins are not downloaded or
changed. An enabled plugin keeps running its installed version until its update
has downloaded, verified, started, and completed. If that fails, Denote removes
the attempted replacement and starts the installed version again.

The plugin manager also has an **Automatically update plugins** toggle, off by
default. Turning it on applies updates for enabled, previously approved plugins
in the background, without the **Update all** confirmation, but only when the update
keeps every permission the plugin already holds unchanged. An update that asks
for a new or different permission still waits for you to review it through
**Update all** or that plugin's own **Review and update** action. Update controls
stay together near the top of the panel. **Disable all plugins** is in the
separate **Plugin recovery** section below the catalog.

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

The Welcome vault's [plugin examples](<../plugins/README.md>) provide small,
invented files for every user-facing plugin. New example sets add only their
missing paths once, including after unlock as ciphertext in encrypted Welcome
vaults. Existing files and earlier migration markers stay untouched; samples
deleted after their set was applied are not restored on later launches.
Opening an example never installs a plugin or initializes Git.

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

Try the editable [emoji practice note](<../plugins/Emoji practice.md>).

## JSON and YAML viewer

Enable **JSON and YAML viewer** under **Code** to open `.json`, `.yaml`, and
`.yml` files as structured trees. The plugin is off by default and its
executable code is downloaded only after you approve **Structured viewer**. It
has no file-write, network, process, or clipboard permission.

Use **Structured** and **Raw** in the editor toolbar. Raw is Denote's ordinary
source editor and preserves the complete file, including YAML comments,
formatting, document separators, anchors, aliases, encoding, and line endings.
Switching views never saves or reformats anything.

Structured rows show the key or array index plus a written type: object, array,
mapping, sequence, string, number, boolean, null, scalar, or alias. Anchors are
shown beside their container or scalar. Aliases remain references and are not
expanded recursively. The root and its first-level entries are visible when
the view opens.

Select a non-empty container to expand or collapse it. **Collapse all** keeps
the root and first level visible. **Expand all** expands up to 5,000 containers
and announces when more remain collapsed. Up/Down move through visible rows,
Left collapses or moves to the parent, Right expands or moves to the first
child, Home/End move to the boundaries, and Enter/Space toggles a container.

Parsing is local in the isolated plugin worker. JSON/YAML Structured view is
limited to 4 MiB of source, 100 YAML documents, 50,000 nodes, 128 levels, and
500 aliases. YAML uses the 1.2 core schema: custom tags, YAML 1.1 known tags,
merge keys, constructors, scripts, and network loading are disabled. A malformed
file or exhausted limit shows an actionable error, with line and column when
available, while Raw remains usable.

Expansion state belongs only to the open tab. Closing the tab, disabling or
updating the plugin, a crash, vault switch, or application teardown releases
the parsed model. Locking an encrypted vault stops the viewer worker and clears
decrypted derived state; it restarts after unlock. Disabling or removing the
plugin never changes open files.

Try the [JSON](<../plugins/Structured data.json>) and
[YAML](<../plugins/Structured data.yaml>) examples, including an unexpanded YAML
alias. Compare Structured with the unchanged Raw source.

## Kanban boards

Enable **Kanban boards** under **Productivity** to create visual boards backed by
portable Markdown. The plugin is disabled by default and its code is downloaded
only after you approve **Kanban board**. It has no general workspace-read,
workspace-write, network, process, clipboard, or credential permission.

Run **Create Kanban board** from the command palette, or create a file ending in
`.kanban.md` or `.kanban.markdown`. Open it and choose **Board** in the editor
toolbar. A new or ordinary Markdown file first shows **Initialize board**.
Initialization appends the managed board after any existing Markdown instead of
replacing it, then creates one Backlog column.

Use **Add column** and **Add card** to build the board. Click the board, column,
or card title to edit it. Click card details to edit their ordinary Markdown;
typing stays in the details field instead of jumping back to the title. Write a
relative link such as `[Design](Design.md)` to link another note, and write
hashtags such as `#planning` to show tags on the card.

Closed cards show at most five wrapped detail lines and show **More…** when text
continues. Markdown links appear where they were written. Choosing a link opens
it instead of the card editor; click the title or any non-link part of the body
to edit the complete Markdown.

Drag a column or card to reorder it or move a card between columns. For
keyboard movement, focus the item's grip, press Space to pick it up, use
Left/Right for columns or any arrow key for cards, then press Space to drop.
Home and End move to the first or last position, and Escape cancels. Focus stays
on the moved grip and Denote announces its new location. No arrow or pencil
action icons are shown. Read mode keeps note links available while disabling
every edit and drag action.

Choose **Markdown** to inspect or edit the exact source. A board remains readable
without Denote:

```markdown
<!-- denote-kanban:board:v1:start -->
# Release board

<!-- denote-kanban:column:start id="column-example" -->
## Backlog

<!-- denote-kanban:card:start id="card-example" -->
### Write the specification

See [Specification](Specification.md). #planning
<!-- denote-kanban:card:end -->

<!-- denote-kanban:column:end -->
<!-- denote-kanban:board:end -->
```

The HTML comments identify only the ranges managed by the plugin. Reordering
moves the original complete card or column block byte-for-byte. Markdown outside
the board and unknown Markdown inside a moved card or column remains unchanged.
Renaming changes only that heading. Editing a card changes only its title and
details.

Board view is limited to 4 MiB of source, 128 columns, 5,000 cards, and 64 KiB
of details per card. A malformed marker or exhausted limit keeps **Markdown**
available with an actionable error. Reserved `denote-kanban` marker lines cannot
be used as card details.

Parsing and edits run locally in the isolated plugin worker. The host owns the
visible board, forms, focus, link opening, autosave, revision history, and file
writes. Locking an encrypted vault stops the worker and clears the Board view
until unlock. Disabling or removing the plugin never changes or deletes board
files; they continue to open in the exact Markdown source editor.

Open [the Kanban board example](<../plugins/Kanban board.kanban.md>) in the
Denote Welcome vault. The original board is kept alongside the newer plugin
examples; an older copy you edited or deleted is never replaced.

## Calendar and daily notes

Enable **Calendar and daily notes** under **Productivity** in Denote 0.6.0 or
newer. It is off by default and asks only for **Calendar**. Open **Calendar** in
the activity rail or run **Show calendar** from the command palette.

**Month** shows a calendar with written counts on dates that have notes.
**Agenda** lists dated notes in the displayed month; choose one to open it.
Use **Dates** to switch between **Daily and dated**, **Created**, and
**Last updated**. Created and Last updated are separate views of ordinary
Markdown notes, and both exclude daily notes. Each works as a month calendar
or agenda; select a marked day to see and open its matching notes.

Created uses filesystem creation/birth time. Last updated uses the latest
filesystem modification time, not the last opened time or every historical
edit. Unknown creation times are reported and left unmarked. Denote retains
original creation dates through its atomic saves and revision restores, and
encryption/decryption do not count as note updates. Copies, external file
replacement, and restoring deleted content may change the available creation
information.

Select a date, then choose **Create daily note** or **Open daily note**. The path
is shown before the action. These controls appear only in **Daily and dated**.
**Open today's daily note** is also available in the
command palette. Existing files are always opened, never replaced.

Daily notes default to `Daily/YYYY-MM-DD.md`. New daily notes have a plain date
heading plus `type: daily` and `date: YYYY-MM-DD` YAML frontmatter. The type marker
keeps them out of both activity views even after a move or rename. Legacy daily
notes are also excluded when they match the configured folder and filename;
existing files are never changed to add a marker. In plugin
settings, change **Daily-note folder** or **Filename format**. Use `YYYY`, `MM`,
and `DD` exactly once, omit `.md`, and put literal text in brackets, for example
`[Day-]DD.MM.YYYY`. An empty folder means the vault root. Missing folders are
created only when you explicitly create a note. Settings changes do not move or
rename old notes.

Month labels and weekday names follow your locale. Week order follows the
locale where supported, otherwise Monday comes first. Filenames remain
deterministic Gregorian dates. A selected date does not shift when your time
zone changes; **Today** uses your current local date when selected.
Creation and update timestamps are displayed on the corresponding day in your
current local time zone.

In the month grid, use arrows for days/weeks, Home/End for the current week,
Page Up/Down for months, and Shift-Page Up/Down for years. Tab leaves the grid.
Month and selected-date fields are also keyboard accessible. Navigation alone
does not create notes.

To include another Markdown note, optionally add YAML frontmatter:

```markdown
---
date: 2026-09-01
---
# Planning
```

Only a valid top-level date-only scalar is used; quoted dates work. Timestamps,
aliases, custom tags, duplicate keys, and invalid dates are not interpreted.
The configured daily filename wins over metadata. Disable **Include date
metadata** to ignore date fields on ordinary notes; explicitly marked daily
notes still use their date field. Created/Last updated always use filesystem
dates. Ordinary notes need no frontmatter. Notes with unreadable or ambiguous
frontmatter are omitted from activity views with a notice, so daily notes are
not mistakenly included.

All parsing stays local. Queries are limited to 5,000 paths, 8 KiB of frontmatter
per note, and 2 MiB of document data. Views show at most 100 notes per date and
1,000 overall, with notices for limits or unavailable metadata. Refresh the
vault after external file changes or choose **Retry calendar** after a query
failure.

Locked vaults cannot expose or create notes. New notes in an unlocked encrypted
vault are written directly as ciphertext. Switching or locking vaults discards
calendar data. Disabling removes the worker, calendar, commands, and downloaded
package, but never changes or deletes daily notes or folders.

The [daily note](<../plugins/Calendar daily note.md>) and
[ordinary dated note](<../plugins/Calendar dated note.md>) both use October 14,
2026. Open them from the calendar's note list without creating another file.

## Advanced task lists

Enable **Advanced task lists** under **Productivity** to collect standard
Markdown checkboxes from the current vault. The plugin is disabled by default
and its executable code is downloaded only after you approve **Index Markdown
checkboxes and update one verified task marker after an explicit action**. It
has no network, process, clipboard, credential, or general workspace-write
permission. This version requires Denote 0.7.0 or newer.

Choose **Advanced task lists** in the activity rail or run **Show advanced task
lists** from the command palette. The consolidated view shows each task's note,
vault-relative path, source line, and enclosing heading path. Choose the note
title to open its Markdown source normally.

Use the labelled filters together:

- **Status** shows Open, Completed, or All tasks.
- **Tag** matches hashtags in the task text, such as `#work`.
- **Path** matches a case-insensitive folder or filename fragment.
- **Due** shows overdue, due today, upcoming, undated, or every task.

Due dates use one portable plain-text token:

```markdown
## Release

- [ ] Ship the installer #work due:2026-10-01
- [x] Publish the notes #docs
```

No custom task file is required. Standard `-`, `*`, and `+` GFM checkbox items
remain ordinary Markdown and continue to render and edit normally without the
plugin. YAML frontmatter, fenced examples, and indented code are not tasks.
Recurring-task syntax is intentionally left uninterpreted so disabling Denote
never changes its meaning or recreates completed items unexpectedly.

Each checkbox is a native keyboard control: Tab reaches filters, note links,
and tasks in reading order; Space toggles the focused task; focus always remains
visible. If a completed or reopened task leaves the active Status filter, focus
moves to the nearest remaining task or back to Status. Progress and conflicts
are announced politely.

The source line number is only a label. To survive nearby edits, the plugin
relocates the exact task line under the same heading and checks its occurrence
and duplicate count. Denote then independently verifies that the plugin changed
exactly one `[ ]`, `[x]`, or `[X]` marker and no other byte. Missing, changed, or
ambiguous tasks report a conflict instead of overwriting the note.

For an open note, the checkbox changes in its current editor buffer and follows
ordinary autosave behavior, preserving other unsaved edits. For a closed note,
Denote re-reads the current file and saves with its content hash, original
encoding, line endings, revision history, encryption rules, and vault identity.
A note that opens, changes externally, or moves to another vault during the
action is refused safely.

Indexing remains local and is limited to 5,000 UTF-8 Markdown notes, 256 KiB per
complete note, and 8 MiB total. Requests are chunked, and a query shows at most
1,000 tasks and 256 tags. Skipped files, malformed Markdown, invalid due tokens,
and reached limits are shown as notices. Use **Refresh current vault** after an
external edit.

Locking or switching vaults clears the derived index and stops the worker.
Disabling removes the view, worker, downloaded code, and cached archives, but
never changes or deletes task Markdown.

Try [Advanced tasks](<../plugins/Advanced tasks.md>) for open/completed items,
headings, hashtags, due dates, and a fenced checkbox that is not indexed.

## Reminders

Enable **Reminders** under **Productivity** in Denote 0.7.1 or newer. It is off
by default and asks for separate **Reminders** and **Notifications** approvals
only when you choose **Enable**. It has no network, process, clipboard,
credential, general workspace-read/write, DOM, or native API access.

Choose **Reminders** in the activity rail. No note is required: **No note**
creates a standalone reminder. When a UTF-8 Markdown note is open, the target
list also offers the whole note, parsed headings, and standard tasks. Enter a
name and future local date and time. **Edit** changes the name, target, date,
time, or repeat rule without changing note bytes.

Wall-clock reminders retain the civil time and the IANA time zone shown in the
form. Changing the computer's current time zone does not rewrite that intent.
When a daylight-saving fall-back hour repeats, Reminders uses its earlier
occurrence. A time skipped by a spring-forward transition is refused instead of
moving silently. **Snooze** schedules the configured number of minutes from
now. Repeat rules support every N days, weeks, months, or years. Monthly and
yearly schedules clamp to the last day of a short month. A recurring occurrence
inside a skipped daylight-saving time is skipped rather than moved silently.

Denote rechecks reminders while running, when the window regains focus, after
sleep, and when the plugin or vault becomes available again. Overdue reminders
therefore catch up after an application restart. Up to five are sent as
individual native notifications; a larger backlog uses one summary
notification while every item remains listed in the panel.
Each due reminder also creates an in-app banner. Up to three banners remain
visible; an additional count points to the panel. The bell in the activity rail
shows a numbered badge and exposes the same count to assistive technology.

The Reminders panel is the reliable action surface:

- **Edit** changes the reminder.
- **Open note** appears only for linked reminders and uses ordinary Denote
  navigation.
- **Snooze** reschedules a notified or failed reminder.
- **Dismiss** removes a one-time reminder.
- **Next occurrence** advances a recurring reminder; **Delete series** removes
  it completely.
- **Cancel** or **Cancel series** removes a future reminder.
- **Retry notification** repeats only a failed native dispatch.

Desktop operating systems do not expose one portable notification-button or
click callback through Tauri, so these actions do not appear inside the system
banner. A status of **Notification requested** means the operating system
accepted the request; Focus, Do Not Disturb, lock-screen policy, or disabled
notification-center settings can still hide it. A command failure stays written
in the panel with its retry action.

Persisted links keep the vault-relative note path and a generic heading/task
source line, not copied heading or task body text. Reminder names and note paths
live in local application plugin data outside vault encryption and may appear in
the operating system's notification history or lock screen. Disablement removes
the view, stops the worker, and cancels host scheduling without deleting those
records. Use **Clear data** in plugin settings to remove them.

Try [Reminder targets](<../plugins/Reminders.md>) for standalone, note, heading,
and task targets. The example never creates a reminder until you choose a future
time yourself.

## Note graph

Enable **Note graph** under **Knowledge management** to see how Markdown notes
link to one another. The plugin is disabled by default and its executable code
is downloaded only after you approve **Index and visualize bounded local note
connections**. It has no network, process, clipboard, credential, or note-write
permission.

Choose **Note graph** in the activity rail. **Global** shows the bounded
connection map for the vault. **Local** starts from the active Markdown note and
shows notes within one, two, or three incoming or outgoing connections. If the
active file is not in the graph, Local explains that no neighborhood is
available instead of changing files or filters.

Use **Open Note graph in a tab** in the graph header, or run that command from
the command palette, to give the graph a complete editor pane. The graph tab can
be reordered, grouped, moved between panes, and docked like other tabs. It is
temporary: Denote never saves it into the vault or restores it next launch.
Choosing a node opens or focuses a separate note tab, so the graph remains
available when you return. That note becomes the Local starting point.

Use the filters to limit the result:

- **Folder** includes that folder and its descendants. **Vault root** selects
  only root-level notes.
- **Tag** matches the normalized hashtags already present in each note.
- **Connections** shows every note, only orphans with no incoming or outgoing
  link, or only connected notes.
- **Depth** appears in Local mode and limits the neighborhood to one, two, or
  three connections.

The graph view uses a stable local constellation. Select a node to open that
note through Denote's ordinary navigation. Zoom controls change only the visual
plot; the full tab offers a wider zoom range and shows more labels. Choose
**Show keyboard note list** for the equivalent searchable list.
Tab enters the list once; Up/Down move one note, Home/End move to the first or
last visible note, and Enter opens it. Every row states its title, relative
path, and incoming/outgoing connection counts.

Drag any visual node to rearrange the constellation. The dragged note stays
under the pointer, linked notes follow naturally, and nearby notes move aside.
Release to let the graph settle. A press that does not move still opens the
note. These positions are temporary view state and never change links or
Markdown. When reduced motion is enabled, dragging remains direct but the graph
updates without animated settling.

The worker indexes standard inline links plus full, collapsed, and shortcut
reference links. Relative paths, vault-root paths, percent-encoded names, and
extensionless `.md` / `.markdown` targets are supported. Images, browser links,
other URI schemes, fragment-only links, links that escape the vault, malformed
targets, and links back to the same note are not graph edges.

Indexing and filtering stay entirely local. The first view receives a bounded
snapshot; later note changes send only changed or removed paths. Adding or
removing a note can resolve links already present in unchanged notes without
reparsing their Markdown. Autosaves and external-file refreshes feed the same
incremental path.

Input is limited to 5,000 UTF-8 Markdown notes, 256 KiB per note, and 8 MiB in
total. Indexing sends at most 256 notes and 512 KiB to the worker at once.
Removal batches carry at most 512 paths. Connection analysis keeps at most
100,000 resolved links, and the visible model is limited to 500 nodes and 2,000
edges. Notes or connections beyond a limit are omitted with a written notice so
large vaults remain responsive.

Closing the view releases its rendered model. Locking or switching a vault,
disabling or updating the plugin, a crash, or application exit releases the
worker's derived index. Disabling or removing Note graph never edits, reformats,
or deletes Markdown.

Open [the three-note graph example](<../plugins/Note graph.md>) and use its tag
filter to isolate the sample chain from the rest of the Welcome guide.

## Mermaid diagrams

Enable **Mermaid diagrams** under **Diagrams and visualization** to render
fenced `mermaid` blocks in Markdown Rich view. The plugin is disabled by
default. Its executable package, including Mermaid 12.0.0, is downloaded only
after you approve **Diagram renderer**. This version requires Denote 0.5.2 or
newer.

Denote owns the block controls and display. **Show diagram source** opens the
ordinary editable fenced source without changing it. **Copy diagram SVG**
copies independently sanitized SVG text, and **Export diagram SVG** opens a
native save dialog. These actions are keyboard reachable, use visible focus,
and report completion through a polite status announcement.

Supported detector families are C4, flowchart, swimlane, ER, Git graph, Gantt,
pie, quadrant, XY chart, requirement, sequence, class, state, journey,
timeline, mindmap, Kanban, Sankey, packet, radar, block, tree view,
architecture, event modeling, Ishikawa, Venn, treemap, Wardley, Cynefin, and
railroad. Put an optional first line such as
`%% denote:title: Note workflow` in the fence to provide a bounded accessible
figure name. Otherwise Denote uses **Mermaid diagram**.

YAML frontmatter may provide only a simple `title` and, for Gantt,
`displayMode: compact`. Nested configuration, unknown keys, tags, anchors, and
aliases are rejected. Diagram labels remain visual content; screen readers
receive the explicit safe title or generic name and can always use the source
path.

Rendering is local and offline. The plugin rejects unsafe Mermaid frontmatter and initialization directives,
HTML labels, links, callbacks, custom style directives, images, icons, external
resources, and scriptable or unsafe URL schemes. Mermaid runs with strict
security, fixed host configuration, HTML
labels off, deterministic IDs, no callback binding, and a fixed local font
family inside an opaque sandbox whose CSP denies network, image, font, object,
form, and parent-origin access. Denote then sanitizes the returned SVG with a
static allowlist and displays it in a second scriptless sandbox. No plugin HTML
or React component enters the editor.

Limits are 32 KiB and 1,000 lines of source, 4 KiB per line, 500 statements,
300 edges, 10,000 sanitized SVG elements, and 2 MiB of SVG. The verified
renderer module has a 30-second initialization bound per open editor. One
diagram renders at a time, at most 32 wait, each render has a five-second watchdog,
successful derived content is capped at 32 entries or 16 MiB, and failed
renders are never retried or cached. A parse error stays beside only its block
and includes a line and column when Mermaid provides them.

Light, Dark, increased-contrast, and forced-colors changes rerender active
diagrams. Motion is disabled for reduced-motion users. Closing the tab,
switching vaults, locking an encrypted vault, disabling, updating, removing, or
crashing the plugin, and application teardown cancel stale work, destroy
sandboxes, clear derived SVG, unregister the contribution, and restore ordinary
fenced-code rendering. Markdown is never rewritten.

Open [the Mermaid decision loop](<../plugins/Mermaid flow.md>) in the Denote
Welcome vault. The earlier [simple diagram](<../examples/Mermaid diagram.md>)
remains available at its original path too.

## Other optional features

These capabilities are planned as separately enabled plugins:

- note comments and highlighting;
- text-to-speech and dictation;
- calendar and time tracking;
- colorful text.

**Git vault versioning** is now in the catalog. Enable it to get one Git view in
the activity rail that lists the vault root and every configured project root
with a safe `.git` marker. Select one repository. Denote performs one read-only
refresh every time you open the Git view, so the folder is current without
competing with vault loading while you are writing; you can still refresh or
initialize it with your configured
default branch, stage and unstage a file, commit staged changes with an optional
configured author identity, and cancel a running operation. Enabling it does not
run Git or change your vault, and it asks for no network, process, or
note-writing permission. Switching projects, or switching vaults, resets the
view and asks for a refresh, so it never shows one repository's state as if it
belonged to another.

The [Git workflow exercise](<../plugins/Git workflow.md>) uses a separate empty
practice vault and manual local commits. It never initializes the Welcome vault
or configures a remote.

Set **Automatic commit interval** above zero to let Denote commit for you on a
timer. Denote saves your open notes first, then commits only tracked files that
changed and match your include and exclude prefixes. It never adds a new file
you have not tracked yourself, and waits for the next interval when work is
already staged, a merge is unfinished, the vault is locked, or Denote is busy.
Nothing happens the moment you enable it: the first automatic commit is one full
interval later. Turn on **Push automatic commits** to use that same interval to
push only after a new automatic commit succeeds. Denote uses the current
branch's existing upstream, never creates one, and never force-pushes. A missing
upstream or failed push leaves the new commit local and tells you why. If a run
cannot finish, whatever you had staged is left exactly as it was, and if another
Git tool changed your index in the meantime Denote leaves that index untouched
and tells you so.
Changing any plugin setting reloads the plugin so the new interval, message, or
prefixes apply straight away. The default message is
`Denote automatic commit {timestamp}`. `{timestamp}` becomes the current local
time in `yyyy-mm-dd hh:mm` format when the commit runs.

You can also work with remotes. The Repository tab adds a remote, changes a
remote's URL, and removes one, and the repository section fetches, pulls, and
pushes. Denote never fetches or pulls on its own. A user-invoked pull, push, URL
change, and remote removal each ask you first and name the exact remote, URL,
and branch involved. The opt-in automatic push is the only unattended remote
action, and both manual and automatic paths offer only ordinary pushes: there is
no force push.

Choose how Denote signs in under **Remote authentication**, in the plugin's
settings. *System Git credentials* is the default and uses your configured
credential helper or OS keychain, including Git for Windows helpers installed in
system configuration. Git and GitHub CLI commands stay in the background on
Windows instead of opening console windows. *Public repository* needs no
credentials, *SSH agent* uses the agent you already have running, and *GitHub
sign-in* uses the GitHub CLI on your machine. The Git view shows the mode you
configured and sends you to Settings to change it, so it always matches what the
next fetch, pull, push, or clone will use. With GitHub sign-in you can browse
your repositories and pick one to clone.
Denote reads the token itself, uses it only for that one Git command, and
deletes it straight afterwards; it is never stored in plugin settings, written
into your repository's configuration, or shown in a message or log. Denote also
checks the address it is really about to contact, so a remote that fetches from
GitHub but pushes somewhere else is refused rather than sent your token. If a
mode is not set up, Denote says so instead of leaving Git waiting for a
password.

Open **Switch vault**, choose **Clone repo as vault**, and enter the repository
URL and optional branch. Select **Choose folder** and choose a real, empty
destination. Its path appears in the form; no clone starts yet. Select **Clone**
and confirm the URL, branch, and destination to begin. Denote checks the result
and only then opens it as a vault. Your open notes are saved
before the clone starts, so nothing you typed in the current vault is lost when
the clone replaces it. Cancelling the folder chooser does nothing at all, and
**Cancel operation** requests cancellation while a clone or repository browse is
running. Progress and any failure details stay in this dialog; its close and
vault-switch controls remain disabled until the operation settles. The footer's
**Cancel** leaves onboarding without cloning when nothing is running.
If the clone fails, the destination path and error remain visible and the folder is left exactly as
it is: you can retry, or use **Clean incomplete clone**, which asks for a
separate confirmation and deletes only that one folder. Denote never cleans it
up for you. A cloned vault that is encrypted opens on the usual unlock screen,
so no note is shown before you unlock it.
Choose an empty folder again before retrying a clone. A clone that completed but
could not be opened is reported separately; its files remain available in the
shown folder. A failed clone refreshes your previous vault only when you chose
a destination inside it; unrelated vaults are not rescanned.

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

Git plugin 0.8.0 requires Denote 0.7.1 or newer. **Refresh** shows added and
removed lines for every staged and unstaged file without opening a diff.
When a file has both kinds of changes, each row measures its own side of the
staging area. Binary and encrypted files are labeled binary. Untracked files,
conflicts, or other changes without measured statistics say **line counts
unavailable**, not `+0 / -0`; stage a new text file to see its line counts.

After a successful **Pull**, **Last remote operation** lists the files changed,
added and removed lines per text file, renamed files' previous paths, and binary
changes. It measures the net difference between the commits before and after
the pull, including merge and rebase pulls, without counting unrelated unsaved
or uncommitted edits. A pull with no file changes says so. The report stays
available through refreshes until dismissed or replaced by another remote
operation; switching repositories clears it.

Reports can list up to 5,000 files. If Git cannot supply a complete report or the
following refresh fails, Denote says that the pull already completed and reports
the follow-up problem separately. **Refresh** rereads local state; it never
repeats the pull. Use your own Git tooling to inspect a report beyond the limit.

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
GPG values into its hardened Git process. System and global config files are
optional: you do not need to create `/etc/gitconfig` to clone or detect a signing
key. Unreadable or malformed config files still report an error.
Manual commits can follow the system signing default, always sign, or never sign.
Leave **Signing key** empty to use
Git configuration, or supply an imported OpenPGP fingerprint or SSH private-key
path. Git plugin 0.9.0 uses the configured signing format and pins the resolved
program, so Git for Windows cannot shadow Gpg4win with a different bundled GPG.
Denote respects both `gpg.openpgp.program` and the legacy `gpg.program`.
Automatic commits remain unsigned.

Choose **Signing credentials → Detect signing key**. If you have pending plugin
settings edits, the button becomes **Save settings and detect signing key** and
saves them before detection; you do not need to find a separate save button.
This reads the focused project's Git configuration, or the vault repository
when no project is focused. It shows the actual format, program, key, and where
the selection came from. Without a configured OpenPGP key, Denote looks for one
usable key matching the commit identity; an ambiguous result asks you to choose
a fingerprint instead of silently signing as someone else.

To remember a key's password, enter it in **Save passphrase for this key** and
choose **Save passphrase**. This is optional and separate from plugin settings:
the password lives in macOS Keychain, Windows Credential Manager, or Linux
Secret Service, not settings JSON, exports, logs, or plugin code. It survives
restarts until **Delete saved passphrase** or **Clear credentials**. The field
clears immediately after submission, including errors. Anyone with access to
your unlocked operating-system account may be able to use saved credentials.
Without a saved password, the system agent or pinentry remains available.

**Find your signing key** provides platform-specific commands. Run these in your
repository; a Git query with no output means that setting is absent:

```bash
git config --show-origin --get user.signingKey
git config --show-origin --get gpg.format
gpg --list-secret-keys --keyid-format=long
ssh-add -L
```

On macOS/Linux, `command -v gpg` locates GPG and `ls -l ~/.ssh/*.pub` lists SSH
public-key files. In Windows PowerShell, use
`Get-Command gpg | Select-Object -ExpandProperty Source` and
`Get-ChildItem "$env:USERPROFILE\.ssh" -Filter *.pub`.
If GPG is not on PATH, invoke your installed executable directly, for example:

```powershell
& 'C:\Program Files (x86)\GnuPG\bin\gpg.exe' --list-secret-keys --keyid-format=long
```

Use the OpenPGP fingerprint shown beneath the secret key, not the path to an
exported private-key file. For SSH file signing, use the matching private-key
path without `.pub`; an SSH public key uses the agent instead. Never paste
private-key contents or passwords into commands or bug reports.

If Git reports **exit 128 / cannot sign the data**, the details now retain GPG's
reason, such as a missing secret key or a bad passphrase. Check the detected
program and keyring first, especially when both Git for Windows and Gpg4win are
installed. Replace or delete a wrong saved password. Denote keeps your staged
work and never retries without a signature.

The manual commit form provides **Sign commit**, enabled by default for each
submission, plus **Commit** and **Commit and push**. Turn signing off for an
unsigned commit. If you leave the message blank, Denote uses
`Denote manual commit {timestamp}` and resolves the placeholder to the current
local time in `yyyy-mm-dd hh:mm` format. For an encrypted SSH signing key, enter its passphrase in the
password-style field that appears while signing is selected. It also supports
OpenPGP: Denote uses it once instead of a saved passphrase and clears it
immediately; the plugin never receives it. Leave it empty to use a saved
password or your system agent. X.509 always uses system pinentry.

Plugin icons in the activity rail can be reordered by dragging. **Organize
plugins** also provides keyboard move controls, optional group names, group
collapse/expand controls, and a **Hidden plugins** section for restoring hidden
entries. These preferences affect only the local sidebar.

Development builds have a **Load local plugin archive** action in this section.
It accepts a locally built `.tgz`, labels it as a local development archive, and
still requires permission approval before enablement. Disable it before loading
a rebuilt archive with the same ID. Installed releases do not expose this
action.
The picker opens without waiting for Git or GitHub CLI checks. While it is open
or Denote is verifying the selected archive, the button shows **Loading local
plugin archive…** and cannot open another picker. Cancel to leave the catalog
unchanged; a failed verification reports an error and lets you retry.

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
keychain isolation, restart restoration, and package removal. It has no Welcome
example because it is an SDK/lifecycle fixture, not a user workflow. Remaining
production feature plugins are tracked separately.

[Back to Welcome](<../Welcome.md>)

#guide #plugins
