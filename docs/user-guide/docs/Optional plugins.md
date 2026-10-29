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
as their working directory. Persistent terminals remain future plugin work.
Code intelligence has its own explicitly approved native protocol sessions.

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

## Advanced authoring

Text highlighting and coloring, Note comments, and Markdown presentation slides
are separate plugins and are off by default. Enable only
the capabilities you want. Their controls appear above an open Markdown note;
Source remains the complete portable fallback.

### Text highlighting and coloring

Select plain text in Rich or Source and choose **Text style**, or press
`Command-Shift-H` / `Ctrl-Shift-H`. Choose **Highlight** or **Text color**, a
named color, and **Apply style**.

The explicit Markdown extension is case-sensitive:

```markdown
=red=Highlighted text=red=
=blue:text=Colored text=blue:text=
```

Available names are `yellow`, `red`, `green`, `blue`, and `purple`. Opening and
switching views never changes the source. Formatting wraps only the selected
plain-text range, on one line and at most 4 KiB. Code, frontmatter, nested
styles, and ambiguous Rich selections are refused. Use Source for a more precise
selection. **Styled excerpts** offers **Show** and **Clear**; clearing removes
only that excerpt's delimiters.

Every offered text/background pair meets WCAG AA contrast in dark and light
mode. Colors have written names, inline tooltips, and an underline for
foreground styles. Keep semantic meaning in words rather than color alone.
Forced colors keep system text, backgrounds, and borders.

**Search → Filters → Notes with highlights** filters saved Markdown notes.
Leave Search text empty for one navigable result per highlighted excerpt.
Ordinary text search also finds the underlying words. Foreground-only colors
are not highlights. Highlight search processes at most 5,000 notes, 256 KiB per
note, and 8 MiB total, with 128 excerpts per note and 10,000 overall; omissions
are reported. Sources above 4 MiB remain available in the core editor.

Disabling removes code, controls, and derived search metadata, not text or
delimiters. Unsupported Markdown applications show the literal extension, with
the underlying text still readable.

Try [Text styling](<../plugins/Text styling.md>).

### Note comments

Choose **Comments**, or `Command-Option-M` / `Ctrl-Alt-M`. Select text first for
a range comment, or choose **Whole note**. Enter a body and choose **Add
comment**. Each row supports **Edit**, **Resolve**, **Reopen**, confirmed
**Delete**, and **Show text** when attached. Tab, Shift-Tab, Enter, Space, and
Escape operate the same native controls without a pointer.

The **Note comments** icon in the sidebar opens the same dialog. Its grey badge
counts open comments for the active Markdown note, including whole-note and
orphaned comments. Resolved comments are excluded; zero has no badge. Navigating
between notes refreshes the count, and adding, resolving, reopening, deleting,
or reattaching comments updates it. Opening the dialog does not clear the count:
it is an open-comment total, not an unread notification.

An exact unique quote follows nearby source edits. Repeated quotes additionally
need their original duplicate count and one exact prefix/suffix context.
Missing text, a changed duplicate count, or indistinguishable matches become
written **Orphaned** states, never a silently guessed attachment.
Display re-anchoring does not save anything.

Use **Show comments → Orphaned** to find those ranges. To reattach, close
Comments, select the intended text, reopen Comments, choose **Selected text**,
and choose **Attach to selected text**. **Attach to whole note** explicitly
removes the old range anchor. Resolved comments remain available in their
separate view.

Ownership is the exact vault-relative note path, not copied content. Renames
and moves do not guess a new owner. In the destination note, choose **Other
notes** and explicitly attach retained comments. Deleting a note does not
delete its comments; reusing its old path exposes that path's retained records.
Duplicated notes do not inherit comments.

Comments live in hidden `.denote/note-comments.json`, not the Markdown body,
SQLite note revisions, or disposable plugin-generated storage. **Back up this
file with the vault.** The version-1 JSON has owner `denote.note-comments` and a
`notes` mapping from relative paths to arrays. Records retain a UUID, body,
optional source anchor, resolved state, and creation/update Unix milliseconds.
An anchor stores exact quote/context, duplicate count, and UTF-16 offsets in
the host's normalized source; disk line endings remain unchanged. Unknown
versions, owners, fields, or corrupt data are refused without
overwriting or resetting them.

