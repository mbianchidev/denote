# Build and compiler

## Purpose

Run an installed build tool or compiler, stream its output, and navigate errors
and warnings. This package uses the SDK's shared process and diagnostic
contracts and does not import Linter.

## Enablement and permissions

Disabled by default. Tooling permits approved local commands and version-bound
diagnostics. Project context supplies the active project identity; Sidebar adds
the build view. Enabling starts nothing and installs no compiler, build system,
language server, shell, or debugger.

Native tools and project build scripts have ordinary operating-system access.
Approve only trusted executables, arguments, and projects. Native builds are
unavailable in encrypted vaults even while unlocked; no plaintext mirror or
encryption material is provided.

## Usage

Open Build and compiler. Select a language profile or **All languages** and
choose the active project or vault scope. Choose the installed executable,
enter a JSON argument array, select its output parser, and **Save and approve**.
Use **Build** to start a new identified run.

Cargo supports `["check", "--message-format=json"]` with Cargo JSON.
GCC/Clang-style `file:line:column: severity: message` output uses Unix;
Microsoft compiler `file(line,column): severity code: message` uses MSVC.
Arguments are passed directly without implicit shell expansion. `%FILE%`
selects the current file relative to the approved working directory.

When edits are unsaved, **Save all and build** uses the ordinary save/conflict
barrier. **Run on saved files** explicitly ignores editor drafts without
overwriting them. Diagnostics from saved files are not placed on an unsaved
document. A save conflict prevents the build.

Output streams stdout and stderr separately. Each result names its build run,
project, source file, and captured source version. Failed exits remain failures.
Filter Problems by severity or text, and select a current result to navigate.
**Cancel** terminates the entire child process group, including descendants.

## Settings

Configurations are host-owned local metadata per vault, project, and language.
Automatic runs inherit the approved vault profile only for unconfigured projects;
a saved project profile, including a disabled one, overrides it.
Manual runs are the default; on-save builds require explicit approval. Builds
never consume a pretend unsaved snapshot or silently save a draft. Choose column
units to match compiler output and a timeout from 1 to 600 seconds.

Source and output limits match the shared Linter contract: 5,000 source files,
4 MiB per file, 64 MiB total, 8 MiB output, 64 KiB per line, and 1,000 diagnostics.
There is no tool downloader or fallback command.

## Disable behavior

Disabling cancels all builds, clears derived diagnostics and output, unregisters
the view, and removes downloaded plugin code. Source, generated build outputs,
and existing project files are not removed. Clearing plugin data also removes
saved command approval.

## Troubleshooting

Check the executable, JSON arguments, working directory, output parser, and
column units. Updated executable bytes require approval again. Missing tools,
invalid output, nonzero exits, timeouts, and limits remain visible. If files
change during a run, stale diagnostics are discarded; run again after saving.
