# Plugin ecosystem

Denote keeps optional capabilities outside the core application. Plugin source
lives in the monorepo under `packages/plugins/<plugin-id>/`, but the desktop
application must not bundle or execute those implementations. It can load
catalog metadata before enablement; executable packages are downloaded,
verified, installed, and loaded only after explicit user approval.

The independent public contract lives in `packages/plugin-sdk`. The renderer's
`src/plugins/usePlugins.ts` hook orchestrates the plugin lifecycle (catalog
refresh, transactional enable/disable, startup restore, shutdown) against that
contract; `src/plugins/workerRuntime.ts` (`PluginWorkerRuntime`) hosts each
enabled plugin in an isolated worker (`src/plugins/pluginWorker.ts`) and speaks
only typed messages to it. The native `PluginManager` in `src-tauri` is the
security boundary: it owns installation, verification, state persistence, and
transaction recovery. Plugins must not import editor internals or another
plugin.

## Package contract

Every plugin contains:

- `plugin.json` with a namespaced ID, semantic version, publisher, license,
  category, Denote/API compatibility, permissions, package paths, and optional
  settings schema;
- `guide.md` with purpose, permissions, usage, settings, disable behavior, and
  troubleshooting sections available to the catalog before code execution;
- `icon.svg` or another package-relative icon;
- an implementation under `src/` that imports only the plugin SDK and its own
  declared third-party dependencies.

Run `npm run check:plugins` to validate manifests, required documentation,
package layout, declared runtime dependencies, type safety, import boundaries,
and the real `dist/` entrypoint produced for each package. The reference package
at `packages/plugins/denote.reference/` exercises this contract without adding a
production feature.

## Host lifecycle

The renderer's `usePlugins` hook stores catalog entries in state rather than
executable modules. Fetching or displaying that metadata does not install,
import, or activate plugin code.

Enablement is transactional and orchestrated by `usePlugins`:

1. reject incompatible API or Denote versions before download;
2. download, verify, and atomically install through the native installer;
3. load the isolated runtime and require its manifest to exactly match signed
   catalog metadata;
4. provide only declared capabilities;
5. activate and track every disposable registration;
6. mark the plugin enabled only after activation succeeds.

Activation failure runs registered cleanup in reverse order, unloads the
runtime, and removes the downloaded package. Disabling calls the plugin's
deactivation hook, disposes registrations, unloads execution, and deletes the
package even when an earlier cleanup step fails.

The native host downloads HTTPS artifacts into application cache, enforces the
catalog byte count and SHA-256 digest, rejects links and traversal during
extraction, validates the packaged manifest, and atomically moves the verified
package into application data. Failed or interrupted enablement removes staging
content. Disablement terminates the worker before atomically removing package
code.

The Settings dialog contains the searchable, category-grouped plugin manager.
It shows catalog metadata, requested permissions, status, in-app guides,
declarative settings, enable/disable controls, and explicit data or credential
cleanup. Permissions must be approved before download. Structured permission
objects are persisted and compared with the current manifest, so any permission
change requires approval again.

The manager also provides **Disable all plugins** as a recovery action. Plugin
workers start after the core editor is usable, activation is time-limited, and a
worker crash automatically terminates that runtime and removes its package.
Renderer reload, shutdown, and disable-all recover or cancel native preparation
transactions before another plugin can start.

Catalog version changes never execute an old package under new metadata. On the
next Denote start, the old package is removed and the plugin is disabled with an
actionable message. Re-enabling downloads the new artifact and requires approval
of its complete permission payload.

The native state records both the catalog artifact digest and the exact
entrypoint digest. Startup and execution recheck those values, so changing
executable bytes without a matching catalog update disables and removes the
package. A process-wide file lock and Denote's single-instance guard prevent
multiple application processes from writing plugin state concurrently.

Downloaded JavaScript runs inside a dedicated, Vite-emitted module worker. Before
the verified data-URL entrypoint is imported, the typed worker bootstrap removes
ambient network, worker, broadcast, and browser-storage globals. The worker has no
DOM or Tauri API object; its private `MessagePort` exposes only approved services,
plugin-scoped state, keychain access, and registered contributions. Worker crashes
trigger termination and package removal. Enabled workers restart from verified
installed packages when Denote starts.

## Security and data boundaries

- Plugins receive no raw vault path or editor implementation object.
- Plugin API version 1 exposes command registration, static sidebar views,
  note lifecycle events, plugin-scoped settings/state, OS keychain storage, and
  explicit-command-action capabilities for versioned workspace text,
  allowlisted HTTPS, clipboard access, notifications, and platform-qualified
  allowlisted process groups. Static status items and literal source-editor
  decorations use disposable contribution handles like commands and sidebars.
  Privileged action leases expire when the command settles, the worker starts
  deactivating, or the active vault changes.