The host saves comments only after flushing the note and checking the current
note and sidecar hashes. A conflict keeps the draft and error visible; **Reload
comments** reads the current records without discarding the draft. Resolve a
note save conflict before retrying. Limits are 500 comments per vault, a 2 MiB
sidecar, 4 KiB per body/quote, and 4 MiB source.

An encrypted vault keeps this sidecar as authenticated ciphertext, including
during enable/unlock sweeps. Keep `.denote/encryption.json` with encrypted
backups. No plaintext temporary sidecar is made. Lock/switch closes the view and
stops its worker. Disabling or deleting plugin-generated data never deletes
user-authored comments or notes.

Try [Note comments](<../plugins/Note comments.md>).

### Markdown presentation slides

Choose **Open as presentation**, or `Command-Option-P` / `Ctrl-Alt-P`, on an
ordinary Markdown file. Only this mode treats an exact standalone `---` or
`===` line as a new slide. In ordinary note mode they remain thematic breaks
and Setext headings. Separators inside fenced code or an opening YAML
frontmatter block are not split.

```markdown
# Example deck

A small Markdown presentation.

---

## Formatting

Use *emphasis* and **bold** text.

---

## Last slide

Use `---` to separate slides.
```

Source and preview share the same file. Moving the source caret selects its
slide; navigation reveals the matching source. **Overview** selects slides and
provides **Earlier** / **Later** reorder controls. Reordering preserves the
original frontmatter, unknown fields, and slide content, adding a missing
separator-boundary newline only when needed.

Optional opening YAML frontmatter configures the presentation:

```markdown
---
title: Synthetic deck
author: Example team
presentation:
  theme: dark
  aspect-ratio: "16:9"
  alignment: left
  slide-numbers: true
  autoplay: false
  advance-seconds: 10
  loop: false
  transition: none
---
# First slide

---

# Second slide
```

`title` and `author` are single lines of at most 200 UTF-8 bytes. The
`presentation` mapping accepts:

| Field | Values | Default |
| --- | --- | --- |
| `theme` | `system`, `dark`, `light` | `system`, following Denote |
| `aspect-ratio` | `"16:9"`, `"4:3"`, `"16:10"` | `"16:9"` |
| `alignment` | `left`, `center`, `right` | `left` |
| `slide-numbers` | `true`, `false` | `true` |
| `autoplay` | `true`, `false` | `false` |
| `advance-seconds` | Number from 1 to 3600 | 10 |
| `loop` | `true`, `false` | `false` |
| `transition` | `none`, `fade` | `none` |

Invalid fields explain the correction and use safe defaults without rewriting
YAML. Invalid YAML, duplicate keys, aliases, custom tags, or non-mapping
metadata leave Source available. Limits are 4 MiB source, 256 slides, 64 KiB
frontmatter, 5,000 YAML nodes, 64 levels, and 32 notices. Empty slides and unclosed
code fences report non-blocking feedback.

**Present** enters full screen. Arrows, Page Up/Down, Home, and End navigate;
Space on the slide plays/pauses, P pauses, and Escape exits. Native **Play**,
**Pause**, **Restart**, **Stop**, interval, **Loop**, and countdown controls stay
available. A positive interval uses absolute monotonic deadlines, so late ticks
do not accumulate drift. Manual navigation resets the deadline. Autoplay from
frontmatter starts only after an explicit Present action, not on opening.
If the webview lacks element fullscreen, Denote uses its native window and a
modal focus boundary, then restores the prior window state on exit.

Changing interval/loop, editing Source, hiding or blurring the window, leaving
the active pane, exiting full screen, closing the deck, or losing the plugin
pauses playback. It never resumes automatically. Reduced motion disables fade.

Preview reuses Denote's note renderer for headings, lists, tasks, quotes,
tables, links, images, highlighted code, and callouts. Enabled Mermaid can render
its fences; it is not required. Unsafe HTML does not execute, links retain the
normal external-domain review, and images follow the existing loading policy.

**Return to note**, disablement, removal, crash, lock/switch, and close release
the preview, renderer scopes, full-screen ownership, timers, and listeners.
Markdown, separators, and metadata remain readable and unchanged.

