# Ghostty terminal exercise

This is an opt-in, invented exercise. Opening it does not choose a shell,
execute a command, or change terminal settings.

1. Read [Ghostty terminal](<../docs/Optional plugins.md#ghostty-terminal>).
2. Enable Ghostty terminal in **Settings → Plugins**.
3. On macOS or Linux, choose a trusted installed shell and explicitly
   **Save and approve**. Windows reports its current PTY limitation.
4. Choose **New terminal**. Verify the starting root before typing anything.
5. Try a harmless command you enter yourself:

   ```sh
   printf 'Synthetic terminal output\n'
   ```

6. Open another terminal tab, resize the sidebar, search output, and copy a
   selection. Tab leaves terminal input; **Send Tab** sends shell completion.
7. Try **Open in Denote** with `code/hello.ts:1:1` from the vault root.
   File links resolve from the tab's starting root, not a later shell `cd`.
8. Close a running tab and inspect the termination warning before confirming.
   Disabling the plugin or quitting also cleans up terminal jobs.

Shells have normal operating-system permissions. Keep secrets out of settings.
Encrypted vaults refuse terminals, even while unlocked, and expose no keys.

[Plugin examples](README.md) | [Optional plugins](<../docs/Optional plugins.md>)
