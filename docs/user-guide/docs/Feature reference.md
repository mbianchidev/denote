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
- Update relative Markdown links automatically after file/folder rename or move,
  with explicit reporting for skipped or conflicting files.

## Tabs and groups

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

## Markdown and source editing

- Use rich single-pane Markdown editing or source mode.
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
- Render `>![info]`, `>![warning]`, and `>![danger]` as callout boxes.
- Copy rich-mode fenced code blocks from their inline **Copy** button.
- Highlight supported programming and markup files by filename in the source
  editor.
- Highlight rich fenced blocks for JavaScript, TypeScript, PHP, Java, C/C++,
  C#, Go, Python, Ruby, Kotlin, Swift, Scala, shells, web, data, and config
  languages.
- Preserve mixed Unicode scripts and emoji in one file.
- Open unsupported rich syntax such as MDX, raw HTML, footnotes, math, reference
  definitions, and escaped hashtags in locked source mode for safety.
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
- Open **About Denote** from the activity rail or command palette to inspect the
  packaged version and full Git commit.
- Scale editor text without scaling application chrome.
- Adapt code blocks and syntax colors to the active theme.
- Resize the vault sidebar by pointer or keyboard.
- Show optional line numbers, spaces/tabs, exact line endings, and trailing
  whitespace.
- Keep rich/source buttons visible but disabled while display guides require
  source mode, with guidance for turning guides off.
- Operate core workflows with keyboard controls, visible focus, named dialogs,
  menus, tab semantics, and screen-reader status updates.

## Optional plugins

Git synchronization, graph view, Kanban, Mermaid, task enhancements, reminders,
comments, highlighting, TTS/dictation, calendar, time tracking, and colorful text
are tracked as optional plugins rather than built into the minimal core.

[Back to Welcome](../Welcome.md)

#guide #reference #features
