# Agent guide

Read these documents before changing Denote:

- `docs/product.md` defines product behavior and constraints.
- `docs/design.md` defines interface and accessibility conventions.
- `docs/architecture.md` explains implementation and security boundaries.
- `docs/development.md` lists setup and validation commands.
- `docs/user-guide/` contains the canonical in-app documentation.

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
