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
`packages/plugins/denote.reference/` as the contract example; it is not bundled into
the Denote application.

Create a complete package skeleton and draft catalog entry with:

```bash
npm run create:plugin -- denote.example "Example plugin" productivity
```

The scaffold includes the manifest, required guide sections, icon, package
metadata, and SDK entrypoint. Implement and test it entirely inside that folder
before packaging.

Plugin packages cannot declare npm lifecycle scripts or executable `bin`
entries. CI checks this before dependency installation, installs with lifecycle
scripts disabled, audits JavaScript and Rust dependencies, and rejects new
high-severity dependency vulnerabilities.

Build the independently downloadable plugin artifacts and update catalog
integrity metadata with:

```bash
npm run package:plugins
```

Commit the resulting files under `plugin-artifacts/`, then pin a new artifact
URL to that commit:

```bash
DENOTE_PLUGIN_ARTIFACT_REF=$(git rev-parse HEAD) npm run package:plugins
```

Commit the catalog-only pin separately. Existing versions retain their immutable
URL when repackaged. CI rebuilds every plugin, validates the real entrypoint,
checks the committed archive contents, requires a 40-character commit pin, and
downloads every pinned URL with a timeout and strict byte bound, checks safe
archive paths/types/sizes, and verifies catalog size and SHA-256 digest on all
supported platforms.

## Build a desktop bundle

```bash
npm run tauri build
```

The GitHub Actions workflow runs the validation commands on macOS, Windows, and
Linux.

## Extend core syntax highlighting

Built-in languages are declared in `src/lib/syntaxLanguages.ts`. Add or change a
language there rather than creating separate source-file and Markdown maps.
Every entry must define a stable ID, display name, preferred fence identifier,
search aliases, explicit extensions or filenames, and a bundled asynchronous
CodeMirror loader.

Add synthetic table-driven coverage in `src/lib/syntaxLanguages.test.ts`, plus
editor or combobox coverage when behavior changes. Update the product,
architecture, design, and canonical user guide language lists together. New
grammar dependencies must be direct dependencies, lazy-loaded, included in
`package-lock.json`, and pass `npm audit`; Denote never downloads grammars at
runtime. Specialized plugin grammar support requires a separately approved typed
host contract and is not part of plugin API version 1.

Terraform/HCL uses the direct `codemirror-lang-hcl` dependency. Helm has no
maintained package, so its small core stream tokenizer stays in
`src/lib/syntaxLanguages.ts` and must retain synthetic coverage for YAML keys,
template actions, functions, variables, comments, and control blocks.

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
