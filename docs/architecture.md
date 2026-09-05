# Architecture

Denote is a Tauri v2 desktop application with a React 19 and TypeScript
frontend plus a Rust native core.

Vite injects the package version and full `git rev-parse HEAD` SHA as compile-time
constants. The About dialog therefore reports the exact desktop artifact build,
not a later runtime checkout or mutable environment value.

## Data boundaries

The selected vault is the content boundary. Every regular file up to 25 MB can
be opened. Markdown (`.md`, `.markdown`) gets the rich/source editor, `.mdx`
uses non-executing JSX-highlighted source editing, other valid UTF-8 files use
the plain editor, and invalid UTF-8 uses a byte-preserving Base64
representation. Images keep their visual preview and offer a raw-edit toggle.

Consistent LF, CRLF, and CR files are normalized in the editor and restored to
their original line-ending style when saved. Mixed line endings use Base64 so
no newline information is discarded.

At startup, Rust atomically seeds an embedded **Denote Welcome** folder beside
the application-data database if that folder does not exist. The complete
directory is written to a random staging path and renamed into place, so a crash
cannot expose a partial guide. Existing files are never merged or overwritten.
The vault is registered as the built-in default, used when no valid last vault
exists, and new copies contain `.denote.md` plus the link-compatible
`Welcome.md`. Existing copies without `.denote.md` continue opening
`Welcome.md`.
The canonical seed content lives under `docs/user-guide/` and is embedded by
`src-tauri/src/default_vault.rs`.

A versioned marker under `.denote/fixtures` adds the multilingual `test` folder
once to older unencrypted Welcome vaults. Existing `test` entries are preserved,
symlinks are never traversed, and encrypted vaults defer the addition until the
encryption manifest is removed.

The native folder picker establishes the active vault inside Rust. Later IPC
commands do not accept arbitrary vault roots. The Rust core canonicalizes every
path, rejects parent traversal and symlink/reparse-point escapes, hides Denote's
internal `.denote` folder, and limits document and image sizes before reading
them into memory.
Project-configuration IPC carries the originating snapshot's vault path only as
an identity guard. Rust compares that value to the current active vault and
rejects stale queued requests before using the active vault as the operation
root. Project/workspace mutations hold the workspace write guard; read-only
`.gitignore` status refreshes hold the shared read guard so they may run
concurrently without racing a vault switch or mutation.
Workspace snapshots also carry the vault-relative paths currently matched by
`.gitignore` rules within each file's closest explicit or implicit project.
Generation- and vault-guarded frontend status refreshes run through one ordered
queue: complete root scopes replace the full set and complete narrow scopes merge
in invocation order. Workspace snapshots preserve a queued result only when a
complete status update applied while the snapshot was in flight; failed or
incomplete requests do not suppress the snapshot's full set. This status is
presentation metadata only: ignored files stay in the tree, cache, search index,
project model, and open tabs.

Explicit project roots and workspace roots are independent operational path
metadata in the application-data SQLite database, never files or markers inside
vault/project content. Each root has a stable opaque ID and validated
vault-relative folder path; one folder may hold both roles.

A workspace discovers each safe, real direct child directory as an implicit
project with its own stable opaque ID. Descendants resolve to that child, while
files directly in the workspace container receive no implicit project. Refresh
discovers new direct children. Explicit nested roots still win through
closest-root resolution, and marking an implicit child as a project promotes the
same identity rather than replacing it.
Filesystem discovery is optional: an unavailable workspace or child is logged
and skipped without blocking cached or full vault snapshots. Each complete
reconciliation lists workspaces, materializes implicit roots, and associates
them in one SQLite immediate transaction, serializing concurrent workspace
removal and rolling back all partial metadata on error. Snapshot reconciliation
errors are logged and the last committed project configuration remains usable;
explicit mark and refresh commands return the error. Marking a workspace also
includes its new workspace row and root-suggestion dismissal in that transaction.

Denote-managed rename and move operations rekey explicit roots, workspaces, and
implicit children without changing their IDs. Unmarking a workspace deletes
only implicit-only children; promoted explicit children remain. Missing roots
and children stay recorded but unavailable. Trash clears affected project and
workspace metadata. If a trashed child is restored beneath a still-marked
workspace, refresh discovers it as a new implicit project.

The root Git suggestion is derived only when the canonical vault safely contains
a `.git` regular file or directory and the root is neither an explicit project
nor a workspace. Acceptance creates an explicit root project. Dismissal and
manual root project/workspace marking persist a per-vault dismissal; no
filesystem marker is written and no root is marked automatically. IDs, paths,
and dismissal state are outside vault content encryption, like other operational
path metadata.

## Plugin boundary

Plugin implementations live under `plugins/<name>/`, including `plugins/git/`
and `plugins/reference/`, separate from the editor and from every other plugin.
Each package owns its implementation, manifest, guide, tests, and repository-only
release ledger. Shared discovery metadata lives in `plugins/catalog.json` and
`plugins/bundles.json`. The public, versioned contract lives in
`packages/plugin-sdk`. `src/plugins/usePlugins.ts` is the
renderer-side orchestrator that drives the lifecycle against that contract;
`src/plugins/workerRuntime.ts` (`PluginWorkerRuntime`) and
`src/plugins/pluginWorker.ts` provide the typed, isolated runtime each enabled
plugin executes in. The native `PluginManager` is the installer, state, and
security boundary: it downloads, verifies, installs, persists state, and
recovers transactions. CI rejects editor imports of plugin implementations,
plugin imports of editor/Tauri internals, and direct plugin-to-plugin
dependencies.

The plugin catalog accepts metadata, not executable modules. Catalog display is
therefore safe before enablement and cannot run plugin code. Release preparation
rewrites each current catalog URL to the matching versioned GitHub Release asset,
while the source commit, byte count, and SHA-256 digest remain independently
pinned. The downloader follows only bounded HTTPS redirects across approved
GitHub asset hosts. Installers contain the catalog but no plugin archive.

Plugin archives are never tracked in the current repository tree. Each
`plugins/<name>/releases.json` ledger records immutable versions, source commits,
origin URLs, sizes, and SHA-256 digests; it is not embedded in the application.
Historical entries keep verified commit-addressed archive URLs, so existing
bytes remain available without copying old Git blobs into new commits. Downloads
use only the exact ledger origin and fail closed if it is unavailable or invalid,
without a fallback to another source. New entries use deterministic builds of
committed source and verified build inputs.
Packaging writes only ignored `.plugin-artifacts/` staging output.
Release validation verifies archive content against source as well as safe
entries, size, and digest, then transfers those bytes in a dedicated workflow
artifact. Publishing rechecks the complete filename set, catalog release URLs,
sizes, and hashes before uploading the same bytes beside the desktop installers.
It neither rebuilds nor reads archives from Git. Rehosting changes only current
catalog URLs, not ledger origins or archive provenance.

Debug builds have a separate local-development adapter, compiled out of release
builds. It is available only when Tauri runs with the
`dev.mbianchi.denote.development` identifier. The native file picker reads one
regular bounded `.tgz` into memory, derives an explicitly untrusted development
entry, and overlays it on the embedded catalog for that process only. It never
adds `file:` or localhost support to the production downloader. The archive
still passes common manifest, category, permission, settings, path, extraction,
entrypoint, and worker checks before enablement. A local package must be
disabled before replacement, and stale development enablement is removed at
startup instead of being restored under production metadata.

The development Tauri configuration uses separate application data, cache, and
manager-lock locations. The keychain service is derived from the runtime
application identity while preserving the existing production service name, so
even a differently named debug/preview build cannot corrupt production
credential tracking. Local archives live only in ignored `.plugin-dev/` output
and are never Tauri resources or installer inputs.
An enable operation must pass compatibility checks, native download, checksum
verification, atomic installation, isolated runtime loading, exact manifest
matching, capability construction, and activation before enabled state is
committed. A failed enable operation disposes registrations, unloads the
runtime, and removes package code.

Disablement runs even after plugin failures: deactivation and every registered
disposable are attempted, then the runtime is terminated and its downloaded
package, per-plugin download cache, staging content, and atomic-removal backups
are deleted. Plugin settings and generated data use an app-data namespace
separate from the vault. Secure-storage capability is backed by an OS keychain
namespace derived by the host from the plugin ID; plugins cannot select or list
other namespaces. User-authored vault content is never removed with a plugin.

Plugin activation contexts expose capability-specific services instead of a
vault path, application state, Tauri invocation, or encryption keys. A plugin
cannot receive a capability absent from its signed manifest. Enabling alone must
not invoke any workspace mutation. Plugin API version 1 intentionally exposes
command registration, static sidebar views, note events, plugin-scoped
state/settings, optional secure storage, status items, literal source-editor
decorations, typed source-control view models, typed automatic local commit
schedules, and explicit user-action services.
Source-control providers contribute host-rendered repository, resource, branch,
remote, history, diff, conflict, operation, and recovery data; they cannot render
HTML or execute Git directly. A provider describes an advanced operation as a
typed plan — the operation, its source, the branch it changes, its risk, and the
bounded paths it expects to touch — and an operation in progress as the typed
operation plus which of continue, skip, and abort are valid for it, so the host
renders controls and confirmations from typed values rather than from provider
wording. A conflict is described as the three recorded sides, each with whether
the index holds it and its exact UTF-8 text when the provider may show one, plus
the chunk model, the editable result, and whether that result is unsaved. Their history is a bounded page with its own index, size,
and whether an adjacent page exists, and their diff content names the comparison
it came from, so the host offers a hunk action only for the working tree and the
index and never for commit history. Opening a file is host-owned: a provider
names a repository-relative path, and the host resolves it inside the open vault
and uses its ordinary file-open flow, so no absolute path is built, shown, or
returned to a plugin.

