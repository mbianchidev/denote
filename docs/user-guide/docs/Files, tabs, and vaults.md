# Files, tabs, and vaults

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
  panes, or close all/others/left/right.
- Collapse or expand a named group from its group header.
- Use the back and forward arrows to revisit files navigated within the active
  tab. Opening a new file after going back replaces only that forward branch.
- Denote reopens the previous session's panes, layout, sizes, files, pane
  assignments, order, groups, collapsed state, focused pane, and active files by
  default. Disable this per vault in **Editor display settings**.
- Use the editor toolbar to copy content, an attachment-ready file, or the active
  absolute path. Encrypted vault attachments use a temporary plaintext cache.
- Use the book control to switch the focused file to read mode. The pencil
  control returns to the default write mode.

## Panes

- Drag a tab over a pane body. Drop it on the left, right, top, or bottom target
  to create or rearrange panes, up to four. Drop it in the center or on empty
  space in that pane's tab strip to add it to that pane.
- Denote chooses the layout from the drop position: horizontal, vertical,
  four-pane grid, or a mirrored/rotated three-pane asymmetric arrangement.
- `Command-\` / `Ctrl-\` and the command palette remain keyboard alternatives
  for creating a pane.
- Click or focus a pane to make it the target for file selection, search,
  commands, history, links, and toolbar actions.
- Press `F6` / `Shift-F6` to focus the next or previous pane. Direct pane focus
  uses `Option-Command-1..4` on macOS or `Ctrl-Shift-1..4` elsewhere.
- Drag pane dividers or focus them and use arrow keys. Home resets the adjacent
  split.
- Close a pane with its close button or `Shift-Command-\` /
  `Ctrl-Shift-\`. Its tabs move into a neighboring pane without losing unsaved
  edits.
- Move a tab through its context menu. Each pane keeps independent tabs, groups,
  active file, and back/forward history.

## Organize a folder

The file-tree toolbar can create, rename, pin, reorder, bookmark, and trash
entries. Pinned files and folders stay above ordinary siblings. Up/down actions
customize order inside the pinned or unpinned section of the current folder.
Use `Command-N` / `Ctrl-N` for a new file. Right-click a folder, file, or empty
tree space for contextual creation. Entry menus also provide rename, move, and
trash actions. File menus additionally duplicate, bookmark, copy the absolute
path, open version history, open in a new tab, and reveal the file in Finder or
the platform file manager. The focused file exposes the same actions from the
three-dot menu. Switching files closes that menu.

Use the folder control beside New folder to expand every nested folder or
collapse the complete tree. Expand all leaves folders named `.git` and
`node_modules` collapsed unless you opened them directly.

Drag a file or folder onto another folder to move it there, or onto empty tree
space to move it to the vault root. Use **Move to folder…** from the context menu
for the keyboard-accessible equivalent. Denote then updates relative inline
links, images, and reference definitions in eligible Markdown files. It reports
large, unreadable, or conflicting files that could not be rewritten.

Drag the divider beside the file tree to resize the sidebar. Focus it and use
Left/Right arrows, or press Home to reset the default width.

## Mark projects and workspaces

Right-click empty tree space for the vault root, or an existing folder. **Mark as
project** makes that folder an explicit project root. **Mark as workspace**
treats each safe, real direct child folder as a separate implicit project. The
two marks are independent, so one folder can be a project, a workspace, or both.
Their separate unmark actions appear in the same menu.

From the keyboard, focus a folder and press Shift-F10 or the Context Menu key.
The command palette provides separate project and workspace commands for the
vault, selected folder, recorded roots, and unmark-all actions. Unavailable roots
remain removable there.

Nested content belongs to its workspace child project. Files directly in the
workspace container do not become an implicit project unless an explicit project
root also covers them. New direct child folders are discovered automatically.
You can still mark projects inside those children; the closest root to the
focused file wins. The active project appears in the status bar, while a blank
tab or file outside every project has none.

Workspace child projects keep stable local identities when renamed or moved
through Denote. Marking an implicit child as a project promotes it to explicit.
Unmarking the workspace removes implicit-only children but preserves explicit
children.

Folders deleted outside Denote remain as unavailable local project/workspace
metadata. Denote Trash clears affected metadata. Restoring a child under a
still-marked workspace causes Denote to discover it as a new implicit project.
All of this metadata stays in app-data SQLite; Denote does not add files or
markers to the vault.

If the vault root safely contains a `.git` file or directory and is not already
a root project or workspace, Denote shows a non-modal suggestion. **Mark as
project** accepts it. **No thanks** permanently dismisses it for that vault.
Manually marking the root as a project or workspace also dismisses it. Denote
never marks a Git repository automatically.

## Switch vaults

Use the sidebar vault switcher or `Shift-Command-O` / `Ctrl-Shift-O`. Denote
saves pending work, clears tabs and search state, and opens the selected folder.
An encrypted source vault is sealed before its in-memory key is discarded.
Non-current user vaults can be removed from the list or moved with all contents
to the operating system Trash.

Known vaults open from their cached file tree and become usable immediately.
Denote refreshes disk changes and search content in the background. A first-time
vault open can take longer because it creates that cache.

## Choose a welcome page

Add `.denote.md` at the vault root to open it automatically when the vault has no
tab session to restore. It remains an ordinary editable Markdown file, and its
links resolve normally from the vault root. No welcome file is generated for
user vaults.

To use another `.md`, `.markdown`, or `.mdx` file, open its file menu and choose
**Set as welcome page**. Choose **Use .denote.md/default** from a file menu to
clear that override. Moving or renaming the chosen file keeps the setting;
moving it to Denote Trash clears it.

An explicit file opened from cross-vault search and a saved tab session take
priority over the welcome page. If the welcome file is missing, unreadable, or
invalid, Denote reports the error and leaves the vault available without opening
another fallback page.

Press `Command-P` or `Ctrl-P` to open the command palette. Type a filename
directly, or choose **Find file across vaults**, to search every known available
vault. Selecting a file switches vaults when necessary and opens it. Encrypted
target vaults ask for an unlock before opening the pending result.

[Next: History, trash, and recovery](<History, trash, and recovery.md>)

#guide #files #vaults
