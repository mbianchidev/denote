# Linter

## Purpose

Run an installed linter and inspect its errors and warnings without leaving the
source editor. Linter and Compiler share host process and diagnostic contracts,
not plugin implementation.

## Enablement and permissions

Disabled by default. Tooling permits bounded, versioned diagnostics and local
commands only after you configure and approve their exact executable and
arguments. Sidebar adds the Linter view; Project context selects the active
project or the vault root. Enabling never starts a linter.

Native tools run with your operating-system permissions. Approve only trusted
tools and projects. Denote never installs tools and refuses encrypted vaults,
including while unlocked. No plaintext mirror or encryption key is provided.

## Usage

Open Linter, select a language and scope, and choose an installed executable.
Use **Save and approve**, then **Run linter**. Arguments are a JSON array, not
a shell command. `%FILE%` expands to the selected file relative to the working
directory. Choose the Unix, MSVC, ESLint JSON, or Cargo JSON output parser.

For ESLint, approve the installed interpreter and ESLint entrypoint with
`--format json`; enable stdin and add `--stdin` and `--stdin-filename %FILE%`
as separate arguments. Do not use `--fix` or write flags. Fix proposals returned
by the linter appear under Problems as **Preview fix**. Open the matching
editable Source view, inspect Before and After, then choose **Apply fix**.
Application is undoable and never replaces an intervening edit or external save.

Problems can be filtered by severity and text. Select a result to navigate to its
file, line, and column. Inline underlines, gutter indicators, and hover details
supplement the list. A clean run clears earlier diagnostics. Edits, project
changes, and external source changes invalidate stale results.

## Settings

Commands are local application metadata, separately approved per vault, project,
and language. Automatic runs use an approved vault profile only when no project
profile exists; a saved project profile overrides it, including explicit
disablement. Choose manual, on-save, or debounced runs. Debounced runs require
stdin so the linter receives current unsaved content without a temporary file.
Saved-file runs require saving edits or explicitly choosing saved files.
Configure column units to match the tool: UTF-16 for ESLint/MSVC, Unicode for
Rust, or UTF-8 bytes when the tool emits byte columns.

The host limits source snapshots to 5,000 files, 4 MiB per file, and 64 MiB total;
output to 8 MiB and 64 KiB per line; results to 1,000 diagnostics; and timeouts
to 1-600 seconds. Narrow large projects rather than treating omitted results as
a clean run.

## Disable behavior

Disabling stops every process, clears diagnostics and pending fixes, unregisters
views, and removes downloaded plugin code. Notes remain unchanged. Configuration
persists until plugin data is explicitly cleared.

## Troubleshooting

Missing executables, changed executable hashes, malformed output, failed exits,
timeouts, and output limits remain visible. Review and approve an updated
executable again. Use **Cancel** for a running linter. A stale fix must be
generated and previewed again. For tools that read project configuration or load
extensions, trust those files before approving execution.
