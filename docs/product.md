# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who keep a personal or professional knowledge base in plain Markdown and
want a focused desktop editor without giving up direct ownership of their
files.

## Product Purpose

Denote is a local-first Markdown workspace for macOS, Windows, and Linux. It
opens a user-selected folder as a vault, supports rich editing in up to four
independent panes, and keeps navigation, search, metadata, and recovery close to
the writing flow.
Success means users can create, find, edit, connect, and recover notes without
moving their content into a proprietary format or hosted service.

## Positioning

Denote combines an Obsidian-like vault and file workflow with a Typora-like
focused Markdown editing experience. The selected folder remains the source
of truth while optional workspace metadata is stored locally in SQLite.

## Operating Context

Users work with existing or new folders containing arbitrary files. UTF-8
content opens as text, while binary content opens as a reversible Base64
representation. Notes may mix any Unicode languages and emoji in the same document.
Users commonly switch among several notes, browse folders, search by content
or metadata, follow links, and recover earlier content after an unwanted edit.

## Capabilities and Constraints

- Tauri desktop application with React and TypeScript.
- macOS, Windows, and Linux support.
- A user-selected local folder is the active vault.
- The vault root and any existing subfolder can independently be marked or
  unmarked as an explicit project root, a multi-project workspace, or both
  through separate folder/root context actions or command-palette commands.
- Each safe, real direct child folder of a workspace is discovered as an
  implicit project. Nested content belongs to that child project, while files
  directly in the workspace container need a separate explicit project root.
  New direct child folders are discovered automatically.
- Explicit and implicit project roots may be nested. The closest available root
  of the focused file is active, so an explicit nested project wins over its
  workspace child ancestor. No focused project file means no active project.
- The active project appears in the status bar. Workspace child projects keep
  stable local identities through Denote rename/move and can be promoted to
  explicit projects. Unmarking a workspace removes only implicit-only children.
- Missing project and workspace folders remain as unavailable local metadata
  until removed through the command palette. Denote Trash clears affected
  project/workspace metadata; restoring a direct child under a still-marked
  workspace discovers it as a new implicit project.
- When an otherwise unmarked vault root safely contains a `.git` file or
  directory, Denote suggests—but never automatically applies—**Mark as
  project**. **No thanks** permanently dismisses the suggestion for that vault;
  manually marking the root as a project or workspace also dismisses it.
- Every installation includes an offline Denote Welcome vault with an editable
  feature tour and task-focused documentation; seeded files are never
  overwritten after creation.
- A vault can provide a root `.denote.md` welcome page or designate another
  Markdown file locally. The page opens when no saved tab session or explicit
  cross-vault file takes priority.
- The Welcome vault includes a one-time, non-destructive `test` folder covering
  Japanese, Russian, mixed scripts, emoji, punctuation, nested paths, links, and
  highlighted source files.
- Up to 50 recently opened vault folders are available from a quick switcher,
  while the native folder picker adds new vaults.
- Previously opened vaults use a cached file tree for immediate switching, then
  refresh disk state and search content in the background. First-time vault
  registration may perform the slower complete scan.
- Non-current user vaults can be removed from the recent list, with a separate
  explicit option to move the folder and all contents to system Trash.
- Every regular file up to 25 MB can be opened and edited.
- Valid UTF-8 content edits as text. Invalid UTF-8 content edits as reversible
  Base64 so unchanged bytes round-trip exactly.
- Source-only programming and markup files use one filename-driven core
  CodeMirror language registry. Its bundled baseline covers JavaScript, JSX,
  TypeScript, TSX, Java, JSP, Go, Rust, Python, C/C++, C#, Kotlin, Swift, Ruby,
  PHP, Dart, Lua, R, Scala, Elixir, JSON, XML, HTML, CSS, Markdown, shell, YAML,
  TOML, SQL, PowerShell, SCSS, LESS, Dockerfiles, Go module/workspace files,
  CMake, Makefiles, Gradle/Groovy, Protocol Buffers, properties/INI/CFG files,
  Visual Studio solutions, common XML project manifests, LaTeX, Jinja, Vue,
  Angular templates, Haskell, Clojure/ClojureScript, Erlang, OCaml, F#,
  Fortran, Julia, Perl, Pascal, VB.NET, Cobol, Puppet, Common Lisp,
  Terraform/HCL, Helm templates, and common SQL dialects.
