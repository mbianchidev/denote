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
When the focused file has an active explicit or implicit project, Settings also
shows a non-blocking **Code tooling** recommendation. Git, Terminal, Language
server, Linter, Compiler, and Code navigation roles report unavailable,
disabled, or enabled catalog status. Recommendations never download or enable a
plugin, and missing, disabled, or failed plugins do not affect core project
behavior.

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

Host messages reach a plugin one at a time, so activation, commands, note
events, and source-control actions never interleave. Two message kinds are
exempt. A `cancel-operation` source-control action runs concurrently, because
the operation it names is exactly what would otherwise be holding the queue; it
still carries its own request ID and its own host-validated action lease, so
correlation, lease checks, and failure reporting are those of any other action,
and a provider must expect its `runAction` to be re-entered for that one action.
A project-context change is delivered while an action is still in flight, so a
provider can invalidate a model update belonging to the workspace the user just
left; messages received after it still wait for it, so nothing else becomes
concurrent.

## Security and data boundaries

- Plugins receive no raw vault path or editor implementation object.
- An approved additive API version 1 `project-context` capability provides only
  the active explicit or implicit project's stable opaque ID and vault-relative
  root, with change events. It exposes no absolute filesystem path or project
  implementation object.
- A change event also carries `workspaceChanged`, which reports that the host
  switched to a different vault. It is reported even when the project context
  is null before and after the switch, because two vaults reach the same
  vault-scoped identity and a provider would otherwise keep showing a
  repository the user has left. The vault itself is never identified: the host
  compares the workspace internally and only the flag crosses the boundary.
- Plugin API version 1 exposes command registration, static sidebar views,
  note lifecycle events, plugin-scoped settings/state, OS keychain storage, and
  explicit-command-action capabilities for versioned workspace text,
  allowlisted HTTPS, clipboard access, notifications, platform-qualified
  allowlisted process groups, and the typed hardened Git transport. Static
  status items and literal source-editor
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
- Plugin command leases capture project identity as well as vault scope. Existing
  bounded process execution resolves and validates that captured project again,
  then runs with its current root as the working directory. Unmarking, switching
  projects, moving to another vault, or making the root unavailable prevents a
  stale lease from selecting a directory.
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
secure storage. Approved plugins may also observe `project-context`. Sensitive
workspace, network, clipboard, notification, and process operations exist only
inside an explicit command action.

Arbitrary renderer code, embedded webviews, custom React components, menu
injection, and general import/export hooks are deliberately not approved
surfaces in API version 1. Editor actions are exposed as commands so they inherit
the same user-action lease and permission checks. Adding a new surface requires a
typed declarative contract, deterministic disposal, accessibility behavior,
security review, and an additive SDK release; executable UI injection requires a
new API major and a separately documented isolation model.
Core source and fenced-code syntax highlighting is available before plugins
start and does not use a plugin capability. Specialized future grammars would
need a separately approved typed contribution contract and bundled package;
plugins cannot inject parsers or download executable grammar code through API
version 1.
Persistent terminals, long-running language-server sessions, and their protocol
APIs remain separate future plugin work rather than extensions of bounded
`process.run`.

Content-oriented capabilities remain unavailable while an encrypted vault is
locked. Plugins must use host APIs rather than reading decrypted temporary
files. A Git plugin therefore stages ciphertext only, tracks
`.denote/encryption.json` as binary, and passes the host encryption preflight
before committing.

### Git transport

The approved `git` permission adds a `git` capability to the user-action
context. It is privileged, so it exists only inside an explicit command or
source-control action lease. Only the source-control lease is extended to a
bounded ten minutes; ordinary commands keep the 30 second lease.

`git.run(request)` returns a `PluginGitOperation` handle,
`{ operationId, result }`, rather than a bare promise. The host generates the
operation ID and hands it back before the operation completes, so a plugin can
store it and call `git.cancel(operationId)` from a concurrent source-control
action while the first operation is still running. The host validates every
operation ID and refuses one that is already live. An invocation carries the
request and nothing else: there is no options argument, so no raw argument,
flag, environment value, or executable path can travel with a request. A user
who needs a Git that is not in a standard location fills in the plugin's
`gitExecutablePath` setting, a host-rendered string whose default is empty; the
host reads that setting itself for the requesting plugin and still requires the
path to be absolute, canonical, and a real Git executable. The reserved
`githubExecutablePath` setting works the same way for the GitHub CLI.

