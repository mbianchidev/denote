# Files, tabs, and vaults

#guide #files #vaults

## Any regular file

Files up to 25 MB can be edited regardless of extension. Valid UTF-8 opens as
text. Invalid UTF-8 and mixed-line-ending files open as reversible Base64 so
unchanged bytes round-trip exactly. Images provide both a visual preview and a
raw Base64 editor.

## Tabs

- Select a file to open it in the active tab.
- Use `Command-T` / `Ctrl-T` or the small plus button to create a blank tab before
  opening another file.
- Use `Ctrl-Tab` and `Ctrl-Shift-Tab` to switch tabs.
- Use `Command-W` or `Ctrl-W` to close the active tab.
- Drag tabs directly with the pointer to reorder them.
- Use `Alt-Shift-Left/Right` to reorder the focused tab from the keyboard.
- Right-click a tab to create or rename a group, move the tab between groups, or
  close all/others/left/right.
- Collapse or expand a named group from its group header.
- Use the back and forward arrows to revisit files navigated within the active
  tab. Opening a new file after going back replaces only that forward branch.
- Denote reopens the previous session's files, order, groups, collapsed state,
  and active file by default. Disable this per vault in **Editor display
  settings**.
- Use the editor toolbar to copy content, an attachment-ready file, or the active
  absolute path. Encrypted vault attachments use a temporary plaintext cache.

## Organize a folder

The file-tree toolbar can create, rename, pin, reorder, bookmark, and trash
entries. Pinned files and folders stay above ordinary siblings. Up/down actions
customize order inside the pinned or unpinned section of the current folder.
Use `Command-N` / `Ctrl-N` for a new file. Right-click a folder, file, or empty
tree space for contextual creation. Entry menus also provide rename, move, and
trash actions.

Drag a file or folder onto another folder to move it there, or onto empty tree
space to move it to the vault root. Use **Move to folder…** from the context menu
for the keyboard-accessible equivalent. Denote then updates relative inline
links, images, and reference definitions in eligible Markdown files. It reports
large, unreadable, or conflicting files that could not be rewritten.

Drag the divider beside the file tree to resize the sidebar. Focus it and use
Left/Right arrows, or press Home to reset the default width.

## Switch vaults

Use the sidebar vault switcher or `Shift-Command-O` / `Ctrl-Shift-O`. Denote
saves pending work, clears tabs and search state, and opens the selected folder.
An encrypted source vault is sealed before its in-memory key is discarded.
Non-current user vaults can be removed from the list or moved with all contents
to the operating system Trash.

Known vaults open from their cached file tree and become usable immediately.
Denote refreshes disk changes and search content in the background. A first-time
vault open can take longer because it creates that cache.

Press `Command-P` or `Ctrl-P` to open the command palette. Type a filename
directly, or choose **Find file across vaults**, to search every known available
vault. Selecting a file switches vaults when necessary and opens it. Encrypted
target vaults ask for an unlock before opening the pending result.

[Next: History, trash, and recovery](<History, trash, and recovery.md>)