Try the [Presentation deck](<../plugins/Presentation.md>).

## Speech, voice notes, and transcription

Speech is off by default. Enable it under **Accessibility**, open a Markdown
note, and choose **Speech** in the activity rail, command palette, or note
toolbar. Its sidebar stays beside the note rather than blocking the editor. Its single
permission opens trusted host controls; downloaded plugin code never receives
note text, audio, transcripts, device handles, or filesystem access.

**Read note aloud** and **Read selection aloud** use installed voices explicitly
identified as local. Choose **Local voice** and **Speech rate** before playback;
**Pause speech**, **Resume speech**, and **Stop speech** remain keyboard
operable. Missing offline voices are reported rather than replaced with a
remote service.

Press **Control-Space** by default in a Markdown note to start local dictation, in either
Rich or Source. Press it again, or choose **Finish recording**, to stop and
transcribe. Dictation requires the separately downloaded local model first;
the shortcut never downloads anything or silently selects a remote service.
In **Speech → Dictation shortcut**, enter a modified combination such as
`Ctrl+Shift+D`, then choose **Save shortcut**. It applies immediately across
vaults and persists on this device. **Use Ctrl+Space** restores the default.
Use Ctrl, Alt/Option, or Cmd/Command with Space, a letter, a number, or F1-F12.
Unmodified keys, malformed combinations, and existing Denote actions are
rejected without changing the active binding. Shortcut fields cannot start
recording, and focusing configuration cancels a still-pending dictation request.
Finish or cancel recording before changing its binding. OS-reserved combinations
may be intercepted before Denote receives them.
**Start recording**, **Start dictation**, and this shortcut are the only
microphone entry points. No manual caret placement or Source switch is required.
Denote uses a safely mapped caret or selection when available. Otherwise, or if
the note changed during recording, reviewed text is added to the end without
replacing existing source. The review names the insertion destination.
The panel shows written recording/paused state, elapsed
time, and input level. Pause/resume, finish, and cancel use native buttons.
Escape stops recording even while focus is in the note; it cancels a pending
permission request and also stops any
late grant. Backgrounding, closing, locking, switching vaults, and removing the
plugin release capture and playback resources. Opening another dialog stops
capture and clears unsaved audio and transcript drafts; nothing resumes
automatically afterward.

Recordings are limited to ten minutes and normalized to mono PCM16 WAV at
16 kHz. Review the stopped recording, then choose **Save voice note**. Denote
creates a collision-safe `assets/voice-<UUID>.wav` beside the note and inserts
an ordinary relative Markdown link only after checking the saved note version.
Unrelated source and disk line endings remain unchanged. Encrypted vaults
encrypt audio at rest; no decrypted audio temporary file is made.

Supported ordinary inline links to local WAV, MP3, M4A, AAC, Ogg, Opus, FLAC,
and WebM files offer play/pause, seek, volume, speed, and confirmed unencrypted
download. The ordinary link stays available. Playback/decoding support depends
on the webview; unsupported formats keep their link and explain recovery.
Only one player retains decoded audio at a time.

**Local transcription model** separately asks approval for the pinned NVIDIA
Nemotron 3.5 ASR Streaming 0.6B model, its OpenMDW 1.1 license, and the official
NeMo-Speech.cpp 0.2.0 CPU runtime. The model is 742,090,464 bytes plus about
5–7 MB for the platform runtime. Nothing downloads on enablement. SHA-256,
exact sizes, immutable model revision, and approved HTTPS origins are verified.
The offered locales are the 32 supported out-of-box locales plus automatic
language detection, not the eight adaptation-only locales requiring fine-tuning.
Unsupported systems report unavailable inference without a remote fallback.

Choose **Transcribe audio locally** after recording or importing supported
audio up to 25 MB and ten minutes. The native engine receives audio over
anonymous pipes, never a plaintext staging file or HTTP service. Review and
edit **Review transcript** before **Insert transcript**. Select returned
timestamps before editing so toggling an option cannot discard reviewed text.
Speaker labels require a separate diarization model and are not invented.
An error keeps the existing source unchanged; cancellation discards late results.