The separate `automatic-local-commit` permission exposes exactly one activation
capability: registering a typed schedule with an ID, a bounded interval in whole
minutes above zero, a commit message, validated repository-relative include and
exclude path prefixes, and an optional commit identity. Registration returns a
handle that replaces or removes the schedule, and the runtime applies every
register, update, and unregister transactionally, discarding staged schedules
when activation fails and clearing them when the plugin stops, crashes, or is
disabled. No vault path, project ID, or Git capability is exposed to plugin code
through it, and the schedule itself runs no Git command.

The host owns the timers. One timer exists per plugin, schedule, and current
vault and project; none exists while no workspace is open or while an encrypted
vault is locked or mid-maintenance. Nothing runs when a timer is created: the
first run is one whole interval later. A tick is skipped when the workspace lock
is held, when the app is closing, or when another automatic run is still active,
and timers are cleared and recreated on a schedule update, a vault or project
switch, an unlock, a plugin removal or disablement, shutdown, and unmount. A
run drains uploads and preference writes and flushes every tab through the same
workspace operation used by explicit mutations, then calls one dedicated native
command, refreshes and reindexes after a commit, and always releases the lock.
It never creates a plugin user-action lease and never dispatches a provider
action.

That native command requires both the `git` and `automatic-local-commit`
approved permissions, revalidates workspace and project identity, and reuses the
host-owned Git executable with the same hardening and encryption preflight as
the typed transport. It refuses to act when there is no repository or HEAD, when
a merge, rebase, cherry-pick, revert, sequencer, or conflict is in progress, when
anything is already staged, when the vault is locked or its encryption sweep
fails, and when no tracked worktree change matches the configured prefixes. It
never adds an untracked file: eligible paths come from NUL-safe tracked-change
output, are filtered by normalized prefixes where excludes win, and are staged
with `git add -u --` alone. Before staging it snapshots the index bytes and
metadata, or its safe absence, revalidates HEAD immediately before committing,
and restores that snapshot exactly whenever staging, the commit, or cancellation
stops the run. Restoring is conditional on ownership: every index state the run
produces, the snapshot itself and then each staging batch that lands, is
fingerprinted by SHA-256 digest, size, filesystem identity, and timestamp, read
through one handle that refuses to follow a link and is bounded by the snapshot
ceiling. Rollback rereads the index and writes only while it still matches that
fingerprint, so an index another Git process committed, staged, or replaced in
the meantime is left exactly as that process wrote it and the run reports a
skipped or failed outcome saying the concurrent Git activity was preserved.
Ownership moving with each staging batch is what keeps a failed or cancelled run
from leaving its own partial staging behind. Fetch, pull, push, checkout, merge,
rebase, revert, and every
other remote or history-rewriting command are unreachable from it: a standing
run is local by construction, whatever remotes the repository has. It returns a
typed `committed`, `unchanged`, or `skipped` status with a message and, where
available, a commit ID, and its generated messages never contain note content or
paths. Standing runs register in the same Git operation registry as typed
requests, so plugin disablement and application shutdown cancel them.
Each provider is addressed by its `(pluginId, providerId)` pair. The activity
rail and vault sidebar render only the typed model with native host controls;
standardized user actions are returned to the owning provider through a
workspace-scoped action lease. A provider that reports an `activeOperationId`
while it is busy also gets a host-rendered cancel control, which returns that
exact ID to the provider as a `cancel-operation` action rather than cancelling
anything itself. That one action bypasses the worker's serialized host-message
queue, so it reaches the provider while the operation it names is still
running; every other action stays serialized. A project-context change is
likewise observed during an in-flight action, so a provider can discard a model
update that belongs to the workspace the user just left. Provider updates
replace the displayed model
live, while unregistering or disabling the provider clears its selection and
returns the sidebar to Files.
The host does not run the provider's initial refresh during vault activation.
It waits until the user opens that source-control view, keeping Git status work
off the vault scan, tab restore, and search-index critical path.

Source-control actions that can mutate the vault take the workspace lock, which
flushes every open note and the tab session before the provider runs, and
refresh the workspace snapshot and search index afterwards. A smaller set —
checkout, create-and-checkout, the two answers that resolve a pending branch
switch, pull, merge, rebase, cherry-pick, revert, and continue, skip, or abort —
can also replace what is on disk, so those additionally reload every open tab
from the refreshed vault. The reconciliation keeps pane layout, tab order,
groups, and each tab's language and view choices, replaces only the bytes,
closes and names the tabs whose paths the refreshed tree no longer has, and
gives a tab whose content really changed a new editor revision so an editor
history built on the previous branch cannot write those bytes back. Ignored
status is re-read in the same pass.
Workspace text reads return
a content version that writes must present unchanged, reusing the canonical
vault boundary and conflict hashes;
network requests require HTTPS and declared hosts; clipboard, notifications, and
processes require separate permissions; processes use platform-qualified exact
absolute executable allowlists, cross-platform process groups, bounded output,
and a timeout.

### Git transport

The approved `git` permission adds one privileged, action-lease-scoped service,
`git.run`, routed from the plugin worker through `hostOperations` and
`src/lib/api` to the native `plugin_git_request` command. Only the
source-control action lease is extended to a bounded ten minutes so it can span
one native Git operation; ordinary commands keep the 30 second lease.

`PluginGitRequest` is a typed discriminated union. Each operation carries exact
structured fields, and `src-tauri/src/plugins/git/transport.rs` maps it to a fixed
argument template. Plugins never supply argument arrays, option flags, or shell
input, and option-like values, control characters, path traversal, absolute or
`.git` paths, pathspec magic, revision syntax in branch names, unsupported URL
schemes, and embedded passwords are all rejected before a process starts.
The trusted transport, automatic commits, clone, GitHub authentication, askpass,
and executable resolution share the native `src-tauri/src/plugins/git/`
namespace. They remain host-owned permission and filesystem boundaries, not
code shipped in the downloadable `plugins/git/` package.
`restore-from-upstream` maps to one fixed `git restore --source=@{upstream}
--staged --worktree -- <paths>` template. The plugin supplies only bounded
repository-relative tracked paths. The host confirmation names the selected
repository and warns that local tracked changes are replaced; untracked paths
are never included or removed. `discover` and `operation-state` are answered from the filesystem without
running Git at all.

A commit request may carry an optional `authorName` and `authorEmail`. Each is
validated as a bounded, non-empty, control-free value that carries no angle
bracket, so it cannot split Git's `name <email>` identity, and is then applied
as `-c user.name=` and `-c user.email=` immediately before the `commit`
subcommand. Command-line configuration outranks every configuration file, so a
repository cannot replace the identity a user configured, and a request that
omits both leaves the repository-local identity untouched.

Conflict resolution is gated on the index. Before either a stage or a content
resolution touches the worktree, the transport requires that exact path to have
unmerged index entries, so an ordinary tracked file, an untracked file, or a
folder that merely contains a conflict can never be overwritten. A plan that writes a resolution and then stops before staging it
puts the original file back. `list-conflicts` reports those entries directly,
running `ls-files --unmerged -z`, so a surface reads exact repository-relative
paths and the stages the index actually holds rather than inferring either.

The repository's own state also decides which advanced operations may run. Before
planning, the transport reads the same filesystem markers `operation-state`
reports and refuses a merge, rebase, cherry-pick, or revert while any of them is
already in progress, and refuses a continue, skip, or abort that names an
operation the repository is not running. A rebase is recognised ahead of the
merge head it records for the commit it is replaying, and a cherry-pick or revert
of several commits stays resumable between commits: the command it is replaying
is read from the first instruction of the sequencer's own bounded to-do list, so
a paused sequence is never resumed as the other command, and a list the host
cannot read names nothing rather than a guess. Cancellation keeps the same guarantee as every other mutating
command: a step that reached its process boundary reports its real result, so the
index and the worktree are never left disagreeing, and nothing resumes on its
own.

Hunk staging is structural, not textual. `stage-hunk` and `unstage-hunk` carry
one validated path and one hunk described as four line numbers and an ordered
list of typed lines. The host writes every structural byte of the patch itself —
both file headers, the hunk header, each line prefix, and every newline — so a
request cannot introduce a second file, a second hunk, a rename, a mode change,
or binary content. Line text may end with the single carriage return of a CRLF
ending, which is preserved so a real CRLF diff still applies. Line text that
carries a line terminator, a second or misplaced carriage return, or any other
control character, a header that disagrees with its lines, a hunk that changes nothing,
a missing-newline marker away from the end of its side, and anything beyond the
line, count, and patch-size bounds are all refused before a process starts. The
patch is fed to `apply --cached --no-unsafe-paths --whitespace=nowarn -p1
[--reverse] -` on standard input, from a dedicated writer thread so a payload
larger than the pipe buffer cannot deadlock the child. `--cached` restricts the
change to the index, and Git applies a patch whole or not at all, so a refused,
failed, or cancelled hunk leaves the index and the worktree exactly as they
were. Standard input is a closed handle for every other Git invocation.

