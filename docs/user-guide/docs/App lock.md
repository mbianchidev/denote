# App lock

App lock is optional and separate from vault encryption. It protects access
through Denote, including unencrypted vaults, without changing file contents.

## Enable app lock

1. Open **Settings → Security** and select **Enable app lock**.
2. Choose **App password**, the available native device method, or both.
3. For a password, enter and confirm at least 12 characters.
4. Choose an inactivity interval, or keep **Disabled**.
5. Select **Save app lock**. Device enablement requires a native confirmation.

Touch ID works on configured, supported Macs. Windows Hello uses the device's
configured biometric or PIN verification on supported Windows desktops.
Linux supports app passwords; unavailable native methods explain why.
With both methods enabled, either can unlock Denote. Keeping an app password
also gives you an option when native authentication becomes unavailable.

## Lock and unlock

An enabled app lock starts locked on every launch. Use **Lock app** in the
activity rail or command palette, or **Lock app now** in Security settings.
Denote saves pending files and the tab session, stops plugins and native tools,
clears sensitive sessions and owned temporary clipboard files, and hides the
entire workspace.

Inactivity locking is disabled by default. A chosen interval locks after no
keyboard, pointer, wheel, or input activity. Returning from sleep or a hidden
window checks the elapsed interval. Locking stops terminal jobs; manual locks
ask first when terminals are running.

Enter your **App password** or choose the native unlock action. Cancelling or
failing authentication keeps Denote locked and clears the password field.
App unlock does not unlock an encrypted vault or the independent credential
store. Their own passwords or recovery mechanisms still apply.

## Change or disable

Use **Change app password**, enter the current and new passwords, and select
**Save app lock**. The current app password is also required for changing other
app-lock settings or disabling lock when a password exists. Device-only
configurations instead require native confirmation.

To disable it, clear **Enable app lock** and select **Save app lock**.
Forgotten app passwords cannot be recovered or reset through Denote.

If a file or tab session cannot be saved, locking is cancelled and edits stay
available. A native locking error withdraws the workspace and shows **Retry**;
check the reported state before trying again.

App lock does not encrypt files, SQLite metadata, exports, backups, or clipboard
history. Someone with access to the same OS account can access or modify those
files outside Denote. Use [vault encryption](<Vault encryption.md>) when you
also need content encryption at rest.

#guide #security
