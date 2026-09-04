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

The application embeds catalog metadata only. Plugin `.tgz` files are committed
under `plugin-artifacts/`, checksum/source-commit pinned in
`packages/plugins/catalog.json`, and published as separate GitHub Release
assets. They must never be added to Tauri resources or desktop installers.

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

Publish one plugin version with:

```bash
npm run package:plugin -- denote.example
npm run pin:plugin -- denote.example --ref "$(git rev-parse HEAD)"
npm run check:plugins
```

Commit the source/archive before pinning, then commit the catalog pin
separately. Never replace different artifact bytes at an existing plugin
version. Release preparation rewrites current catalog URLs to the release tag;
the source commit, size, and SHA-256 remain authoritative. Disabling a plugin
must remove package code, cached archives, staging content, and removal backups
without deleting vault content.

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