`GitExecution` carries the host's encryption preflight result, and the
`discover` inspection reports it alongside `initialized`. That is the only way
encryption state reaches a plugin, and it exists so a surface can withhold an
operation an encrypted vault cannot survive instead of failing after the user
presses the control. The host does not rely on it: an encrypted vault refuses a
content conflict resolution, an untracked stash, and both hunk directions
natively, before any Git command starts, whatever a surface offered.

Every request is scoped to either the vault root or a host-issued project
repository identity. The project-context capability exposes a bounded list of
repository IDs, project IDs, and labels for safe `.git` markers, never inactive
filesystem paths. A Git action lease carries the complete set of project IDs
issued for that vault; `git.run` may target one of them and rejects anything else.
The command layer revalidates the workspace scope and resolves the selected
project identity immediately before execution, so a vault switch, removed
repository, or moved project invalidates the lease. `PluginManager` receives
Tauri's resource directory at startup. Git resolves from exactly one typed
Bundled, System, or Custom source; GitHub CLI resolves from Disabled, Bundled,
System, or Custom. There is no fallback between sources. System resolution
checks fixed platform locations rather than `PATH`; Custom requires an
absolute, canonical regular executable and a successful version probe.
Bundled resolution verifies the build-anchored integrity manifest and selected
executable digest before probing it. Requests carry no executable or mode:
both remain host-owned validated settings.

Path-only schema version 1 settings migrate non-destructively. A non-empty
legacy path becomes Custom; an empty legacy path becomes System, preserving the
previous executable choice. Fresh schema version 2 settings default Git to
Bundled and GitHub CLI to Disabled. The host settings surface reports source,
resolved path, version, validation status, setup guidance, and a native picker.
Generic Git operations never resolve `gh`; only GitHub repository browsing and
`github-https` authentication can reach it.

Every invocation disables the pager, editor, interactive terminal prompts, hooks,
fsmonitor, external diff and textconv, recursive submodules, automatic
maintenance, and every protocol except
HTTPS and SSH. Every remaining configuration key that names a command,
including `core.sshCommand`, `core.askpass`, `core.editor`, `core.gitProxy`,
`sequence.editor`, `diff.external`, and the `gpg` programs, is pinned on the
command line, which outranks every configuration file, so repository
configuration can never win. System configuration is disabled with
`GIT_CONFIG_NOSYSTEM`, and global configuration is not merely unset but pointed
at a host-owned empty file kept beside the empty hooks directory, refused unless
it is a regular file and truncated before use. Removing `GIT_CONFIG_GLOBAL`
would only fall back to `$HOME/.gitconfig` or `$XDG_CONFIG_HOME/git/config`,
either of which could reintroduce a filter or a command-bearing key.

The Git plugin can explicitly opt into **Use system Git settings**, which is its
default. The host reads the user's global configuration with the resolved Git
binary, keeps only bounded values for `user.name`, `user.email`,
`user.signingKey`, `commit.gpgSign`, the `gpg.*` program/format keys,
`credential.helper`, `credential.useHttpPath`, `credential.username`, and the
safe `core.autocrlf`, `core.eol`, `core.ignoreCase`, and
`core.precomposeUnicode` values, then reapplies only the values needed by the
typed operation after the hardening overrides. Credential helpers are enabled
only for the `system` authentication mode. GPG programs and signing values are
enabled only for a manual commit whose signing policy requires them. A masked
key setting can override `user.signingKey`; the passphrase remains entirely in
the system GPG agent or pinentry. Automatic commits keep the isolated unsigned
path.

Hardening pins every GPG program to an empty value before operation-specific
settings are applied. A signed manual commit therefore always restores one
explicit program after that pin: the configured program when present, otherwise
Git's format default (`gpg` for OpenPGP, `ssh-keygen` for SSH signatures, or
`gpgsm` for X.509). This prevents an empty `gpg.program` from being executed
without weakening unsigned operations.

An SSH signing passphrase never enters plugin code. `SourceControlPanel` passes
it as host-only metadata beside the typed commit action;
`PluginWorkerRuntime` keeps it only in the in-memory action lease and posts the
ordinary commit action to the worker. When the plugin invokes `git.run`,
`hostOperations` attaches the secret directly to the native command. The native
layer validates and zeroizes the received string, writes it to an owner-only
one-shot askpass file, and sets `SSH_ASKPASS` to Denote's early-exit helper with
`SSH_ASKPASS_REQUIRE=force` for that signed commit only. A separate signing
context answers only passphrase/PIN prompts, never GitHub credential prompts.
The file is overwritten and removed with the operation scope on success,
failure, cancellation, timeout, disable, or shutdown. OpenPGP/X.509 signing
continues to use the system GPG agent or pinentry.
The per-commit sign choice and optional passphrase are consumed by the first
commit host request in the action lease, including commit-before-switch and
commit-and-push. A second request cannot reuse either value. Explicit Always or
per-commit signing still installs the safe default signing program and key when
system Git settings are disabled; turning system imports off no longer disables
an explicit signing request.

Structured diff models remain the plugin boundary. The host serializes them into
a bounded unified patch only for presentation, creates an in-memory read-only
`EditorTab` whose name ends in `.diff`, and renders each file with
`@pierre/diffs/react`. The tab retains the structured model for typed file and
hunk actions; raw patch text is never accepted back as an operation. Transient
diff tabs are excluded from file references, autosave, search/recent tracking,
and persisted pane sessions, and closing one sends the provider's typed
`close-diff` or `close-commit` action.

Every Git child, including the executable probe, also has its inherited
environment stripped. `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
`GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_AUTHOR_DATE`, and
`GIT_COMMITTER_DATE` are removed with the rest, because Git reads them ahead of
every `user.name` and `user.email` setting, including a command-line override.
`EMAIL` is removed for the same reason: Git falls back to it whenever no
`user.email` is configured, so it can supply an address the user never gave
Denote. An ambient value inherited from whatever launched Denote would otherwise
silently outrank the configured identity and stamp the wrong person, the wrong
address, or the wrong time, onto a commit.
Bundled source builds receive runtime `GIT_EXEC_PATH` and template paths derived
from the signed resource directory rather than their build staging prefix.
MinGit additionally receives its bundled CA bundle and binary directory, which
preserves HTTPS, credential helpers, and OpenSSH without accepting repository
command configuration. Custom and system executables retain the same isolated
Git configuration, askpass, signing, and credential rules.

Git output that a plugin has to parse is delimited so repository text cannot
reshape it. History is read with `-z` under a NUL separated format, which makes
the whole report one flat stream of fields, seven per commit. Git cannot place a
NUL into an author name, a subject, a ref, or a path, so no text read out of a
repository can shift a field or split a record the way a tab or a newline
could.

Repository-local configuration that defines filters, includes, credential
helpers, URL rewrites, protocol overrides, command-bearing `remote` keys, or
executable `core`, `diff`, `merge`, `gpg`, and hook keys is rejected before any
operation runs, and pathspecs are always literal. That inspection reads
configuration the way Git does: a variable written beside its section header on
one line, a quoted subsection, the deprecated dotted section form, and values
continued across lines are all understood, and anything it cannot parse is
treated as unsafe. Comments are resolved before continuations, because Git
discards a comment or a blank line before it ever looks for a trailing
backslash, so neither `; \` nor `# \` can hide the dangerous line that follows
it.

Remote authentication is host-owned. `system` uses the allowlisted global
credential-helper configuration and is the default; Git terminal prompts remain
disabled, so an unavailable helper fails instead of hanging. `public` clears the
helper, `ssh-agent` uses the pinned SSH client and running agent, and
`github-https` is bound to the address the operation
will really contact. A `github-https` fetch or pull reads the remote's fetch
URLs, and a push reads its push URLs, with `git remote get-url [--push] --all`,
so a separate `pushurl` or a mirror list cannot route a GitHub token to another
host. No credential material is created unless every one of those URLs is an
`https://github.com` URL. That preflight cannot see a remote that is repointed
after it runs, so the askpass answer is bound to Git's own prompt as well: it
parses the target Git quotes there and answers only for an HTTPS URL whose host
is exactly `github.com` or `www.github.com`, and answers an absent, malformed,
non-HTTPS, userinfo-confused, port-bearing, lookalike, or non-GitHub target with
nothing. The cancellable operation is registered before the GitHub CLI is
reached, so cancelling during credential acquisition stops the
adapter and the Git command never starts, and both the registration and the
secret are released by scope guards on every error, timeout, and cancellation
path. The GitHub adapter captures its output into bounded private temporary
files and polls their size the same way the Git transport does, so it cannot
deadlock on an undrained pipe. Askpass directories a killed process left behind
are removed once, while the plugin manager is constructed, only after the
exclusive manager lock is acquired, and only after symbolic-link and path
validation, so a second Denote that loses the lock cannot delete a live
instance's secret; nothing is swept during ordinary operation.
Diagnostics repeated back from Git or the GitHub CLI are truncated on a
character boundary, so multi-byte output cannot panic an operation out of its
own clean-up.

