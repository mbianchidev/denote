# Complete feature reference

This page lists every built-in Denote capability. The linked task guides provide
more detail and examples.

## Vaults

- Open any local folder as a vault.
- Switch among known work, music, personal, or other vaults.
- Use `Command-P` / `Ctrl-P` to open a command palette containing contextual
  actions, visible shortcuts, and filenames from all known available vaults.
- Remove non-current vaults from the recent list.
- Optionally move a removed vault folder to operating-system Trash.
- Open the built-in **Denote Welcome** vault at any time.
- Cache known file trees for fast switching, then refresh disk/search state in
  the background.
- Optionally encrypt a vault with a password and ten one-time recovery codes.

## Files and folders

- Open and edit every regular file up to 25 MB.
- Edit valid UTF-8 as text.
- Edit invalid UTF-8 or mixed-line-ending files as reversible Base64.
- Preserve LF, CRLF, or CR endings when saving.
- Preview images or switch them to raw Base64 editing.
- Create files with `Command-N` / `Ctrl-N`.
- Create files or folders from toolbar or context-menu actions.
- Rename entries from toolbar or context menu.
- Delete entries to Denote Trash from toolbar or context menu.
- Restore trashed entries or permanently empty Trash.
- Drag files or folders onto another folder or empty tree space to move them.
- Use **Move to folder…** as the keyboard alternative.
- Pin entries above siblings.
- Reorder pinned and ordinary siblings independently.
- Copy active content, an attachment-ready file, or the absolute file path.
- Duplicate files with a non-conflicting sibling name.
- Bookmark, copy a path, open version history, open in a new tab, or reveal a
  file from its context menu or the focused-file three-dot menu.
- Expand every folder except `.git` and `node_modules` unless opened directly,
  or collapse the complete file tree.
- Expand or collapse one folder from its context menu.
- Persistently hide or show dotfiles and complete dot-folder subtrees in the
  local file-tree presentation without changing vault data or open tabs.
- Keep `.gitignore` matches visible and interactive with reduced emphasis and an
  accessible ignored indicator. Rules come from the closest code project and do
  not remove files from Denote, search, or project data.
- Update relative Markdown links automatically after file/folder rename or move,
  with explicit reporting for skipped or conflicting files.

## Projects and workspaces

- Independently mark or unmark the vault root or an existing folder as an
  explicit project, a multi-project workspace, or both through its context menu
  or the command palette.
- Discover each safe, real direct child folder of a workspace as an implicit
  project, including new child folders added later. Nested content belongs to
  that child; files directly in the workspace container need an applicable
  explicit project root.
- Keep multiple or nested roots; use the closest available root of the focused
  file as the active project, so explicit nested projects win.
- Show the active project in the status bar and announce project changes to
  screen readers. A blank tab or non-project file has no active project.
- Preserve stable local identity and update paths through Denote rename/move.
  Promote an implicit child to explicit without replacing its identity.
- Remove only implicit-only children when unmarking a workspace; preserve
  explicit children.
- Keep missing roots and children as unavailable local metadata until removed
  through the command palette.
- Clear affected project/workspace metadata on trash. Rediscover a restored
  direct child of a still-marked workspace as a new implicit project.
- Suggest marking an otherwise unmarked Git vault root as a project, without
  automatic marking. Accept with **Mark as project**, permanently dismiss with
  **No thanks**, or dismiss by manually marking the root as project/workspace.
- Store project/workspace roots and suggestion dismissal only in app-data
  SQLite, never in vault content.

## Tabs, groups, and panes

- File selection navigates in the active tab.
- Create a blank tab with `Command-T` / `Ctrl-T` or the rightmost plus button.
- Switch with `Ctrl-Tab` / `Ctrl-Shift-Tab`.
- Close with `Command-W` / `Ctrl-W`.
- Reorder tabs by pointer drag or `Alt/Option-Shift-Left/Right`.
- Create named groups from a tab context menu.
- Move tabs into or out of groups.
- Rename groups and collapse or expand group headers.
- Close all tabs, all other tabs, or every tab to the left/right from a tab
  context menu.
- Reopen the last session's files, order, groups, collapsed state, and active
  file by default.
