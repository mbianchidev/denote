# Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Open command palette | `Command-P` | `Ctrl-P` |
| Open settings | `Command-,` | `Ctrl-,` |
| Find file across vaults | Open the command palette and type a filename | Open the command palette and type a filename |
| Search current file or active PDF | `Command-F` | `Ctrl-F` |
| Create file | `Command-N` | `Ctrl-N` |
| Create blank tab | `Command-T` | `Ctrl-T` |
| Add editor pane | `Command-\` | `Ctrl-\` |
| Close focused pane | `Shift-Command-\` | `Ctrl-Shift-\` |
| Focus next / previous pane | `F6` / `Shift-F6` | `F6` / `Shift-F6` |
| Focus pane 1–4 | `Option-Command-1..4` | `Ctrl-Shift-1..4` |
| Find and replace | `Command-H` | `Ctrl-H` |
| Save now | `Command-S` | `Ctrl-S` |
| Paste without formatting | `Command-Shift-V` | `Ctrl-Shift-V` |
| Create or edit link | `Command-K` | `Ctrl-K` |
| Insert emoji (optional Emoji picker plugin) | `Command-Shift-E` | `Ctrl-Shift-E` |
| Close tab | `Command-W` | `Ctrl-W` |
| Increase editor text / zoom active PDF | `Command-+` | `Ctrl-+` |
| Decrease editor text / zoom active PDF | `Command--` | `Ctrl--` |
| Reset editor text / active PDF zoom | `Command-0` | `Ctrl-0` |
| Switch tabs | `Ctrl-Tab` | `Ctrl-Tab` |
| Previous tab | `Ctrl-Shift-Tab` | `Ctrl-Shift-Tab` |
| Move tab left/right | `Option-Shift-Left/Right` | `Alt-Shift-Left/Right` |
| Switch vault | `Shift-Command-O` | `Ctrl-Shift-O` |
| Open focused folder context menu for project/workspace actions | `Shift-F10` or Context Menu key | `Shift-F10` or Context Menu key |

The command palette lists assigned shortcuts beside their commands. Type a
command name, category, description, keyword, or filename; use Up/Down and
Enter to run the active result.

On macOS, the application, File, Edit, View, Window, and Help menus expose the
same core commands, including Settings, vault actions, search, pane controls,
editor text size, and tab/window closing.

The search shortcut keeps the active file in **Where to search** and focuses
**Search text**. Type `*` in the location field to search the vault or a pattern
such as `*.html` to limit file types.

When a PDF is active, the search shortcut focuses **Search this PDF** instead.
Enter moves to the next match, Shift-Enter moves to the previous match, and
Escape clears the PDF query. Every PDF toolbar control is reachable in visual
order with Tab and Shift-Tab. The password prompt traps focus until Unlock,
Cancel, or Escape.

`Escape` hides the document outline when it is open. Sidebar and pane dividers
use arrow keys and Home. File-tree context menus use arrow keys and
Escape. Press Escape then Tab to move focus out of a source/code editor when Tab
is configured to indent. Tab context menus expose bulk close, group, and
cross-pane actions.
Folder and root context menus include separate project and workspace marking.
Use the command palette for whole-vault actions and unavailable project/workspace
roots. Active-project changes, including workspace-discovered projects, are
visible in the status bar and announced to screen readers.
The source outline's code-minimap slider uses arrows for small moves, Page
Up/Down for viewport moves, and Home/End for the file boundaries.
The outline divider uses Left/Right, Shift for a larger step, Home for its
default width, and End for its maximum width.
All toolbar and dialog actions are keyboard reachable and use visible focus
indicators.

With the optional JSON and YAML viewer, Tab reaches the Structured/Raw group,
Collapse all, Expand all, and the tree. Inside the tree, Up/Down move through
visible entries; Left collapses or moves to the parent; Right expands or moves
to the first child; Home/End move to the first/last visible entry; and
Enter/Space toggles a container. Collapse restores focus to the nearest visible
ancestor, and status changes are announced politely.

[Next: Optional plugins](<Optional plugins.md>)

#guide #shortcuts
