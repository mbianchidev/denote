# Kanban boards

## Purpose

Create visual Kanban boards without replacing portable Markdown. Board titles,
columns, cards, note links, tags, and card details remain readable in any text
editor.

## Enablement and permissions

The plugin requests **Kanban board** permission. Denote sends only the current
matching `.kanban.md` or `.kanban.markdown` source, or an ordinary Markdown file
with an explicit native or Obsidian board marker, to the isolated plugin worker.
The worker returns a bounded declarative board model and rewritten Markdown only
after you use a board control. It receives no vault path, DOM access, network
access, process access, encryption key, or general workspace read/write access.

Enabling the plugin never changes a file.

## Usage

Create a file whose name ends in `.kanban.md` or `.kanban.markdown`, or run
**Create Kanban board** from the command palette. Open the file and choose
**Board**.

An empty or ordinary Markdown file first shows **Initialize board**. Initialization
appends the managed board after any existing content instead of replacing it.
The default board starts with one Backlog column.

### Existing Obsidian boards

In Denote 0.8.2 or newer, Kanban 0.1.4 reads ordinary `.md` and `.markdown`
files with `kanban-plugin: board` frontmatter without renaming or rewriting
them. Escaped exports with `\---`, `\##`, `\- \[x]`, and encoded tab indentation
also open directly. **Legacy Kanban board** is read-only: checked states, note
links, tags, dates, and multiline card text remain available. Choose card
details to show the full text without opening an editor.

Choose **Migrate to native**, then confirm. Migration converts the open file in
place, preserving column/card order, checked states, links, and full card text.
Long card titles use a bounded preview; the complete item stays in its details.
The untouched original source, including Obsidian settings and any other
Markdown, remains in a fenced **Legacy Kanban source (recovery)** block below
the native board. That copy is not used by Board view.
Its newline marker preserves the original end-of-file newline state.

Migration is never automatic. Cancel leaves the source unchanged. If the file
changes or becomes read-only before migration completes, Denote rejects the
result. Use revision history or the recovery block to restore the original
source. Migration is refused if the new board plus recovery copy exceed 4 MiB.
Obsidian colors, collapsed-list settings, and other display preferences are
retained for recovery but are not applied in Denote.

### Native boards

Use **Add column** and **Add card** to build the board. Click the board, column,
or card title to edit it. Click a card's details to edit its Markdown without
moving focus back to the title. Relative links such as `[Design](Design.md)`
appear as note links, and hashtags such as `#planning` appear as tags. Choose a
note link to open it through Denote's normal safe link handling.

Collapsed cards show at most five wrapped detail lines and display **More…**
when content continues. Markdown links render in their original position.
Choosing a link opens it without opening the card editor; click the title or
another part of the details area to edit the complete Markdown.

Drag a column or card to reorder it or move a card between columns. The grip is
also the complete keyboard alternative: focus it, press Space, use Left/Right
for columns or any arrow key for cards, then press Space again to drop. Home and
End move to the first or last position, and Escape cancels.

The Markdown representation is:

```markdown
<!-- denote-kanban:board:v1:start -->
# Release board

<!-- denote-kanban:column:start id="column-example" -->
## Backlog

<!-- denote-kanban:card:start id="card-example" -->
### Write the specification

See [Specification](Specification.md). #planning
<!-- denote-kanban:card:end -->

<!-- denote-kanban:column:end -->
<!-- denote-kanban:board:end -->
```

Denote changes only the explicit board, column, card, and heading ranges.
Reordering moves the original marked block byte-for-byte. Markdown outside the
board and unrecognized Markdown inside a moved card or column remains unchanged.
Editing a card replaces only that card's title and details.
Imported cards also have a completion checkbox. Changing it updates only the
card marker's `completed="true"` or `completed="false"` attribute; moving or
editing the card preserves its checked state. Cards without that optional
attribute keep the original checkbox-free presentation.

## Settings

This plugin has no settings. Legacy Obsidian settings are preserved as source,
not executed or imported as Denote preferences.

## Disable behavior

Disabling removes the Board view and deletes the downloaded plugin package.
Board files remain untouched and continue to open as Markdown.

## Troubleshooting

If Board view reports malformed markers, switch to **Markdown** and restore the
missing matching end marker shown in the error. Marker IDs must be unique.

Reserved `denote-kanban` marker lines cannot be placed inside card details. Use
ordinary Markdown comments with another name instead.

Files larger than 4 MiB, card details larger than 64 KiB, more than 128 columns,
or more than 5,000 cards remain editable as Markdown but are not rendered as a
board.