- Disable session restore per vault in **Editor settings**.
- Navigate backward and forward through each tab's independent file history.
- Open up to four independently focusable and resizable panes.
- Use horizontal, vertical, grid, and mirrored or rotated asymmetric layouts.
- Drag tabs onto pane centers or edges to move, split, and rearrange the
  workspace without a separate layout control.
- Move live tabs between panes without losing unsaved edits.
- Close a pane by merging its tabs into a neighbor.
- Scope file selection, links, search, commands, history, and toolbar actions to
  the focused pane.
- Restore the pane layout, resize fractions, assignments, focus, and per-pane
  active files with the tab session.

## Markdown and source editing

- Use rich Markdown editing or source mode independently in each pane.
- Switch an individual file between default write mode and non-editable read
  mode.
- Keep one rich/source preference for every Markdown file in each vault.
- Set a persistent editor font size from 12 to 24 px.
- Choose two- or four-space Tab indentation for every source/code editor.
- Increase, decrease, or reset editor text with Command/Control `+`, `-`, or `0`.
- Create links with `Command-K` / `Ctrl-K`: rich mode keeps selected anchor text
  in its dialog; source mode inserts Markdown syntax directly.
- Autosave after editing.
- Keep the previous ten changed revisions.
- Render headings, emphasis, lists, task lists, quotes, tables, thematic breaks,
  frontmatter, links, images, code, and callouts.
- Treat angle-bracket comparisons, hearts, and placeholders in `.md` as standard
  Markdown text; keep `.mdx` and `.jsx` as non-executing JSX-highlighted source.
- Render canonical `<!-- toc -->` / `<!-- /toc -->` link lists as tables of
  contents and preserve their generator markers across Rich and Source edits.
- Render safe `<details>` / `<summary>` disclosure blocks with Markdown content.
- Render `>![info]`, `>![warning]`, and `>![danger]` as callout boxes.
- Copy rich-mode fenced code blocks from their inline **Copy** button.
- Highlight supported programming and markup files from one built-in filename
  and extension registry.
- Show the effective source language in the status bar and apply a non-persistent
  per-tab Automatic, Plain text, or explicit language override without changing
  the file.
- Highlight source files and rich fences for JavaScript, JSX, TypeScript, TSX,
  Java, JSP, Go, Rust, Python, C/C++, C#, Kotlin, Swift, Ruby, PHP, Dart, Lua,
  R, Scala, Elixir, JSON, XML, HTML, CSS, Markdown, shell, YAML, TOML, SQL,
  PowerShell, SCSS, LESS, and Dockerfiles. JSP uses HTML highlighting.
- Highlight `go.mod`, `go.sum`, `go.work`, `go.work.sum`, CMake files,
  Makefiles, Gradle/Groovy, Protocol Buffers, properties/INI/CFG files,
  Cargo/Poetry/uv locks, Visual Studio solutions, `.csproj`-family XML project
  manifests, and other documented project filenames.
- Highlight LaTeX, PostgreSQL, MySQL, MariaDB, MS SQL, PL/SQL, SQLite SQL,
  CQL, Jinja, Vue, Angular templates, Haskell, Clojure/ClojureScript, Erlang,
  OCaml, F#, Fortran, Julia, Perl, Pascal, VB.NET, Cobol, and Puppet. React uses
  JSX or TSX.
- Highlight Common Lisp, Terraform/HCL (`.tf`, `.tfvars`, `.hcl`), and Helm
  `.tpl` files. Offer Helm as a per-tab override for chart YAML templates.
- Keep ambiguous `.pp` files plain under Automatic and allow an explicit Pascal
  or Puppet tab override. Leave diff highlighting to the Git plugin.
- Search code-block languages by name, alias, or extension from a keyboard
  combobox. Keep unknown identifiers until a supported option is explicitly
  selected, and change only the fence identifier through undoable editing.
- Fall back to readable plain text for unknown identifiers, extensions, or
  grammar-load failures.
- Preserve mixed Unicode scripts and emoji in one file.
- Open unsupported rich syntax such as MDX, other raw HTML, footnotes, math,
  reference definitions, and escaped hashtags in locked source mode for safety.
- Report Markdown parser line/column details, highlight the failing source
  position, and expose **Navigate to error** without changing the saved mode.

## Tags, links, and navigation