Cloning and deleting a failed clone are bound to the standardised source-control
action the host confirmed. The renderer's action lease carries the action ID it
was opened for, `null` for a plugin command, and the host operation refuses
anything but `clone` and `clean-failed-clone` respectively, before the native
folder chooser opens or any native command runs.

Operations run in a command process group with a ten minute hard timeout and
output bounded at 8 MiB. The bound is enforced while the command runs and again
once it has exited, so output from a command that finishes between two polls
fails the operation instead of being silently truncated, and a truncated
conflict stage can never be written into the worktree.

The operation ID is generated by the host runtime for each invocation and
returned to the plugin as `{ operationId, result }` before the operation
completes, so a concurrent source-control action can cancel a running operation.
Filesystem-only discovery and operation-state requests return before executable
resolution, so an ordinary folder can be identified without Git. Other
operations register their cancellation ID before executable probing and
settings reads, closing the early-cancellation gap.
The native command validates that ID as a canonical UUID and refuses one that is
already live. A plugin can cancel only its own operation. Cancellation during a
mutating command waits for that atomic Git command boundary: the command that
reached its boundary reports its real exit status and output, and the token
stops the next plan step instead, reporting the recoverable operation state
(`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge`,
`rebase-apply`, and sequencer state). Work Git already committed is never rolled
back, so a cancelled conflict resolution is either fully unresolved or fully
resolved with the index and the worktree agreeing, and it stays retryable either
way. Plugin disable, failed enable rollback, disable-all, and application
exit cancel with force, so no live child is ever left behind. Errors carry
command output with absolute host paths and URL passwords redacted. Standard
error is redacted for every operation without exception; standard output is too,
except for the typed `diff` and `show` reads, whose output is returned byte for
byte because it is the content a surface renders and quotes back verbatim in a
hunk request — a redacted diff would stage `<repository>` into the index in
place of a note's real bytes. The `show` template additionally suppresses the
commit header and message with `--format=` and `--no-show-signature`, so that
exact output is the patch alone: a repository that sets `format.pretty` cannot
print a message flush left where a line quoting `diff --git` would parse as
another changed file. `list-history` is bounded by `maxCount` and an optional
`skip`, so paging a log never produces unbounded output.

Encryption is handled entirely by the host. Vault encryption, sealing, and
sweeping skip every `.git` file and directory subtree without deleting it, so
repository metadata stays byte-identical. Disabling encryption is the single
pass that descends into `.git`, and every encrypting pass first recovers
repository metadata an older build encrypted: a `.git` directory whose `HEAD`,
or a `.git` pointer file that itself, carries the Denote encrypted-file magic is
decrypted in place with the active key, whole subtree at a time, nested project
repositories included and symbolic links never followed. The recovery is
non-destructive and repeatable, it leaves recovered metadata out of encryption
for good, and a recovery that cannot be completed fails the operation rather
than leaving half-readable metadata behind. Before a Git
operation, an encrypted vault must be in the `encrypted` phase with an unlocked
key, and a sweep must verify every file; the key is used only for that sweep and
never reaches the plugin or the transport. All repositories receive a host-owned `.git/info/exclude` managed block for
Denote operational files under `.denote`, while explicitly retaining
`.denote/encryption.json` because encrypted clones require it. Encrypted
repositories also receive a managed `.git/info/attributes` block that marks
every tracked path, including the encryption manifest, binary with no text,
diff, or text merge while preserving unrelated user lines. The manifest stays tracked and therefore
versioned, but Git can never line-merge wrapped-key metadata. Encrypted conflicts resolve by choosing a whole
side, because merged plaintext cannot be written into ciphertext. A `stash`
`push` that asks to include untracked files is refused on an encrypted vault
before any Git command runs, because it would remove an untracked
`.denote/encryption.json` from the worktree and leave the ciphertext
unreadable; stashing tracked changes stays available. Repositories
that use `.git` file indirection, such as linked worktrees and submodules,
report a clear limitation instead of being modified.
The additive API version 1 `project-context` capability exposes only the active
explicit or implicit project's opaque ID and vault-relative root plus change events. It provides no
absolute path and no dependency on editor or project-root implementation
objects.

Each explicit plugin command or source-control action lease snapshots both vault
scope and active project identity. Changing project identity invalidates
outstanding leases. Existing
bounded process execution resolves the captured ID through native SQLite,
revalidates that it still belongs to the active vault and names a safe available
directory, and uses that directory as `cwd`. Persistent terminal sessions and
language-server protocols are not part of this API.

API version 1 intentionally excludes arbitrary renderers, embedded plugin UI,
menu injection, and general import/export hooks. Editor actions use command
registrations so every privileged operation remains tied to an explicit,
short-lived user action. New declarative contribution surfaces can be added
compatibly; executable UI surfaces require a new API major and isolation review.
Baseline syntax highlighting is core and never waits for plugin startup. A
future specialized grammar contribution would require a separately approved,
typed, bundled host contract with deterministic disposal and fallback; API
version 1 does not expose editor grammars or runtime grammar downloads.

The native plugin manager embeds only `plugins/catalog.json`. Plugin
artifacts remain separate GitHub Release assets and are downloaded over HTTPS after
approval. The native core verifies the catalog size and SHA-256 digest before
extracting a gzip-compressed tar archive. Extraction rejects absolute paths,
parent traversal, symlinks, hard links, and special files. The packaged manifest
must match the catalog ID, version, API version, and permission payload. A
same-filesystem rename commits the staged package atomically.

### Bundled tool supply chain

`bundled-tools.lock.json` is the immutable release input for Git 2.55.0, Git for
Windows MinGit 2.55.0.5, and GitHub CLI 2.99.0. It pins source tags and commits,
archive and detached-signature URLs, redirect hosts, exact sizes and SHA-256
digests, signature or SLSA attestation identities, executable and license paths,
corresponding source, notices, and SPDX SBOM digests for Linux x64, macOS x64
and ARM64, and Windows x64.

`scripts/bundled-tools.mjs` performs bounded HTTPS downloads without `latest`,
validates signed tag metadata or GitHub artifact attestations, rejects unsafe
tar/ZIP paths and entry types, enforces expanded-size limits, builds upstream
Git with deterministic locale/time inputs on Linux and macOS, installs MinGit
on Windows, normalizes permissions, checks the expected tree, and version-probes
both programs. It then stores each target tool tree as a deterministic
gzip-compressed release asset, preserving Git's symlink aliases instead of
expanding each built-in into another multi-megabyte copy. The installer receives
only the target integrity manifest and legal material. That manifest pins exact
release-asset URLs, archive and executable bytes, and redirect hosts. `build.rs`
anchors its digest into the native binary; preparation rejects combined tool
assets above 96 MiB.

Inspecting settings does not download a Bundled tool: it reports the locked
version and `not downloaded` status. When and only when Bundled mode is selected
and an action first requires that tool, the native resolver follows the signed
HTTPS redirect allowlist, enforces the exact download size, verifies SHA-256,
checks every archive entry and link target against the expected tool root,
enforces entry and expanded-size bounds, and extracts to a random app-data
staging directory. It then verifies and probes the executable, writes a
completion marker, deletes the downloaded archive, and atomically renames the
result into a digest-addressed cache. System, Custom, and Disabled never enter
the downloader. An interrupted or corrupted cache is reported explicitly and
never causes fallback.

Release jobs prepare the target assets and metadata before Tauri packaging.
Every matrix build passes Tauri's `--no-sign` option, so Apple Developer ID
signing/notarization and Windows Authenticode signing are disabled. The jobs
still smoke-test tools from the installed Debian package, mounted DMG, or
administrative MSI image, publish checksums, notices, SPDX SBOMs, the exact Git
corresponding-source archive and signature, the on-demand target tool archives,
and GitHub build-provenance and SBOM attestations. Release checksums enumerate
only the package files that publication uploads. The public checksum file uses
their release-asset filenames, while the attestation input keeps one subject per
SHA-256 digest because GitHub rejects repeated digests in a single statement. Installed-package
smoke tests assert that tool archives are absent from the installer. The build
checks out this release helper from the workflow commit separately from the
immutable release source, so a manual retry can repair release infrastructure
without moving an existing tag. Its explicit SLSA predicate records both the
workflow ref and commit that performed the retry and the immutable release tag
and source commit that produced the artifacts.

Downloaded entrypoints are read only for transaction-prepared or enabled
plugins and passed to a Vite-emitted module worker as a data-URL module. The typed
worker bootstrap blocks ambient network, nested-worker, broadcast, and browser
storage globals before importing the self-contained plugin bundle, then exposes a
bound private `MessagePort`. The worker shares the application origin but has no
DOM or direct Tauri bindings; the CSP denies direct network connections, and the
host terminates the worker on invalid protocol messages or timeouts. Messages are
scoped to the plugin ID by the host, so plugin code cannot choose the ID used for
native storage or keychain calls.
Command and source-control contributions require the plugin ID prefix, remain
staged until activation succeeds, and disappear when the worker terminates.
Source-control model updates use the original registration handle and do not
re-register the provider.

