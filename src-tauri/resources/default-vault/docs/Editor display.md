# Editor display

#guide #editor

Open **Editor display settings** from the editor toolbar. Preferences persist
across launches and can show:

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

**Reopen tabs from the last session** is enabled by default for each vault. It
restores open files, order, named groups, collapsed state, and the active file.
Turn it off here when a vault should always open with an empty tab strip.

[Next: Keyboard shortcuts](<Keyboard shortcuts.md>)