- Images retain their visual preview and can switch to raw editing.
- Rich Markdown editing is the default in every pane.
- Full, collapsed, and shortcut Markdown reference links render and remain
  editable in Rich mode. Definitions stay invisible and retain their exact
  source formatting and ordering.
- `.md` files treat ordinary angle-bracket comparisons and placeholders as
  Markdown text rather than MDX JSX. `.mdx` and `.jsx` remain non-executing,
  JSX-highlighted source files.
- Canonical `<!-- toc -->` / `<!-- /toc -->` blocks containing link-only
  Markdown lists render as tables of contents in Rich mode while
  retaining their generator markers through Rich and Source edits. Other
  comments remain locked to source mode.
- Well-formed `<details>` blocks with a plain `<summary>` line render as native,
  keyboard-operable disclosure sections while preserving Markdown content
  inside. A separately validated README-style subset of paragraphs, headings,
  links, strong text, and local or HTTP(S) images renders as atomic Rich blocks
  while preserving its raw source exactly. Other raw HTML remains source-only.
- Markdown thematic breaks render as consistent full-width document separators.
- Long rich-text and source documents scroll inside the editor without moving
  the caret to reveal later content.
- A tag-only final line renders its hashtags as colored pills in rich mode.
  Each normalized tag has one stable default or user-selected color within its
  vault.
- Each vault keeps one rich-text or source-mode choice across all Markdown files
  and restores it after app restarts unless file safety or display guides require
  source mode.
- File navigation replaces the active tab by default. Explicit blank tabs come
  from Command-T / Control-T or the tab-row plus button and can be reordered by
  pointer or keyboard.
- Tabs can be organized into named collapsible groups. Their context menu can
  close all, other, left, or right tabs, and move tabs between groups or panes.
- Each tab maintains an independent back/forward file-navigation history. New
  navigation after going back truncates that tab's forward branch.
- The editor supports one to four independently focusable and resizable panes.
  Two-pane layouts can be horizontal or vertical; three panes support equal and
  mirrored asymmetric layouts; four panes support grid, horizontal, and
  vertical layouts.
- Dragging a tab over a pane exposes center and edge docking targets. Center or
  empty tab-strip drops move the tab into that pane; edge drops create or
  rearrange the valid pane layout without requiring a separate layout control.
- Tabs retain unsaved edits when moved between panes or when a pane is closed
  into a neighboring pane. Search, commands, links, history, and file actions
  follow the focused pane.
- Each vault restores its pane layout and sizes plus its last real file tabs,
  pane assignments, order, group membership, group names, collapse state,
  focused pane, and active files by default. This setting is optional per vault;
  temporary blank tabs are never persisted.
- Autosave is available and keeps the previous 10 changed revisions by
  default.
- SQLite stores local workspace metadata, including open, edit, and save
  counters, bookmarks, recent activity, ordering, tag color overrides, trash
  records, revision history, stable project/workspace identities and paths, and
  Git-suggestion dismissal. These records never alter vault or project files.
- Denote rename and move operations preserve explicit and implicit project
  identities while updating their paths. Moving a marked folder or its ancestor
  to Denote Trash removes affected project/workspace metadata.
- ZBSearch provides local full-text search with a separate location glob and
  visual filters for tags, filename, path, content, file type, bookmarks, and
  recency.
- Command-F / Control-F opens search with the active file selected in the
  location field and keyboard focus in the search-text field. Every content
  occurrence has its own result and navigates to that exact term. `*` searches
  the vault and patterns such as `*.html` limit results by filename; platform
  replace shortcuts remain distinct.
- Command-P / Control-P opens a unified command palette containing contextual
  application actions and their assigned shortcuts. Typing a filename directly
  retains filename-only search across all known available vaults and switches
  vaults before opening a selected result.
- On macOS, native application menus expose the matching file, search, view,
  pane, and editor actions. Settings opens with Command-comma.
- Find and replace works in the current note or across the vault, with a
  selectable preview before vault-wide changes are applied.
- The active file's validated absolute path can be copied to the system
  clipboard from the editor toolbar.
- A per-file read mode disables editing without changing the file or its
  rich/source presentation.
- The active in-memory content or a native attachment-ready file can also be
  copied. Encrypted vault attachments use a temporary plaintext cache file.
- Command-N / Control-N and the file-tree context menu create files or folders
  relative to the current target.
- The vault sidebar width is pointer- and keyboard-resizable and persists across
  launches.
- Files and folders can be pinned above their siblings and manually ordered
  within the pinned or unpinned section of each parent folder.
- Files and folders can move between folders by pointer drag or the
  keyboard-accessible context action. Rename and trash are also available from
  the file-tree context menu.
