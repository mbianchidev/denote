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

Update every Denote version source with one command:

```bash
npm run release -- 0.2.0
```

The script updates `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json`. Commit the version update through a pull request.
After that commit reaches `main`, create and push the matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Tags must use semantic versions and point to a commit on `main`. The release
workflow validates the tag against every version source, creates a draft GitHub
Release, builds Linux x64, Windows x64, macOS Apple Silicon, and macOS Intel
bundles, uploads them, and publishes the release only after all builds succeed.

If a release run fails after the tag is pushed, run the **Release** workflow
manually and provide the existing tag. The workflow checks out that tagged
source, reuses its draft release, and resumes the platform builds without moving
or recreating the tag. Restore a deleted tag at its original release commit
before retrying. If failed attempts left multiple drafts for one tag, delete the
stale duplicates first; the workflow refuses to choose between them.