The additive API version 1 `emoji-picker` capability accepts one bounded
declarative picker per plugin. The SDK and runtime both validate field shapes,
IDs, labels, Unicode graphemes, variants, settings-key references, entry counts,
and total bytes. Registration is staged until activation succeeds and is
withdrawn immediately when deactivation or failure starts. Delayed messages from
a replaced worker cannot register contributions in its successor.

The host owns emoji indexing, search, shortcode context, toolbar/palette
commands, keyboard handling, and editor transactions. The plugin receives no
query, surrounding text, selection, file identity, editor object, or insertion
callback. The permission grants no native workspace, network, filesystem, or
encryption-key access. Rich Lexical and source CodeMirror adapters capture
selection and document identity and insert complete Unicode sequences only on
explicit acceptance, using ordinary undo history. Code and composition contexts
suppress automatic suggestions.

Emoji suggestions publish only to their own surface; the workspace subscribes
to the picker-open boolean, not individual matches or keyboard highlights. The
local prefix index is prepared during browser idle time after a contribution
becomes available, or synchronously on first use if the picker is opened sooner.
Common words stop adding postings after their first eight matches. Picker
filtering is independent of favorites, tone, and keyboard selection; only the
visible page resolves variants. Dataset-membership validation is cached by
installed entries, so preference writes never rescan the full catalog.

Ordinary editor changes perform only selection bookkeeping and a bounded
shortcode-prefix check. Until a candidate or emoji surface exists, they skip
emoji host calls, focus/DOM inspection, permission checks, lookup, and settings
work. When no enabled plugin has the `note-events` permission, the workspace also
skips building tab snapshots and broadcasting note events entirely. Focus events
establish the active editor rather than rediscovering it on each character.
Dismissal and insertion return to this idle path. Exact-source history indexes
snapshot lengths first, avoiding full-note string hashing for ordinary appends;
editor line-ending detection and history allocation run once per editor rather
than once per render.

Rich emoji insertion reuses the reference analysis tree only when its source
matches exactly. Translated or masked content still parses independently.
Selection mapping reuses that tree, repeated entities decode once per projection,
and the resulting document is still parsed to confirm the intended visible-text
change. An exact-source insertion bypasses the normal serialization repair pass
while refreshing TOC and thematic-break snapshots for later edits and undo/redo.

Recent/favorite Unicode strings and the chosen skin tone use three declared
plugin setting keys. Preference writes validate dataset membership, serialize
per plugin, merge the current settings, and guard runtime/workspace identity.
Settings mutations invalidate queued writes and wait for issued writes before
reset, disablement, or cleanup. These host-owned preference updates do not
restart the worker. Explicit settings changes still use the ordinary restart
flow. No emoji implementation or dataset is imported into the desktop bundle.

Plugin state lives in `plugins/state.json` under application data. Package code
lives under `plugins/packages/<plugin-id>/<version>/`; transient downloads use
application cache. Startup removes orphaned downloads and packages for disabled,
unknown, missing, or incompatible plugins. Settings and generated state are
namespaced separately and retained by default when code is disabled. Credential
keys are tracked only to support explicit cleanup; credential values live in
the operating-system keychain. A separate `plugins/credentials.json` write-ahead
journal preserves cleanup discovery if the main state file is corrupt. State
updates use copy-on-write atomic persistence, and a process-lifetime file lock
plus the single-instance plugin prevents concurrent writers.

Approved permission records and the artifact/catalog identities last accepted
by the user remain as inert metadata after code is disabled or removed. They are
consulted only to mark an independently changed catalog entry update-available
and to qualify it for the explicit **Update all** flow; runtime authorization
still requires the plugin to be enabled. For enabled plugins, native state also
records the installed manifest. Startup validates that manifest, its approved
permissions, and the recorded entrypoint digest against the versioned package,
then continues running it under those installed permissions when a newer catalog
entry appears. Bulk update captures the eligible list, stops one old runtime,
stages the new version beside it, starts the new runtime under the latest full
manifest permissions, and commits the replacement before pruning superseded
code. Rollback removes only the staged version and restarts the installed
runtime. Failure of one is reported without selecting or mutating another.

The catalog is compiled into the desktop release. Catalog additions, update
metadata, and revocations therefore require an application update in API version
1. A changed catalog entry marks the plugin update-available but does not disable
or delete a valid installed version. The latest package substitutes for it only
after **Review and update** or **Update all** completes. Disabled packages,
tampered packages, incompatible installed versions, and explicitly revoked
installed versions are still removed during recovery.
The packaging tool also enforces catalog independence: historical artifacts are
downloaded from their immutable ledger origins and compared with current package
content; new versions are deterministically rebuilt and compared with their
committed source and build inputs. Both paths verify exact package content and
retain the recorded byte identity and provenance. Packaging never bumps versions
or edits metadata. A targeted pin changes only one plugin's catalog entry and
release ledger, rejects replacement of an existing version, and publishes
nothing. It verifies committed plugin source, SDK, build tooling, and lockfile
inputs before building and again after packaging. Catalog
`provenance.sourceCommit` and ledger `sourceCommit` identify source provenance,
not an archive-bearing commit, so no binary Git object is required.
New source entries record `sourcePath`, the plugin directory at that commit.
Source verification uses this immutable path independently of the package's
current location, preserving provenance through later directory moves.
Pinning atomically writes the ledger before atomically replacing the
catalog; an interrupted catalog write leaves a prepared immutable version that
an exact retry can finish. Its exclusive cross-process PID lock lives at
`.plugin-artifacts/pin.lock`. A crashed pin leaves the lock behind and later pins
refuse rather than stealing it; recovery requires confirming no pin process is
running, removing only that exact lock file, and retrying the same pin.
CI rejects archive files in the Git index and archive
additions anywhere in the proposed commit range while permitting their immutable
history. Against a full-SHA base, it also requires existing ledger entries to
remain unchanged and same-version catalog size, digest, and source SHA to stay
fixed; only new ledger versions or rehosted catalog URLs may be added.

Deleted entries move to `.denote/trash` inside the vault. The sidebar restore
action returns them to their original path, choosing a non-conflicting restored
name when necessary. Empty Trash permanently removes both hidden files and
their plugin-free metadata after explicit confirmation.

## Vault encryption

Encryption is a vault-level, optional state. Denote generates a random 256-bit
data key and stores only wrapped copies in `.denote/encryption.json`. The
password wrapper uses Argon2id with a per-vault salt. Ten high-entropy,
one-time recovery codes each have an independent salt and wrapped copy of the
same data key. Successfully using a recovery code removes its slot from the
manifest before the vault is unlocked.

File contents use chunked XChaCha20-Poly1305. New files use 4 MB chunks to reduce
allocation, AEAD, and write-call overhead; existing 1 MB chunk files remain
readable. Every chunk has a nonce derived from a random per-file prefix and its
chunk index, and
authenticates the file header and index as additional data. Streaming
transforms use the same atomic replacement path as ordinary saves, so large
files do not need to fit in memory. Existing version-one whole-file ciphertext
remains readable.

The manifest records `encrypting`, `encrypted`, or `decrypting`. Each file and
history row is transformed atomically and checked before work is repeated, so
an interrupted operation resumes after password or recovery-code unlock.
The manifest is removed only after every encrypted file and history record has
been decrypted. Denote Trash is encrypted with the rest of the vault; only the
manifest and internal lock files remain plaintext control data.

The unwrapped data key lives only in zeroizing native memory while the vault is
unlocked. Search, previews, history, saves, and attachments cross the native
boundary as plaintext only after unlock. Tabs, history previews, replace
previews, and the in-memory search index are cleared when the vault locks.
Unlock, explicit lock, and application exit also sweep files created externally
while Denote was not actively writing.

Paths are intentionally not encrypted. Filenames, folder structure, file sizes,
timestamps, trash paths, counters, bookmarks, customized tag labels/colors, and
other non-content metadata remain observable. The application-data SQLite file
is not a password vault: revision contents are encrypted, but operational
metadata is not. Encryption also does not protect plaintext already exposed to
another process while the vault is unlocked.

SQLite connections enable secure deletion. Completing initial encryption
checkpoints and truncates the WAL, then vacuums the metadata database so prior
plaintext revision rows are not left in active database pages. This cannot
erase independent backups, filesystem snapshots, journal history, or storage
device remnants created before encryption was enabled.

## SQLite metadata

The application-data database stores:

- known vaults and the most recently opened vault;
- per-note open, edit, and save counters and timestamps;
- each vault's persisted rich-text/source preference;
- an optional vault-relative Markdown path that overrides the root
  `.denote.md` welcome convention;
- serialized file-tree caches for previously opened vaults;
- each vault's restore-tabs preference and validated serialized pane, layout,
  size, tab, and group session;