- File context menus can duplicate, bookmark, copy the validated path, open
  version history, open in a new tab, and reveal the file in the operating
  system file manager. The focused file exposes the same menu from a three-dot
  control and closes it when focus changes to another file.
- One file-tree control expands every folder except `.git` and `node_modules`,
  which stay collapsed unless opened directly, or collapses the complete tree.
- A folder's context menu exposes **Expand folder** or **Collapse folder** for
  that single subtree, with the same keyboard-operable menu behavior.
- A persistent local file-tree control can hide entries whose basename starts
  with `.`, including complete dot-folder subtrees, without changing vault data,
  search results, project metadata, or open tabs.
- Files matched by the closest code project's `.gitignore` rules remain visible
  and interactive in the file tree with an accessible, reduced-emphasis ignored
  state; ignore rules never remove files from Denote.
- Renaming or moving a file/folder updates relative inline links, images, and
  reference definitions in eligible Markdown files; skipped or conflicting
  rewrites are surfaced.
- No-protocol links always resolve relative to the current file inside the vault.
- File and same-file `#heading` fragments navigate to stable rendered heading
  anchors or the matching Markdown source line.
- HTTP(S) links normalize protocol case and require confirmation for unknown
  exact domains. Users can allow one domain or all domains and manage that list
  in Settings.
- The active file can open every unique HTTP(S) link in one queued action that
  pauses at each untrusted domain and resumes after approval.
- Email, telephone, file, and confirmed custom application protocols use the
  operating system handler; dangerous URI schemes remain blocked.
- Command-K / Control-K preserves selected rich text in the link dialog and
  inserts editable Markdown link syntax directly in source mode.
- Persistent editor settings include a 12–24 px font size shared by rich and
  source editors, two- or four-space Tab indentation, line numbers, spaces and
  tabs, exact line-ending style, and trailing whitespace without modifying
  content.
- Command/Control `+`, `-`, and `0` increase, decrease, and reset editor text
  size without changing the surrounding application chrome.
- Display guides visibly disable rich/source controls and explain that guides
  must be turned off before mode switching.
- Files inside an explicit or implicit project temporarily force line numbers.
  Project Markdown uses the byte-preserving source editor so opening a code
  project cannot normalize stored Markdown syntax. Leaving the project or
  removing its governing mark restores the saved line-number setting and vault
  Markdown preference immediately; these constraints never persist as editor
  preferences.
- Source editors use the full pane width when the focused file has project
  context or the vault root is marked as a workspace, while ordinary vault text
  keeps the narrower writing measure.
- The optional outline lists bounded, language-aware source symbols for project
  files. Selecting a symbol moves to its line; a miniature code map below the
  symbols reflects indentation and declaration structure, overlays the live
  viewport, and jumps to any proportional position.
- The Markdown or source outline width is pointer- and keyboard-resizable,
  persists locally, and remains bounded so the editor keeps usable space.
- Syntax highlighting remains available for recognized files in any vault.
  Marking a folder as a project additionally enables project status, forced line
  numbers, byte-preserving project Markdown, and code-tooling recommendations.
  Marking a folder as a workspace discovers each safe direct child as an
  implicit project; root-level files need the same folder marked as a project.
- Markdown parser failures expose line and column details, force a temporary
  source fallback without changing the vault preference, highlight the failing
  line, and provide keyboard-accessible error navigation. Errors remain scoped
  to their file and hide when another file is active; link failures fade
  automatically.
- Code blocks, syntax highlighting, gutters, and selections use complete dark
  and light palettes rather than a fixed editor theme.
- Rich fenced blocks use the same core registry and recognize language names,
  common aliases, and registered extensions. Unknown identifiers remain
  untouched and render as readable plain text.
- The active rich code block exposes a searchable, keyboard-operable language
  combobox with Automatic and Plain text choices. Filtering does not edit the
  fence; an explicit selection changes only its identifier through normal undo.
- Source-only UTF-8 tabs expose their detected language in the status bar and
  accept a transient per-tab override. Automatic returns to filename detection;
  Plain text disables highlighting. Overrides never rename, dirty, save, or
  persist with the file.
- JSP uses the bundled HTML grammar as a safe baseline, leaving Java scriptlets
  readable but uncolored.
- JSX and TSX provide React syntax; Angular component templates and Vue
  single-file components use their bundled grammars.
- `.pp` remains automatic plain text because both Pascal and Puppet claim it;
  users can select either language as a transient per-tab override.
