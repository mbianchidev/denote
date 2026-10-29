# Development

## Prerequisites

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 26.12.1 (pinned in `.node-version`), and stable
Rust. CI, Pages, and release jobs use the same Node pin. Other supported Node.js
versions are declared in `package.json`.

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

The root `undici@8.12.3` override patches jsdom's test-only HTTP transport
without changing the immutable plugin dependency trees.

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
npm run test:website
npm run build:website
python3 -m http.server 4173 --directory dist/website
```

Website tests use Node's built-in test runner and synthetic fixtures. Both
website commands need only Node.js and npm, not a dependency install or the
desktop toolchain. `npm test` includes these same tests on every CI platform.
For website-only watch mode, run `node --test --watch website/*.node.mjs`.

GitHub Pages must use **GitHub Actions** as its source. The Pages workflow tests
and builds pull requests without installing desktop dependencies, then deploys
only from `main` or manual dispatch.

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

Vitest uses isolated forks with at most two concurrent workers, leaving one CPU
available on smaller machines. This bounds cold `jsdom` startup pressure instead
of scaling expensive environments to every available CPU. Each file still gets
a fresh process, DOM, and module state; test and hook deadlines and unhandled-error
reporting remain unchanged. Do not disable isolation or ignore unhandled errors
to make a run pass.

On a heavily loaded machine, run the same suite with one worker:

```bash
VITEST_MAX_WORKERS=1 npm test
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
Opening a document must share the original parse with its reference, TOC, and
thematic-break snapshots. Ordinary paragraph edits must not rescan the entire
page for headings, TOCs, tags, or image dimensions.
Frontmatter/TOC/reference notes retain separate controlled Rich/Source work
budgets: two Rich edits may require at most four full-note trees rather than ten;
two Source edits may require at most two rather than six. Comment
delimiters are not ordinary HTML angles, and frontmatter is not a thematic-break
candidate. Actual TOC and HTML safety validation remains mandatory.
Markdown coverage also checks that opening, focus, and Rich/Source switches do
not publish edits or start autosave, including trailing spaces/tabs and LF, CRLF,
and CR input. Explicit Source whitespace removal must survive later Rich edits.
Keep `mailto:` destinations and query separators unescaped while preserving
required directive/entity escapes and literal backslashes in code.

Production-browser responsiveness has a separate measured regression gate:

```bash
npm exec --no -- playwright install chromium
npm run benchmark:editor
```

The command type-checks the benchmark harness, builds the production application,
and runs headless Chromium against that build. Fixtures contain only generated
synthetic data: 3,000 file-tree entries, a 180-section typing note, a 500-section
reading note, and a 2,500-line source file. Only native IPC is mocked; the real
App, editors, save scheduling, lazy modules, and document worker still run.
Typed characters must reach the saved document, and unexpected native commands
or application error alerts fail the run.

Rich input-to-paint latency must remain below 250 ms at the 95th percentile;
Markdown Source and plain source retain a 150 ms limit. No input sample may
reach 500 ms. Rich's limit is calibrated to the standard Linux runner, not a
developer laptop; the independent parser/DOM budgets guard algorithmic
regressions on faster hardware too. Large-page opening must remain
below 2,500 ms cold and 1,500 ms warm, including shared-runner scheduling margin.
Each input sample waits for two animation
frames. The opening clock starts from the real click event and ends in the
browser after content appears and two frames, excluding Playwright's selector
and actionability round trips. Tests run serially with no retries so competing
benchmark browsers cannot contaminate timings or hide a regression.
Whole-DOM tracing is disabled during measurements because it changes input and
render timings; collect a separate `--trace on` run only for functional diagnosis.
Results and failure screenshots stay in ignored `.performance-artifacts/`.

The same browser command also measures a 20,000-note synthetic vault below the
existing content budget. It requires a real search worker, bounded native read
requests covering the complete inventory, unchanged Rich input-to-paint limits,
and exactly one saved-file read after editing one note. The final note must
remain searchable. A second gate updates graph, task-list, and calendar
projections over 20,000 source records: only one graph/task document may change,
every unchanged bounded projection must retain its object identity, and the
combined warm projection pass must finish below 200 ms.

Deterministic index and scope checks run with:

```bash
npx vitest run src/lib/search.test.ts src/lib/searchDocuments.test.ts \
  src/lib/searchWorker.test.ts src/plugins/noteGraphs.test.ts \
  src/plugins/taskLists.test.ts src/plugins/calendars.test.ts src/App.test.tsx
```

These checks count actual ZBSearch chunk insertions/removals, exercise worker
failure/recovery and teardown, reject stale deletion snapshots, and retain the
64 MiB global budget across changed-path reads. Native scoped-reader tests cover
subtree deduplication, traversal/internal-path refusal, and small remaining
budgets. No real vault content is used.

CI runs the browser gate once on Linux, reusing its existing frontend build
instead of building again, and uploads evidence on failure. After an existing
local build, use `npx tsc --noEmit -p tsconfig.benchmarks.json` followed by
`npm exec --no -- playwright test` to avoid a duplicate build.

Native responsiveness is covered independently on every desktop platform:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked \
  editor_file_ipc_dispatch_stays_responsive -- --nocapture
```

This regression invokes the real registered Tauri commands through MockRuntime
IPC while another thread holds a synthetic vault access lock. Reads, PDF and
image delivery, saves, edit tracking, refresh, last-vault restoration, content
index/replace/link scans, and global filename discovery must
return control to the dispatcher within 100 ms, even when I/O cannot proceed.
After releasing the lock, responses and saved bytes must still be correct.
The budget measures UI dispatch, not total disk or encryption completion time.

Windows MSVC tests also need Common Controls v6 before the test harness starts;
linking Tauri's mock-window API otherwise exits with
`STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`). `src-tauri/build.rs` links
`windows-app-manifest.xml` for every package artifact, including library unit
tests, instead of relying on Tauri's bins-only resource directive. The XML
matches the pinned `tauri-build` 2.6.3 default; icons, version resources, runtime
pins, and the existing manifest's lack of a UAC override are preserved.
Cargo's `rustc-link-arg-tests` alone does not cover library unit tests. See
[tauri-apps/tauri#13419](https://github.com/tauri-apps/tauri/issues/13419)
and [tauri-apps/tauri#14580](https://github.com/tauri-apps/tauri/issues/14580).
Compare this manifest with upstream when re-evaluating the coordinated runtime
pin, and keep the Windows renderer/shutdown smoke gate.

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

Git 0.10.1 targets Denote 0.9.0. `plugins/git/tests/sync.test.ts` covers
porcelain rejections, preference-aware recovery, stale branch guards and failed
pull conflict state. Native synthetic-origin tests cover rejected automatic
pushes and both real merge/rebase conflict resolution through the production
typed transport. Every origin, note, commit and identity is invented; local
transport remains test-only.

Clone tests use local synthetic bare repositories. Folder selection alone must
leave the directory empty; only the host-bound explicit clone may populate it.
Keep cancellation, one-shot destination tokens, scope changes, changed/non-empty
folders, link replacement, visible failure state, and saved-note handoff covered.

The native read-only cancellation regression waits for a synthetic descendant
to start and keeps it behind a test-owned gate until cancellation. It checks
the descendant's process state after cleanup; a zombie has terminated even if
the operating system has not reaped it yet. Do not replace this synchronization
with a fixed-duration sleep or infer process cleanup only from a missing marker.

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
`npm audit --audit-level=high --workspaces --include-workspace-root` and
`npm ls lodash-es`. The host sanitizer and Mermaid 0.2.9 use DOMPurify
[3.4.17](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) to fix
[GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7),
[GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), and
[GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f).
The host sanitizer and Mermaid 0.2.9 use this patch. Earlier published plugin
archives retain their immutable bytes and source provenance.
The build/test toolchain pins Vite 8.3.5 and Rolldown 1.2.15 together, with
patched Undici 8.12.3. This compiler refresh uses new patch versions for all
11 plugin packages, including Git 0.10.1 and Code intelligence 0.1.2. Earlier
archive identities remain unchanged. Pin compatible compiler inputs and
validate all plugin digests plus the frontend build when updating the toolchain;
never repin an existing version to accommodate different compiler output.
Include the workspace root in npm audits so development dependencies such as
Vite and jsdom's Undici are covered as well as plugin workspaces.

The root `katex` override
pins [0.18.10](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.10) because
Mermaid 12 otherwise requires KaTeX 0.16, which is affected by
[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Keep it
at this compatible patch until strict-mode changes are reviewed. KaTeX 0.18.11
was deprecated after accidentally shipping the
[0.19 breaking changes](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0);
it is not a safe patch-only upgrade. Earlier published plugin archives retain
their immutable bytes and source provenance.
Changes to a plugin's own dependencies require an explicitly approved new
plugin version and committed source pin before `check:plugins` can succeed.
Never replace a released version's bytes or provenance; its ledger entry
remains tied to the original source commit.

### Landed plugin release history

The user-directed merge of
[#105](https://github.com/mbianchidev/denote/pull/105) establishes the canonical
0.9.0 catalog: all eleven current plugin versions retain source
`4e180efefe2801ac3b200c0b9915dc093990b4ff` and the matching Vite 8.3.5 /
Rolldown 1.2.15 inputs. The Rust-backport integration adopts those exact
manifests, guides, digests, and source pins, without rebuilding a different
identity at an existing version.

That merge also selects main's prepared Mermaid 0.2.5 record from source
`62cc5f14e57fb62b22f6d530e59fec35c89d7ebc`. The conflicting, never-published
#119 reservation from source `b865816bdfc21c48fc7d74848fb6bbc5aa68641b`
is abandoned, not substituted for main's artifact. Its original record remains
in Git history. Nonconflicting older #119 reservations, including Mermaid
0.2.8, remain unchanged in the ledgers but are not current catalog entries.
No published asset, main ledger entry, or current plugin source pin is
rewritten.

### Prepare an immutable plugin version

The 0.9.0 candidate introduces the code-intelligence and Git remote-recovery
host contracts; those new packages require 0.9.0, not older released hosts.
Security overrides pin KaTeX 0.18.10 for
[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) and
source-map-js 1.2.2 for
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Mermaid 0.2.9 combines DOMPurify 3.4.17, compatible KaTeX 0.18.10, and the included
math license in a new source pin. All canonical main ledger entries stay
unchanged. Select fresh versions above existing reservations in parallel
plugin PRs; an unpublished prepared version must not be silently reused.
Validate with the full `npm audit --audit-level=low`, not only workspace auditing.
After changing an override, use `npm update <package> --package-lock-only`
and verify `npm ls <package>` before committing and pinning; a lockfile-only
install can otherwise retain an older overridden transitive version.

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
Release preparation may rehost an unchanged artifact under the matching Denote tag
by changing the current catalog URL; it must not change its ledger origin,
source commit, size, or digest.
Before packaging, `npm run release -- --check <version>` verifies that current
catalog URLs and all application version sources match the intended Denote release.

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
  src/lib/editorRouting.test.ts \
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
Also cover ordinary `.md` discovery through explicit optional format metadata,
standard and escaped Obsidian sources, encoded indentation, fenced examples,
long titles with full details, completion state, read-only detail expansion,
confirmation/cancellation, migration with exact-source recovery, recovery fence
collisions, output-size refusal, and in-flight source/read-mode changes.
Format ownership must be unique, released on stop, and preserved through the
actual isolated worker bridge. Old suffix-only registrations must still work.

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

### Code intelligence plugin development

Use `npm run dev:plugin -- denote.code-intelligence` and the isolated development
app's local archive picker. The package requests `code-intelligence`,
`project-context`, and `sidebar`. It contains adapter metadata/protocol handling,
not UI or native process implementations. Install tools yourself and explicitly
approve them in the host; tests use synthetic Node protocol servers and never
run a developer's real language/debug configuration.

```bash
npx vitest run \
  packages/plugin-sdk/src/codeIntelligence.test.ts \
  plugins/code-intelligence/tests \
  src/plugins/codeHost.test.ts src/plugins/codeIntelligence.test.ts \
  src/plugins/runtimeMessages.test.ts src/plugins/workerRuntime.test.ts \
  src/plugins/hostOperations.test.ts src/plugins/usePlugins.test.tsx \
  src/lib/codeTools.test.ts src/lib/codeEditor.test.tsx src/lib/tabs.test.ts \
  src/components/CodeToolPanel.test.tsx src/components/PluginGuide.test.tsx \
  src/components/PlainTextEditor.test.tsx src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml plugins::code_
cargo test --manifest-path src-tauri/Cargo.toml plugin_v4_preserves
```

The native tests require the existing Node development prerequisite. Cover
byte-count framing, headers/JSON bounds, response IDs, cancellation, source
versions, folder markers/core project precedence, virtual URI/path translation,
foreign plugin/vault/project/language rejection, executable reapproval, process
groups and loopback teardown, DAP launch/configuration ordering, empty control
responses, optional capabilities, suspended reference lifetimes, synthetic
source edits, keyboard navigation and formatting, encrypted refusal and shutdown.

The frozen `plugins-v4` Welcome inventory adds only the code intelligence
exercise; previous markers/inventories and deleted examples stay untouched.
Stage the package, commit all source/SDK/build/lock inputs, then pin its full
source commit for the intended Denote release and commit the generated catalog
and `plugins/code-intelligence/releases.json` separately. No tool executable or
plugin archive belongs in Git or a desktop installer.

### Time tracking plugin development

Use `npm run dev:plugin -- denote.time-tracking` with the isolated development
application. Version 0.2.0 requests `time-tracking`, `clocks`, and `notifications`;
its worker owns note sessions, correction history, and the standalone stopwatch,
countdowns, and alarms. The host owns UI, native clock samples, scheduling,
notification dispatch, gesture-enabled sound, and explicit exports.

```bash
npx vitest run \
  packages/plugin-sdk/src/timeTracking.test.ts packages/plugin-sdk/src/clocks.test.ts \
  packages/plugin-sdk/src/civilTime.test.ts plugins/time-tracking/tests \
  src/plugins/runtimeMessages.test.ts src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx src/plugins/useTimeTracking.test.tsx src/plugins/useClocks.test.tsx \
  src/lib/clockSound.test.ts src/components/ClockPanel.test.tsx src/components/ClockBanners.test.tsx \
  src/components/TimeTrackingPanel.test.tsx src/components/ActivityRail.test.tsx \
  src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib plugins::time_tracking::tests
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib plugin_v5_
```

Use synthetic notes, project IDs, scopes, clock samples, and histories. Cover
one active timer across vaults, pause exclusion, sleep/wake and wall-clock
changes, same-boot restart, reboot recovery without guessing, stale requests,
locked disablement, cancelled confirmation, immutable revisioned corrections,
CSV formula safety, midnight/daylight-saving summary bounds, atomic storage
failures, and native export authorization/bounds.
Also cover independent simultaneous clocks without an active note, countdown
pause/resume/restart and limits, civil alarms and DST, revision/occurrence races,
notification batching/failure/retry, interrupted dispatch, locked banner actions,
sound gesture/cleanup, and writing both disable cutoffs before unloading.
Mock sound and system notifications; never ring real alarms during tests.

macOS uses `mach_continuous_time`, Linux uses `CLOCK_BOOTTIME`, and Windows uses
`GetTickCount64` plus the 32-byte boot-environment GUID query. These require no
new dependency or Tauri-family upgrade. Native clock tests run on all desktop
CI platforms. A clock/boot-identity failure must stay visible; never substitute
wall-clock duration.

The Welcome `plugins-v5` inventory contains only `plugins/Time tracking.md`.
Keep earlier inventories/markers and edited/deleted examples unchanged.
Commit source, SDK, build inputs, documentation, and lockfile first, then pin
`denote.time-tracking` 0.2.0 for Denote `v0.10.0` and commit its catalog/ledger
separately. The earlier prepared 0.1.0 reservation remains immutable, even
though it was not published. Existing plugin source pins and archive identities
stay unchanged.

### Advanced authoring plugin development

Phase 5 adds independent `denote.text-styling`, `denote.note-comments`, and
`denote.presentations` packages targeting Denote 0.11.0. Text styling and comments
remain 0.1.0. Presentations 0.1.1 adds standard `---` slide separators alongside
`===`; its earlier prepared 0.1.0 ledger entry stays immutable.
Feature branches retain the latest published application version;
the approved authoring capabilities also gate compatibility in local previews.
Use `npm run dev:plugin -- <id>` and the isolated development application.
Their shared additive contract is `packages/plugin-sdk/src/authoring.ts`;
downloaded implementations stay outside the renderer.

```bash
npx vitest run packages/plugin-sdk/src/authoring.test.ts \
  plugins/text-styling/tests plugins/note-comments/tests plugins/presentations/tests \
  src/components/AdvancedAuthoring.test.tsx src/components/AuthoringMarkdownEditor.test.tsx \
  src/components/NoteCommentsPanel.test.tsx src/components/PresentationEditor.test.tsx \
  src/plugins/useHighlightIndex.test.tsx src/lib/authoring.test.ts \
  src/lib/presentationPlayback.test.ts src/lib/nativeFullscreen.test.ts src/lib/search.test.ts \
  src/plugins/runtimeMessages.test.ts src/plugins/workerRuntime.test.ts src/plugins/usePlugins.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib note_comments
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib plugin_v6_
npx tsc --noEmit -p tsconfig.benchmarks.json
npm run build
npm exec --no -- playwright test benchmarks/authoring.perf.ts
```

The production-browser gate builds the three real worker entrypoints and mocks
only native IPC with invented notes. It exercises exact Rich formatting,
sidecar anchoring and ambiguous-orphan recovery, source preservation, real
full-screen keyboard navigation, autoplay, and return to ordinary notes.
Unit checks measure every palette pair against 4.5:1, absolute late-tick
deadlines, source/sidecar conflicts, malformed YAML, ownership, unknown fields,
symlink refusal, encryption sweeps, and lock/switch disposal. Never send private
selection bookmarks or editor functions across the worker boundary.

Source dependency validation compiles TypeScript with the same Vite/Oxc
toolchain before inspecting JavaScript imports. Erased type-only declarations
do not become runtime dependencies. Folder, editor, Tauri, and cross-plugin
boundaries are still checked on the original source, including type imports.
Runtime imports, side effects, re-exports, dynamic imports, and `require` remain
subject to dependency approval and the self-contained archive check.

The pinned Wry 0.55.1 enables WebKit element fullscreen only behind its optional
[`fullscreen` feature](https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/wkwebview/mod.rs#L386-L388),
which Denote's runtime graph does not enable. Presentation therefore uses DOM
fullscreen where supported and a public Tauri window-fullscreen lease plus a
native modal focus boundary otherwise. It restores the prior window state,
serializes owners, ignores obsolete cleanup, and handles cancelled entry.
`core:window:allow-set-fullscreen` applies only to the trusted main webview;
no native API or lease reaches a plugin. No private WebKit API, runtime-family
version, or Windows pin is changed.

Welcome `plugins-v6` adds only `Text styling.md`, `Note comments.md`, and
`Presentation.md`. Keep every earlier marker and inventory unchanged. Existing
paths and user edits are preserved; deleted applied samples are never restored.
Encrypted vaults receive only ciphertext after unlock.

Commit reviewed source, SDK, docs, tests, and lockfile before pinning each new
package for `v0.11.0`; commit catalog/ledger metadata separately. Do not repin
unchanged existing versions or include archives in the installer.

### Sensitive plugin development

Phase 6 adds isolated `denote.speech` and `denote.credential-store` packages.
Keep the application at its latest published version; plugin publication/pins
for the intended release are separate. Read
[the threat model and cryptographic design](phase-6-security.md) before changing
these boundaries. The pre-implementation design review on 2026-10-27 reported
no blocking vulnerabilities; that is not an independent production certification
or a guarantee against OS-owned plaintext copies.

```bash
npx vitest run packages/plugin-sdk/src/sensitiveTools.test.ts \
  plugins/speech/tests plugins/credential-store/tests \
  src/components/CredentialStorePanel.test.tsx src/components/SpeechPanel.test.tsx \
  src/lib/speech.test.ts src/lib/speechCapture.test.ts \
  src/components/AuthoringMarkdownEditor.test.tsx src/components/PresentationEditor.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
npx tsc --noEmit -p tsconfig.benchmarks.json
npm run build
npm exec --no -- playwright test benchmarks/authoring.perf.ts benchmarks/sensitive.perf.ts
```

The browser journey uses real compiled workers, editor transactions, keyboard
navigation, and the real capture worklet with Chromium's synthetic microphone
and muted output. Only native IPC is mocked. It verifies portable WAV links,
review-before-insertion, masked credentials, fresh export authentication, exact
source preservation, and removal. Native tests independently verify ciphertext
and tampering, private file permissions, locks/conflicts, whole-vault sweeps,
recovery ownership, and preservation of notes/decks/comments/audio/credentials.
Canary scans use invented values and include generated database/temp files.
The sensitive sidebar journeys additionally cover both rail entries,
Control-Space start/stop in Rich without a pre-positioned caret, exact Rich
selection replacement, microphone-track teardown when switching panels, and
credential table create/copy/link/delete actions. Service-link review must not
persist a credential domain. Component regressions cover pending model checks,
late permission/flush results, source-change append behavior, and refusal to
record in read mode or after another dialog takes over.

Windows CI additionally provisions a disposable, unprivileged synthetic account
and an explicitly readable fixture under Public Documents. A readable control
file proves the second identity can access that location; the private export
must reject it while empty, during writing, and after close. Owner read handles
are also denied until the write handle closes. The dedicated native account
test is explicitly ignored in ordinary local runs and invoked by CI with its
fixture environment. Account, files, and environment values are removed in
`finally`; desktop builds never provision accounts. Private transfers fail
closed when the filesystem cannot enforce private mode bits or persistent ACLs.

Run actual model inference only with explicit download approval:

```bash
npm run test:speech-model -- --approve-download --engine-dir /absolute/private/model-cache
```

The runner generates mock speech locally using macOS Samantha, Windows
System.Speech, or Linux `espeak-ng`; it never opens a microphone or reads notes.
It normalizes a private temporary WAV, invokes the real native downloader and
isolated helper, requires recognition of the generated word `synthetic` plus
word timing data, and removes its generated audio afterward. Omit `--engine-dir`
to remove the model/runtime cache too. `--executable <current-build>` reuses a
freshly built **speech-helper** binary, not the desktop executable; otherwise
the runner prepares a debug helper with two Cargo workers. No test corpus or
model weight is committed.

CI reuses its existing macOS/Windows/Linux matrix and runs this approximately
750 MB-per-platform smoke only when native speech, its shared build inputs, or
the workflow changes; incomplete/manual selection runs it conservatively.
Windows reuses its packaged release helper. Linux installs the offline
generator only for this gate. Other changes retain normal checks without these
downloads. Existing triggers, required checks, fail-fast, benchmark isolation,
runtime pins, and release consumers are unchanged. Extra Linux/Windows runtime
cost has not been measured locally; the approved macOS download/inference
smoke completed successfully on 2026-10-27.

`src-tauri/Info.plist` declares the microphone purpose, and
`src-tauri/Entitlements.plist` grants only audio-input access to a signed main
app. The CSP adds only same-origin/blob media, not remote audio connections.
The native engine uses verified platform archives and `libloading`; Windows ZIP support uses maintained
`zip` 9 with only deflate enabled, not the updater's disabled legacy ZIP feature.
No Tauri/Wry family member changes. A platform unable to load its optional
library reports unavailable inference rather than weakening main-app runtime
security.

`npm run prepare:speech-helper -- --debug` builds the separate
`denote-speech-worker` workspace package. Tauri's development/build hooks run
this automatically with the matching target and profile. Generated helper
binaries remain in ignored `src-tauri/resources/speech/`, never Git or a plugin
archive. Windows/Linux bundle the helper as a host resource. macOS embeds its
independently signed app under `Contents/Helpers/`; only this helper has the
library-validation exception needed for NVIDIA's pinned libraries, and it has
no microphone entitlement. The main/credential process keeps library validation.
This is necessary: real inference failed in a hardened main executable without
that exception, despite succeeding in an unsigned build.

The helper's small Tauri bundle config reuses the configured Developer ID
identity or certificate import. Local builds use ad-hoc hardened signing.
The helper is not notarized separately, so its nested-code build emits Tauri's
expected missing-notarization-credentials warning. Notarize the containing
application once with the normal release credentials. Never fix a model-load
failure by granting the library-validation exception to the main app.

The helper's working directory is its reverified runtime library directory,
not the model cache or a vault. The pinned GGML loader searches the executable
directory and current directory for backend libraries; changing `PATH` or
trusting an arbitrary DLL directory is not a substitute. Application failure
messages use fixed stages and numeric native status codes. The desktop reports
the child exit status and always discards engine stderr. Only Rust test builds
inherit helper stderr for the explicitly generated, synthetic-audio platform
smoke.
The verified library stays loaded until its bounded one-shot helper exits.
The pinned [GGML backend
registry](https://github.com/ggml-org/llama.cpp/blob/bd4f514db14d87fded667787a7a963bfbaa98e89/ggml/src/ggml-backend-reg.cpp)
explicitly warns that backend code cannot be safely unloaded while backend
threads/resources remain. Release recognizer/result handles normally, but do
not call `FreeLibrary`/`dlclose` on that code mid-process. The OS reclaims it on
helper exit, including cancellation.
If the Windows synthetic smoke fails, the runner compares the same generated
WAV with the already verified NVIDIA CLI in offline and streaming mode, using
explicit local model paths. It prints only selected crash-event module/code/
offset fields and preserves the original failing status. These test-only
reference probes neither enable a production CLI fallback nor download another
model or capture a microphone.

The SQLite `pending_speech_attachments` table contains only native operation
identities, paths, and hashes, never audio or transcript text. Vault-supplied
JSON is not recovery authority. Interrupted uncertain saves keep files; the
explicit **Keep unfinished audio** action clears only their derived recovery
records. The independent credential container never enters this table.

Welcome `plugins-v7` adds only `Speech.md` and `Credential store.md`. Earlier
markers, deleted applied samples, existing bytes, encryption deferral, and
explicit opt-in remain unchanged. For an unpublished plugin handoff, follow
**Preview an unpublished plugin on macOS** below and stage each archive with
`npm run dev:plugin -- denote.speech --once` and
`npm run dev:plugin -- denote.credential-store --once`.
Do not add local downloads to the production runtime or include model/plugin
archives in either installer.

Device-dependent microphone permission, installed voices, screen-reader use,
clipboard history, sleep/resume, and configured code-signing behavior still need
actual platform sign-off before release. Browser mocks do not establish those
guarantees. Record missing or unsupported capabilities instead of marking an
untested platform successful.

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

The frontend bundle integration tests run real in-memory Vite builds with a
file-local 30-second timeout so full-suite worker contention does not exhaust
the ordinary five-second deadline. Other test deadlines and byte limits stay
unchanged.

```bash
npx vitest run scripts/frontend-bundle.test.ts \
  src/components/ErrorBoundary.test.tsx \
  src/components/SourceControlDiffEditor.test.tsx src/App.test.tsx
npx tsc --noEmit -p tsconfig.node.json
```

## Dependency update boundaries

Dependabot excludes `plugins/**` and `packages/plugin-sdk/**` from npm version
updates, and `vendor/**` relative to `/src-tauri` from Cargo version updates.
These are immutable plugin source inputs or reviewed compatibility backports,
not independently upgradable manifests. The shared `mdast-util-from-markdown`
dependency also requires explicitly approved new plugin versions before its
resolved bytes change. Keep existing catalog entries, release ledgers, and
archive digests unchanged when updating host-only dependencies.

Root dependency updates must retain every SDK and plugin workspace in
`package-lock.json`, including their links and transitive dependencies.
Dependabot's excluded manifest paths do not exclude those workspaces from
`npm ci` or the audit. Regenerate from the last complete reviewed lockfile with
`npm install --package-lock-only --ignore-scripts --workspaces --include-workspace-root`;
verify plugin archive identities before accepting the result.

The npm `@tauri-apps/*` packages and Cargo Tauri, Tao, Wry, WebView2, and
URLPattern families remain manual updates under **Re-evaluate the Windows
runtime pin** below. Do not accept a partial npm or Cargo runtime upgrade.
These automation boundaries do not replace the JavaScript and source-aware
Rust audits; any security fix crossing them still requires the documented
compatibility or plugin-release procedure.

The Denote 0.10.0 refresh updates Mermaid to 12.2.0 and the shared
`mdast-util-from-markdown` graph to 2.1.0. Fresh plugin identities are Mermaid
0.2.10, Note graph 0.1.7, Reminders 0.3.3, and Advanced task lists 0.1.4.
Reminders also adopts the shared civil-time helpers. Commit all source,
SDK/build inputs, guides, legal notices, and the installed lock graph first;
pin these four packages and Time tracking 0.2.0 to that full source SHA with
`--release v0.10.0`, then commit appended ledgers/catalog separately.
Unchanged packages retain their existing source identities and bytes.

Keep the published v0.9.0 DOMPurify remediation from issue #130: canonical
DOMPurify 3.4.17, KaTeX 0.18.10, lodash-es 4.18.1, source-map-js 1.2.2, and
Undici 8.12.3 remain security overrides. Deprecated KaTeX 0.18.11 accidentally
included breaking 0.19 changes and is not a routine patch upgrade. Retain Vite
8.3.5, archive-compatible Rolldown 1.2.15, and pako 3.0.2. Do not rewrite old
ledger entries or repin old versions to fix already-published remediation.
The host-only compatible updates are autocomplete 6.20.4, @pierre/diffs 1.6.1,
and jsdom 30.1.3; no Tauri-family upgrade is implied.

After pinning, inspect `npm ls mermaid mdast-util-from-markdown dompurify katex
lodash-es rolldown`, run full and workspace-root `npm audit --audit-level=low`,
the affected plugin tests and full suite, `check:plugins`, `package:plugins`,
`check:plugin-downloads -- --source`, `check:plugin-archives -- --base
<full-origin-main-SHA>`, and `npm run build`. Check the real Mermaid entrypoint
and archive limits, native/CI gates, and macOS DMG handoff as usual.

## Rust dependency audits and Linux backports

Run `node scripts/audit-rust-dependencies.mjs`. Windows releases temporarily pin
Tauri 2.11.6, tauri-build/codegen/macros 2.6.3, runtime 2.11.3,
runtime-wry 2.11.4, Tao 0.35.3, and Wry 0.55.1. The npm Tauri API 2.11.1 and
CLI 2.11.5 use the matching runtime minor. Tauri 2.12, including
`tauri-utils` 2.10, opens a blank Windows webview and leaves the process alive
after its last window closes. Do not float this runtime family until the
packaged Windows renderer smoke gate passes. Desktop packaging rejects a
mismatched API minor. No vulnerability advisory is ignored.

The 2026-10-24 security refresh updates ctutils, Quinn, Rustls,
rustls-webpki, webpki-root-certs, and Tokio to compatible patched releases, and
replaces yanked clipboard-win 5.4.1 with 5.4.3. No vulnerability-level findings
remain in that audit.

The lockfile keeps `quinn-proto` at 0.11.19 to fix the advisories published on
2026-10-12:
[RUSTSEC-2026-0338](https://rustsec.org/advisories/RUSTSEC-2026-0338),
[RUSTSEC-2026-0340](https://rustsec.org/advisories/RUSTSEC-2026-0340), and
[RUSTSEC-2026-0343](https://rustsec.org/advisories/RUSTSEC-2026-0343).
This networking patch preserves the existing Windows/Tauri dependency graph.

Compatible lockfile patches also fix:

- `ctutils` 0.4.5:
  [RUSTSEC-2026-0385](https://rustsec.org/advisories/RUSTSEC-2026-0385).
- `rustls-webpki` 0.103.16:
  [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382).
- `webpki-root-certs` 1.0.11:
  [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383).
- `tokio` 1.54.1:
  [RUSTSEC-2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386).

These updates preserve the complete pinned Tauri, Tao, Wry, WebView2, and
URL-pattern package records.

The 2026-10-14 Rustls advisories
[RUSTSEC-2026-0346](https://rustsec.org/advisories/RUSTSEC-2026-0346),
[RUSTSEC-2026-0347](https://rustsec.org/advisories/RUSTSEC-2026-0347),
[RUSTSEC-2026-0348](https://rustsec.org/advisories/RUSTSEC-2026-0348), and
[RUSTSEC-2026-0349](https://rustsec.org/advisories/RUSTSEC-2026-0349) require
`rustls` 0.23.46 or newer; the lockfile now pins that patched version.
`tauri-plugin-updater` disables its default `zip` feature to remove `zip`
4.6.1 and the advisories published on 2026-10-17:
[RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367),
[RUSTSEC-2026-0368](https://rustsec.org/advisories/RUSTSEC-2026-0368), and
[RUSTSEC-2026-0369](https://rustsec.org/advisories/RUSTSEC-2026-0369).
That feature only extracts legacy Tauri v1 Windows ZIP and AppImage archives.
Denote publishes raw `-setup.exe`, `.msi`, `.AppImage`, DEB, and RPM updater
artifacts; macOS `.app.tar.gz` extraction does not depend on the feature. Keep
only `rustls-tls` and `system-proxy` enabled. Do not restore the default features
or add an unrelated ZIP dependency to mask its audit findings.

Seven source packages in `src-tauri/vendor/` carry narrowly scoped compatibility
backports through `[patch.crates-io]`; their original package names and versions
remain unchanged. The workspace defaults to the application only, so ordinary
desktop builds do not acquire a macOS or Windows GTK build requirement. Its
`target` tree is excluded so staged bundled Git source remains an independent
Cargo package. Do not list `.` in `workspace.members`: Cargo includes the root
package automatically, and an explicit root member overrides descendant
exclusions. The separate `speech-worker` member is built explicitly by its
preparation hook, not added to the default application test/build selection.
The source-aware audit permits only its exact reviewed local `0.1.0` manifest
alongside the application and named backports; it rejects a helper from a
registry, Git URL, different path/version, or duplicate package.

The workspace has one authoritative `src-tauri/Cargo.lock`. Redundant lockfiles
from the original Tauri plugin archives are omitted because Cargo ignores them
inside this workspace and they retain unrelated, stale dependency graphs.
The source-aware audit rejects reintroducing nested vendor lockfiles and
continues to audit every resolved vendor package's original registry identity.

Keep the vendored manifests on their reviewed dependency API lines. In
particular, GLib/GTK macros use Syn 2, and the opener build script uses
`schemars` 0.8 because pinned `tauri-plugin` 2.6.3 accepts its `RootSchema`,
not the incompatible `Schema` returned by `schemars` 1. Updating these
dependencies independently of their vendored source is not a compatibility
backport.

These backports and the maintained credential-store replacement remove all
nine unmaintained dependencies from the GTK, URLPattern, and D-Bus graph.
The published GLib version-based warning remains visible below.

The GLib and GLib-macro regression suites use maintained `trybuild` 1.0.122
instead of `trybuild2`, whose TOML parser is unmaintained
([RUSTSEC-2026-0374](https://rustsec.org/advisories/RUSTSEC-2026-0374)).
The same 29 invalid clone expressions and four unit-return forms remain covered
by checked-in compiler-diagnostic fixtures; the unit-return fixture denies
warnings. This is a test-tool migration only, not a change to the GLib runtime.

- GLib 0.18.5 applies the two-line
  [upstream iterator fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343):
  the variadic C out-argument is a mutable pointer passed through `&mut p`,
  not an immutable reference. Optimized iterator tests cover `next`, `nth`,
  `last`, `next_back`, and `nth_back`, including mixed-direction iteration,
  empty strings, and synthetic Unicode.
- GLib macros 0.18.5 and GTK3 macros 0.18.2 use the maintained
  [`proc-macro-error3` 3.1.1](https://github.com/gamma0987/proc-macro-error3)
  implementation with explicit Syn 2 support. Both the original crate and
  `proc-macro-error2` are unmaintained; do not replace one with the other.
  This removes `proc-macro-error` and
  [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370)
  from the resolved dependency graph without changing macro interfaces.
- URLPattern 0.3.0 backports the upstream
  [ICU identifier-property replacement](https://github.com/denoland/rust-urlpattern/pull/67).
  It uses Unicode `ID_Start` and `ID_Continue`, not the different Rust
  `XID_*` properties, and preserves URLPattern's `$`, `_`, and joiner rules.
  This removes all five unmaintained `unic-*` crates. Tests cover the current
  Unicode middle-dot continuation rule, invalid identifier characters, and
  the package's existing URLPattern conformance cases.
- Tauri opener 2.5.5 and single-instance 2.4.5 migrate only their Linux D-Bus
  adapters to maintained [zbus 6.0.0](https://github.com/z-galaxy/zbus/releases/tag/zbus-6.0.0).
  Its wire types, derives, and names replace the unmaintained standalone
  `zvariant`, `zvariant_derive`, and `zbus_names` crates:
  [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370),
  [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371), and
  [RUSTSEC-2026-0372](https://rustsec.org/advisories/RUSTSEC-2026-0372).
  The adapters follow the
  [upstream migration guide](https://z-galaxy.github.io/zbus/upgrading-to-6.html):
  they use asynchronous proxies on Tauri's persistent Tokio runtime rather
  than the removed blocking API. Scoped workers prevent nested-runtime panics,
  and single-instance ownership remains active between calls and is released
  at shutdown. Registration and secondary-activation failures are returned
  instead of silently dropping the launch.
- Tauri notification 2.4.0 selects `notify-rust`'s maintained `d` (libdbus)
  backend instead of its default zbus 5 backend. Linux delivery runs on a
  blocking worker and logs errors. The macOS and Windows notification
  implementations and native dependency versions remain unchanged.

The host uses `keyring-core` with explicit platform stores instead of the
all-in-one `keyring` facade. macOS and Windows keep the same native stores;
Linux uses maintained
[`dbus-secret-service-keyring-store` 1.0.1](https://docs.rs/dbus-secret-service-keyring-store/1.0.1/).
It uses encrypted Secret Service sessions, the same `service` and `username`
attributes, and the same default collection as the previous zbus store.
Existing service names, account hashes, and cleanup journals are unchanged.
Initialization remains lazy and failures are reported, without an unencrypted
or memory-only fallback.

The original registry archives were verified against the pre-backport
`Cargo.lock` SHA-256 checksums before extraction. Each package retains its
upstream license, copyright notices, and `.cargo_vcs_info.json`; these identify
the original source, not the additional Denote changes.

| Package | Original archive SHA-256 |
| --- | --- |
| `glib` 0.18.5 | `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5` |
| `glib-macros` 0.18.5 | `0bb0228f477c0900c880fd78c8759b95c7636dbd7842707f49e132378aa2acdc` |
| `gtk3-macros` 0.18.2 | `52ff3c5b21f14f0736fed6dcfc0bfb4225ebf5725f3c0209edeec181e4d73e9d` |
| `tauri-plugin-notification` 2.4.0 | `ad2fd40946aef810c4be9fd33a2d1b9b397cb79042b2d21c81a0a8f204354fd1` |
| `tauri-plugin-opener` 2.5.5 | `60d60366174b745b4ef5824b8bbc1c457fd08f0ce101ff643c0a49181a9f4e91` |
| `tauri-plugin-single-instance` 2.4.5 | `db817fe9295e19b7d8357e900af31edb93703dd9fb6de524b007b47b6afc63b0` |
| `urlpattern` 0.3.0 | `70acd30e3aa1450bc2eece896ce2ad0d178e9c079493819301573dae3c37ba6d` |

Raw `cargo audit --file src-tauri/Cargo.lock` skips local path packages.
The source-aware audit script verifies that the resolver uses exactly these
seven local names, versions, and manifest paths, with only Denote selected by
default. It rejects unreviewed non-registry dependency sources, audits the
actual registry graph, then audits a standard-input projection containing the
backports' original registry identities and archive checksums. It never edits
`Cargo.lock`. This prevents vendoring from silently hiding an advisory.
Both passes fetch the advisory database and crates.io registry metadata. The
published-baseline pass must not use `--no-fetch`: in `cargo-audit` 0.22.2 that
also prevents downloading missing index records for the seven local packages.
Yanked versions and unmaintained crates fail either pass.

`cargo-audit` 0.22.2 can print failed index downloads or missing crate/version
lookups but still exit zero. The wrapper preserves its diagnostics and also
fails on error or non-summary warning output, process-launch failures,
termination, or timeout. The ordinary allowed-advisory summary remains visible;
the GLib warning below is not ignored. A cold Cargo index must fetch the
published metadata successfully rather than relying on an already warm cache.
Synthetic success/failure coverage runs with
`npx vitest run scripts/audit-rust-dependencies.test.mjs`, including zero-exit
registry errors, unavailable metadata, yanked-version rejection, and the retained
GLib advisory.

The published-baseline scan still reports
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429) because
its version-based rule marks GLib 0.18.5 affected even with the source fix.
This warning remains visible: it is not ignored, renamed, or hidden with a
fabricated version. A successful audit exit alone is not proof that this bug
is fixed. The release-mode regression tests must pass. The audit includes all
platforms in the lockfile, so macOS and Windows also report this Linux dependency.
CI rejects any unmaintained-crate or yanked-version warning in either scan.

Run the backport checks with:

```bash
node scripts/test-gtk-backports.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --package urlpattern
DENOTE_TEST_DBUS=1 dbus-run-session -- cargo test --manifest-path src-tauri/Cargo.toml --locked \
  --package tauri-plugin-opener --package tauri-plugin-single-instance \
  --package tauri-plugin-notification --lib linux_backport
```

The GTK checks require native GLib development libraries. D-Bus tests require
Linux and `dbus-run-session`; they use synthetic services on a private bus, never
a user's desktop bus or real credentials. These checks run in Linux CI and
release validation alongside the ordinary all-platform desktop tests and
Windows renderer smoke. Historical tags without backports retain their
original release checks.

The complete GLib library unit suite runs unfiltered in debug mode. The separate
optimized gate retains all iterator safety tests and the `IntoStrV` fixture.
That fixture checks the null terminator through the underlying allocation
pointer, not
`slice.get_unchecked(slice.len())`: the callback's Rust slice intentionally
excludes the allocated terminator. This follows the
[upstream GLib 0.22.10 fixture](https://github.com/gtk-rs/gtk-rs-core/blob/0.22.10/glib/src/collections/strv.rs)
without changing production code or the pinned 0.18.5 identity. Coverage includes
empty, short, and stack/heap-boundary inputs for slices, vectors, owned `StrV`,
`String`, and `GString`, plus the fixed-array adapter. The owned-string cases
exercise their actual vectors rather than accidentally reusing the string-slice
array. Length, null termination, and every returned string remain asserted.

The local GLib source explicitly spells its previously elided return lifetimes
and removes unnecessary trait-object type parentheses without changing borrowing
semantics or upstream package identity. CI and release validation compile that
library with `unused_parens` and `mismatched_lifetime_syntaxes` denied.
`scripts/test-gtk-backports.mjs` also denies compiler warnings across the GLib
and macro suites and checks the original GTK3 macro library. Numeric fixtures
use `MAX`; extension-trait getters put `must_use` on trait declarations, not
trait implementations; the subclass fixture exercises its extension method;
and unused GTK3 parser fields are removed without changing error spans.

The driver copies the exact two GLib source packages into an excluded temporary
workspace under `src-tauri/target/`, with only their two required patches.
It seeds that workspace from the authoritative lockfile, resolves offline, and
rejects any local identity or registry dependency version absent from the
reviewed application graph before running tests with the derived lock frozen.
Nested `trybuild` projects therefore do not inherit unrelated GTK3, Tauri, or
URLPattern patches. Production keeps all seven patches and its original
resolver; no Cargo or compiler diagnostics are filtered. Generated source
copies are cleaned up, while a dedicated GTK target cache remains reusable.
Source copies stay outside that cache so `trybuild` retains the original
relative diagnostic paths and unchanged golden files.
These checks preserve the full debug suite, macro fixtures, subclass
compile-fail/pass fixtures, and optimized iterator/string-vector regressions.
The full library suite also keeps ownership of the synthetic main context
while its cross-thread `spawn_from_within` fixture runs, retains the caller's
context reference, and joins the worker before teardown. It asserts that a
non-`Send` future executes on the context-owning thread. This prevents a
detached worker from creating or dropping thread-local futures on the wrong
thread; no production executor code changes. The
[GLib 0.22.10 fixture](https://github.com/gtk-rs/gtk-rs-core/blob/0.22.10/glib/src/main_context_futures.rs#L789-L808)
likewise joins its worker and exercises a non-`Send` value.
Keep backports limited to the documented fixes, retain upstream attribution,
and remove them only when compatible upstream releases replace the patched
sources. Do not replace source fixes with advisory suppression.

### Vendored-library availability check

**TODO/FIXME: every agent must re-check upstream fixes at the start of every
Denote development session, before editing files, including non-Rust tasks.**
Inspect the current vendor inventory rather than assuming it still contains
only the packages above. Check official crate releases, upstream release
notes and issue/PR trackers, and RustSec for each package. Record the date,
versions examined, exact evidence links, and whether a compatible upstream
release can replace the local source. Report a compatible fix explicitly.

Last vendored-library check: **2026-10-29**.
All seven vendor directories and `[patch.crates-io]` entries were rechecked for
the note-dictation and sensitive-sidebar follow-up using the
[official registry index](https://github.com/rust-lang/crates.io-index).
The official
[crates.io API](https://crates.io/data-access), release notes, linked upstream
fixes and backport requests, and each linked RustSec advisory were checked
again. Published versions and dependency requirements were read directly from
the official sparse registry index. Compatible versions are unchanged; current
stable releases are listed below. RustSec's package pages have no direct entries
for GLib macros, URLPattern, or the three Tauri plugins, so their affected
macro-error, Unicode, and D-Bus dependencies were checked explicitly against
the advisories below. The three plugins also publish 3.0.0-alpha.3,
which requires Tauri 3 and still uses zbus 5, so it is not a compatible
replacement. No compatible
published replacement removes a local backport. The open
[zbus 6 plugin update](https://github.com/tauri-apps/plugins-workspace/pull/3722)
and [notify-rust update](https://github.com/hoodie/notify-rust/pull/294)
remain unreleased. The latest `trybuild2` 1.3.0 additionally depends on
unmaintained `basic-toml`
([RUSTSEC-2026-0374](https://rustsec.org/advisories/RUSTSEC-2026-0374));
the local regression tooling uses maintained `trybuild` instead, with equivalent
positive and negative fixtures rather than a warning suppression.
GLib 0.22.10 also provides the worker-join/non-`Send` fixture pattern linked
above; the local test retains explicit context ownership and teardown ordering
without changing the pinned GLib runtime.

[GLib 0.18.5](https://crates.io/crates/glib/0.18.5) remains the last
published compatible GLib release; the
[0.18 backport request](https://github.com/gtk-rs/gtk-rs-core/pull/2009)
and [later request](https://github.com/gtk-rs/gtk-rs-core/pull/2022) were closed
without merging. The current
[GLib 0.22.10 release](https://github.com/gtk-rs/gtk-rs-core/releases/tag/0.22.10)
and [GLib macros 0.22.9](https://crates.io/crates/glib-macros/0.22.9) do not
provide replacements compatible with the GTK 0.18 dependency graph.
[GLib macros 0.18.5](https://crates.io/crates/glib-macros/0.18.5) and
[GTK3 macros 0.18.2](https://crates.io/crates/gtk3-macros/0.18.2) still require
the local macro-error replacement.
The [upstream macro-error removal](https://github.com/gtk-rs/gtk-rs-core/pull/1288)
was not backported to those compatible releases. GTK3's own
[maintenance advisory](https://rustsec.org/advisories/RUSTSEC-2024-0419)
was withdrawn on 2026-08-14; that does not fix their `proc-macro-error`
dependency or GLib's retained iterator advisory.
[GTK3 macros 0.19.0](https://github.com/gtk-rs/gtk3-rs/releases/tag/0.19.0)
belongs to the GTK 0.19 / GLib 0.22 stack, not the pinned runtime's GTK 0.18
types. URLPattern 0.4 through the current
[0.6.0 release](https://github.com/denoland/rust-urlpattern/releases/tag/0.6.0)
contain the
[upstream ICU replacement](https://github.com/denoland/rust-urlpattern/pull/67),
but the verified Tauri utils 2.9.3 graph requires
[URLPattern 0.3.0](https://crates.io/crates/urlpattern/0.3.0).
The direct
[GTK3-macros advisory](https://rustsec.org/advisories/RUSTSEC-2024-0419)
is withdrawn; the separate
[macro-error advisory](https://rustsec.org/advisories/RUSTSEC-2024-0370)
and [Unicode advisory](https://rustsec.org/advisories/RUSTSEC-2025-0100)
remain applicable to the original dependency graphs. Neither withdrawal nor
a newer incompatible release removes the need for these local replacements.

Published
[notification 2.8.0](https://crates.io/crates/tauri-plugin-notification/2.8.0),
[opener 2.7.2](https://crates.io/crates/tauri-plugin-opener/2.7.2), and
[single-instance 2.5.5](https://crates.io/crates/tauri-plugin-single-instance/2.5.5)
require Tauri 2.12 and still use zbus 5. The
[notification release notes](https://github.com/tauri-apps/plugins-workspace/releases/tag/notification-v2.8.0),
[opener release notes](https://github.com/tauri-apps/plugins-workspace/releases/tag/opener-v2.7.2),
and [single-instance release notes](https://github.com/tauri-apps/plugins-workspace/releases/tag/single-instance-v2.5.5)
do not provide compatible releases removing the D-Bus backports. The
[upstream migration issue](https://github.com/tauri-apps/plugins-workspace/issues/3716)
is open; no compatible published plugin removes the local adapters.
[notify-rust 4.18.2](https://crates.io/crates/notify-rust/4.18.2) also retains
zbus 5 as its default Linux backend. Its existing libdbus backend and the
maintained Secret Service store above are usable replacements and are selected
locally. RustSec still marks the latest standalone
[`zvariant` 5.15.1](https://crates.io/crates/zvariant/5.15.1),
[`zvariant_derive` 5.15.1](https://crates.io/crates/zvariant_derive/5.15.1), and
[`zbus_names` 4.3.5](https://crates.io/crates/zbus_names/4.3.5) unmaintained;
a patch-only bump does not resolve their advisories.

Keep the reviewed backports until a compatible replacement passes the
source-aware audit, optimized GTK regressions, and all-platform validation.
Any required runtime-family change must also follow the Windows pin procedure
below and pass the packaged Windows renderer/shutdown smoke gate. Do not
silently upgrade, remove source fixes, or suppress an advisory.

### Re-evaluate the Windows runtime pin

The exact npm, Cargo manifest, and Cargo lock versions are one coordinated
workaround. Denote 0.7.2 moved to the Tauri 2.12 family; packaged Windows builds
then opened as a uniform black page and kept `denote.exe` alive after the last
window closed. Restoring the complete 0.7.1 Tauri graph fixed both behaviors.
Changing only Wry, only `tauri-utils`, or only the top-level Tauri crate is not a
supported upgrade.

Last upstream check: **2026-10-25**.

The Dependabot repair rechecked the releases and Windows issue/PR trackers
below. No published fix was identified for both the blank renderer and
orphaned process. The npm API 2.11.1, CLI 2.11.5, and complete Cargo runtime
family therefore stay at their verified versions.

- [Tauri 2.12.5](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.5)
  is the current stable release. Its
  [manifest](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/Cargo.toml)
  still requires GTK 0.18.
- [Tauri issues](https://github.com/tauri-apps/tauri/issues) had no identified
  Windows blank-webview fix matching this regression.
- [Wry 0.57.1](https://github.com/tauri-apps/wry/releases/tag/wry-v0.57.1)
  fixes macOS drag/drop and popup-controller handling plus Linux IPC injection;
  it does not identify a Windows fix matching both the blank frame and orphaned
  process.
- [Tauri's GTK migration issue](https://github.com/tauri-apps/tauri/issues/16264#issuecomment-6131842560)
  confirms that the maintained GTK bindings require coordinated work across
  the runtime crates.
- Earlier investigations of
  [Tauri issue #14846](https://github.com/tauri-apps/tauri/issues/14846),
  [Tauri issue #16232](https://github.com/tauri-apps/tauri/issues/16232), and
  [Wry issue #1871](https://github.com/tauri-apps/wry/issues/1871) found separate
  Windows blank-webview or Linux WebKitGTK problems, not a matching fix.

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

Migration investigation, 2026-10-24: maintained
[GTK 0.19.0](https://crates.io/crates/gtk/0.19.0) uses GLib 0.22. However, the
Tauri 2.11 and 2.12 runtime families, Tao, Wry, and WebKitGTK still use GTK 0.18
types. A new direct GTK/GLib dependency cannot replace incompatible transitive
types and native
`links` dependencies. The runtime, menu/dialog integrations, and WebKitGTK
bindings need a coordinated upgrade.

[Tauri 3.0.0-alpha.5](https://github.com/tauri-apps/tauri/releases/tag/tauri-v3.0.0-alpha.5)
requires Rust 1.95, matching version-three runtime/plugins, and native plugin
hooks that can run concurrently and require `Sync`. Its
[Wry runtime manifest](https://github.com/tauri-apps/tauri/blob/tauri-v3.0.0-alpha.5/crates/tauri-runtime-wry/Cargo.toml)
still uses
GTK 0.18 and WebKitGTK 2.0: moving to that alpha alone does not fix the findings.
Keep stable Tauri until a compatible maintained GTK stack is available. That
migration must cover Linux menus, dialogs, clipboard, deep links, single-instance
behavior, updater shutdown, and vault/plugin lifecycles across all platforms.
Do not relabel crates or suppress advisories to bypass this dependency boundary.

[zbus 6](https://github.com/z-galaxy/zbus/issues/2043) merges the deprecated
wire/name crates into `zbus::wire` and `zbus::names`. A direct dependency bump
cannot remove the older graph: the released Tauri opener and single-instance
plugins, notify-rust, secret-service, and zbus-secret-service-keyring-store still
require zbus 5. The coordinated
[Tauri plugin migration](https://github.com/tauri-apps/plugins-workspace/issues/3716)
and [dependency update](https://github.com/tauri-apps/plugins-workspace/pull/3722)
remain open, as does
[notify-rust's update](https://github.com/hoodie/notify-rust/pull/294).
Until compatible published clients or separately reviewed source backports are
adopted together, keep those warnings visible and preserve the Windows-safe
runtime family.

## GitHub Actions validation

CI runs on pull requests, pushes to `main`, and manual dispatch. The plugin
archive guard, JavaScript and Rust security audits, and macOS, Windows, and Linux
validation remain mandatory within each run.
The JavaScript audit includes the workspace root as well as plugins, so Vite
and jsdom/Undici development dependencies cannot escape the security gate.

The security job caches the pinned `cargo-audit` installation and Cargo
downloads, not the advisory database or audit results. The cache key includes
the tool version and Rust toolchain. Locked installation and the audit still
run on every revision; an audit failure remains a failed check. This tool cache
is saved even when the subsequent audit fails.

Platform jobs restore compatible Cargo caches on every branch but save new
entries only from `main`. This avoids uploading large, PR-scoped caches that
other PRs cannot reuse. Dependency-changing PR reruns may rebuild dependencies
until their changes reach `main`; no tests or checks are skipped on cache hits
or misses.

Windows builds the frontend once through Tauri's `beforeBuildCommand` when
building the renderer smoke binary, before Rust tests consume the generated
assets. macOS and Linux retain their standalone frontend build step.

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

## Build a desktop bundle

```bash
npm run tauri build
```

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

Feature and dependency PRs retain the latest published application version.
Only the release command below advances the root npm, Cargo, and Tauri
application versions. Do not run `npm run release -- <next-version>` while
preparing a feature PR: that makes the later release command produce no version
changes. Preparing new plugin versions, source pins, or catalog URLs for the
intended release does not require an application-version bump.

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

Non-packaging Linux jobs use `ubuntu-latest`. The Linux release builder alone
stays on `ubuntu-22.04` to preserve the existing glibc/WebKitGTK baseline for
installers and on-demand Git. FUSE remains a packaging-only dependency.
[Tauri's AppImage guidance](https://v2.tauri.app/distribute/appimage/) explains
why a newer build system can raise the required glibc version. Both macOS
release targets already use `macos-latest` with explicit Rust target triples;
their architectures and minimum-OS settings remain unchanged. Use only
[supported runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
not invented floating Intel-macOS or ARM-Linux aliases.

The validation job runs `check:plugins`, then
`npm exec --no -- tsx scripts/package-plugins.ts` to recheck and stage archives
using the already-built plugin entrypoints. Standalone `package:plugins` still
builds its own entrypoints first. The job transfers the verified
`.plugin-artifacts/*.tgz` files as the dedicated
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
