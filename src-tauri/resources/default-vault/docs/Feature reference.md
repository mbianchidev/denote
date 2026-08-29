# Complete feature reference

#guide #reference #features

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

## Markdown and source editing

- Use rich single-pane Markdown editing or source mode.
- Keep one rich/source preference for every Markdown file in each vault.
- Set a persistent editor font size from 12 to 24 px.
- Increase, decrease, or reset editor text with Command/Control `+`, `-`, or `0`.
- Autosave after editing.
- Keep the previous ten changed revisions.
- Render headings, emphasis, lists, task lists, quotes, tables, thematic breaks,
  frontmatter, links, images, code, and callouts.
- Render `>![info]`, `>![warning]`, and `>![danger]` as callout boxes.
- Copy rich-mode fenced code blocks from their inline **Copy** button.
- Highlight supported programming and markup files by filename in the source
  editor.
- Preserve mixed Unicode scripts and emoji in one file.
- Open unsupported rich syntax such as MDX, raw HTML, footnotes, math, reference
  definitions, and escaped hashtags in source mode for safety.

## Tags, links, and navigation

- Extract Unicode hashtags including slash, underscore, and hyphen forms.
- Render tags as colored pills in rich mode.
- Assign stable default colors and editable per-vault color overrides.
- Search a tag by selecting its document tag pill.
- Follow relative vault links inside Denote.
- Open HTTP, HTTPS, email, telephone, and file links through the operating
  system; Denote never becomes a browser.
- Navigate headings through the table of contents.

## Search and replace

- Open current-vault search with `Command-F` / `Ctrl-F`.
- Search content with ZBSearch plus Unicode substring fallback.
- Filter by tag, filename, path, content, type, bookmark, or recency.
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

## Appearance and accessibility

- Use dark mode by default or persistent light mode.
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
