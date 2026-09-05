# Agent guide

Read these documents before changing Denote:

- `docs/product.md` defines product behavior and constraints.
- `docs/design.md` defines interface and accessibility conventions.
- `docs/architecture.md` explains implementation and security boundaries.
- `docs/development.md` lists setup and validation commands.
- `docs/user-guide/` contains the canonical in-app documentation.

## Plugins

Before changing plugin code or lifecycle behavior, read:

- `docs/plugins.md` for the complete package, runtime, permission, security,
  installation, update, disablement, and publication model.
- `docs/development.md` for the current authoring, validation, packaging,
  pinning, and release commands.
- `docs/user-guide/docs/Optional plugins.md` for canonical user-visible
  behavior.

Plugin packages live in `plugins/git/`, `plugins/reference/`, and other
`plugins/<name>/` directories, each owning its manifest, guide, tests, and
repository-only `releases.json` ledger. Shared discovery metadata lives in
`plugins/catalog.json` and `plugins/bundles.json`; the public SDK stays in
`packages/plugin-sdk`. Trusted native Git integration belongs in
`src-tauri/src/plugins/git/`, not in downloadable plugin code.

The application embeds catalog metadata only. Plugin `.tgz` files are separate
GitHub Release assets and must never be committed, added to Tauri resources, or
included in desktop installers. Generated release archives belong only in
ignored `.plugin-artifacts/`. Historical versions retain their verified
immutable origin URLs and metadata; do not rewrite history or replace bytes.

For local plugin development, use the isolated development application:

```bash
npm run dev:plugin -- denote.example
npm run dev:desktop
```

Load the ignored `.plugin-dev/denote.example.tgz` from **Settings → Plugins**.
The local adapter is debug-only, visibly untrusted, and must continue to reuse
the production manifest, permission, extraction, entrypoint-integrity, worker,
rollback, and cleanup boundaries. Never add `file:` or localhost support to the
production downloader. Disable a local plugin before loading rebuilt bytes with
the same ID.

Stage one plugin version with:

```bash
npm run package:plugin -- denote.example
```

Commit the source and relevant SDK, lockfile, and build inputs first, then pin
that full source commit for the intended Denote release:

```bash
npm run pin:plugin -- denote.example --ref "$(git rev-parse HEAD)" --release v0.1.1
npm run check:plugins
npm run package:plugins
npm run check:plugin-archives -- --base "$(git rev-parse origin/main)"
```

`package:plugin` writes ignored staging output only. `pin:plugin` verifies
committed plugin source, SDK, build tooling, and lockfile inputs before building
and again after packaging, then updates only the
selected release ledger atomically before atomically replacing its catalog
entry; it does not publish a release. An interruption between those writes
leaves a prepared immutable ledger entry: retry the exact same pin, never edit
or remove that entry to bypass immutability. Commit metadata changes separately.
Catalog `provenance.sourceCommit` and ledger `sourceCommit` identify source
provenance, not a commit containing archive bytes; no binary Git object is needed.
New source ledger entries also retain `sourcePath`, the plugin directory at that
commit, so later directory moves do not rewrite released provenance.

`.plugin-artifacts/pin.lock` is an exclusive cross-process lock containing the
pin process's PID. A crashed pin leaves it behind; another pin refuses rather
than stealing it. Confirm no pin process is running before removing only that
exact lock file, then retry the same pin command. Never delete the ledger or
staging directory to recover a lock.

Never automatically bump a version or replace different bytes at an existing
version. `check:plugins`
and `package:plugins` verify historical downloads or deterministically rebuild
new versions without requiring archive blobs in Git. Historical downloads use
the exact ledger origin with no fallback. The archive guard rejects archives in
the index and additions across proposed commits, not immutable history.
`--base` requires a full commit SHA; it also preserves every existing release
ledger entry and rejects same-version catalog digest, size, or source-SHA changes
relative to that base.

Release preparation rewrites current catalog URLs to the Denote tag; the source
commit, size, SHA-256, and ledger origin remain authoritative. CI transfers
verified staged archives to the publish job and rechecks their names, hashes,
sizes, and URLs before uploading the exact bytes beside installers. Disabling
a plugin must remove package code, cached archives, staging content, and removal
backups without deleting vault content.

For macOS development handoff, build the disk image with
`CI=true npm run tauri build -- --bundles dmg`, then open the generated `.dmg`
from `src-tauri/target/release/bundle/dmg/`.

Preserve the one-time, non-destructive Denote Welcome vault behavior. Existing
Welcome vaults must not be overwritten. When adding, removing, or moving a
Welcome file, update `SEED_FILES` in `src-tauri/src/default_vault.rs`. Content
changes affect new Welcome vaults unless a separate non-destructive migration is
implemented.

Tests and test fixtures must use synthetic mock data. Never copy filenames,
paths, note text, customer data, personal data, or production data from a real
vault into tests. Reduce regressions to the smallest invented example that
preserves the behavior being tested.
