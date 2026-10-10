# Development

## Prerequisites

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 24.15 or newer, and stable Rust.

## Run Denote

```bash
node scripts/preinstall-validate-plugins.mjs
npm ci --ignore-scripts
npm run prepare:pdf-assets
npm run prepare:bundled-tools
npm run verify:bundled-tools
npm run dev:desktop
```

The root `package.json` also records npm's dependency lifecycle policy:
`esbuild@0.28.2` is pin-approved for its platform-binary postinstall check, while
the optional `fsevents` native rebuild is denied. Review any new warning with
`npm install-scripts ls`; do not approve a new package or version without
inspecting its published script and lockfile provenance.

`prepare:pdf-assets` verifies the installed Apache-2.0 `pdfjs-dist` package and
copies its local CMaps, standard fonts, ICC profile, image-decoder WebAssembly,
and license files into ignored `public/pdfjs-assets/`. It excludes QuickJS
evaluation assets, rejects links and non-regular entries, and enforces an 8 MB
aggregate ceiling. `npm run dev` and `npm run build` run it automatically.
Never commit the generated directory or replace these URLs with a CDN.

`dev:desktop` uses the separate `dev.mbianchi.denote.development` application
identity, so development vault state, plugin packages, process locks, and
keychain entries cannot collide with an installed Denote release.

The `denote:///` app-link scheme belongs to installed desktop bundles. Use a
URL-encoded absolute file path, such as
`denote:///Users/example/Notes/linked%20note.md`; the Vite development server
alone is not an operating-system scheme handler.

Preview the dependency-free public website from the repository root:

```bash
npm run build:website
python3 -m http.server 4173 --directory dist/website
```

GitHub Pages must use **GitHub Actions** as its source. The Pages workflow tests
and builds pull requests, then deploys only from `main` or manual dispatch.

## Validate changes

```bash
npm run check:plugin-archives -- --base "$(git rev-parse origin/main)"
npm test
npm run verify:bundled-tools
npm run build
npm run test:website
npm run build:website
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

The App integration suite preloads the real Markdown editor and formatted-diff
modules with module-scope imports. Keep cold module transformation in test
collection, outside timed hooks and UI interactions. Production loading remains
lazy, and tests retain their normal interaction deadlines.

PDF-focused checks are:

```bash
npx vitest run \
  src/lib/pdf.test.ts \
  src/lib/pdfRenderer.node.test.ts \
  src/components/PdfReader.test.tsx \
  src/components/FileActionsMenu.test.tsx \
  src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml \
  reads_pdfs_byte_exactly_and_refuses_every_save_path
```

`src/test/pdfFixtures.ts` generates small deterministic synthetic PDFs for
multi-page text, rotated pages, image-only pages, malformed data, password
protection, and large lazy documents. Do not replace them with personal,
customer, production, or downloaded documents. The Node renderer contract uses
PDF.js's legacy Node build only to validate bytes and errors in tests; the
desktop application bundles the modern browser build and module worker.

Core typing and memory-allocation regressions use synthetic documents and real
editor transactions:

```bash
npx vitest run \
  src/components/MarkdownEditor.performance.test.tsx \
  src/components/MarkdownEditor.test.tsx \
  src/components/PlainTextEditor.test.tsx \
  src/lib/documentStatistics.test.ts \
  src/lib/markdown.test.ts \
  src/App.test.tsx
```

These checks enforce parser-call budgets and streaming word segmentation rather
than hardware-dependent wall-clock thresholds. No optional plugin is required.

Validate plugin manifests, package structure, documentation, type safety, and
editor/plugin import boundaries separately with:

```bash
npm run check:plugins
```

Git status and pull-report checks are:

```bash
npx vitest run plugins/git/tests \
  src/plugins/gitRequests.test.ts src/plugins/runtimeMessages.test.ts \
  src/plugins/hostOperations.test.ts src/plugins/workerRuntimeLease.test.ts \
  src/components/SourceControlPanel.test.tsx \
  src/components/CloneOnboarding.test.tsx src/components/VaultSwitcherDialog.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml plugins::git::
cargo test --manifest-path src-tauri/Cargo.toml --test git_signing
```

Clone tests use local synthetic bare repositories. Folder selection alone must
leave the directory empty; only the host-bound explicit clone may populate it.
Keep cancellation, one-shot destination tokens, scope changes, changed/non-empty
folders, link replacement, visible failure state, and saved-note handoff covered.

The signing integration tests require Git, GnuPG (including `gpgconf`), and
OpenSSH `ssh-keygen`. They generate encrypted synthetic keys in temporary
keyrings, exercise Denote's early-exit OpenPGP/SSH helpers, verify the resulting
commits, and reject a wrong password without creating an unsigned commit.
They never read, import, or modify a developer's own keys. Windows searches the
ordinary Git for Windows and GnuPG installation directories as well as PATH.

Bundled tool preparation accepts an explicit release target:

```bash
npm run prepare:bundled-tools -- --target aarch64-apple-darwin
npm run verify:bundled-tools -- --target aarch64-apple-darwin
```

Apple target preparation resolves both the active macOS SDK and clang with
absolute `/usr/bin/xcrun --sdk macosx`. It ignores an inherited `SDKROOT`,
preserves `DEVELOPER_DIR` when selecting a specific Xcode installation, and
does not pin an SDK version: local builds and `macos-latest` use the `macosx`
SDK exposed by their selected Xcode. Preparation fails before configure when
xcrun fails, the SDK result is not an existing directory, or the clang result
is not an existing file. Reproduce the stale launcher environment check with:

```bash
SDKROOT=/removed/macos-sdk \
  npm run prepare:bundled-tools -- --target aarch64-apple-darwin