Beyond `run` and `cancel`, the Git capability exposes three host-owned
operations that are not Git commands: `listGitHubRepositories`, `cloneVault`,
and `cleanFailedClone`. Each one requires the same approved `git` permission and
the same user-action lease as a Git command. `listGitHubRepositories` and
`cloneVault` both reach the network, so both return `{ operationId, result }`
exactly as `git.run` does: the ID is published before the work is awaited, and
`git.cancel(operationId)` stops a browse or a clone while it is still running.
Cloning and deleting a failed clone additionally require the lease to belong to
the standardised source-control action the host confirmed, `clone` and
`clean-failed-clone`; a plugin command carries no source-control action at all,
and any other action ID is refused before the folder chooser opens or any native
command runs.

`PluginGitRequest` is a typed discriminated union covering discovery, status,
operation-state detection, initialize, stage, unstage, commit, branch and remote
listing, history, diff, fetch, pull, push, remote add/set/remove, branch
create/checkout/rename/delete, stash, merge, rebase, cherry-pick, revert,
continue/skip/abort, conflict-stage reads, conflict resolution, clone, and
cancel. `fetch`, `pull`, `push`, and `clone` additionally carry an `authMode` of
`public`, `ssh-agent`, or `github-https`; only the mode crosses the boundary,
never a credential. Every operation names exact structured fields; there is no argument
array, option flag, or shell input, and the native host maps each operation to a
fixed argument template. A commit may carry an optional `authorName` and
`authorEmail`; the host validates each as a bounded, non-empty, control-free,
bracket-free value and applies it as a highest-precedence command-line
configuration override placed before the `commit` subcommand, so repository
configuration cannot replace the identity a user configured. Omitting both keeps
whatever safe repository-local identity the repository already has.
`PluginGitResult` returns the operation ID, exit code,
standard output, standard error, and whether the operation was cancelled.
Conflict resolution requires the path to be genuinely unmerged in the index, so
it can never overwrite an ordinary tracked or untracked file, and a resolution
that is written but not staged is rolled back.

Requests are scoped to the active vault root or the captured active project, and
vault scope works without a marked project. The host resolves and pins a
canonical Git executable, refuses `PATH` lookup, disables hooks, filters,
pagers, editors, prompts, signing, submodule recursion, credential helpers, and
every protocol except HTTPS and SSH, pins every command-bearing configuration
key on the command line so repository configuration cannot win, replaces the
user's global configuration with a host-owned empty file so nothing in `$HOME`
can reintroduce a filter or a command, and rejects dangerous repository-local
configuration before running. Operations use process
groups, output bounded at 8 MiB that fails rather than truncates, a ten minute
hard timeout, and a native per-plugin cancellation registry that is also cleared
on disable, failed enable rollback, disable-all, and shutdown. Errors redact
absolute host paths and URL passwords.

### Remote authentication

`public` and `ssh-agent` need nothing beyond the hardened invocation: prompts
are already disabled, so an unconfigured agent fails with Git's own error rather
than waiting for input. `github-https` is served by a host-owned GitHub adapter.
The host resolves the GitHub CLI from fixed platform locations or the reserved
`githubExecutablePath` setting, requires an absolute, canonical, regular file
that answers `gh version`, and runs it with a stripped environment that removes
every ambient GitHub and Git token variable. `gh repo list` is asked for exactly
five fields, and each entry is dropped unless its name, HTTPS URL, SSH URL, and
default branch pass the same bounds the Git transport already enforces, so a
plugin receives only `nameWithOwner`, an HTTPS URL, an SSH URL, a default
branch, and a private flag.

The host registers the cancellable operation before it reads anything, so
cancelling during credential acquisition stops the GitHub CLI and the Git
command never starts. Registration and credential material are both released by
scope guards, so every error, timeout, and cancellation path unregisters the
operation and deletes the secret. The adapter captures `gh` output into bounded
private temporary files and polls their size, exactly as the Git transport does,
so a flood of output is refused at 1 MiB instead of deadlocking on an undrained
pipe. Askpass directories a killed process left behind are removed once, while
the plugin manager is being constructed, after the exclusive manager lock has
been acquired and after symbolic-link and path validation; a second Denote that
loses that lock never touches the material the live instance is authenticating
with, and nothing is swept during ordinary operation.