Interrupted saves use host-private SQLite recovery records containing paths and
hashes, never audio or transcript contents. Vault-supplied JSON cannot authorize
file deletion. A known current failed save rolls back only its own hash-matching
audio. Ambiguous interrupted saves retain their files and report an error in
Speech; **Unfinished audio recovery → Keep unfinished audio** explicitly clears
only that recovery metadata and leaves files for you to review.

Disabling removes worker and native runtime code, cancels transcription, and
clears temporary audio/transcript views. Saved recordings, links, notes,
accepted transcripts, and comment metadata remain. Public model weights can be
reused after re-enabling; **Remove local model and engine** or the plugin's
separate generated-data cleanup removes them. No model or runtime archive is
included in the desktop installer.

Try [Speech practice](<../plugins/Speech.md>).

## Encrypted credential store

Enable the optional store under **Security and privacy**, then choose
**Credential store** in the activity rail or command palette. Its sidebar
contains the credential table and entry forms. Enabling does not create a file.
Create a separate master password of at least 12 characters, or unlock the
existing store. There is no implicit OS-keychain remembrance or password
recovery mechanism.

All service names, usernames, URLs, entry notes, IDs, and secrets live inside
`.denote/credentials.dncred` as authenticated ciphertext, even in an unencrypted
vault. The store uses Argon2id (64 MiB, three iterations, one lane) and
XChaCha20-Poly1305 with random salts/nonces and 4 KiB size buckets. The fixed
filename, format, random header, and padded length remain observable.

After unlock, search/sort entries and use **New entry**, **Edit**, and confirmed
**Delete**. An edit keeps the old secret unless **Replace existing secret** is
chosen. The eye button (**Show secret**) reveals explicitly and changes to
**Hide secret** while visible; it masks the secret again after 15 seconds.
Service names, usernames, masked secrets, and row actions share one table.
The table scrolls horizontally in a narrow sidebar and is keyboard-focusable.
When present, an HTTP(S) service link appears below its name and opens through
Denote's external-link review. New approval is one-time: credential service
addresses are not added to allowed domains. Links with embedded credentials,
unsafe protocols, or invalid addresses are non-navigating and marked
**Unsupported service link**. External-link failures never log the address.
**Copy service**, **Copy username**, and **Copy secret** resolve the selected field natively;
plugin workers and renderer copy responses never receive its value.
Clipboard clearing is best effort, after the selected timeout, and preserves
different newer clipboard contents.

**Lock now**, the chosen inactivity timeout, focus loss, vault lock/switch,
switching away from the credential sidebar, plugin removal, and exit clear the
view and native key. Pending service-link approval is also cleared on lock. Background polling is
not activity. Failed authentication exposes no entry metadata and never
replaces an existing store with an apparently valid empty file.

**Encrypted backup** copies only the independently encrypted container.
**Import encrypted backup** validates it before replacement, requires its
master password, and additionally reauthenticates an existing current store
with explicit replacement confirmation. **Plaintext export** is separate:
choose a new destination outside known vaults/application storage, supply the
current master password again, and explicitly confirm exposure. Export approval
is one-use and short-lived. The resulting private-permission file is
intentionally plaintext and outside subsequent Denote cleanup.

Back up the hidden credential file with the vault and retain its master
password. For a damaged or unknown-format store, preserve the original file
before restoring a verified encrypted backup; Denote will not guess, reset, or
overwrite it to make an import succeed. Whole-vault decryption and plugin
code/data/credential cleanup never decrypt or delete the independent store.

