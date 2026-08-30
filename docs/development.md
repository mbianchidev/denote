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
