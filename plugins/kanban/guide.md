# Kanban boards

## Purpose

Create visual Kanban boards without replacing portable Markdown. Board titles,
columns, cards, note links, tags, and card details remain readable in any text
editor.

## Enablement and permissions

The plugin requests **Kanban board** permission. Denote sends only the current
matching `.kanban.md` or `.kanban.markdown` source to the isolated plugin worker.
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

Use **Add column** and **Add card** to build the board. Click the board, column,
or card title to edit it. Click a card's details to edit its Markdown without
moving focus back to the title. Relative links such as `[Design](Design.md)`
appear as note links, and hashtags such as `#planning` appear as tags. Choose a
note link to open it through Denote's normal safe link handling.

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

## Settings

This plugin has no settings.

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
