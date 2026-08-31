# Editor display

Open **Editor settings** from the editor toolbar, the macOS application menu,
or with `Command-,` on macOS and `Ctrl-,` on Windows and Linux. Preferences
persist across launches.

## Text size

Choose an editor font size from 12 to 24 px. It applies immediately to rich
Markdown, source mode, programming files, plain text, and Base64 without scaling
the surrounding application controls.

Use `Command-+`, `Command--`, and `Command-0` on macOS, or `Ctrl-+`, `Ctrl--`,
and `Ctrl-0` on Windows and Linux, to increase, decrease, or reset the size.

## Tab indentation

Choose two or four spaces. Pressing Tab uses that width in Markdown source,
plain and programming files, and fenced code blocks in rich mode. Press Escape
then Tab when you want to move keyboard focus out of a CodeMirror editor.

## Display guides

The settings can show:

- line numbers;
- spaces as dots and tabs as arrows;
- `LF`, `CRLF`, or `CR` line-ending markers;
- trailing whitespace.

These are visual CodeMirror decorations. They never enter the document or alter
save hashes. Because rendered rich Markdown does not map one-to-one to source
lines, enabling a guide keeps Markdown in source mode until all guides are off.
The rich/source controls stay visible but disabled. Hover their wrapper for the
tooltip; keyboard focus announces the same reminder to disable line numbers and
invisible-character guides before switching modes.

Code blocks, syntax tokens, gutters, selections, cursors, and matching brackets
use complete dark and light palettes.

## Project files

Files inside any marked project always show line numbers. Markdown project files
also use Source mode. These are temporary project constraints: they do not
change the saved line-number setting or the vault's Markdown preference, and
leaving or unmarking the project restores normal behavior immediately.

`.mdx` files remain non-executing, JSX-highlighted source files; project context
does not add rich editing.

## Session restore

**Reopen tabs from the last session** is enabled by default for each vault. It
restores pane count, layout and sizes, focused pane, open files, pane
assignments, order, named groups, collapsed state, and active files. Turn it off
here when a vault should always open with one empty pane.

## External domains

The same Settings dialog lists domains approved for HTTP and HTTPS links. Remove
an exact domain at any time. If `*` is shown, every external web domain is
allowed; remove it or clear permissions to restore confirmation prompts.

[Next: Keyboard shortcuts](<Keyboard shortcuts.md>)

#guide #editor