- Core does not register diff highlighting. Git-owned diff presentation remains
  part of the optional Git plugin.
- Rich-mode fenced code blocks expose a copy action that reads the complete live
  code document rather than only visible lines.
- About Denote exposes the packaged semantic version and immutable Git commit
  hash from both the activity rail and command palette.
- Vault encryption is optional and encrypts file contents plus saved revision
  contents while leaving paths visible. It uses a password, ten one-time
  recovery codes, and resumable full-vault encryption and decryption.
- Disabling vault encryption requires every encrypted file and revision to be
  decrypted successfully first.
- The core application stays minimal. It embeds only plugin catalog metadata;
  executable plugin archives are separate, checksum-pinned GitHub Release
  assets downloaded only after explicit installation.
- The repository distributes plugin source and immutable release metadata, not
  plugin archives. Each plugin owns its source, manifest, guide, tests, and
  release ledger. Generated `.tgz` files remain ignored staging output and
  never enter new commits, Tauri resources, or installers; historical versions
  keep their verified immutable origins and byte identities.
- Approved plugins may request the additive API version 1 `project-context`
  capability. It exposes only a stable opaque project ID, a vault-relative root,
  and context-change events, never an absolute path or editor implementation.
- Plugin command leases capture the current project identity. Existing bounded
  process execution validates that identity again and uses the current project
  root as its working directory. Persistent terminal and language-server APIs
  remain separate future plugin work.
- **Settings → Plugins** shows a non-blocking **Code tooling** recommendation
  only when the focused file has an active explicit or implicit project. Git,
  Terminal, Language server, Linter, Compiler, and Code navigation roles show
  unavailable, disabled, or enabled status; Denote never downloads or enables
  them automatically, and core project behavior does not depend on plugins.
- **Update all** appears only when previously approved plugins have available
  updates. One confirmation lists the affected plugins and re-accepts each
  latest complete permission payload. Each plugin then updates through its own
  transaction and runtime. The installed version remains active and stored
  until the replacement has downloaded, verified, activated, and committed;
  a failed or cancelled update restores that installed version. Unrelated,
  never-approved, current, or incompatible plugins are untouched.
- Disabling a plugin removes its installed package, cached archive, staging
  content, and removal backups. Catalog metadata remains available for a later
  reinstall; plugin settings and generated data follow their separate cleanup
  controls.
- The independently installable **Emoji picker** plugin is disabled by default.
  Its toolbar action, command-palette entry, and Command/Control-Shift-E open a
  local searchable Unicode picker in editable Markdown Rich and Source modes.
  Names, keywords, categories, and shortcodes find emoji, including standardized
  variants and skin tones. Recent and favorite choices stay in plugin settings
  outside notes. Conservative `:shortcode:` suggestions require an explicit
  selection, dismiss with Escape, and never appear in inline or fenced code.
  Locking a vault or disabling the plugin removes its editor UI; previously
  inserted Unicode remains ordinary portable text. No search, typing, note
  content, or preferences are sent to a network service.
- Development builds use a separate application identity and can explicitly
  load a local `.tgz` from **Settings → Plugins**. Local packages are visibly
  untrusted, pass the ordinary package/runtime safety checks, and are
  unavailable in release builds.
- The optional **Git vault versioning** plugin is the first production catalog
  entry. Its host-rendered view lists the vault root and configured project roots
  that contain a safe `.git` file or directory, keeps one explicitly selected,
  and binds every action to that host-issued repository identity. It performs
  one read-only refresh when its Git view first opens in a vault and supports initialize,
  stage, unstage, commit or commit-and-push of staged changes, and cancellation
  of a running operation. It
  requests no network, process, or workspace-write permission. Setting an
  automatic commit interval above zero also enables timed local commits: Denote
  saves open notes first, then commits only tracked changes that match the
  configured include and exclude prefixes, never adds untracked files, never
  contacts a remote, skips the run when work is already staged or a merge is
  unfinished, and leaves the index exactly as it was whenever a run does not
  finish. Its default message is `Denote automatic commit {timestamp}`, where
  the placeholder resolves in the current timezone as `yyyy-mm-dd hh:mm`.
