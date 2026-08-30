# Development

## Prerequisites

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 24.15 or newer, and stable Rust.

## Run Denote

```bash
npm ci
npm run tauri dev
```

## Validate changes

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Validate plugin manifests, package structure, documentation, type safety, and
editor/plugin import boundaries separately with:

```bash
npm run check:plugins
```

Plugin source belongs under `packages/plugins/<plugin-id>/` and may import
`@denote/plugin-sdk`, its own files, and declared third-party packages. It must
not import from `src/`, `@tauri-apps/*`, or another plugin package. Use
`packages/plugins/reference/` as the contract example; it is not bundled into
the Denote application.

Build the independently downloadable plugin artifacts and update catalog
integrity metadata with:

```bash
npm run package:plugins
```

Commit the resulting files under `plugin-artifacts/` with the matching catalog
change. CI rebuilds every plugin, validates the real entrypoint, checks the
committed archive contents, and verifies its catalog size and SHA-256 digest on
all supported platforms.

## Build a desktop bundle

```bash
npm run tauri build
```

The GitHub Actions workflow runs the validation commands on macOS, Windows, and
Linux.

## Prepare a release

From an up-to-date `main` branch, update every Denote version source, commit and
push the update, then create and push the matching tag with one command:

```bash
npm run release -- 0.1.1 && git add . && git commit -m "Release v0.1.1" && git push && git tag v0.1.1 && git push origin v0.1.1
```

The script updates `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json`.

Tags must use semantic versions and point to a commit on `main`. The release
workflow validates the tag against every version source and builds every
platform before it creates a GitHub Release. It stages Linux AppImage, Debian,
and RPM packages, macOS Apple Silicon and Intel disk images, and Windows MSI and
NSIS installers, then publishes them together with generated release notes.

If a release run fails, run the **Release** workflow manually and provide the
existing tag. Incomplete draft releases are replaced automatically after every
platform bundle succeeds, including duplicates left by older failed runs.
Restore a deleted tag at its original release commit before retrying.

To abandon a failed release, revert the tagged release commit, push the revert,
then remove the tag locally and remotely:

```bash
git revert --no-edit v0.1.1 && git push && git tag -d v0.1.1 && git push origin --delete v0.1.1
```
