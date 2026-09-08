# Getting started

## What is a vault?

A vault is any folder you choose. Denote reads and writes the files in place; it
does not upload them or move them into a proprietary database.

The built-in **Denote Welcome** vault is created once and is otherwise ordinary.
Your edits are never replaced. Its `test` folder provides Japanese, Russian,
mixed-script, emoji, punctuation, nested-path, link, and code fixtures.

## Create or open a vault

1. Open the vault switcher in the sidebar header.
2. Choose a recent vault, or select **Open another folder**.
3. Pick an existing folder or create a new one with the operating-system dialog.

Use `Shift-Command-O` on macOS or `Ctrl-Shift-O` on Windows and Linux to open the
switcher. Denote remembers the 50 most recently opened vaults. Missing folders
remain listed but disabled.

Non-current user vaults have a remove action. Removing from the list leaves the
folder untouched. The optional checkbox moves the folder and all contents to the
operating system Trash. The current vault and built-in guide cannot be removed.

## Opening an unsigned macOS build

If you downloaded an unsigned Denote build, macOS may report that the app is
damaged. First verify the download against the release's `SHA256SUMS`, copy
`Denote.app` to Applications, then run:

```bash
xattr -dr com.apple.quarantine "/Applications/Denote.app"
```

This removes quarantine only from that app bundle. Do not use it for a download
whose origin or checksum you have not verified. A Developer ID-signed and
notarized build opens without this workaround.

## First steps

- Create a file or folder from the file-tree toolbar.
- Select a file to open it in a tab.
- Select a PDF to read it locally with page, zoom, fit, rotate, selection, and
  search controls.
- Edit normally; autosave runs after a short pause.
- Open **Settings** to choose Light, Dark, or System appearance. Light and Dark
  override the operating system; System follows it as it changes.

## About, updates, and bug reports

Open **About Denote** from the activity rail or command palette to inspect the
installed version, full source commit, operating system, architecture, package,
and update channel.

**Check for updates** uses only the configured signed stable channel. If the
build has no trusted updater public key, About says the channel is not configured
and does not download anything.

**Report a bug** opens an editable GitHub draft through Denote's normal external
domain confirmation. The draft contains bounded redacted diagnostics and no note
contents or vault paths. Review it before submitting and remove any information
you do not want to share.

[Next: Writing and formatting](<Writing and formatting.md>)

#guide #basics
