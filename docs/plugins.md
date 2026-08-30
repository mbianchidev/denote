# Plugin ecosystem

Denote keeps optional capabilities outside the core application. Plugin source
lives in the monorepo under `packages/plugins/<plugin-id>/`, but the desktop
application must not bundle or execute those implementations. It can load
catalog metadata before enablement; executable packages are downloaded,
verified, installed, and loaded only after explicit user approval.

The independent public contract lives in `packages/plugin-sdk`. The editor host
imports that package through `src/plugins/api.ts`; plugins must not import
editor internals or another plugin.

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

`PluginRegistry` stores catalog entries rather than executable modules.
Registering metadata does not install, import, or activate plugin code.

Enablement is transactional:

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
cleanup. Permissions must be approved before download. Permission tokens include
their complete manifest payload, so network-host or other permission changes
require approval again.

The manager also provides **Disable all plugins** as a recovery action. Plugin
workers start after the core editor is usable, activation is time-limited, and a
worker crash automatically terminates that runtime and removes its package.

Catalog version changes never execute an old package under new metadata. On the
next Denote start, the old package is removed and the plugin is disabled with an
actionable message. Re-enabling downloads the new artifact and requires approval
of its complete permission payload.

Downloaded JavaScript runs in a dedicated module worker created from the
verified package. The worker has no DOM or Tauri API object. Its host bridge
exposes only approved services, plugin-scoped state, keychain access, and
registered contributions. Worker crashes trigger termination and package
removal. Enabled workers restart from verified installed packages when Denote
starts.

## Security and data boundaries

- Plugins receive no raw vault path or editor implementation object.
- Workspace, network, command, process, clipboard, notification, and
  secure-storage access require declared host capabilities.
- Secure-storage access is plugin-scoped. The host-provided API exposes no
  plugin ID argument, preventing a plugin from selecting another namespace.
- macOS uses Keychain Services, Windows uses Credential Manager, and Linux uses
  Secret Service through the cross-platform native keyring implementation.
- Secrets must use the OS-backed keychain implementation, never manifests,
  settings, logs, caches, packages, or telemetry.
- Enabling a plugin must not mutate vault content. Content changes require an
  explicit user action and the workspace-write permission. Mutating workspace,
  clipboard, and process capabilities are issued only to host-dispatched user
  action handlers and are absent from activation context.
- Disabled plugins have no executable package left locally. User-authored
  content is never deleted as part of disablement.
- Plugins never receive the unwrapped vault encryption key.

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
- dependency review reports no unresolved high-severity vulnerability;
- the committed archive exactly matches built source;
- its catalog entry pins an immutable repository commit and SHA-256 digest;
- requested permissions are minimal and accurately explained in the guide;
- accessibility, privacy, failure, disablement, and data-cleanup behavior are
  reviewed by a Denote maintainer.

`@denote/plugin-sdk` follows semantic versioning. Additive compatible changes
retain the API major version. Breaking context, manifest, lifecycle, or
capability changes increment `compatibility.apiVersion`, document migration,
and keep the prior host contract for a stated deprecation window before removal.

A vulnerable or compromised artifact is removed from its hosting ref when
possible, recorded in the plugin issue, and blocked in the next catalog update.
Already installed packages with missing, changed, or incompatible catalog
metadata are disabled and deleted at startup. Third-party publishers remain out
of scope until publisher signing and a remotely enforceable revocation channel
are designed and reviewed.

Plugins do not receive telemetry APIs by default. Any future telemetry
capability must be separately permissioned, disclosed in the guide, honor
Denote's global privacy settings, avoid note content and secrets, and remain off
until the user opts in.

Plugin proposals use `.github/ISSUE_TEMPLATE/plugin.yml`. The host API, SDK,
catalog, and native installer require maintainer review; each plugin owns its
manifest, guide, tests, artifact, migrations, and support lifecycle.