- Secure-storage access is plugin-scoped. The host-provided API exposes no
  plugin ID argument, preventing a plugin from selecting another namespace.
- macOS uses Keychain Services, Windows uses Credential Manager, and Linux uses
  Secret Service through the cross-platform native keyring implementation.
- Keychain account identifiers are SHA-256-derived from the plugin ID and key,
  preventing delimiter collisions between plugin namespaces. Cleanup keys and
  in-progress writes also live in a separate atomic credential journal so a
  corrupt general state file does not strand known secrets.
- Secrets must use the OS-backed keychain implementation, never manifests,
  settings, logs, caches, packages, or telemetry.
- Enabling a plugin cannot mutate vault content because workspace writes exist
  only in command action context. The host validates the current plugin
  permission before every read, write, network, clipboard, notification, or
  process operation.
- Disabled plugins have no executable package left locally. User-authored
  content is never deleted as part of disablement.
- Plugin state is limited to 256 keys, 256 KiB per value, and 2 MiB total.
  Declarative settings are capped at 256 KiB and revalidated against current
  types, choices, defaults, and numeric ranges.
- Settings exports contain their schema version. Imports run every declared
  one-version migration before current validation, and the UI also supports
  reset-to-default behavior.
- Plugins never receive the unwrapped vault encryption key.

### API version 1 contribution surfaces

API version 1 supports commands, static sidebar views, status items, literal
source-editor decorations, note lifecycle events, settings/state, and optional
secure storage. Sensitive workspace, network, clipboard, notification, and
process operations exist only inside an explicit command action.

Arbitrary renderer code, embedded webviews, custom React components, menu
injection, and general import/export hooks are deliberately not approved
surfaces in API version 1. Editor actions are exposed as commands so they inherit
the same user-action lease and permission checks. Adding a new surface requires a
typed declarative contract, deterministic disposal, accessibility behavior,
security review, and an additive SDK release; executable UI injection requires a
new API major and a separately documented isolation model.

Content-oriented capabilities remain unavailable while an encrypted vault is
locked. Plugins must use host APIs rather than reading decrypted temporary
files. A future Git plugin may stage ciphertext only, include
`.denote/encryption.json`, and run the host encryption preflight before
committing.

The repository reference plugin is the end-to-end fixture. Its independently
downloadable artifact is stored under `plugin-artifacts/`, while only catalog
metadata enters the desktop bundle.

## Publication and governance

The initial catalog is first-party only. A plugin artifact is publishable when:

- its source is contained in one `packages/plugins/<plugin-id>/` directory;
- manifest, guide, package, type, import-boundary, and artifact checks pass;
- frontend and native tests pass on macOS, Windows, and Linux;
- automated JavaScript and Rust audits report no unresolved high-severity
  vulnerability;
- the committed archive exactly matches built source;
- its catalog entry pins an immutable repository commit and SHA-256 digest;
- its trusted provenance publisher and source commit match the immutable
  artifact URL;
- requested permissions are minimal and accurately explained in the guide;
- accessibility, privacy, failure, disablement, and data-cleanup behavior are
  reviewed by a Denote maintainer.

`@denote/plugin-sdk` follows semantic versioning. Additive compatible changes
retain the API major version. Breaking context, manifest, lifecycle, or
capability changes increment `compatibility.apiVersion`, document migration,
and keep the prior host contract for a stated deprecation window before removal.

A vulnerable or compromised artifact is removed from its hosting ref when
possible, recorded in the plugin issue, and marked with a catalog revocation
reason and timestamp. Revoked versions are disabled and removed before code
execution.
Already installed packages with missing, changed, or incompatible catalog
metadata are disabled and deleted at startup. Third-party publishers remain out
of scope until publisher signing and a remotely enforceable revocation channel
are designed and reviewed.

The version 1 catalog is embedded in each Denote release. New listings,
available-version metadata, and revocations therefore arrive with an application
update. A changed catalog fingerprint disables and removes the previous package
instead of executing stale code; re-enablement downloads the new artifact and
repeats permission approval. Automatic background updates and executable-version
rollback are intentionally unavailable in version 1.

Plugins do not receive telemetry APIs by default. Any future telemetry
capability must be separately permissioned, disclosed in the guide, honor
Denote's global privacy settings, avoid note content and secrets, and remain off
until the user opts in.

Plugin proposals use `.github/ISSUE_TEMPLATE/plugin.yml`. The host API, SDK,
catalog, and native installer require maintainer review; each plugin owns its
manifest, guide, tests, artifact, migrations, and support lifecycle.

Curated bundles live in `packages/plugins/bundles.json`. They can reference
stable categories and explicit plugin IDs for discovery, but never trigger
download or enablement.
