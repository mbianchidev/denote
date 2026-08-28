# Files, tabs, and vaults

#guide #files #vaults

## Any regular file

Files up to 25 MB can be edited regardless of extension. Valid UTF-8 opens as
text. Invalid UTF-8 and mixed-line-ending files open as reversible Base64 so
unchanged bytes round-trip exactly. Images provide both a visual preview and a
raw Base64 editor.

## Tabs

- Select files in the tree to open tabs.
- Use `Ctrl-Tab` and `Ctrl-Shift-Tab` to switch tabs.
- Use `Command-W` or `Ctrl-W` to close the active tab.
- Use the copy button in the editor toolbar to copy the active absolute path.

## Organize a folder

The file-tree toolbar can create, rename, pin, reorder, bookmark, and trash
entries. Pinned files and folders stay above ordinary siblings. Up/down actions
customize order inside the pinned or unpinned section of the current folder.

## Switch vaults

Use the sidebar vault switcher or `Shift-Command-O` / `Ctrl-Shift-O`. Denote
saves pending work, clears tabs and search state, and opens the selected folder.
An encrypted source vault is sealed before its in-memory key is discarded.

[Next: History, trash, and recovery](<History, trash, and recovery.md>)
