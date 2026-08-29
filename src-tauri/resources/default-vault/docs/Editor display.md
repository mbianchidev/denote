# Editor display

#guide #editor

Open **Editor settings** from the editor toolbar. Preferences persist across
launches.

## Text size

Choose an editor font size from 12 to 24 px. It applies immediately to rich
Markdown, source mode, programming files, plain text, and Base64 without scaling
the surrounding application controls.

Use `Command-+`, `Command--`, and `Command-0` on macOS, or `Ctrl-+`, `Ctrl--`,
and `Ctrl-0` on Windows and Linux, to increase, decrease, or reset the size.

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

## Session restore

**Reopen tabs from the last session** is enabled by default for each vault. It
restores open files, order, named groups, collapsed state, and the active file.
Turn it off here when a vault should always open with an empty tab strip.

[Next: Keyboard shortcuts](<Keyboard shortcuts.md>)
