# Time tracking

## Purpose

Use a standalone timer, countdowns, and alarms, or track time against Markdown
notes, their tags, and the active project. Clocks, sessions, daily and weekly
summaries, and correction history stay on this computer.

## Enablement and permissions

Time tracking 0.2.0 requires Denote 0.10.0. Enable **Time tracking** in
**Settings → Plugins** and approve **Time tracking**, **Clocks**, and
**Notifications**.
It receives only the active note's relative path, tags, and optional project
identity/root after you start a note session. It never receives note bodies, absolute
vault paths, general filesystem access, network access, or process execution.
The host provides a continuous native clock and explicit export controls.

Clock names, schedules, and session metadata are stored in local application
data, outside vault encryption.
Descriptions and exported CSV/JSON files are not encrypted. Do not put secrets
in descriptions.

## Usage

Open **Time tracking** in the activity rail and choose **Timer**,
**Countdowns**, **Alarm**, or **Notes**.

### Timer

Start the standalone elapsed timer without opening a note. Pause and resume
retain its elapsed time. **Reset timer** asks before clearing it. It is separate
from note sessions and can run alongside countdowns and alarms.

### Countdowns

Enter a name and duration from one second to seven days, optionally select
**Repeat alarm sound**, then choose **Start countdown**. Up to 32 countdowns can
exist independently. Pause, resume, or restart a row; cancel it to stop without
deleting it. Expired rows stay visible until dismissed. Delete unused rows to
make room.

### Alarm

Enter a name, a future date and time, and optionally **Repeat daily** and
**Repeat alarm sound**, then choose **Set alarm**. Each of up to 32 alarms
keeps the displayed IANA time zone. Editing requires a future schedule.
Repeated daylight-saving times use the earlier occurrence; nonexistent local
times are refused. Dismissing a daily alarm advances to the next valid future
civil occurrence, skipping daylight-saving gaps. **Snooze 5 min** overrides the
next occurrence with an instant five minutes from now.

Denote must be running to issue alerts. It catches up after sleep, throttling,
or restart; it does not install a closed-application alarm service. System
notifications and sounds depend on operating-system settings. Repeating in-app
sound needs a gesture; after restart use **Enable alarm sound** if needed.
**Stop sound** mutes current occurrences, not future ones, without dismissing
their banners. Locked-vault banners retain dismiss, snooze, and sound controls.
**Retry notification** is explicit; an interrupted dispatch may already have
appeared, so retry only if needed.

Standalone timer and countdown duration includes sleep and closed-application
time during the same boot, ignoring wall-clock changes. After a system reboot,
they pause at their last saved checkpoint. Resume only after reviewing the
recovery notice.

### Notes

Open a Markdown note, choose **Notes**, optionally enter a description, and
choose **Start timer**. **Pause timer** excludes paused
time; **Resume timer** continues the same session; **Stop timer** finishes it.
The command palette exposes the same actions. A status-bar action returns to
the running or paused timer.

Only one note timer can be active, including a paused timer and across vaults.
Changing notes does not retarget it. Return to its original vault to control it;
other vaults do not reveal its note metadata. Note paths, tags, and project
roots are snapshots from the start, not automatic rename tracking.

Running time includes sleep and time while Denote is closed. Restarting Denote
during the same system boot recovers the timer using the native continuous
clock, not wall-clock subtraction. Clock changes keep elapsed time unchanged.
After an operating-system reboot, the timer pauses at its last saved checkpoint
instead of guessing. Review or correct it, then resume or stop it.

Choose **Daily** or **Weekly**, a summary date, and grouping by note, project,
or tag. Weeks start on Monday in your current time zone. Running segments split
at period boundaries; paused time is excluded. A session with multiple tags
counts toward each tag. The host checkpoints every 30 seconds and rechecks on
focus or wake.

Choose **Correct session** on a stopped session to adjust start, end, elapsed
minutes, description, or tags. A reason is required. **Save correction** retains
the exact previous and new values; **Correction history** exposes them.
Corrections replace the pause breakdown and count corrected duration from the
corrected start. Note and project references remain historical snapshots.

**Export CSV** and **Export JSON** refresh the timer first, then ask where to
save every session in the current vault, including correction history and
running/paused checkpoints. CSV cells are quoted and formula-like text is
neutralized for spreadsheets. JSON preserves original text exactly.

## Settings

This plugin has no configurable settings. Clock state and session history are
generated plugin data, separate from settings exports.

## Disable behavior

Disabling this plugin, disabling all plugins, or clearing its data asks you to
confirm stopping clocks and alarms first. Cancelling leaves it enabled and
running. A confirmed native-clock cutoff also applies while its vault is locked;
re-enabling never counts disabled time. The standalone timer pauses, countdowns
are cancelled, and alarms are disabled. Resume, restart, or enable them explicitly.
Updates and settings reloads preserve running state rather than stopping it.

Disabling removes downloaded code, commands, views, and host checkpoints. It
does not change notes or delete session history. **Delete saved data** explicitly
deletes clocks, sessions, and correction history; export note history first.

## Troubleshooting

Use **Refresh** after a clock or wake event if the display has not caught up.
Clock, storage, export, and stale-scope failures appear in the panel. There is
no wall-clock fallback when the native clock is unavailable.

The store holds at most 500 sessions across vaults, 32 corrections per session,
512 running segments per session, and the normal bounded plugin-storage budget.
Space is reserved for stopping and recovery. Export history before clearing
plugin data to begin a new history. Corrupt stored data is never silently reset.
Exports contain only the current vault; open other vaults to export their
history before clearing all plugin data.

After a system reboot, uncheckpointed time cannot be reconstructed safely.
The recovery notice identifies this case so you can make an auditable correction.
