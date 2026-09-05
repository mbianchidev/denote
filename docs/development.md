# Development

## Prerequisites

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 24.15 or newer, and stable Rust.

## Run Denote

```bash
npm ci
npm run prepare:bundled-tools
npm run verify:bundled-tools
npm run dev:desktop
```

`dev:desktop` uses the separate `dev.mbianchi.denote.development` application
identity, so development vault state, plugin packages, process locks, and
keychain entries cannot collide with an installed Denote release.

## Validate changes

```bash
npm test
npm run verify:bundled-tools
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

Bundled tool preparation accepts an explicit release target:

```bash
npm run prepare:bundled-tools -- --target aarch64-apple-darwin
npm run verify:bundled-tools -- --target aarch64-apple-darwin
```

The immutable inputs live in `bundled-tools.lock.json`. Preparation never
resolves `latest`; it verifies bounded downloads, release provenance, archive
paths, the installed tree, executable permissions, and exact Git/gh versions.
The generated `src-tauri/resources/tools/` and
`src-tauri/target/bundled-tools/` trees are ignored and must not be committed.
The resource tree contains only the anchored integrity manifest and legal
material. The target tree contains the Git and gh release archives. Denote
downloads the matching published archive only for Bundled mode, then extracts it
atomically into application data on first required use.

Plugin source belongs under `packages/plugins/<plugin-id>/` and may import
`@denote/plugin-sdk`, its own files, and declared third-party packages. It must
not import from `src/`, `@tauri-apps/*`, or another plugin package. Use
`packages/plugins/denote.reference/` as the contract example; it is not bundled into
the Denote application.

Plugin unit tests belong in `packages/plugins/<plugin-id>/tests/`, outside
`src/`, so the packaged source keeps its strict import boundary while the tests
still type check with `npm run check:plugins` and run with `npm test`. Use
`packages/plugins/denote.git/tests/` as the example.

Create a complete package skeleton with:

```bash
npm run create:plugin -- denote.example "Example plugin" productivity
```

The scaffold includes the manifest, required guide sections, icon, package
metadata, and SDK entrypoint. It does not add an invalid unpublished entry to
the production catalog.

Build one plugin continuously while editing:

```bash
npm run dev:plugin -- denote.example
```

The watcher writes `.plugin-dev/denote.example.tgz`, which is ignored by Git.
Run `npm run dev:desktop`, open **Settings → Plugins**, and choose **Load local
plugin archive**. Local archives are available only in the isolated development
app, are labeled untrusted, and still pass package bounds, path, manifest,
permission, extraction, entrypoint-integrity, worker-isolation, rollback, and
cleanup checks. Disable the plugin before loading its rebuilt archive. Use
`--once` for one build without watching.

Targeted one-off builds are also available:

```bash
npm run build:plugin -- denote.example
```

Plugin packages cannot declare npm lifecycle scripts or executable `bin`
entries. CI checks this before dependency installation, installs with lifecycle
scripts disabled, audits JavaScript and Rust dependencies, and rejects new
high-severity dependency vulnerabilities.

Build one independently downloadable plugin artifact with:

```bash
npm run package:plugin -- denote.example
```

Commit the plugin source and resulting archive under `plugin-artifacts/`, then
pin the catalog entry to that commit:

```bash
npm run pin:plugin -- denote.example --ref "$(git rev-parse HEAD)"
```

Both commands finish successfully and affect only the selected plugin.
`package:plugin` refuses to replace different bytes at an existing version.
Commit the catalog-only pin separately. Repository-wide
`npm run package:plugins` and `npm run check:plugins` remain the release/CI
aggregation commands. CI rebuilds every plugin, validates the real entrypoint,
checks the committed archive against its 40-character source commit, checks safe
archive paths/types/sizes, and verifies catalog size and SHA-256 digest on all
supported platforms. Set
`DENOTE_VERIFY_REMOTE_PLUGIN_ARTIFACTS=1` to additionally verify already
published catalog URLs.

Check published downloads independently of packaging:

```bash
npm run check:plugin-downloads -- --source
npm run check:plugin-downloads
```

The first command checks each immutable source-commit archive before a release
exists. The second checks the exact URLs embedded in the application, reports
every unavailable plugin, and verifies the bounded download's size and SHA-256.
CI checks source pins; release publication checks the public release URLs after
publishing, including when retrying an already-published release.

Native download/install, enablement commit, disable/reinstall, and update rollback
smoke checks use temporary application data and a synthetic previous version:

```bash
cargo test --manifest-path src-tauri/Cargo.toml plugins::download_tests::source_pinned_downloads_complete_native_lifecycle -- --ignored --exact
cargo test --manifest-path src-tauri/Cargo.toml plugins::download_tests::published_catalog_downloads_complete_native_lifecycle -- --ignored --exact
```

These opt-in checks require network access. They exercise the production native
downloader and integrity boundaries, not renderer worker activation.

Packaging is per plugin. An unchanged manifest version must match its committed
archive and is retained without changing its artifact bytes, URL, digest, size,
guide, or provenance. If one plugin changes, bump only that plugin's version;
`npm run package:plugins` must leave every unrelated plugin untouched.

## Build a desktop bundle

```bash
npm run tauri build
```

The GitHub Actions workflow runs the validation commands on macOS, Windows, and
Linux.

Release builds additionally require Apple signing/notarization secrets and a
Windows PFX for Authenticode. They prepare and verify on-demand tool assets for
each target, assert installed packages contain metadata but no tool or plugin
archive, generate checksums and SPDX SBOMs, attest bundles and tool assets, and
publish Git's corresponding source archive and signature.

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

Source outline declaration heuristics live in `src/lib/sourceOutline.ts`.
Extending a language should add the smallest anchored declaration patterns,
synthetic line-number tests, and no unbounded backtracking. Keep extraction in
the document-analysis worker, preserve the 20 KB line and 1,000-symbol bounds,
cap the proportional code minimap at 500 strokes, and never force a complete
CodeMirror parse for outline generation.

## Prepare a release

From an up-to-date `main` branch, update every Denote version source, commit and
push the update, then create and push the matching tag with one command:

```bash
npm run release -- 0.1.1 && git add . && git commit -m "Release v0.1.1" && git push && git tag v0.1.1 && git push origin v0.1.1
```

The script updates `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json`, and every current plugin catalog URL. The URLs
target the matching versioned GitHub Release while retaining each archive's
source commit, checksum, and size.

Tags must use semantic versions and point to a commit on `main`. The release
workflow validates the tag against every version source and builds every
platform before it creates a GitHub Release. It stages Linux AppImage, Debian,
and RPM packages, macOS Apple Silicon and Intel disk images, and Windows MSI and
NSIS installers, validates the current catalog archives, then publishes the
installers and plugin archives together with generated release notes.

If a release run fails, run the **Release** workflow manually and provide the
existing tag. Incomplete draft releases are replaced automatically after every
platform bundle succeeds, including duplicates left by older failed runs.
Restore a deleted tag at its original release commit before retrying.

An HTTP 404 for every plugin can mean the release has not been published, even
when the source archives and their hashes are correct. Check the Release run's
validation job before changing catalog pins. A retry of the same tag uses the
same source commit: a code or test fix must land on `main` and be included in a
new release tag. Do not move an existing tag, replace plugin bytes, or publish
an incomplete release just to make its plugin URLs resolve.

To abandon a failed release, revert the tagged release commit, push the revert,
then remove the tag locally and remotely:

```bash
git revert --no-edit v0.1.1 && git push && git tag -d v0.1.1 && git push origin --delete v0.1.1
```