- bookmarks, per-folder pins, and explicit sibling ordering;
- per-vault tag color overrides keyed by normalized tag;
- the previous 10 distinct saved contents per note, encrypted when vault
  encryption is enabled;
- trash records used by restore;
- stable explicit/implicit project and workspace IDs and vault-relative paths,
  including unavailable roots and children;
- per-vault Git-project-suggestion dismissal.

Schema changes are tracked in `schema_migrations`. Markdown remains authoritative
if the metadata database is removed.

Tree ordering is evaluated independently for each parent folder: pinned entries
come first, then explicit custom positions, then the folders-first/name fallback.
The up/down controls reorder only inside the selected entry's pinned or unpinned
section, so ordinary entries cannot move above pins accidentally.
Dotfile visibility is a renderer-local `localStorage` preference that defaults
to visible. The iterative visible-row and expansion helpers omit dot entries and
dot-folder subtrees only while rendering; the native tree and stored expansion
paths remain unchanged.

The vault switcher reads the 50 most recently opened rows from SQLite and opens
them by trusted database ID rather than accepting a new arbitrary path from the
frontend. Missing folders remain visible but disabled. Switching uses the same
save/attachment flush barrier as closing the application, clears the prior
vault's tabs and search index, seals an unlocked encrypted source vault before
discarding its key, and then either opens the target workspace or its password
screen.
The built-in guide is always included in this list and labeled separately.
User vaults can be removed from SQLite only, or moved to the operating system
Trash before their metadata is deleted. The current vault, built-in guide,
filesystem and mount roots, shallow system paths, the home folder,
symlinks/reparse points, and ancestors of Denote's application-data directory
are rejected as deletion targets.

A full vault scan serializes the ordered file tree into SQLite. Known-vault open
commands deserialize that cache, overlay current bookmark/pin/order metadata,
and return immediately. The frontend releases the switch barrier without
waiting for content indexing, then performs a generation-guarded full disk scan
and ZBSearch rebuild in the background. Missing or invalid caches fall back to a
full scan once and are replaced. Pending filesystem recovery operations also
force a full scan before a cached tree can be used.

Welcome target resolution does not depend on the cached tree. Rust checks the
root `.denote.md` path directly and returns the explicit and effective paths in
the workspace snapshot. An explicit Markdown-file choice wins, followed by
`.denote.md`, then the built-in vault's legacy `Welcome.md`; other vaults have no
automatic target. The frontend opens that target only when no saved tab session
or requested cross-vault file is being restored. Read or parse errors use the
ordinary editor error surfaces and do not block the vault or fall through to a
lower-priority target.

Full tree, search-document, editable-document, and global filename scans run on
Tauri blocking workers after capturing the active vault/key, so they do not hold
the global workspace guard or the native UI thread. Each full tree scan reserves
a per-vault generation in SQLite and updates the cache only if that generation
is still current, preventing an older concurrent scan from replacing newer
results.

Rename, trash, and restore operations are recorded in a recovery journal before
the filesystem move. Opening or refreshing a vault reconciles any operation
interrupted between the move and metadata commit.
Renames and moves rekey an explicit welcome path transactionally. Moving that
path or an ancestor to Denote Trash clears the override.
Denote directory rename and move operations similarly rekey equal and descendant
project/workspace paths without replacing their IDs. Trash deletes affected
project/workspace metadata transactionally. Restore does not recreate those
records directly; a restored direct child of a still-marked workspace is later
discovered as a new implicit project.

## Search

Rust scans regular files up to 10 MB and returns normalized search documents.
Binary content is indexed in its Base64 representation. Unreadable files are
reported and skipped individually; the automatic index stops at a 64 MB
aggregate content budget.
The frontend builds an in-memory ZBSearch index. ZBSearch provides ranked,
typo-tolerant full-text retrieval; Denote applies metadata filters and a Unicode
substring fallback so mixed-script queries still find local content.
Index insertion is split into overlapping chunks no larger than roughly 512 KB
and yields to the webview between batches, including for individual files near
the 10 MB search limit.

The index rebuilds when a vault opens and shortly after content or file
structure changes. Search requests keep text, a location glob, and visual filter
state separate. `*` includes every indexed document; glob matching without a
slash targets basenames (`*.html`), while path patterns and exact relative paths
match the full vault-relative path. Existing inline filters are merged with the
visual filter model before result scoring and filtering.

Command-F on macOS and Control-F on Windows/Linux are captured before browser or
CodeMirror find handlers, set the active file as the location, and focus the
search-text field. Search expands each ranked file into one result per exact
content-match range, so every result can select and center its specific term in
the active rich-text or source editor. Metadata-only matches remain single
file-level results. Command-H on macOS and Control-H on Windows/Linux open
replace; the macOS native application menu omits its conflicting default Hide
item.

Command-P on macOS and Control-P on Windows/Linux opens a unified command
palette. The frontend contributes contextual action descriptors with labels,
categories, keywords, disabled state, and shortcut text. The same input also
filters filename results, while a dedicated command switches to a file-only
view. Rust walks up to 25,000 regular files across the 50 trusted SQLite-known
vault roots, skips unavailable vaults, symlinks, and each internal `.denote`
folder, and never reads file contents. Selecting a file uses its trusted vault
ID, runs the ordinary save-and-seal switch barrier, and opens the relative path
after the target vault is ready. If that vault is encrypted, the path remains
pending until unlock. An explicitly selected palette file takes precedence over
restoring that vault's previous tab session.

The macOS native menu uses the same command identifiers as the command palette.
Rust emits menu selections to the frontend, which resolves the current command
descriptor before running it so unavailable actions remain no-ops. The menu
keeps Command-H for Denote replace instead of the conflicting default Hide
action, maps Command-W to closing the active tab, and opens Settings with
Command-comma. Shift-Command-W closes the window through the ordinary safe-exit
barrier.

## Replace

Replace previews are calculated from Markdown source rather than rendered
editor text. Current-file replacement uses the open tab content. Vault-wide
replacement flushes open tabs first, then previews all editable files up to 25
MB, including Base64 binary content.
Each selected file is saved with its preview-time content hash, so files changed
externally after preview fail individually instead of being overwritten.
Successful replacement clears the stale preview, keeps the dialog open, and
announces the number of replaced instances.

## Editing

Core Markdown feature checks first look for the syntax they need. Notes without
reference brackets, HTML angles, disclosure tags, TOC markers, or thematic-break
delimiters do not get parsed merely to prove those features absent. The ordinary
prose typing path performs no host-side full-document Markdown parses; matching
syntax still uses the complete parser and existing safety rules.

Rich/source eligibility is memoized by content, and stable callback bridges keep
MDXEditor plugin configuration from being rebuilt when only parent callback
identities change. Starting debounced outline analysis does not publish an
unchanged cache entry or force a second workspace render per keystroke.
Unmount cancels deferred autosave, tab-session, and indexing timers and
invalidates stale background requests; normal window closing still flushes
through the existing safe-exit barrier.

Each active Markdown pane owns an MDXEditor instance with rich editing and a
source fallback.
Denote translates its compact callout syntax to Markdown directives while the
editor is active and back to `>![type]` blocks before saving.
For `.md`, MDXEditor's HTML/JSX processing remains suppressed so
CommonMark/GFM owns autolinks, indented code, raw HTML, comparisons, hearts, and
placeholders. A high-priority standard-HTML visitor imports HTML tokens as
literal text and inherits surrounding formatting; canonical TOC comments remain
structural markers. A higher-priority custom atomic node validates a narrow
README-style subset (`p`, headings, `a`, `strong`, and `img`), renders only typed
React elements, resolves local images through the native preview command, and
exports the original raw HTML bytes. It never uses generic MDX HTML processing.
Well-formed top-level `<details>` blocks remain a separate restricted exception:
Denote validates the exact `details`/`summary` tag shape, escapes unrelated angle
syntax, and enables MDXEditor's native generic HTML nodes for that document.
Documents mixing both exceptions stay in lossless source mode. Attributes other
than each exception's allowlist, nested raw HTML, malformed blocks, and other raw
HTML remain locked to source mode. Serializer escapes are reconciled against the
previous source only after Rich edits.
Reference links use dedicated Lexical link nodes carrying their CommonMark
identifier, label, and reference type. Definition nodes are invisible atomic
blocks that retain the exact source range. A whole-document snapshot resolves
references before tree import, applies first-definition-wins semantics, and
refreshes after Source edits. Rich export keeps a reference while its definition
still supplies the destination, otherwise it safely degrades to an inline link.
Unresolved references import as literal Markdown text.

Generated repository definitions using a self-closing `copilot-ref` destination
are parsed separately from generic HTML. Only the exact tag with unique `kind`,
`target-id`, and `label` attributes is accepted; `kind` must be `repo` and the
target must be HTTP(S). The renderer uses the validated target while the atomic
definition exports its original bytes. Invalid generated targets remain inert,
and Lexical plus the ordinary Denote link pipeline continue to neutralize unsafe
schemes.
`.mdx` and `.jsx` bypass the rich editor and use non-executing JSX-highlighted
source editing.

