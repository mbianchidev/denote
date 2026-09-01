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

Files inside any explicit project or workspace-discovered implicit project
always show line numbers. Markdown project files use the byte-preserving source
editor, so opening a project cannot rewrite callout markers or other stored
Markdown syntax. These are temporary project constraints: they do not change
the saved line-number setting or the vault's Markdown preference, and leaving
the project restores normal behavior immediately.

`.mdx` files remain non-executing, JSX-highlighted source files; project context
does not add rich editing.

Project source files use the full editor pane instead of the narrower writing
column. A vault marked as a workspace uses the same wider source layout even
before a direct child project is focused.

Open **Outline** to list detected functions, methods, types, modules, resources,
or sections with their line numbers. Select one to center and focus that line.
The code minimap below shows miniature line structure, indentation, comments,
and highlighted declaration lines. Its outlined window shows the current
viewport; click or drag anywhere on the minimap to jump through a long file.
With keyboard focus on it, use arrows, Page Up/Down, Home, or End. The slider
announces its visible line range.

## Source language

Source-only UTF-8 files show **Language:** in the status bar. Denote detects the
language from the filename using its built-in registry. Open the control to
search names, aliases, or extensions and apply an override to the current tab.

**Automatic** returns to filename detection. **Plain text** disables syntax
highlighting. An override does not rename or edit the file, does not trigger
autosave, and is discarded when the tab is closed or navigates to another file.
It is not restored with the next session.

The built-in registry covers JavaScript, JSX, TypeScript, TSX, Java, JSP, Go,
Rust, Python, C/C++, C#, Kotlin, Swift, Ruby, PHP, Dart, Lua, R, Scala, Elixir,
JSON, XML, HTML, CSS, Markdown, shell, YAML, TOML, SQL, PowerShell, SCSS, LESS,
Dockerfiles, Go module/workspace files, CMake, Makefiles, Gradle/Groovy,
Protocol Buffers, properties/INI/CFG files, Visual Studio solutions, and common
XML project manifests. It also includes LaTeX, PostgreSQL, MySQL, MariaDB,
MS SQL, PL/SQL, SQLite SQL, CQL, Jinja, Vue, Angular templates, Haskell,
Clojure/ClojureScript, Erlang, OCaml, F#, Fortran, Julia, Perl, Pascal, VB.NET,
Cobol, Puppet, Common Lisp, Terraform/HCL, and Helm templates. JSX and TSX cover
React syntax. JSP uses HTML highlighting; Java scriptlets remain readable but
uncolored.

Automatic detection leaves `.pp` as plain text because both Pascal and Puppet
use it. Choose either language from the tab override when needed. Diff
highlighting is reserved for the optional Git plugin.
Terraform files use `.tf`, `.tfvars`, or `.hcl`. Helm `.tpl` files are detected
automatically; Helm YAML templates stay YAML until **Helm template** is selected
as the tab override.

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