- Extract Unicode hashtags including slash, underscore, and hyphen forms.
- Render a tag-only final line as colored pills in rich mode.
- Assign stable default colors and editable per-vault color overrides.
- Search a tag by selecting its document tag pill.
- Resolve no-protocol links relative to the current file inside Denote,
  including parent paths such as `../assets/image.svg`.
- Navigate file and same-file `#heading` anchors in rich or source mode, including
  stable suffixes for duplicate headings.
- Normalize HTTP(S) protocols, confirm unknown domains, and manage exact or
  wildcard domain permissions in Settings.
- Fade link-navigation failures automatically instead of leaving a persistent
  error banner.
- Open every unique HTTP(S) link in the active file from the toolbar or command
  palette, pausing the queue when a domain needs approval.
- Open email, telephone, hostless local file, and confirmed custom application
  protocols through the operating system; block remote file hosts and dangerous
  schemes.
- Navigate headings through the table of contents.

## Search and replace

- Open search with `Command-F` / `Ctrl-F` and the active file selected as the
  location.
- Use `*`, exact paths, `*.html`, or path globs to choose where to search.
- Search content with ZBSearch plus Unicode substring fallback.
- See every matching content occurrence as a separate result that opens its exact
  position in the file.
- Open visual filters for tag, filename, path, content, type, bookmark, or
  recency; inline filters remain supported.
- Open the command palette with `Command-P` / `Ctrl-P`.
- Filter commands by title, category, description, or keyword.
- Type a filename directly or enter the file-only palette view; paths, tags, and
  content remain excluded from global filename matching.
- Find and replace in the current file.
- Preview selectable replacements across the vault.
- Reject stale replacements when files changed after preview.

## Metadata and recovery

- Store open, edit, and save counts plus timestamps in SQLite.
- Store bookmarks, tags colors, ordering, vault preferences, cached trees, and
  tab sessions locally.
- Use same-directory atomic file replacement.
- Reject autosave when another application changed the file.
- Journal rename, move, trash, and restore operations for crash recovery.
- Preserve Unix extended attributes and Windows file metadata during saves.
- Use the built-in `test` folder for multilingual, Unicode-path, link, move,
  rename, and syntax-highlighting edge cases.

## Appearance and accessibility

- Use dark mode by default or persistent light mode.
- On macOS, use native menus for common file, vault, search, view, pane, and
  editor actions.
- Open Settings with `Command-,` on macOS or `Ctrl-,` on Windows and Linux.
- Open **About Denote** from the activity rail or command palette to inspect the
  packaged version and full Git commit.
- Scale editor text without scaling application chrome.
- Adapt code blocks and syntax colors to the active theme.
- Preserve source and fenced editor instances, selection, undo history, and
  content while themes or presentation-only language state change.
- Expand project and vault-workspace source editors to the available pane width.
- Show a bounded project source outline of functions and other declarations,
  navigate directly to a symbol line, and use an accessible code minimap with a
  live viewport window to jump anywhere in long files.
- Resize the vault sidebar by pointer or keyboard.
- Show optional line numbers, spaces/tabs, exact line endings, and trailing
  whitespace.
- Keep rich/source buttons visible but disabled while display guides require
  source mode, with guidance for turning guides off.
- Force line numbers for explicit and implicit project files and Source mode for
  project Markdown without changing saved editor settings or the vault Markdown
  preference.
- Operate core workflows with keyboard controls, visible focus, named dialogs,
  menus, tab semantics, and screen-reader status updates.

## Optional plugins

- Approved API version 1 plugins can observe the active explicit or implicit
  project's stable opaque ID and vault-relative root through `project-context`
  change events, without receiving absolute paths or Denote implementation
  objects.
- Plugin command leases capture project identity. Existing bounded process
  execution revalidates it and uses the current project root as `cwd`; persistent
  terminal and language-server APIs remain future work.
- For a focused active explicit or implicit project, Plugins settings recommends
  Git, Terminal, Language server, Linter, Compiler, and Code navigation roles
  with unavailable, disabled, or enabled status. Recommendations never
  auto-download or enable.
- Core project behavior remains independent of missing, disabled, or failed
  plugins.
- Git synchronization, graph view, Kanban, Mermaid, task enhancements,
  reminders, comments, highlighting, TTS/dictation, calendar, time tracking, and
  colorful text remain optional rather than built into the minimal core.

[Back to Welcome](../Welcome.md)

#guide #reference #features