Exact paired `<!-- toc -->` and `<!-- /toc -->` marker lines are accepted only
around one root link-only list, including nested link-only items. MDXEditor
omits comments from its rich tree, so Denote snapshots list/item order, link
fingerprints, and neighboring block context, then restores only verified marker
boundaries after Rich serialization. The matching rendered root list receives a
stable TOC class and accessible label; thematic breaks receive the shared editor
separator treatment. Snapshots refresh after each edit.
Switching to Source synchronizes the latest marker-preserving Markdown through a
non-history CodeMirror transaction; subsequent Source edits replace or
invalidate the snapshot so explicit marker deletion remains authoritative.
Other HTML comments stay source-only.

Rendered headings receive deterministic Unicode-aware IDs; duplicates add
numeric suffixes. Internal fragment navigation retries while a newly opened
editor renders, highlights the rich heading when available, and otherwise
selects the matching Markdown heading line in CodeMirror source.

MDX parser messages discard their underlying positional cause, so Denote
replays the MDX JSX/Markdown tokenizer against the reported source after masking
accepted HTML comments with offset-preserving whitespace. For remaining inline
invalid names, Denote locates the reported Unicode code point outside code,
HTML, and escaped ranges. A stable CodeMirror StateField receives
diagnostics without remounting the editor. Parse failures temporarily select
source mode without writing the vault-wide preference; the error banner can
scroll, select, and focus the marked position. A reducer stores diagnostics by path,
so late callbacks cannot leak an old file's error into the active view. Tab
switches hide unrelated diagnostics while preserving them for return navigation;
closing, moving, renaming, or trashing files removes or rekeys their entries.
Link-navigation failures use a separate transient alert that fades automatically.

The editor opts into MDXEditor's full-height flex chain so its rich-text wrapper
owns vertical overflow. Source and plain-file CodeMirror instances keep their
own scroll containers. Long files therefore scroll independently of caret
movement while the workspace shell remains fixed.

Lexical's hashtag entity support recognizes the same NFC-normalized Unicode,
slash, underscore, and hyphen syntax as search indexing, but only on a tag-only
final content line. Headings, tables of contents, prose, inline and fenced code,
and escaped hashes remain literal. Hashtag nodes export through the ordinary
text visitor, so visual pills never alter source.
SQLite stores only explicit per-vault color overrides; deterministic palette
colors cover tags without an override. CSS mixes the chosen color into the
current theme surface while retaining normal theme text, keeping dark and light
contrast stable.

Editor display preferences are stored locally and applied immediately. A
clamped 12–24 px CSS custom property sizes rich Markdown, Markdown source,
programming files, plain text, and binary Base64 while leaving workspace chrome
unchanged. Command/Control `+`, `-`, and `0` update the same persisted setting.
Plain text, binary Base64, and MDX source use a shared CodeMirror surface.
Markdown source mode receives the same CodeMirror extensions. A persisted
two/four-space setting configures CodeMirror's tab width, indentation unit, and
Tab command for Markdown source, plain/programming files, and rich fenced code
blocks; CodeMirror's Escape-then-Tab behavior still provides a keyboard exit.
Line numbers, whitespace markers, trailing-whitespace emphasis, and LF/CRLF/CR
widgets are decorations only; document text and save hashes never include them.
Because rendered rich Markdown has no stable one-to-one source-line mapping,
enabling any guide temporarily constrains Markdown editing to source mode.
Disabled rich/source controls remain visible and point back to the display
settings.
For a file whose closest explicit or implicit project root is active, the
frontend applies line numbers through an in-memory display-settings overlay.
Markdown in that project routes directly to the byte-preserving CodeMirror
source editor rather than initializing the rich editor, so opening a code
project cannot normalize callout or other Markdown syntax. The override does
not write the saved display settings or vault Markdown preference, so switching
focus outside the project or unmarking it restores ordinary behavior
immediately. `.mdx` remains independently source-only.
Source files with active project context, plus source files in a vault-root
workspace, receive an in-memory wide-layout class; the file and editor settings
remain unchanged.

The most recent rich-text/source choice remains the fallback for vaults without
a saved preference. Each vault stores one mode in its SQLite row, and every
Markdown file in that vault receives it. A post-initialization realm write
prevents MDXEditor's previous global cell value from leaking across vaults. A
realm observer records only actual user mode changes; initial source mode
required by unsupported syntax or display guides does not overwrite the vault
preference.

Pane layout, tab order, and named groups are frontend session state. The
workspace keeps one to four stable pane IDs, one focused pane, per-pane active
tabs and groups, and normalized resize fractions for horizontal, vertical, grid,
and mirrored asymmetric layouts. Ordinary file navigation flushes and replaces
the focused pane's active tab; Command-T / Control-T and the pane-row plus button
append an explicit placeholder tab that the next file selection fills. Pointer
events and `Alt-Shift-Left/Right` update the same group-contiguous order used by
activation, `Ctrl-Tab`, bulk close ranges, close-next selection, rendering, and
persistence. Moving a tab between panes transfers the live editor state and
clears its previous group assignment. Closing a pane merges its tabs into a
neighbor so unsaved content is not discarded. Collapsed groups keep their active
tab rendered so keyboard focus and tab semantics remain valid.

Pointer tab dragging keeps the existing tab-bar reorder path when another tab
is targeted. Empty tab-strip space appends the live tab to that pane, while
editor-body drops are resolved against the hovered editor rectangle. A center
target moves the live tab into that pane. Edge targets either reuse a sole-tab
source pane or create a pane, then derive horizontal, vertical, asymmetric, or
grid layout from the target pane and drop direction. The visual target overlay
is pointer transparent and uses the same editor rectangle as hit testing.

Real file tabs are serialized to SQLite after a 400 ms debounce and at workspace
barriers. The JSON state includes pane IDs and assignments, layout and resize
fractions, focused pane, per-pane active paths, tab order, group IDs and names,
and collapsed state; placeholders are excluded. Legacy flat tab sessions upgrade
to one pane without a database migration. Restore is enabled by default per
vault, loads at most four panes, 100 tabs, and 50 groups, skips missing files, and
clears malformed or semantically invalid saved state. Explicit cross-vault file
opens bypass restore.
Session metadata failures are surfaced but never block saving note content,
closing tabs, switching vaults, or exiting.

Plain UTF-8 files remain source-only. `src/lib/syntaxLanguages.ts` is the typed
authoritative registry for both source files and rich fenced blocks. Each entry
owns its stable ID, display name, preferred fence identifier, searchable aliases,
explicit extensions or filenames, and bundled asynchronous loader. The registry
covers JavaScript/JSX/TypeScript/TSX, Java, JSP, Go, Rust, Python, C/C++, C#,
Kotlin, Swift, Ruby, PHP, Dart, Lua, R, Scala, Elixir, JSON, XML, HTML, CSS,
Markdown, shell, YAML, TOML, SQL and its packaged dialects, PowerShell, SCSS,
LESS, Dockerfiles, LaTeX, Jinja, Vue, Angular templates, Haskell,
Clojure/ClojureScript, Erlang, OCaml, F#, Fortran, Julia, Perl, Pascal, VB.NET,
Cobol, Puppet, Common Lisp, Terraform/HCL, and Helm templates. React uses the
existing JSX and TSX grammars rather than a separate parser.
CodeMirror's packaged language-data loaders cover the standard entries;
`codemirror-lang-elixir` and `codemirror-lang-hcl` are bundled lazy chunks. JSP
deliberately uses the HTML grammar, so scriptlets stay readable without
introducing an unmaintained parser.
The same registry recognizes auxiliary project files: `go.mod`, `go.sum`,
`go.work`, `go.work.sum`, CMake files, Makefiles, Gradle/Groovy, Protocol
Buffers, `.ini`/`.cfg`/properties files, Cargo/Poetry/uv locks, Visual Studio
solutions, and XML project formats such as `.csproj`, `.props`, and `.targets`.
Small bounded `StreamLanguage` tokenizers cover Go module and Makefile syntax;
the remaining formats reuse packaged XML, TOML, JSON, Python, Groovy, CMake, or
properties grammars. Compound suffixes such as `.cmake.in` are matched
longest-first before ordinary extensions.
Alias and extension lookup records collisions instead of using registry order.
The shared `.pp` extension is therefore intentionally unresolved until the user
chooses Pascal or Puppet. SQL dialect choices include PostgreSQL, MySQL,
MariaDB, MS SQL, PL/SQL, SQLite SQL, and CQL; plain `.sql` remains standard SQL,
while dialect-specific suffixes or an explicit tab override select a dialect.
Diff is deliberately not registered by core because Git diff presentation and
future diff-specific interaction belong to the Git plugin.
Helm has no maintained CodeMirror package, so core supplies a bounded
`StreamLanguage` tokenizer for YAML structure plus `{{ }}` actions, built-in
functions, `.Values`-style variables, and control keywords. `.tpl` files select
it automatically. YAML chart templates remain YAML under Automatic to avoid
misclassifying unrelated `templates/` folders and can use the per-tab Helm
override.