A token is read with `gh auth token` inside the native host, held in a zeroizing
buffer, and written to a private owner-only file in a fresh directory beside the
other host-owned Git support files. Git reaches it through `GIT_ASKPASS`
pointing at Denote's own executable in an early-exit askpass mode, selected by a
private environment marker that is stripped from every other child. The token
therefore never appears in an argument vector, a URL, `.git/config`, Git output,
a log line, or any plugin message, and the file is overwritten and removed when
the operation succeeds, fails, times out, or is cancelled. A `github-https`
operation is refused unless every URL it will actually contact really is an
`https://github.com` URL. For `fetch`, `pull`, and `push` those URLs are read
from repository configuration first, for the direction the operation uses: a
push reads `git remote get-url --push --all`, so a remote carrying a separate
`pushurl`, or several mirror URLs, cannot route a GitHub token to another host.
No credential material is created at all unless that check passes. The prompt
itself is the final authority: the askpass answer parses the target Git quoted
in its own prompt and answers only when that target is an HTTPS URL whose host
is exactly `github.com` or `www.github.com`. An absent, malformed, non-HTTPS,
userinfo-confused, port-bearing, lookalike, or non-GitHub target is answered
with nothing, so a remote repointed after the preflight and before the prompt
gets Git's own authentication error rather than the token. An
unsupported or unconfigured mode produces an actionable error and never falls
back to an interactive prompt.

The mode itself is a host-persisted plugin setting rather than plugin state. The
source-control panel reports the configured mode read-only and points at
Settings, so what is on screen is always the mode the next remote operation will
use.

### Cloning a vault

`cloneVault` is the one operation that creates a whole vault, so the host owns
every part of it. A plugin supplies a URL, an authentication mode, and an
optional branch; it never supplies, learns, or influences a destination. The
host opens a native folder chooser, and closing it is an ordinary `cancelled`
outcome rather than an error. The chosen folder must be a real, empty directory
that is not a symbolic link. The clone runs through the same hardened Git with a
fixed template that disables submodules, local object sharing, and hard links,
and the standard protocol pins still allow only HTTPS and SSH.

Before anything is registered, the checkout is validated: `.git` must be an
ordinary directory, repository-local configuration must pass the same dangerous
key inspection, no symbolic link may resolve outside the folder, Denote's
`.denote/locks` and `.denote/trash` control paths must not arrive as tracked
content, and `HEAD`, the origin URL, the current branch, the remote default
branch, and the upstream are read back. Only then does the host seal the
previous vault, register the clone, and hand a workspace snapshot to its own
renderer. The snapshot never crosses the plugin boundary, and an encrypted clone
opens locked, so the normal password and recovery screen appears before any
content.

A clone that fails leaves the destination exactly as it is and returns an opaque
host-owned clean-up token instead of a path. The panel offers Retry and
"Clean incomplete clone"; the clean-up needs its own dangerous confirmation, is
bound to that one canonical destination, revalidates that the folder is still
the failed clone and is not a live vault, deletes nothing else, and cannot be
spent twice. Nothing is ever cleaned automatically, and disabling the plugin
drops its tokens along with its running processes.

Vault encryption, sealing, and sweeping skip `.git` entirely, so repository
metadata is never encrypted or deleted. Disabling encryption is the one pass
that descends into `.git`, and an encrypting pass first recovers any repository
an older build encrypted: a `.git` directory whose `HEAD`, or a `.git` pointer
file that itself, carries Denote ciphertext is decrypted in place with the
active key, nested project repositories included, and is then left out of
encryption for good. A recovery that cannot be completed fails the operation
instead of leaving half-readable metadata behind. Encrypted vaults must be
unlocked, in the `encrypted` phase, and pass a full sweep before Git runs; the
vault key is never exposed to a plugin. Encrypted repositories get host-owned
managed blocks in `.git/info/attributes` and `.git/info/exclude`, so Git treats
content as binary and never writes conflict markers into ciphertext. The
`.denote/encryption.json` manifest is tracked like any other file and is covered
by the same rules, so Git can never line-merge wrapped-key metadata. Conflicts
in an encrypted vault are resolved by choosing a whole side. A `stash` `push`
with `includeUntracked` is refused on an encrypted vault before any Git command
runs, because it would remove an untracked `.denote/encryption.json` from the
worktree; stashing tracked changes still works. Repositories that
use `.git` file indirection, such as linked worktrees and submodules, report a
clear limitation rather than being modified.