- Remote work is explicit and confirmed. The same view adds remotes, changes a
  remote URL, removes a remote, fetches, pulls, and pushes, and clones a
  repository into a new vault. Denote never fetches, pulls, or pushes on its own
  or from an automatic commit; a pull, a push, a URL change, a remote removal,
  and a clone each ask first, naming the exact remote, URL, and branch, and only
  an ordinary push is offered. Remotes may be public HTTPS, an SSH remote served
  by a running agent, or GitHub over HTTPS, where Denote's own GitHub CLI
  adapter can list your repositories to pick from and supplies the credential
  itself; no token is ever stored in plugin settings, written into repository
  configuration, or shown in a message or log, and a credential is only ever
  offered to the address the operation will really contact. The mode is a
  setting, so the view reports the configured one and sends you to Settings to
  change it.
- The default authentication mode uses the credential helpers and stored
  credentials from the user's global Git configuration. Public, SSH-agent, and
  host-owned GitHub CLI modes remain available. The host imports only bounded
  allowlisted identity, credential-helper, line-ending, and signing values into
  its otherwise isolated Git invocation; repository-local command configuration
  remains rejected.
- Official releases publish verified Git and GitHub CLI archives for every
  release target, while installers contain only signed metadata and legal
  notices. Git selects exactly one of Bundled (default), System, or Custom.
  GitHub CLI selects exactly one of Disabled (default), Bundled, System, or
  Custom. Bundled downloads its archive only when selected and first required;
  the other modes never download it. No mode silently falls back, custom paths
  must be absolute and version-probed, and generic Git never requires GitHub
  CLI.
- Plugin executable settings report the selected source, canonical resolved
  path, version, validation result, prerequisite guidance, and a native path
  picker. Existing path-only settings migrate to explicit System or Custom
  modes without changing the executable previously used.
- Manual commits can follow the global Git signing default, always sign, or
  never sign. An optional masked GPG key setting selects the key. The system GPG
  agent or pinentry owns any passphrase; Denote never stores or receives it.
  Automatic commits remain unsigned and unattended.
- The manual commit form offers Commit and Commit and push. Its per-commit
  signing control defaults on and can explicitly request an unsigned commit.
  Leaving the message empty uses `Denote manual commit {timestamp}`, with the
  placeholder resolved in the current timezone as `yyyy-mm-dd hh:mm`.
  The password-style **Signing passphrase** appears only while signing is
  requested, is used once for encrypted SSH signing keys, is cleared
  immediately, and never enters the plugin worker. OpenPGP and X.509 continue
  to use the system GPG agent or pinentry.
- **Clone repo as vault** lives in the Switch vault dialog beside **Open another
  folder**. It asks you to choose an empty folder, clones into it, checks the result,
  and only then opens it as a vault, so an encrypted clone shows the usual
  unlock screen before any note. Open notes are saved before the clone starts,
  and a clone or a repository browse can be cancelled while it runs. A clone that fails leaves the folder untouched
  and offers Retry, or an explicitly confirmed clean-up that deletes only that
  exact folder. Nothing is ever deleted automatically.
- Branch work is explicit, reviewed, and never destructive. The always-visible
  selector expands inside the plugin into one searchable local-and-remote list.
  It switches local branches, creates local tracking branches, creates and
  switches when search has no exact result, and provides accessible rename and
  delete controls for local and remote branches. The branch you are on is never
  deleted and nothing switches on its own. Remote rename creates the replacement
  before deleting the old name; partial completion is reported rather than
  hidden. Remote URL management stays on its own Repository tab.
- The daily path stays compact: the selected repository row, branch selector,
  create-and-switch field, pull and push controls, commit message, stage-all,
  unstage-all, and per-file actions are available without opening advanced
  history or branch management. A tracked file, or all tracked changes, can be
  restored from the current upstream only after a dangerous confirmation.
  Untracked files are never removed.
- The branch control opens one searchable picker. It switches local branches,
  checks out remote branches with a proposed local name, or creates and switches
  to a new branch from any listed local or remote branch. The existing
  save/dirty-worktree review and explicit confirmation still run before checkout.
- Compact source-control actions use icons with accessible names and native
  tooltips. Opening a working-tree, staged, or commit diff creates a read-only
  temporary `.diff` tab in the editor, rendered with `@pierre/diffs`. The tab
  keeps file and hunk stage/unstage controls, is never autosaved or indexed, and
  is omitted from restored tab sessions.
- Plugin activity-rail entries can be pointer-dragged or keyboard-reordered,
  hidden into a disclosed Hidden plugins section, assigned to local groups, and
  collapsed by group. Source-control panels are memoized so editor keystrokes
  do not rerender a large unchanged repository model.