`PlainTextEditor` resolves the filename plus the tab's optional override, clears
the previous language immediately, and asynchronously reconfigures a stable
language compartment. A request counter rejects stale completions, successful or
in-flight loaders are cached, and a failed load removes its cache entry, reports
the error, and leaves plain text available for retry. Grammar effects do not
change CodeMirror documents and therefore cannot enter autosave.

Rich blocks use a Denote-owned catch-all `CodeBlockEditorDescriptor` rather than
MDXEditor's built-in editor and select. The custom editor uses the same theme,
history, indentation, read-only, and language-compartment behavior as source
files. Its searchable ARIA combobox edits a fence language only after explicit
selection; typing, opening, theme changes, and unknown identifiers are
presentation-only. Automatic serializes an empty identifier, Plain text uses
`text`, and the code document is never replaced during a language change.
Copy-button discovery uses the stable Denote code-block wrapper and reads
`EditorView.state.doc`, including virtualized lines.

The focused UTF-8 source tab exposes its effective language in the status bar.
`EditorTab.languageOverride` is frontend-only state: pane moves preserve the live
tab, while navigation, close/reopen, and session restore return to Automatic. It
is absent from tab-session JSON, SQLite, Rust models, file names, save hashes, and
plugin context. Theme changes remain CSS-variable updates and do not remount
either editor. CodeMirror and Lezer perform incremental viewport parsing; Denote
adds no synchronous whole-document highlighting scan.

The existing delayed document-analysis worker also runs
`extractSourceSymbols` for source files when project or vault-workspace context
enables the source outline. The extractor walks normalized text once without a
line-array copy, skips pathological lines over 20 KB, and caps results at 1,000.
Language families use bounded declaration heuristics for functions, methods,
types, modules, resources, and sections; unknown languages return no symbols.
Worker generation checks prevent stale results from crossing tab or language
changes.

The worker also reduces source into at most 500 minimap strokes, choosing one
representative line per proportional bucket and retaining indentation, relative
length, comment tone, and symbol emphasis. It never transfers raw rendered DOM
or forces CodeMirror parsing.

`PlainTextEditor` reports its live CodeMirror viewport through a
requestAnimationFrame-coalesced callback. The source outline sends monotonic
navigation requests back
to the focused editor: symbol requests select and center a line, while code
minimap requests set proportional scroll position. These effects do not change
the document, history, language, or autosave state.

The outline divider stores one global local width through
`src/lib/outlineWidth.ts`, clamped to 180–480px with a 280px default. Pointer
movement is reversed for the right-aligned panel; keyboard resizing and reset
use the same clamping path. At narrow breakpoints the outline and divider become
right-aligned overlays without changing the persisted value.

Markdown source mode registers a highest-precedence Command-K / Control-K
CodeMirror command. It wraps a range as `[selected text]()` or inserts `[]()` at
a caret without opening a dialog. Rich mode uses MDXEditor's link dialog and
prevents toolbar pointer focus from collapsing the active Lexical selection.

After a short edit debounce, a cancellable Web Worker parses the active UTF-8
document into MDAST to collect and deduplicate inline, autolink, and referenced
HTTP(S) destinations without blocking editor keystrokes. The open-all action
passes them sequentially through the same exact-domain/wildcard policy as
ordinary clicks. Encountering an unknown domain stores the remaining queue in
dialog state; approval resumes it and cancellation discards it. Individual
native-open failures are counted and do not stop later trusted URLs.

The activity rail, resizable vault sidebar, divider, and editor are separate CSS
grid columns. Inside the editor, CSS grid areas arrange up to four panes and
semantic separators resize adjacent pane fractions by pointer or keyboard.
Sidebar width is clamped to 210–480px, updates continuously during pointer drag,
supports arrow/Home/End keys through an ARIA separator, and is stored in local
storage.

Command-N / Control-N resolves the selected folder or selected file's parent and
uses the existing validated create command. The file tree exposes the same
parent-resolution logic through a keyboard-operable contextual menu; right-click
on empty tree space targets the vault root.
Visible file-tree rows are flattened iteratively and large trees render a
fixed-height overscanned window immediately, using a bounded fallback viewport
until the sidebar is measured. Logical row indices drive arrow, Home/End, and
cross-window Tab focus without expanding collapsed ancestors. Bulk expansion
skips `.git` and `node_modules` subtrees while retaining folders opened directly;
collapse-all clears every expanded path.

Cross-folder moves resolve a folder or vault-root destination inside the
canonical vault, reject self/descendant folder moves and conflicts, then reuse
the rename recovery journal around one filesystem rename plus transactional
metadata path rekeying. The frontend flushes affected tabs first and rewrites
their paths after the move. Pointer capture plus coordinate hit-testing drives
folder/root drop targets; **Move to folder…** is the keyboard alternative.

After a successful rename or move, Rust returns a bounded batch containing only
UTF-8 `.md` and `.markdown` files up to 1 MB each and 32 MB total. A bundled Web
Worker parses those files and rewrites inline links, images, and reference
definitions by resolving against pre-move source paths and recalculating paths
after both source and target moves. MDX is excluded. Updated files use ordinary
hash-checked saves and revision history; oversized, unreadable, truncated, or
conflicting rewrites are surfaced without reverting the completed filesystem
move. A dedicated cross-process link-rewrite lease starts before the filesystem
move and remains held through those saves, preventing another Denote process
from interleaving a second topology change.

Create, trash, and restore commands return the changed file node or trash
record. The frontend updates the tree, Trash view, open tabs, navigation
history, and expanded folders immediately after the filesystem mutation. Rust
updates the cached tree in the same operation, while the slower search rebuild
runs after the workspace lock is released. Vault switches wait for an active
mutation instead of failing with a workspace-busy error.

Each open tab keeps an in-memory path history and cursor. Ordinary navigation
appends after the cursor and truncates its forward branch. Back/forward loads use
the same serialized save barrier as file selection. Rename/move rekeys history
paths, while trash removes invalid entries. Session persistence intentionally
stores only the current tab layout, not transient navigation history.

All CodeMirror surfaces receive one highest-precedence Denote theme extension.
The extension uses CSS semantic tokens, so editable code blocks, Markdown
source, plain files, gutters, selections, active lines, matching brackets, and
syntax tokens update immediately when the root theme changes. Static `pre` and
inline `code` rendering uses the same code-surface tokens. Rich-mode code-copy
buttons are React portals attached to MDXEditor's code wrappers. Editable blocks
copy `EditorView.state.doc`, not virtualized DOM lines, so off-screen content is
included without changing Lexical or Markdown state.

Autosave waits 800 ms after the latest change. Saves are serialized per note;
tab close, vault switch, restore, trash, and application close all wait for the
latest content to reach disk and stop if persistence fails. Before changed
content replaces the file, the prior content is committed to SQLite history.
The replacement itself uses a same-directory atomic write.

Window close and application-level quit requests use the same frontend flush
barrier, including macOS Dock Quit and Command-Q.

Each save includes the hash of the version originally read. A mismatched hash
surfaces a conflict rather than overwriting edits from another application or
Denote process. A per-note cross-process lock keeps validation and replacement
in one critical section. On Unix systems, extended attributes are copied to the
atomic replacement before commit. On Windows, Denote writes and syncs a sibling
temporary file, then uses `ReplaceFileW` so replacement stays atomic while
preserving ACLs, DOS attributes, and alternate data streams.

## Security

Filesystem operations run through dedicated Tauri commands rather than a broad
frontend filesystem permission. Copying a file path resolves the selected entry
inside the canonical vault boundary before the native clipboard plugin writes
its absolute path. Revealing a file uses the same validated absolute path before
the opener plugin invokes the operating-system file manager. Duplication reads
the bounded plaintext through the vault encryption boundary, creates a
non-conflicting sibling with a fresh encrypted representation when necessary,
and updates the cached tree. Every no-scheme link resolves relative to the current note and
stays inside the vault. Hostless local `file:///` links use the associated
desktop application; remote file hosts are rejected.
HTTP(S) schemes are normalized to lowercase and unknown exact domains require
confirmation; trust is local-only and can be exact or wildcard. Mail, telephone,
and custom `scheme://` links use a native validator and opener, with custom
schemes requiring one-time confirmation. `javascript`, `data`, `vbscript`,
`blob`, `about`, and `file` are blocked from that generic URI command. The
content security policy allows local application scripts, the bundled plugin
worker plus verified data-URL plugin modules, and the image sources required for Markdown
previews. Encrypted vaults must be unlocked before
content commands receive a data key, and incomplete encryption state blocks
ordinary content operations until the resumable transformation finishes.

Clipboard content copy sends the current in-memory text through the native
clipboard plugin. Attachment copy reconstructs the current file bytes, including
unsaved edits and original line endings, in a UUID-scoped application-cache
folder and places that path on the OS file-list clipboard. Encrypted vault copies
therefore stage plaintext outside the vault with owner-only Unix permissions.
One application-lifetime clipboard context serializes staging, clipboard update,
and cleanup so concurrent copies cannot delete the file currently advertised by
the clipboard. Replacing the clipboard file removes prior staging folders;
startup and future copies prune entries older than 24 hours. Cache roots reject
symlinks/reparse points before cleanup, and partial failures remove the new
private staging directory.
