# Time tracking

## Purpose

Track time against Markdown notes, their tags, and the active project. Sessions,
daily and weekly summaries, and correction history stay on this computer.

## Enablement and permissions

Enable **Time tracking** in **Settings → Plugins** and approve **Time tracking**.
It receives only the active note's relative path, tags, and optional project
identity/root after you start a timer. It never receives note bodies, absolute
vault paths, general filesystem access, network access, or process execution.
The host provides a continuous native clock and explicit export controls.

Session metadata is stored in local application data, outside vault encryption.
Descriptions and exported CSV/JSON files are not encrypted. Do not put secrets
in descriptions.

## Usage

Open a Markdown note, choose **Time tracking** in the activity rail, optionally
enter a description, and choose **Start timer**. **Pause timer** excludes paused
time; **Resume timer** continues the same session; **Stop timer** finishes it.
The command palette exposes the same actions. A status-bar action returns to
the running or paused timer.

Only one timer can be active, including a paused timer and across vaults.
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

This plugin has no configurable settings. Timer state and session history are
generated plugin data, separate from settings exports.

## Disable behavior

Disabling this plugin, disabling all plugins, or clearing its data asks you to
confirm stopping any active timer first. Cancelling leaves it enabled and
running. A confirmed native-clock cutoff also applies while its vault is locked;
re-enabling never counts disabled time. Updates and settings reloads preserve
the timer rather than stopping it.

Disabling removes downloaded code, commands, views, and host checkpoints. It
does not change notes or delete session history. **Delete saved data** explicitly
deletes all sessions and correction history; export them first.

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