### Automatic local commits

The approved `automatic-local-commit` permission adds one activation capability,
`automaticLocalCommit`. It is not a Git capability: a plugin registers a typed
schedule with an ID, a whole-minute interval above zero and bounded at a day, a
commit message, validated repository-relative include and exclude path prefixes,
and an optional commit identity, and receives a handle that replaces or removes
it. The worker validates every field before the registration leaves it, and the
host validates the message again and refuses anything a plugin sent without
going through the capability. Registering, replacing, and removing a schedule
are applied transactionally, staged schedules are discarded when activation
fails, and every schedule disappears the moment the plugin stops, crashes, or is
disabled. Plugin code receives no vault path, no project ID, and no Git handle
through it, and registering runs no Git command.

The host owns the timers and the commit. One timer exists per plugin, schedule,
and current vault and project, and only while a workspace is open and an
encrypted vault is unlocked and stable. Nothing runs when a timer is created:
the first run is one whole interval later, so enabling, unlocking, or switching
vault or project starts a fresh interval. A tick is skipped when the workspace
lock is held, when the window is closing, or when another automatic run is still
in flight, and a skipped tick is dropped rather than queued. Timers are cleared
and recreated on a schedule update, a vault or project switch, a lock or
maintenance phase, plugin removal, disablement, shutdown, and unmount.

A run drains uploads and preference writes and flushes every tab through the
same workspace operation explicit mutations use, so a commit matches what the
user sees, then calls one dedicated native command and always releases the lock.
It creates no plugin action lease and dispatches no provider action, so plugin
code never runs on a timer.

The native command requires both the `git` and `automatic-local-commit`
approved permissions, revalidates vault scope and project identity, and reuses
the host-owned executable, the hardening, and the encryption preflight of the
typed transport. It refuses to act without a repository or a commit on `HEAD`,
during a merge, rebase, cherry-pick, revert, or sequencer, with an unresolved
conflict, with anything already staged, and when the vault is locked or its
sweep cannot verify a file. Eligible paths come from NUL-safe tracked-change
output, are filtered by normalized prefixes where an empty include list means
everything and excludes always win, and are staged with `git add -u --` alone,
so an untracked file is never added. The index is snapshotted, bytes and
metadata or its safe absence, before staging and restored exactly when staging,
the commit, or cancellation stops the run, but only while the index on disk is
still the one Denote's own staging produced. Each index state Denote writes is
fingerprinted by digest, size, filesystem identity, and timestamp through a
single bounded, link-refusing read, and rollback rechecks that fingerprint
first: an index another Git process took over is left exactly as that process
wrote it, and the run reports that the concurrent Git activity was preserved.
`HEAD` is confirmed again immediately before committing so external Git activity
cannot be raced. No fetch, pull,
push, checkout, merge, rebase, revert, or other remote or history-rewriting
command is reachable from an automatic run, which stays local by construction. The result is a typed `committed`, `unchanged`, or
`skipped` status with a message and, where available, a commit ID, and no
generated message contains note content or paths. Standing runs join the same
cancellation registry as typed requests, so disabling the plugin or closing
Denote stops them.

The repository reference plugin is the end-to-end fixture. Its independently
downloadable artifact is stored under `plugin-artifacts/`, while only catalog
metadata enters the desktop bundle.

`denote.git`, the Git vault versioning plugin, is the first production catalog
entry and the `git` role candidate in the Code tooling bundle. It requests
commands, status, source control, project context, Git, and
`automatic-local-commit`, and requests no network, process, or workspace-write
permission. Its current increment registers one source-control provider, one
status item, refresh and initialize commands, and, when its interval setting is
above zero, one automatic local commit schedule. It supports refresh,
initialize, stage, unstage, commit of staged changes, cancellation, and
scheduled local commits of tracked changes. Remote operations, branch
switching, diffs, and conflict resolution are later increments; the plugin
reports them as unavailable instead of implying support.

Changing a plugin's settings reloads its runtime, because settings are read
during activation. The package, the approved permissions, and the enablement
record are untouched, so a schedule or a setting takes effect without
reinstalling the plugin.

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
