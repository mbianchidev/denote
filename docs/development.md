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

Targeted one-off builds are also available:

```bash
npm run build:plugin -- denote.example
```

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
bounded to 5 MiB, included in the deterministic archive, and independently
hashed by the native installer. `npm run build:plugin -- denote.mermaid` builds
both files without runtime imports.

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
  plugins/mermaid/tests/renderer.test.ts \
  src/plugins/diagramRenderers.test.ts \
  src/plugins/runtimeMessages.test.ts \
  src/plugins/workerRuntime.test.ts \
  src/plugins/usePlugins.test.tsx \
  src/components/MermaidMarkdownEditor.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml diagram_renderer
```

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
Archive compression uses the exact build-only `pako@2.1.0` implementation with
fixed gzip parameters and a portable header, not the Node runtime's native
zlib. Different native zlib builds can compress identical tar input differently.
The pinned compressor preserves existing source-archive bytes; upgrading it is
an archive-format change, not a routine dependency refresh. Golden-digest tests
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
off the edit path when no enabled plugin requests `note-events`, and the first
Git refresh to wait until its source-control view is opened.

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

## Build a desktop bundle

```bash
npm run tauri build
```

The GitHub Actions workflow runs the validation commands on macOS, Windows, and
Linux.

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
editor or combobox coverage when behavior changes. Update the product,
architecture, design, and canonical user guide language lists together. New
grammar dependencies must be direct dependencies, lazy-loaded, included in
`package-lock.json`, and pass `npm audit`; Denote never downloads grammars at
runtime. Specialized plugin grammar support requires a separately approved typed
host contract and is not part of plugin API version 1.

The canonical Welcome-vault language samples live in `docs/user-guide/code/`.
Keep one tiny invented file for every distinct `CORE_SYNTAX_LANGUAGES`
descriptor, plus representative filename-only rules and the ambiguous `.pp`
case documented in `code/README.md`. `src/lib/welcomeSamples.test.ts` compares
the directory with the live registry. The canonical Mermaid, PDF, JSON, and
YAML files live in `docs/user-guide/examples/`; the PDF must remain exactly
equal to the deterministic `createPdfFixture` output and contain no actions,
forms, annotations, attachments, or external links.

`src-tauri/src/default_vault.rs` also owns the non-destructive `examples-v1`
addition for older Welcome vaults. Tests must prove exact source inventory,
missing-file addition, existing-file preservation, one-time behavior, symlink
refusal, encrypted deferral, and ciphertext creation after unlock.

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