- A switch that would disturb work never runs. Denote re-reads the working tree
  first: unresolved conflicts refuse the checkout outright, and any staged,
  changed, or untracked file produces a review that lists every affected path
  and offers exactly three answers — commit all of them, stash them, or cancel.
  Committing stages exactly the listed paths and commits them with the message
  and identity given. Stashing includes untracked files only in an unencrypted
  vault; while an encrypted vault has untracked files, stashing is unavailable
  and says why. Nothing is ever discarded, and once the commit or the stash has
  succeeded every later problem — a failed checkout, a failed refresh, a
  cancellation, a host refusal, or opening another repository part way through —
  is reported with the same sentence saying where the work was preserved.
- After a successful checkout, merge, rebase, pull, or the actions that resume
  one, Denote reads the vault again and reloads every open tab from disk. Open
  notes were saved before the action started, so nothing typed is lost. Pane
  layout, tab order, groups, and each tab's language and view choices are kept;
  only tabs whose files are not on the new branch are closed, and those are
  named.
- Changes can be staged a hunk at a time. Opening the diff for a changed or
  staged file shows its hunks, and Stage hunk and Unstage hunk apply exactly
  that one hunk of that one file to the index, leaving the file on disk alone.
  Whole-file staging is unchanged. A binary, added, deleted, renamed, or copied
  change is staged as a whole file instead, and says so, as does an encrypted
  vault, whose tracked content is ciphertext with no lines to choose between.
- Commit history is read one bounded page at a time, newest first, with explicit
  refresh and page controls that are offered only when that page exists. A
  surface describes the page it holds rather than the size of the log, because
  nothing counts it. Selecting a commit shows its summary, author, date,
  parents, refs, and the exact diff Git reports for it, including renames,
  previous paths, and binary or encrypted content with no line-level text. A
  merge is shown compared with its first parent and says so. Commit history is
  read-only: no hunk action is offered on it. A diff larger than Denote parses
  is refused with a message rather than shown cut short.
- Opening a file from a source control row or a commit is the host's own
  file-open flow. A provider names a repository-relative path only; the host
  resolves it inside the open vault, opens or focuses it, and reports a file
  that is no longer there. A renamed file opens under the path it has now, a
  deleted file stays reviewable without being openable, and no absolute path is
  ever built or shown.
- Merge, rebase, cherry-pick, and revert are host-rendered and always reviewed
  before they run: the review names the operation, its source, the branch it
  changes, its risk, and the files it is expected to touch. Starting one is
  confirmed, a rebase and every destructive step are confirmed as dangerous,
  and no operation starts on refresh, activation, or restart. Reset and force
  push are not offered at all.
- An interrupted merge, rebase, cherry-pick, or revert is detected from the
  repository itself on every refresh, so it survives a restart. Only the
  controls Git allows are offered: continue stays unavailable while any path is
  unmerged, skip is offered only where Git has one, and abort returns the
  repository to its pre-operation state.
- Conflict resolution reads the three sides Git recorded in the index, never the
  working-tree copy, and merges unencrypted text with a deterministic bounded
  three-way merge: non-overlapping changes combine automatically, and a change
  both sides made differently is chosen between per change or by taking one
  whole side. The merged result is editable, unresolved changes block marking a
  file resolved, and an unsaved result is never discarded silently. Binary and
  encrypted content never exposes line content or accepts plaintext: it offers
  the recorded sides as whole-file choices, and only when the index holds that
  side.
- No cloud account, synchronization service, telemetry, or remote content
  storage is part of the initial product.

## Brand Commitments

The product name is Denote. The interface is dark by default and also provides
a persistent light mode. Its interaction model should feel familiar beside
Obsidian and Typora without copying their branding.

## Evidence on Hand

No customer claims, benchmarks, testimonials, or production assets are
available. Future work must not fabricate them.

## Product Principles

1. Files first: the vault on disk is always the durable source of truth, either
   as directly editable content or explicitly enabled ciphertext.
2. Writing stays central: editing should feel immediate and visually calm.
3. Recovery is routine: autosave, history, and trash prevent avoidable loss.
4. Search is local and fast: useful retrieval does not require a server.
5. Capability is optional: advanced workflows belong in explicitly enabled
   plugins.

## Accessibility & Inclusion

Core workflows must be keyboard operable with visible focus, semantic controls,
accessible names, and screen-reader status updates. Separate folder project and
workspace actions are available with Shift-F10 or the Context Menu key;
whole-vault and unavailable project/workspace roots remain operable through the
command palette. Text handling must preserve full Unicode content and emoji
without language-specific restrictions.