npm run verify:bundled-tools -- --target aarch64-apple-darwin
```

The immutable inputs live in `bundled-tools.lock.json`. Preparation never
resolves `latest`; it verifies bounded downloads, release provenance, archive
paths, the installed tree, executable permissions, and exact Git/gh versions.
GitHub tag metadata uses `GH_TOKEN` or `GITHUB_TOKEN` when present, otherwise it
reuses the token stored by `gh auth login` for `github.com`. Without a token it
falls back to the anonymous API limit, so authenticate before release
preparation.
The generated `src-tauri/resources/tools/` and
`src-tauri/target/bundled-tools/` trees are ignored and must not be committed.
The resource tree contains only the anchored integrity manifest and legal
material. The target tree contains the Git and gh release archives. Denote
downloads the matching published archive only for Bundled mode, then extracts it
atomically into application data on first required use.

Git's source build passes `QUIET_CARGO=+` to Make. The recursive recipe prefix
keeps Make's jobserver descriptors open for its nested Cargo invocation; clearing
`MAKEFLAGS` or hiding warnings would lose that concurrency contract. The
synthetic Make fixture in `npm run test:bundled-tools` checks inherited jobserver
handles. Git identity tests explicitly disable `core.autocrlf` only in their
temporary repositories, preventing Windows conversion notices without changing
production Git configuration or note line-ending preservation.

Plugin source belongs under `plugins/<name>/` and may import
`@denote/plugin-sdk`, its own files, and declared third-party packages. It must
not import from `src/`, `@tauri-apps/*`, or another plugin package. Use
`plugins/reference/` as the contract example; it is not bundled into
the Denote application.

Each plugin owns its manifest, guide, icon, package metadata, source, tests, and
repository-only `releases.json` ledger. Shared catalog and bundle metadata live
in `plugins/catalog.json` and `plugins/bundles.json`. The public contract remains
in `packages/plugin-sdk`; native Git transport, automatic commits, clone,
authentication, and executable resolution belong to the trusted host under
`src-tauri/src/plugins/git/`, never to a downloadable package.

Plugin unit tests belong in `plugins/<name>/tests/`, outside
`src/`, so the packaged source keeps its strict import boundary while the tests
still type check with `npm run check:plugins` and run with `npm test`. Use
`plugins/git/tests/` as the example.

Create a complete package skeleton with:

```bash
npm run create:plugin -- denote.example "Example plugin" productivity
```

The scaffold creates `plugins/example/` with the manifest, required guide
sections, icon, package metadata, and SDK entrypoint. Commands select a plugin
by its manifest ID (`denote.example`), not by its directory name. The scaffold
does not add an invalid unpublished entry to the production catalog.

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
The native picker does not wait for Git/gh status probes. Selecting an archive
starts background verification with a visible loading state; repeated requests
share the same picker, and cancelling leaves the catalog unchanged. Tool version
checks have a five-second deadline, so a broken custom executable cannot hang
the settings UI.
On macOS, file/folder selection uses the main dispatch queue instead of
constructing AppKit panels inside the event-loop observer. The native file
panel is prepared and retained once after the main window finishes loading,
without showing a dialog. Later requests reset and reuse it, with a callback-owned
lease preventing overlapping dialogs. Debug builds log panel preparation and
presentation times without filenames or paths, so picker latency can be
distinguished from later file verification.

Targeted one-off builds are also available:

```bash
npm run build:plugin -- denote.example
```

Activation entrypoints resolve conditional package exports with the `worker`
condition because downloaded plugin code runs in a DOM-free module worker.
Dependencies that publish separate browser and worker builds must select their
worker-safe export. Diagram-renderer entrypoints retain browser resolution for
their separately sandboxed iframe runtime. Keep
`scripts/plugin-build.test.ts` aligned with this distinction.

Plugin packages cannot declare npm lifecycle scripts or executable `bin`
entries. CI checks this before dependency installation, installs with lifecycle
scripts disabled, audits JavaScript and Rust dependencies, and rejects new
high-severity dependency vulnerabilities.

The additive `diagram-renderer` capability uses two self-contained build
outputs. `plugin.json` declares the normal worker `entrypoint` and a distinct
`diagramRenderer.entrypoint`; source paths mirror them under `src/`. The worker
entrypoint registers metadata only. The renderer entrypoint runs only in the
host's opaque no-network sandbox after enablement and must export
`renderDiagram(request)`. Both outputs are package-relative, independently
bounded to 10 MiB, included in the deterministic archive, and independently
hashed by the native installer. `npm run build:plugin -- denote.mermaid` builds
both files without runtime imports.

The 10 MiB per-entrypoint limit applies to every plugin's activation worker and
optional diagram renderer. Packaging, native installation, startup validation,
hashing, and runtime reads enforce the same limit. Compressed and expanded
packages remain bounded to 25 MiB in total. Plugins requiring the larger
entrypoint allowance must declare a minimum Denote version of 0.5.2.

The host-side `src/plugins/diagramSandboxBootstrap.js` is imported as raw text
and inserted as a static inline module in the opaque renderer frame. Its exact
SHA-256 must match `DIAGRAM_SANDBOX_BOOTSTRAP_HASH` and the hash in
`src-tauri/tauri.conf.json`; the unit test rejects drift. This avoids
cross-origin Vite module loading in development without permitting arbitrary
inline script. The bootstrap imports the verified renderer source through a
short-lived Blob URL rather than synchronously base64-encoding the multi-megabyte
bundle on the application UI thread.

For Mermaid changes, run:

```bash
npm audit --audit-level=high
npm ls mermaid dompurify
npx vitest run \
  packages/plugin-sdk/src/diagramRenderer.test.ts \
  plugins/mermaid/tests/compatibility.test.ts \
  plugins/mermaid/tests/renderer.test.ts \
  src/plugins/diagramRenderers.test.ts \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/MermaidMarkdownEditor.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml diagram_renderer
```

The root `lodash-es` override pins 4.18.1 because Mermaid 12's Chevrotain 11
dependencies otherwise require vulnerable 4.17.23 copies. Keep the override
until upstream removes those pins. After dependency updates, verify both
`npm audit --audit-level=high --workspaces` and `npm ls lodash-es`.
The root DOMPurify dependency and override pin
[3.4.16](https://github.com/cure53/DOMPurify/releases/tag/3.4.16) to fix
[GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p).
The host sanitizer and Mermaid 0.2.3 use this patch. Earlier published plugin
archives retain their immutable bytes and source provenance.
Changes to a plugin's own dependencies require an explicitly approved new
plugin version and committed source pin before `check:plugins` can succeed.
Never replace a released version's bytes or provenance; its ledger entry
remains tied to the original source commit.

### Prepare an immutable plugin version

Build and stage one independently downloadable plugin artifact with:

```bash
npm run package:plugin -- denote.example
```

The command writes only
`.plugin-artifacts/denote.example-<plugin-version>.tgz`. That directory is
ignored: never commit the archive, force-add it, or copy it into Tauri resources
or an installer.

Commit the plugin source first, together with any relevant SDK, lockfile, and
build-tool changes. Then pin that full, 40-character source commit for the
intended **Denote** release tag (not the plugin version):

```bash
npm run pin:plugin -- denote.example --ref "$(git rev-parse HEAD)" --release v0.1.1
```

Pinning verifies committed plugin source, SDK, build tooling, compiler
configurations (including inherited configurations), and lockfile inputs
before building and again after packaging. It checks a reproducible archive and
its contents, then atomically writes that plugin's
`releases.json` ledger before atomically replacing its catalog entry. An
interruption between writes leaves the immutable version prepared in the ledger;
retry the exact same pin to finish the catalog update. Do not edit or remove
the prepared entry to replace its bytes or provenance. Pinning stages the
verified bytes locally but does not create a tag, upload an asset, or publish a
release. Commit only the catalog and selected ledger changes in a separate
metadata commit.

The source commit must be an ancestor of `HEAD`, so pushing the branch also
publishes the source needed for reproduction. Archive text uses LF endings and
fixed file modes regardless of checkout line endings or the author's umask.
Archive compression uses the exact build-only `pako@3.0.2` implementation with
its legacy hash mode, fixed gzip parameters, and a normalized portable OS byte,
not the Node runtime's native zlib. Different native zlib builds can compress
identical tar input differently. The pinned compatibility settings preserve
existing source-archive bytes; changing the compressor or those settings is an
archive-format change, not a routine dependency refresh. Golden-digest tests
and all existing release pins must pass before changing compression.
Plugin bundles also depend on the build toolchain: Vite 8.3.0 and Rolldown 1.2.6
reproduce the pinned Mermaid renderer, while Vite 8.3.1 and Rolldown 1.2.12
change its archive bytes. Keep both versions fixed until plugin build recipes
can reproduce older releases with their original compiler; never replace an
existing release's checksum to accommodate a toolchain upgrade.

Pinning uses `.plugin-artifacts/pin.lock`, an exclusive cross-process lock
containing the pin process's PID. If the process crashes, the lock remains and
later pins refuse to run rather than stealing it. Inspect the recorded PID with
your operating system's process tools and confirm no pin process is running.
Only then remove the exact `.plugin-artifacts/pin.lock` file and retry the same
pin command. Do not remove the staging directory or alter the immutable ledger.
If the ledger write completed before the interruption, the identical retry
finishes the catalog update without replacing the prepared version.
Interrupted metadata temporary files are ignored and are not compiler inputs.

Every ledger entry records an immutable plugin version, source commit, archive
origin URL, byte count, and SHA-256 digest. Existing historical versions retain
their verified commit-addressed raw URLs and exact byte identities. A historical
download uses only that exact ledger URL and fails if unavailable or invalid;
it never falls back to a current catalog URL or another source. New versions
are deterministically built from source rather than recovered from archive blobs
in Git. The ledger is repository-only, not executable package or app metadata.
Release preparation may rehost an unchanged artifact under a newer Denote tag
by changing the current catalog URL; it must not change its ledger origin,
source commit, size, or digest.

`provenance.sourceCommit` in the catalog and `sourceCommit` in the ledger mean
source provenance: they identify the committed source and build inputs, not a
commit containing a `.tgz`. Pinning never requires a binary archive Git object.
New source entries also record `sourcePath`, such as `plugins/example`, naming
the plugin directory at the pinned commit. Verification uses that recorded path
even if the current package later moves; do not rewrite existing ledger entries
to follow a directory rename.

Both targeted commands affect only the selected plugin and refuse to replace
different bytes at an existing version. Neither command bumps versions. When
one plugin changes, explicitly bump only its own manifest/package version.
Unchanged plugins retain their bytes, guide, provenance, and metadata.

Run the repository-wide checks and staging command before a release:

```bash
npm run check:plugin-archives -- --base "$(git rev-parse origin/main)"
npm run check:plugins
npm run package:plugins
```

`check:plugins` validates manifests, guides, real built entrypoints, types,
import boundaries, safe archive paths/types/sizes, exact package content, and
pinned sizes and SHA-256 digests. Historical entries use verified immutable
downloads; new entries use deterministic source rebuilds. No tracked `.tgz`
blob is required. `package:plugins` applies the same archive verification and
stages every current catalog artifact as
`.plugin-artifacts/<plugin-id>-<plugin-version>.tgz` without editing metadata.
Set `DENOTE_VERIFY_REMOTE_PLUGIN_ARTIFACTS=1` to additionally verify already
published current catalog URLs; do not use it for a release whose assets have
not been published yet.

`check:plugin-archives` needs no installed dependencies. It rejects archive files
in the Git index, including force-added ignored output. `--base <full-sha>`
also checks additions across all proposed commits, including an archive added
and then deleted before the tip; old immutable history is permitted. The base
comparison also requires every existing ledger entry to remain unchanged and
rejects a changed catalog digest, size, or source SHA for the same plugin
version. New ledger versions may be appended; unchanged versions may be
rehosted through a catalog URL change only.
Ledgers are matched by stable plugin ID, so moving a self-contained plugin
directory preserves its recorded history. Merge-resolution-only archive
additions are checked too, even if a later commit deletes them.

Resolve a base ref to its full commit SHA as shown above. CI runs the guard
before dependency installation with full history, using the pull request base
or push's previous commit. Manual runs and all-zero bases omit `--base`, so they
check the index without a historical metadata comparison.

Check published downloads independently of packaging:

```bash
npm run check:plugin-downloads -- --source
npm run check:plugin-downloads
```

The first command rebuilds plugins and verifies their ledger-backed source
recipes or historical origins before a release exists. It never assumes an
archive exists in a source commit. The second checks the exact URLs embedded in
the application, reports every unavailable plugin, and verifies the bounded
download's size and SHA-256. CI checks source recipes; release publication checks
the public release URLs after publishing, including when retrying an
already-published release.

Native download/install, enablement commit, disable/reinstall, and update rollback
smoke checks use temporary application data and a synthetic previous version:

```bash
cargo test --manifest-path src-tauri/Cargo.toml plugins::download_tests::source_pinned_downloads_complete_native_lifecycle -- --ignored --exact
cargo test --manifest-path src-tauri/Cargo.toml plugins::download_tests::published_catalog_downloads_complete_native_lifecycle -- --ignored --exact
```

These opt-in checks require network access. They exercise the production native
downloader and integrity boundaries, not renderer worker activation.

The source-pinned native smoke test uses each ledger's exact origin URL. It can
exercise historical raw pins before a new Denote release, but a newly pinned
source-built version needs its origin release published before that network
smoke test can pass. Use `check:plugins` for offline pending-source validation.

An already-pinned plugin builds against the SDK source at its catalog
`sourceCommit`, keeping later additive host capabilities out of its immutable
archive. A new or bumped plugin version builds against the current SDK.
Keep full Git history available when rebuilding pinned artifacts. A plugin that
needs a newly added SDK function must bump its own version before building.

### Emoji plugin development

Use `npm run dev:plugin -- denote.emoji-picker` with the isolated development
app to load the local archive. The plugin owns the bundled dataset and manifest;
the SDK's `emoji-picker` contract and host editor adapters own validation and
interaction. Do not import its dataset into `src/` or grant workspace/network
permissions to implement insertion.

Targeted coverage includes `src/plugins/emojiPickers.test.ts`,
`src/plugins/workerRuntime.test.ts`, `src/plugins/usePlugins.test.tsx`, emoji
editor/component tests, package tests under
`plugins/emoji-picker/tests/`, and native
`plugins::emoji_tests`. Keep all note text and paths synthetic. Exercise Rich
and both source-editor paths, composition, code exclusion, Unicode variants,
undo/redo, focus restoration, and runtime/locked-vault changes.
Performance regressions assert that suggestion navigation does not rerender the
workspace, only 48 visible results resolve variants, repeated preference writes
reuse dataset membership, and rich insertions reuse current Markdown analysis.
These are deterministic work-count checks rather than machine-dependent timing
limits. Keep the `:sm` path synchronous; do not hide expensive work behind a
typing debounce.
Ordinary-typing regressions compare enabled and disabled plugins in Rich and
both Source paths, require identical parser counts and no emoji host calls, and
repeat after an insertion. To print synthetic timing diagnostics alongside
these work counts, use
`DENOTE_PROFILE_EMOJI=1 npx vitest run src/components/EmojiPicker.editors.test.tsx -t "keeps ordinary typing off"`.
Those jsdom timings include the editor and test environment; they are not
end-to-end desktop latency guarantees.
Core regressions additionally require zero full-note parses for ordinary prose,
including with the emoji plugin disabled, one workspace render per settled edit,
and cancellation of deferred work when the app unmounts. Delimiter fast paths
are covered alongside the full Markdown, HTML, reference, TOC, and code tests;
never replace those safety parsers with a permissive fallback.
App-level regressions also require note-event bookkeeping to remain completely
off the edit path when no enabled plugin requests `note-events`, and Git
refreshes to wait until the source-control view opens and rerun whenever it is
reopened.

Stage with `npm run package:plugin -- denote.emoji-picker`, commit source and
build inputs, then pin that source with `npm run pin:plugin -- denote.emoji-picker`
using `--ref` and `--release` for the intended Denote release. Commit only the
catalog and release ledger separately, never the archive. The package guide documents dataset
provenance and regeneration; license notices must be included in the archive's
guide, not just an unpackaged source file.

### JSON and YAML viewer development

Use `npm run dev:plugin -- denote.json-yaml-viewer` and load the ignored
development archive from **Settings → Plugins**. The plugin requests only
`structured-viewer`; parser code and `yaml` stay inside the plugin package,
while `src/components/StructuredDataViewer.tsx` and the runtime protocol remain
generic host-owned API-v1 surfaces.

Run focused coverage with:

```bash
npx vitest run \
  src/plugins/structuredViewers.test.ts \
  src/plugins/structuredViewers.path.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/StructuredDataViewer.test.tsx \
  plugins/json-yaml-viewer/tests
```

Fixtures must be minimal and synthetic. Cover JSON/YAML scalar and container
types, empty values, duplicate keys, comments and line endings in Raw source,
multi-document streams, anchors, aliases, recursive aliases, alias/depth/node
limits, unsupported tags, malformed locations, stale requests, virtualization,
keyboard focus, pane/tab isolation, lock/unlock, repeated lifecycle operations,
and disable/re-enable cleanup.

Stage the source-only archive with
`npm run package:plugin -- denote.json-yaml-viewer`. Commit source, SDK, host,
tests, docs, dependency manifests, and lockfile first; pin that full commit with
`npm run pin:plugin -- denote.json-yaml-viewer --ref "$(git rev-parse HEAD)"
--release <Denote-tag>`, then commit only its catalog and ledger metadata.

### Kanban board development

Use `npm run dev:plugin -- denote.kanban` and load the ignored development
archive from **Settings → Plugins**. The plugin requests only `kanban-board`.
Representation-specific parsing and source splicing stay in
`plugins/kanban/src/board.ts`; `src/components/KanbanBoardEditor.tsx`, path
routing, autosave, links, focus, and the runtime protocol remain generic
host-owned API-v1 surfaces.

Run focused coverage with:

```bash
npx vitest run \
  packages/plugin-sdk/src/kanban.test.ts \
  src/plugins/kanbanBoards.test.ts \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/KanbanBoardEditor.test.tsx \
  src/App.test.tsx \
  plugins/kanban/tests
```

Use only synthetic board content. Cover initialization after existing Markdown,
LF/CRLF handling, malformed and duplicate markers, source/model/card limits,
note links and tags, add/edit/delete/move operations, byte-preserving reorder,
stale worker responses, lock/unlock, disable/re-enable, exact Markdown fallback,
pointer drag, every keyboard move alternative, announcements, and focus after
move or deletion.

Stage the source-only archive with
`npm run package:plugin -- denote.kanban`. Commit source, SDK, host, tests, docs,
dependency manifests, and lockfile first; pin that full commit with
`npm run pin:plugin -- denote.kanban --ref "$(git rev-parse HEAD)" --release
<Denote-tag>`, then commit only its catalog and ledger metadata.

### Note graph development

Use `npm run dev:plugin -- denote.note-graph` and load the ignored development
archive from **Settings → Plugins**. The plugin requests only `note-graph`.
Markdown link parsing, the transient note map, incremental update handling,
target resolution, graph traversal, filtering, and ranking stay in
`plugins/note-graph/`. `src/components/NoteGraphPanel.tsx`, bounded snapshot
construction, activity-rail integration, file opening, focus, and the runtime
protocol remain generic host-owned API-v1 surfaces.

Run focused coverage with:

```bash
npx vitest run \
  packages/plugin-sdk/src/noteGraph.test.ts \
  src/plugins/noteGraphCoordinator.test.ts \
  src/plugins/noteGraphs.test.ts \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/ActivityRail.test.tsx \
  src/components/NoteGraphPanel.test.tsx \
  src/App.test.tsx \
  plugins/note-graph/tests
```

Use only synthetic Markdown. Cover inline and full/collapsed/shortcut reference
links, legacy destinations with bare spaces, fragments, percent encoding,
root-relative and extensionless paths, ambiguous case, external schemes,
malformed source, path additions/removals, changed-note-only reparsing,
incoming/outgoing counts, orphans, global/local depth, every filter, node/edge
limits, stale requests, lock/unlock, disable/re-enable, visual selection, the
roving keyboard list, announcements, host-owned navigation, sidebar-to-tab
launch, transient-session exclusion, graph-tab pane movement, and opening notes
without replacing the graph. Force-layout coverage must prove deterministic
seeding, surviving-position preservation, bounded spatial-grid work, connected
response to dragging, pointer coordinate conversion through zoom/letterboxing,
click-versus-drag behavior, release settling, and reduced-motion behavior
without machine-timing assertions.

Stage the source-only archive with
`npm run package:plugin -- denote.note-graph`. Commit source, SDK, host, tests,
docs, dependency manifests, and lockfile first; pin that full commit with
`npm run pin:plugin -- denote.note-graph --ref "$(git rev-parse HEAD)"
--release <Denote-tag>`, then commit only its catalog and release-ledger
metadata. Never commit the generated `.tgz`.

### Calendar plugin development

Use `npm run dev:plugin -- denote.calendar` and load the ignored archive in the
isolated development application. Calendar targets Denote 0.6.0 and requests only
the `calendar` capability. Filename mapping, settings interpretation, and YAML
date parsing belong to `plugins/calendar/`; the host owns its UI, bounded
snapshots, worker protocol, and the native no-replace file creation adapter.
Calendar 0.2.0 adds advertised Created/Last updated views; preserve the immutable
0.1.0 ledger entry when pinning it. Cover both explicit `type: daily` markers and
legacy filenames, unknown timestamps, filesystem-date changes, stale tree data,
time-zone projection, and older dated-only providers. Native migration 16
retains filesystem creation times across atomic note replacements without using
the note-statistics row's creation/opened timestamps as file dates.

```bash
npx vitest run \
  packages/plugin-sdk/src/calendar.test.ts \
  plugins/calendar/tests \
  src/lib/calendar.test.ts \
  src/plugins/calendars.test.ts \
  src/components/CalendarPanel.test.tsx \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/ActivityRail.test.tsx \
  src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml calendar
```

Exercise leap dates, month/year boundaries, different `TZ` values, localized
labels, keyboard focus, optional/invalid metadata, configured paths, truncation,
stale results, disablement, vault switching and locking, encrypted creation, and
existing-file byte preservation with synthetic fixtures only. On constrained
machines, use Vitest `--maxWorkers=1` and Cargo `--jobs 2` rather than increasing
timeouts or changing application behavior.

Stage with `npm run package:plugin -- denote.calendar`. Commit the complete
source/build inputs before pinning with
`npm run pin:plugin -- denote.calendar --ref "$(git rev-parse HEAD)" --release v0.6.0`.
Commit the resulting catalog and release ledger separately; archives stay
ignored and are published only by the ordinary release workflow.

### Reminders plugin development

Use `npm run dev:plugin -- denote.reminders` and load the ignored archive in the
isolated development application. Reminders targets Denote 0.7.1 and requests
both `reminders` and `notifications`; registration must fail when either
approval is absent. Plugin code owns optional Markdown target parsing,
civil-time/DST and recurrence resolution, storage migration, vault-scoped
storage, quotas, and typed state transitions. The host owns the activity-rail
panel, edit form, banner stack, numbered badge, 30-second wall-clock rechecks,
focus catch-up, generation guards, native notification dispatch, and teardown.

```bash
npx vitest run \
  packages/plugin-sdk/src/reminders.test.ts \
  plugins/reminders/tests \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/plugins/useReminderScheduler.test.tsx \
  src/components/ReminderPanel.test.tsx \
  src/components/ReminderBanners.test.tsx \
  src/components/ActivityRail.test.tsx \
  src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml \
  vault_plugin_scopes_are_stable_and_distinct
cargo test --manifest-path src-tauri/Cargo.toml \
  plugin_v3_adds_only_reminders_and_never_restores_it
```

Cover fall-back ambiguity, spring-forward gaps, system-zone changes, long future
dates, sleep/focus catch-up, overdue summary bounds, stale workspace or disabled
provider races, persisted `delivering` recovery, notification failures, manual
retry, snooze, dismiss, storage corruption/quota, encrypted-vault disclosure,
forced colors, focus, standalone and synthetic note/heading/task targets,
editing, every-N recurrence, short-month and leap-day clamping, recurring DST
gaps, exact minute/hour intervals, stable repeat-control layout, series
advancement, Active/Completed/Dismissed filtering, archival restore/permanent
delete, recurring completion snapshots, copying from every stage, banner bounds,
and badge counts. Native dispatch success only means the operating system
accepted the request; do not test Focus or notification-center policy as
delivery success.

Stage with `npm run package:plugin -- denote.reminders`. Commit SDK, host, plugin,
tests, docs, lockfile, and Welcome `plugins-v3` inputs first. Pin that full
source commit with
`npm run pin:plugin -- denote.reminders --ref "$(git rev-parse HEAD)"
--release <Denote-tag>`, then commit only the generated catalog and
`plugins/reminders/releases.json` metadata. Never commit the `.tgz`.

## Frontend bundle limits

`npm run build` uses entry-aware Rolldown groups and rejects main-thread
JavaScript chunks above 500,000 bytes after minification. The warning limit is
not raised. Markdown editing and formatted Git diffs load only when opened;
PDF rendering already has a lazy entrypoint. Loading or failing one editor
leaves the surrounding workspace available.

Large Shiki grammar JSON is emitted unchanged as local hashed assets instead
of JavaScript strings. The build validates the literal-data format without
executing package code and fails if it changes. Grammar imports await those
assets and reject HTTP or JSON errors. The optional Oniguruma engine uses a
local `.wasm` asset instead of a Base64 JavaScript module. Neither path uses a
CDN or removes languages. PDF.js's separately loaded, prebuilt worker remains
one upstream module, not a main-thread chunk.
`dist/.vite/manifest.json` records static and lazy imports.

```bash
npx vitest run scripts/frontend-bundle.test.ts \
  src/components/ErrorBoundary.test.tsx \
  src/components/SourceControlDiffEditor.test.tsx src/App.test.tsx
npx tsc --noEmit -p tsconfig.node.json
```

## Rust dependency audits and GTK migration

Run `cargo audit --file src-tauri/Cargo.lock`. Windows releases temporarily pin
Tauri 2.11.6, tauri-build/codegen/macros 2.6.3, runtime 2.11.3,
runtime-wry 2.11.4, Tao 0.35.3, and Wry 0.55.1. The npm Tauri API 2.11.1 and
CLI 2.11.5 use the matching runtime minor. Tauri 2.12, including
`tauri-utils` 2.10, opens a blank Windows webview and leaves the process alive
after its last window closes. Do not float this runtime family until the
packaged Windows renderer smoke gate passes. The known-good graph retains
`tauri-utils` 2.9.3 and its URL-pattern implementation, so five unmaintained
`unic-*` warnings return temporarily. Desktop packaging rejects a mismatched API
minor. No vulnerability advisory is ignored.

Seven warning-level findings remain:

| Advisory | Dependency path | Status |
| --- | --- | --- |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370) | GTK 0.18 / GLib macros -> `proc-macro-error` 1.0.4 | Unmaintained |
| [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081) | Tauri utils 2.9 / URL pattern -> `unic-char-property` 0.9.0 | Unmaintained |
| [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075) | Tauri utils 2.9 / URL pattern -> `unic-char-range` 0.9.0 | Unmaintained |
| [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080) | Tauri utils 2.9 / URL pattern -> `unic-common` 0.9.0 | Unmaintained |
| [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100) | Tauri utils 2.9 / URL pattern -> `unic-ucd-ident` 0.9.0 | Unmaintained |
| [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098) | Tauri utils 2.9 / URL pattern -> `unic-ucd-version` 0.9.0 | Unmaintained |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429) | Tauri / Wry / WebKitGTK -> `glib` 0.18.5 | Unsound `VariantStrIter` |

The audit includes every platform in the lockfile, so macOS and Windows also
report the Linux GTK dependencies. A successful exit does not resolve any of
these warnings.

### Re-evaluate the Windows runtime pin

The exact npm, Cargo manifest, and Cargo lock versions are one coordinated
workaround. Denote 0.7.2 moved to the Tauri 2.12 family; packaged Windows builds
then opened as a uniform black page and kept `denote.exe` alive after the last
window closed. Restoring the complete 0.7.1 Tauri graph fixed both behaviors.
Changing only Wry, only `tauri-utils`, or only the top-level Tauri crate is not a
supported upgrade.

Last upstream check: **2026-09-29**.

- [Tauri releases](https://github.com/tauri-apps/tauri/releases) had no stable
  release newer than 2.12.0.
- [Tauri issues](https://github.com/tauri-apps/tauri/issues) had no identified
  Windows blank-webview fix for this regression.
- [Wry releases](https://github.com/tauri-apps/wry/releases) had no release newer
  than 0.57.0.
- [Wry issues](https://github.com/tauri-apps/wry/issues) had no identified
  Windows fix matching both the blank frame and orphaned process.

Any agent or contributor considering an upgrade must:

1. Check those official release notes and issue trackers first. Link the exact
   upstream release, issue, or pull request evaluated and update the last-check
   date above; do not assume that `latest` contains a fix.
2. Move the family together: `@tauri-apps/api`, `@tauri-apps/cli`, `tauri`,
   `tauri-build`, `tauri-codegen`, `tauri-macros`, `tauri-runtime`,
   `tauri-runtime-wry`, `tauri-utils`, Tao, Wry, and their WebView2 bindings.
   Use npm and Cargo to regenerate lockfiles; never hand-edit resolved versions.
3. Run the JavaScript and Rust audits, full build/check suite, and all-platform
   CI. The package-equivalent Windows renderer smoke is mandatory: it must show
   Denote's dark UI, reject blank or browser-error frames, close the last window,
   and observe `denote.exe` exit.
4. Remove or relax the exact pins only when the upstream evidence is cited and
   the Windows gate passes. If the candidate fails, restore the known-good graph
   exactly; never weaken, skip, or delete the smoke check to land an upgrade.

Migration investigation, 2026-09-28: maintained
[GTK 0.19.0](https://crates.io/crates/gtk/0.19.0) uses GLib 0.22. However, the
Tauri 2.11 and 2.12 runtime families, Tao, Wry, and WebKitGTK still use GTK 0.18
types. A new direct GTK/GLib dependency cannot replace incompatible transitive
types and native
`links` dependencies. The runtime, menu/dialog integrations, and WebKitGTK
bindings need a coordinated upgrade.

[Tauri 3.0.0-alpha.3](https://github.com/tauri-apps/tauri/releases/tag/tauri-v3.0.0-alpha.3)
requires Rust 1.95, matching version-three runtime/plugins, and native plugin
hooks that can run concurrently and require `Sync`. Its
[Wry runtime](https://crates.io/crates/tauri-runtime-wry/3.0.0-alpha.3) still uses
GTK 0.18 and WebKitGTK 2.0: moving to that alpha alone does not fix the findings.
Keep stable Tauri until a compatible maintained GTK stack is available. That
migration must cover Linux menus, dialogs, clipboard, deep links, single-instance
behavior, updater shutdown, and vault/plugin lifecycles across all platforms.
Do not relabel crates or suppress advisories to bypass this dependency boundary.

## Build a desktop bundle

```bash
npm run tauri build
```

The GitHub Actions workflow runs the validation commands on macOS, Windows, and
Linux.

Windows CI additionally builds the embedded application without installers and
runs:

```powershell
pwsh -NoProfile -File scripts/windows-renderer-smoke.ps1 `
  -AppPath src-tauri/target/release/denote.exe `
  -EvidenceDirectory windows-renderer-smoke
```

The hosted runner launches this at medium integrity, isolates application and
WebView2 data, captures the client area, rejects a uniform blank frame or browser
error page, closes the last window, and requires `denote.exe` to exit. Failure
uploads the screenshot and measured frame evidence.

### Preview an unpublished plugin on macOS

The production DMG cannot download a plugin asset until its intended release is
published. To test a staged plugin without publishing or changing the production
downloader, build the separate development application:

```bash
CI=true NODE_ENV=development CARGO_BUILD_JOBS=2 \
  npm run tauri build -- --debug --config src-tauri/tauri.dev.conf.json --bundles dmg
npm run dev:plugin -- denote.calendar --once
```

Open the DMG in `src-tauri/target/debug/bundle/dmg/`. **Denote Development** uses
its own application identity, state, plugin storage, and keychain namespace.
Choose **Settings → Plugins → Load local plugin archive** and select
`.plugin-dev/denote.calendar.tgz`.

Both development flags matter: `NODE_ENV=development` retains the frontend's
local-archive control, while `--debug` includes the native development-only
adapter. This bundle is a local preview, not a production release artifact.
The plugin archive remains separate from either DMG.

### Provision signed application updates

Application updater signatures are independent from Apple Developer ID
signing/notarization and Windows Authenticode. The checked-in
`src-tauri/updater.json` enables signed stable updates only after a maintainer
has committed the durable Tauri updater public key and separately provisioned
its matching private key and password in GitHub Actions.

1. Generate the key outside the repository on a secured maintainer system:

   ```bash
   npm run tauri signer generate -- -w /secure/backup/denote-updater.key
   ```

2. Back up the private key and its password in durable maintainer-controlled
   storage. Losing the private key prevents existing installations from trusting
   later updates. Never put it in Git, project files, logs, or issue bodies.
3. Base64-encode the complete generated public-key file, including its
   `untrusted comment` line, into `src-tauri/updater.json`. Copy that same
   generated Base64 value into `src-tauri/tauri.release.conf.json` at
   `plugins.updater.pubkey`, set `enabled` to `true`, and review the resulting
   commit. Release validation rejects missing or mismatched copies before
   platform builds start.
4. Configure the repository Actions secrets
   `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from the
   backed-up values. Prefer the GitHub repository settings UI or an interactive
   `gh secret set` invocation that does not place the password in shell history.
5. Run:

   ```bash
   node scripts/updater-release.mjs status
   npm test
   cargo test --manifest-path src-tauri/Cargo.toml updater::tests
   ```

When disabled, ordinary local and release desktop bundles remain unsigned and
usable exactly as before; no updater artifacts or `latest.json` are published.
When enabled, release jobs fail before building if either signing secret is
missing, then use `src-tauri/tauri.release.conf.json` as the template for signed
updater artifacts. Never rotate or replace the key without a separately
designed in-application trust migration.
The workflow checks out its release helpers from `github.workflow_sha` and
derives `src-tauri/tauri.workflow.release.conf.json` from the tagged
`updater.json` plus release template. The generated file is ephemeral. This
keeps the updater key and application source tied to the immutable tag while a
reviewed workflow-only fix can retry that tag.

Release packaging passes Tauri's `--no-sign` option when updater provisioning
is disabled. When it is enabled, the workflow omits that option so Tauri can
generate updater Minisign signatures. Apple Developer ID
signing/notarization and Windows Authenticode remain unconfigured. The jobs
still prepare and verify on-demand tool assets for each target, assert installed
packages contain metadata but no tool or plugin archive, generate checksums and
SPDX SBOMs, attest bundles and tool assets, and publish Git's corresponding
source archive and signature. Checksum generation
selects only the package formats uploaded for that platform. It keeps every
release-asset filename in the published `SHA256SUMS` file and deduplicates
attestation subjects by SHA-256 digest to satisfy GitHub's
one-subject-per-digest requirement. Build
jobs obtain the checksum helper from the workflow commit while compiling the
requested release tag, so workflow-only fixes can retry an existing immutable
tag. The provenance records the workflow revision and the separately resolved
release tag commit.

### Sign and notarize a macOS build

Unsigned downloads can make Gatekeeper report that `Denote.app` is damaged.
Public macOS distribution should use an Apple **Developer ID Application**
certificate and notarization rather than asking users to bypass quarantine.

1. Create a **Developer ID Application** certificate in Apple Developer
   Certificates, IDs & Profiles, install it in the login keychain, and confirm
   its exact identity:

   ```bash
   security find-identity -v -p codesigning
   ```

2. Export the identity for the build:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"
   ```

3. Configure one notarization credential method. App Store Connect API keys are
   preferred:

   ```bash
   export APPLE_API_ISSUER="issuer-uuid"
   export APPLE_API_KEY="KEYID"
   export APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_KEYID.p8"
   ```

   Apple ID notarization is also supported with `APPLE_ID`,
   `APPLE_PASSWORD` set to an app-specific password, and `APPLE_TEAM_ID`.
   Certificates, private keys, and passwords must remain outside the repository.

4. Build without `--no-sign`:

   ```bash
   CI=true npm run tauri build -- --bundles dmg
   ```

   Tauri signs the app and submits it for notarization when the signing identity
   and notarization variables are available. The current release workflow does
   not provide those credentials, so CI artifacts are not platform-signed.

5. Verify the resulting app and disk image:

   ```bash
   codesign --verify --deep --strict --verbose=2 \
     "src-tauri/target/release/bundle/macos/Denote.app"
   spctl --assess --type execute --verbose=4 \
     "src-tauri/target/release/bundle/macos/Denote.app"
   dmg="$(find src-tauri/target/release/bundle/dmg -name '*.dmg' -print -quit)"
   xcrun stapler validate "$dmg"
   ```

For GitHub Actions, export the certificate as a password-protected `.p12`,
store its base64 contents as `APPLE_CERTIFICATE`, store its password as
`APPLE_CERTIFICATE_PASSWORD`, import it into a temporary keychain protected by
`KEYCHAIN_PASSWORD`, and set `APPLE_SIGNING_IDENTITY` to the imported identity
before the Tauri build. Store the App Store Connect values as encrypted secrets
too. An ad-hoc local build can use `APPLE_SIGNING_IDENTITY="-"`, but it is not
notarized and is not suitable for public downloads.

See the official
[Tauri macOS code-signing guide](https://v2.tauri.app/distribute/sign/macos/)
for certificate creation and credential setup.

## Extend core syntax highlighting

Built-in languages are declared in `src/lib/syntaxLanguages.ts`. Add or change a
language there rather than creating separate source-file and Markdown maps.
Every entry must define a stable ID, display name, preferred fence identifier,
search aliases, explicit extensions or filenames, and a bundled asynchronous
CodeMirror loader.

Add synthetic table-driven coverage in `src/lib/syntaxLanguages.test.ts`, plus
editor or combobox coverage when behavior changes. Force complete parsing with
`ensureSyntaxTree` before asserting tokens or tree length: `EditorState.create`
only spends a small initial parsing budget and may leave a partial tree.
Update the product, architecture, design, and canonical user guide language
lists together. New grammar dependencies must be direct dependencies,
lazy-loaded, included in
`package-lock.json`, and pass `npm audit`; Denote never downloads grammars at
runtime. Specialized plugin grammar support requires a separately approved typed
host contract and is not part of plugin API version 1.

The canonical Welcome-vault language samples live in `docs/user-guide/code/`.
Keep one tiny invented file for every distinct `CORE_SYNTAX_LANGUAGES`
descriptor, plus representative filename-only rules and the ambiguous `.pp`
case documented in `code/README.md`. `src/lib/welcomeSamples.test.ts` compares
the directory with the live registry. The canonical Mermaid, PDF, JSON, and
YAML files live in `docs/user-guide/examples/`; optional workflow samples live
in `docs/user-guide/plugins/`. The PDF must remain exactly
equal to the deterministic `createPdfFixture` output and contain no actions,
forms, annotations, attachments, or external links.

`src-tauri/src/default_vault.rs` also owns the non-destructive `examples-v1`
addition for older Welcome vaults. Tests must prove exact source inventory,
missing-file addition, existing-file preservation, one-time behavior, symlink
refusal, encrypted deferral, and ciphertext creation after unlock.
The separate `plugins-v1` addition owns only the original Kanban sample.
`plugins-v2` owns the fixed new inventory listed in
`PLUGIN_EXAMPLE_V2_PATHS`: the plugin index and each suitable user-facing
workflow. Do not broaden an applied version's inventory or remove its marker;
future additions need a new version so deleted earlier samples stay deleted.
Neither plugin migration broadens the older `examples-v1` prefix set.
Keep the plugin index, native seed inventory, and synthetic catalog-coverage
test aligned. The Reference SDK fixture is intentionally excluded.

Focused Welcome checks are:

```bash
npx vitest run src/lib/welcomeSamples.test.ts --maxWorkers=1
cargo test --manifest-path src-tauri/Cargo.toml --jobs 2 default_vault::tests -- --test-threads=2
```

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

From a clean `main` branch, run the release script with either an unprefixed
semantic version or the matching `v`-prefixed tag:

```bash
./scripts/release.sh 0.3.2
# Equivalent:
./scripts/release.sh v0.3.2
```

The script fetches `origin`, fast-forwards `main`, refuses local-only commits or
an existing release tag, checks updater provisioning, installs dependencies
without lifecycle scripts after validating plugin package metadata, runs the
complete release validation suite, and updates `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json`, and every current plugin catalog URL. The URLs
target the matching versioned GitHub Release while retaining each archive's
source commit, checksum, and size. Only those release files may change. After
validation, the script creates an unsigned `Release v<version>` commit, pushes
`main`, then creates and pushes the matching tag.

Tags must use semantic versions and point to a commit on `main`. The release
workflow validates the tag against every version source and builds every
platform before it creates a GitHub Release. Every release dependency install is
preceded by `node scripts/preinstall-validate-plugins.mjs` and uses
`npm ci --ignore-scripts`.

The validation job runs `check:plugins`, then `package:plugins`, and transfers
the verified `.plugin-artifacts/*.tgz` files as the dedicated
`plugin-release-assets` workflow artifact. Platform builds never take those
archives as installer inputs. The publish job downloads them into ignored
staging, rechecks the exact filenames, sizes, SHA-256 digests, and catalog URLs
against the release tag, and copies those exact bytes into the upload set
without rebuilding them. It publishes the plugin assets together with Linux
AppImage, Debian, and RPM packages, macOS Apple Silicon and Intel disk images,
Windows MSI and NSIS installers, and generated release notes. Installer smoke
checks continue to reject embedded plugin `.tgz` files.

If a release run fails, run the current **Release** workflow from `main` and
provide the existing tag. Incomplete draft releases are replaced automatically
after every platform bundle succeeds, including duplicates left by older failed
runs. Restore a deleted tag at its original release commit before retrying.

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
