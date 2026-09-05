# Denote

Denote is a local-first desktop workspace for people who want a focused rich
Markdown editor without giving up ownership of their files. Open any folder as a
vault. Denote edits its contents in place and keeps optional workspace metadata
on your device.

<img width="1707" height="1094" alt="image" src="https://github.com/user-attachments/assets/82c52973-0f60-4345-8dda-309ed0d6d9d4" />

## Main features

- Rich Markdown editing with a source mode when exact syntax matters
- Fast local search across notes, file paths, tags, and metadata
- Native files, folders, tabs, links, images, and multiple vaults
- Autosave, revision history, Denote Trash, and conflict-safe writes
- Optional vault encryption with one-time recovery codes
- macOS, Windows, and Linux support through Tauri

Your vault remains a normal folder. Denote does not require an account, cloud
storage, telemetry, or a proprietary document format.

## Downloads

Tagged versions are published on
[GitHub Releases](https://github.com/mbianchidev/denote/releases) with desktop
bundles for Linux, Windows, and both Apple Silicon and Intel Macs. Optional
plugin archives are separate release assets downloaded only when installed;
they are not bundled in the desktop installers or committed to the repository.
Plugin source and immutable release metadata live under `plugins/`; generated
archives are staged only in ignored `.plugin-artifacts/`.

## Documentation

Read the [project documentation](docs/index.md) or start with the
[development guide](docs/development.md).

Plugin authors can use the targeted local workflow documented under
[plugin development](docs/development.md). Each plugin owns its source, manifest,
guide, tests, and release ledger; the shared contract remains in
[`packages/plugin-sdk`](packages/plugin-sdk).