Decrypted entries are not written to search indexes, note revisions, autosave
snapshots, logs, or plaintext temporary files. This is not protection against a
compromised OS/renderer, debugger, clipboard-history application, screen capture,
swap, hibernation image, or externally generated crash dump. JavaScript and
OS-owned copies cannot be reliably zeroized. Review the
[security design](https://github.com/mbianchidev/denote/blob/main/docs/phase-6-security.md)
before storing sensitive data.

Try [Credential store practice](<../plugins/Credential store.md>).

## Time tracking

Time tracking 0.2.0 requires Denote 0.10.0 or newer and is off by default.
Enable it under **Productivity** and approve **Time tracking**, **Clocks**, and
**Notifications**. Open **Time tracking** in the activity rail to choose
**Timer**, **Countdowns**, **Alarm**, or **Notes**.

### Timer, countdowns, and alarms

**Timer** is a standalone elapsed timer with start, pause, resume, and confirmed
reset. It does not require an open note. **Countdowns** supports up to 32 named
countdowns, each from one second to seven days, with pause, resume, restart,
cancel, dismiss, and delete controls. **Alarm** supports up to 32 one-off or
daily alarms, explicit date/time, edit, enable/disable, five-minute snooze,
dismiss, and delete. These modes can run alongside a note session.

Alarms keep the displayed IANA time zone. A repeated daylight-saving time uses
its earlier occurrence; a nonexistent local time is refused. Dismissing a daily
alarm advances to the next valid future civil occurrence. Countdown and timer
duration includes sleep and closed-application time during the same boot.
After a system reboot they pause at the last saved checkpoint instead of
guessing missing duration.

Denote must be running to issue alerts. It catches up after sleep, throttling,
or restart; it does not install a closed-application alarm service. Operating
system notifications and sounds depend on system settings. **Repeat alarm
sound** enables an in-app repeating tone after a gesture. After restart, use
**Enable alarm sound** if needed. **Stop sound** mutes current occurrences only;
their banners remain until dismissal or snooze. A later occurrence can sound
again. Dispatch failures offer **Retry notification**; an interrupted dispatch
may already have appeared, so retry only if needed.

Global banners keep dismiss, snooze, and sound controls available while a vault
is locked. Clock names and schedules are stored outside vault encryption;
avoid secrets in names. Confirmed disablement pauses the standalone timer,
cancels countdowns, and disables alarms. Re-enabling never resumes them
automatically. **Delete saved data** removes all clocks and session history.

### Note sessions

Choose **Notes** with an active Markdown note, optionally enter a description,
and choose
**Start timer**. **Pause timer**, **Resume timer**, and **Stop timer** are also
available as **Note tracking** commands in the command palette. The status bar
returns to an active timer.

One running or paused session exists across all vaults. Switching notes does
not change its original note, tags, or project. Return to the original vault
to control its timer; other vaults never show that note's metadata.

Running time includes sleep and time while Denote is closed. An application
restart during the same system boot recovers it using the native continuous
clock. Changing the system clock does not change elapsed time. A system reboot
pauses the timer at its last checkpoint and shows a recovery notice rather than
guessing missing duration.

Choose **Daily** or **Weekly**, a date, and a grouping by note, project, or tag.
Weeks begin Monday in your current time zone. Running segments are split across
period boundaries and paused time is excluded. Multi-tag sessions contribute to
each tag, so tag subtotals can overlap.

Stopped sessions offer **Correct session**. Change start/end time, elapsed
minutes, description, or tags and enter a reason. **Save correction** retains
the exact previous and new values in **Correction history**. A correction
replaces pause details and attributes corrected duration from its corrected
start. Note and project references retain their historical values.

**Export CSV** and **Export JSON** save all sessions in the current vault,
including audit history and active checkpoints, to a location you choose.
CSV protects formula-like cells when opened in a spreadsheet; JSON retains
original text. Neither format changes notes.

Session metadata lives in local application data outside vault encryption.
Exports are also unencrypted. Disabling, disabling all, or clearing this plugin
asks for confirmation before stopping a timer, including in a locked vault.
Cancelling leaves it running. Re-enabling does not count disabled time.
Ordinary application shutdown, plugin updates, and settings reloads retain the
running checkpoint instead.

There are no plugin settings. History is bounded to 500 sessions across vaults,
32 corrections and 512 running segments per session, plus normal plugin-storage
limits. Export every vault's history before **Delete saved data**, which removes
all stored sessions and corrections. Storage failures are visible and corrupt
data is never silently reset.

Try the [time tracking practice](<../plugins/Time tracking.md>).

## Code intelligence

Code intelligence requires Denote 0.9.0 or newer.

Enable **Code intelligence** under **Code**, then open its activity-rail panel
or find **Code:** in the command palette. The plugin supports Rust, Go, Python,
Java, C/C++, and JavaScript/TypeScript through local Language Server Protocol
tools. Debugging is separately optional. Syntax highlighting and ordinary
editing still work when no tool is installed or running.

Denote installs no language server, debugger, adapter, runtime, or project
dependency. Install the maintained tool yourself, select its real executable,
review arguments/options, check **Enable language server**, and choose **Save
and approve**. Then choose **Start language server**. Approval and execution are
different actions. Each language's server and debugger are independent.
Native tools and project configuration have your operating-system permissions;
approve only trusted tools and projects. Never paste secrets into configuration:
use the operating-system environment or your tool's secure credential support.

| Language | Language server | Installed executable arguments |
| --- | --- | --- |
| Rust | rust-analyzer | Usually `[]` |
| Go | gopls | `["serve"]` |
| Python | python-lsp-server | Choose the project's Python interpreter with `["-m","pylsp"]` |
| Java | Eclipse JDT Language Server | Choose Java with the installed launcher jar, platform configuration, and private data-directory arguments |
| C/C++ | clangd | Usually `[]`; provide compile_commands.json |
| JavaScript/TypeScript | typescript-language-server | `["--stdio"]`; TypeScript must also be installed |

On Windows choose node.exe, python.exe, or java.exe and include the installed
script/jar in its arguments. Denote never executes batch or PowerShell wrappers.
The plugin's in-app guide includes upstream links and adapter-specific setup.

The active marked project is authoritative. Without one, Denote detects the
nearest safe language marker and otherwise uses the vault root. **Current file**,
**Active project**, and **Entire vault** choose symbol scope; vault-wide tooling
has separate approval. Configuration is local application metadata, never
Markdown or a generated project file.

Completion and hover work in the source editor after starting a capable server.
Use **Show documentation**, **Signature help**, and **Format document** in the
panel. Formatting is explicit, undoable, and discarded if source changed while
the server answered; read mode never edits. Servers cannot apply unsolicited
workspace changes.

Use Definition, Declaration, Implementation, Type definition, or References.
Search symbols and filter up to 500 contextual results. Every result includes
path, project, language, symbol/container, and position. Enter
`path:line:column` to navigate without a server. Back/Forward restore the prior
file, cursor position, and project, including same-file jumps and targets already
open in another pane. External filesystem targets are not opened.

### Optional debugging

Approve the debugger separately, with independent per-project **Launch
configuration** and **Attach configuration** JSON. `${workspaceFolder}` and
`${file}` are host-expanded placeholders. Choose **Launch** or **Attach**
explicitly; missing debugging never disables language intelligence.

| Language | Maintained adapter | Transport |
| --- | --- | --- |
| Rust | CodeLLDB or lldb-dap | CodeLLDB uses Loopback TCP and `["--port","%PORT%"]`; lldb-dap uses stdio |
| Go | Delve | Loopback TCP and `["dap","--listen=127.0.0.1:%PORT%"]` |
| Python | debugpy | Python interpreter, stdio, `["-m","debugpy.adapter"]` |
| Java | java-debug in Eclipse JDT LS | Java language server transport; load its installed jar in the server's initialization `bundles` |
| C/C++ | lldb-dap or DAP-capable GDB | stdio; GDB uses `["--interpreter=dap"]` |
| JavaScript/TypeScript | vscode-js-debug standalone server | Node plus installed dapDebugServer.js and `%PORT%`, Loopback TCP |

Denote chooses the loopback port. Adapter connections are never remote, and
debugger-requested terminal/child-session launches are refused. Use an adapter's
internal console and its documented launch/attach fields.

Add source-line breakpoints, optional conditions, and log messages. Continue,
Pause, Step over/into/out, Restart, and Stop follow adapter capabilities.
Stopped sessions show threads, call stacks, scopes, variables, explicit watches,
exceptions, and console output. Select a frame or scope to inspect it. External
library frames keep their names but do not expose or open outside-vault paths.
Attach disconnect does not terminate an independently launched target.

### Recovery and limits

Missing executables, changed executable bytes, invalid arguments, unsupported
capabilities, crashes, and exhausted limits show errors/logs and restart
controls. **Cancel code request** cancels current work. Source changes and close
discard stale results. Native sessions and child groups/connections end when
stopped, disabled, updated, or torn down.

Source is limited to 4 MiB, results to 500, logs to 200 entries, and native
sessions to 12. Versionless push diagnostics are ignored after edits unless a
pull response can establish the current document. Snippets and additional
cross-file completion edits are not executed. Native code tooling is unavailable
in encrypted vaults even after unlock; no plaintext mirror is created.

Stopping only debugging keeps the language server. Stopping a language
integration also stops its debugger. Disabling removes downloaded package code,
not source or user-installed tools. Configuration remains for explicit later
starts; **Clear plugin data** forgets approvals.

Try the [code intelligence exercise](<../plugins/Code intelligence.md>).

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

### Legacy boards

Denote 0.8.2 with Kanban 0.1.4 opens existing Obsidian `.md` or `.markdown`
boards directly when their frontmatter contains `kanban-plugin: board`.
Escaped exports with `\---`, `\##`, `\- \[x]`, and encoded tabs also work as
they are. You do not need to rename or repair the file first.

**Legacy Kanban board** is read-only. Opening it, expanding card details, and
following links do not change the source. Cards retain their checked states,
tags, dates, links, and multiline text. Obsidian colors and collapsed-list
preferences are preserved as source but are not applied in Denote.

Choose **Migrate to native**, then confirm, to edit the board in Denote.
Migration keeps the filename, column/card order, checked states, links, and
complete card text. Long titles use a short preview; full text remains in the
card details. The exact original source, including all Obsidian settings and
other Markdown, stays in a fenced **Legacy Kanban source (recovery)** block
below the native board. Board view never reads that copy as active cards.
Its newline marker preserves the original end-of-file newline state.

Cancel leaves the file unchanged. A file change or read-mode switch before
migration completes rejects the result. Restore the original through revision
history or by replacing the file with the recovery block's contents. Migration
is refused if the native board plus recovery copy exceed the 4 MiB file limit.

### Native boards

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

Migrated cards show their completion checkbox. Toggling it changes only the
card marker's optional `completed="true"` or `completed="false"` attribute.
Moving or editing the card preserves that state. Older native cards without a
completion attribute keep their checkbox-free presentation. In read mode,
details can expand for reading without opening an editor.

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
now. Repeat rules support every N minutes, hours, days, weeks, months, or years.
Minutes and hours use elapsed time. Daily and longer schedules keep civil time;
monthly and yearly schedules clamp to the last day of a short month. A recurring
civil-time occurrence inside a skipped daylight-saving time is skipped rather
than moved silently.

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
- **Copy** prefills a new reminder from any Active, Completed, or Dismissed row.
- **Open note** appears only for linked reminders and uses ordinary Denote
  navigation.
- **Snooze** reschedules a notified or failed reminder.
- **Complete** moves a one-time reminder to Completed. For a recurring reminder,
  it adds that occurrence to Completed and schedules the next one.
- **Next occurrence** advances a recurring reminder without completing it.
- **Dismiss** or **Dismiss series** moves it to Dismissed without deleting it.
- **Restore** reactivates a dismissed reminder.
- **Delete** permanently removes a Completed or Dismissed reminder.
- **Cancel** or **Cancel series** removes a future reminder.
- **Retry notification** repeats only a failed native dispatch.

Use the **Active**, **Completed**, and **Dismissed** controls to switch lists.
Completed and dismissed reminders do not appear in the rail badge or create
in-app banners.

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

### Recover a rejected push

Git 0.10.1 requires Denote 0.9.0. If origin or another remote has commits you
have not pulled, **Remote has newer commits** names that branch and explains
that your commits are still local. A successful commit followed by a rejected
push is not reported as a failed commit. Authentication, network, and
protected-branch failures keep their own errors.

The recovery form uses your saved **Pull strategy**. Choose **Pull with merge**
to keep both histories, or **Pull with rebase** to replay local commits on the
latest remote branch. Rebase confirmation warns that those commit identities
change. This choice applies to that pull only. Fast-forward only stops when both
histories have new commits and asks for an explicit merge/rebase choice instead
of silently choosing one.

If a pull stops with conflicts, Denote immediately refreshes the repository and
opens Changes. **Resolve:** buttons beside the conflicted paths open the
three-way editor from any section. Mark every file resolved, then Continue;
Abort undoes the integration. Push again explicitly once the pull finishes.
Neither a rejection nor an automatic push failure starts a pull or force push.
Switching branches invalidates an old recovery action.

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
