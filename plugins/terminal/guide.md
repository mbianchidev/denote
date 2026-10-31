# Ghostty terminal

## Purpose

Open interactive terminal tabs using Ghostty's bundled WebAssembly terminal
engine through the maintained ghostty-web adapter. The host owns the renderer,
PTY, input, working directory, and process lifetime; downloadable plugin code
only registers the terminal surface.

## Enablement and permissions

Disabled by default. Terminal permits interactive shells only after explicit
executable and argument approval. Project context selects an active project;
Sidebar adds the terminal view. Enabling neither chooses nor starts a shell.
No shell, compiler, debugger, language server, or binary is downloaded.

Shells have normal operating-system permissions, not the plugin worker sandbox.
Use trusted shells and projects. All native tooling is refused in encrypted
vaults, including while unlocked; Denote passes no plaintext mirror, decrypted
document, or encryption key to the terminal.

## Usage

Choose an installed shell, enter its arguments as a JSON array, and **Save and
approve**. **New terminal** starts a tab in the selected project or vault root.
Use terminal tabs to switch sessions, and **Close terminal** to close one.
Closing a running tab asks before terminating its shell and jobs.

Terminal input, normal ANSI colors, Unicode, resize, and shell exit codes are
preserved. Use the named Copy, Paste, and Search controls. Multiline or
control-character paste is reviewed before submission. Tab can leave the
terminal; use the explicit **Send Tab** control for shell completion.
Keyboard users can inspect output and activate detected file and HTTP(S) links
through ordinary buttons. File links stay within the captured project; external
URLs use Denote's existing external-link approval.

## Settings

Shell configurations are local application metadata per vault and project,
never Markdown. Do not put passwords or tokens in command arguments. Shell
history follows the chosen shell's normal configuration; Denote does not save
terminal output or history to the vault.

Interactive PTYs currently support macOS and Linux. Windows reports that
process-tree shutdown is not yet verified and does not start a shell. The host
limits terminal tabs to eight, cells to 2-500 in each dimension, queued output
to 1 MiB, and each input request to 64 KiB. Displayed scrollback is bounded.

## Disable behavior

Closing a terminal terminates its shell and interactive job groups and releases
PTY and renderer resources. Changing the focused project preserves each tab's
captured root. Removing or moving that project invalidates its sessions. Vault
switches, disable, crashes, and app shutdown terminate sessions without leaving
a background shell. Vault switches and quitting warn about running terminals.
Disabling
also removes downloaded plugin code and derived output, never project content.

## Troubleshooting

Shell startup errors and nonzero exits remain visible on their tab. Reapprove
updated executable bytes. If output exceeds the bounded queue, Denote stops
the shell and reports the limit rather than silently dropping output. On
unsupported platforms, ordinary editing and the other plugins remain available.
