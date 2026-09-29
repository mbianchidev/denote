# Reminders

## Purpose

Create local one-time reminders linked to a Markdown note, heading, or task.
Reminder records stay in Denote's local plugin data rather than changing note
content. Requires Denote 0.7.1 or newer, including Denote 0.7.2.

## Enablement and permissions

Reminders is disabled by default. Enable it under
**Settings → Plugins → Productivity** and approve **Reminders** and
**Notifications**. Denote asks for these permissions only when you choose to
enable the plugin.

The Reminders permission supplies the active Markdown note to the isolated
worker only while the host-rendered reminder form is open. The worker returns
bounded note, heading, and task targets and stores reminder metadata under an
opaque vault scope. It receives no absolute vault path, encryption key, DOM,
Tauri API, network, process, clipboard, or general workspace-read/write access.

Native desktop notifications are best effort. Desktop operating systems do not
offer one portable action-button API through Tauri, so snooze, dismiss, retry,
and open-note controls remain in Denote's Reminders panel. Operating-system
notification settings, Focus or Do Not Disturb modes, and lock-screen policy can
still suppress a notification after the host accepts it.

## Usage

Open a Markdown note, choose **Reminders** in the activity rail, then choose the
whole note, a heading, or a standard Markdown checkbox. Enter a reminder name,
date, and time and choose **Create reminder**.

Wall-clock reminders store the selected local civil time and IANA time zone.
Changing the computer's current time zone does not rewrite that intent.
Ambiguous daylight-saving times use the earlier occurrence. A local time that
does not exist during a spring-forward transition is refused so it cannot move
silently.

When Denote is running, the host rechecks reminders against the wall clock at
least once per minute and whenever the window regains focus. After restart,
reenablement, wake, or returning to a vault, overdue reminders appear in the
panel and Denote requests a native notification. A large overdue set is
collapsed into one system notification while every reminder remains listed.

Use:

- **Open note** to navigate through Denote's ordinary file flow.
- **Snooze** to schedule the configured number of minutes from now.
- **Dismiss** to remove the reminder.
- **Retry notification** after a reported native notification error.

Heading and task text is used only to choose the target. Persisted links keep the
vault-relative note path and source line, not copied note body text. Reminder
names and note paths are local application metadata and can appear in the
operating system's notification history or lock screen according to system
settings.

## Settings

**Default snooze** controls the Snooze action from 1 minute through 24 hours.
Changing it reloads the plugin without deleting reminders.

## Disable behavior

Disabling stops the isolated worker, removes the Reminders view, cancels every
host timer and in-flight delivery, and deletes downloaded package code and
caches. Stored reminder records remain local so reenabling can resume them.
Choose **Clear data** in plugin settings to delete those records. Notes are
never edited or deleted.

## Troubleshooting

If a notification request fails, the reminder stays visible with the error and
a **Retry notification** action. Check the operating system's notification
settings for Denote when no error appears but no banner is visible.

Open the linked note if a stored source line no longer identifies the same
heading or task after edits; Reminders never rewrites note content to repair an
anchor. A corrupt or over-quota plugin data record reports an explicit error.
Use **Clear data** only when you intend to remove all reminder metadata.
