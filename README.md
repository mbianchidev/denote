# Denote

Denote is a local-first desktop workspace for people who want a focused
Markdown editor without giving up ownership of their files. Open any folder as a
vault: Denote edits its contents in place and keeps optional workspace metadata
on your device.

<img width="1707" height="1094" alt="Denote showing a Markdown vault, file tree, tabs, and focused editor" src="https://github.com/user-attachments/assets/82c52973-0f60-4345-8dda-309ed0d6d9d4" />

## What you can do

- Write in rich Markdown or exact source mode.
- Read multi-page PDFs locally with navigation, zoom, fitting, rotation,
  selectable text, and in-document search.
- Search local notes, filenames, paths, tags, bookmarks, and recent work.
- Organize files, tabs, groups, and up to four editor panes.
- Recover work with autosave, revision history, Denote Trash, and conflict-safe
  writes.
- Encrypt a vault with a password and one-time recovery codes.
- Opt into isolated plugins for Git workflows and a local Unicode emoji picker.
- Use persistent Light, Dark, or System appearance on macOS, Windows, and Linux.

Your vault remains a normal folder. Denote does not require an account, cloud
storage, telemetry, or a proprietary document format.

## Download

Visit the [Denote website](https://mbianchidev.github.io/denote/) for explicit
macOS Apple Silicon, macOS Intel, Windows, and Linux downloads from the latest
GitHub Release. Every release also publishes SHA-256 checksums, SBOMs, and build
provenance.

Current macOS releases are unsigned. Verify the disk image against its published
checksum before using the documented quarantine workaround in the
[getting-started guide](docs/user-guide/docs/Getting%20started.md).

## Start writing

1. Install and open Denote.
2. Choose any existing folder or create a new one.
3. Select a Markdown file, or create one with `Command-N` / `Ctrl-N`.
4. Open Settings with `Command-,` / `Ctrl-,` to choose appearance and editor
   preferences.

The included **Denote Welcome** vault is an editable offline guide. Denote seeds
it once and never overwrites your changes.

## Privacy and safety

Search, metadata, preferences, history, and optional encryption stay local.
External links require domain approval. Bug reports open as editable GitHub
drafts with bounded, redacted diagnostics; Denote never submits them
automatically. PDF rendering uses bundled assets, makes no external request,
and disables document scripting, forms, annotations, attachments, and embedded
link activation.

## Documentation and development

- [Built-in user guide](docs/user-guide/Welcome.md)
- [Product and design documentation](docs/index.md)
- [Development setup and validation](docs/development.md)
- [Optional plugin model](docs/plugins.md)
- [GitHub Releases](https://github.com/mbianchidev/denote/releases)
