# Note graph

## Purpose

Note graph shows how Markdown notes in the current vault connect to one another.
It builds a local, in-memory graph from ordinary Markdown links and never adds
graph metadata to a note.

## Enablement and permissions

The plugin requests only **Note graph** permission. Denote sends the isolated
plugin worker bounded vault-relative paths, note titles, tags, and Markdown
source. The worker has no absolute vault path, DOM access, network access,
process access, encryption key, or workspace write capability. All indexing and
queries stay on the device, and enabling the plugin does not change a file.

The host accepts at most 1 MiB of source per document, 16 MiB per index request,
and 10,000 notes. If a vault exceeds a host bound, Denote prioritizes the active
and open notes and reports that the graph is incomplete.

## Usage

Open **Note graph** from the activity rail after enabling the plugin.

**Global** mode ranks all matching notes by their total incoming and outgoing
connections. **Local** mode starts at the active note and follows incoming and
outgoing connections as an undirected neighborhood. Choose depth 1, 2, or 3 to
control how many connection steps are included.

Use the folder, tag, and connection filters together:

- **All folders** does not restrict paths. **Vault root** means only notes whose
  path has no folder. Any other folder includes notes whose path starts with
  that `folder/` prefix, including nested folders.
- Tag matching is exact after case and a leading `#` are normalized.
- **Orphans only** shows notes with no incoming or outgoing connection.
  **Connected only** excludes those notes.

Choose a node in the visual graph to open that note through Denote's normal
navigation. The visual graph is pointer-operated. Its complete keyboard
equivalent is **Show keyboard note list**: use the search field to filter the
visible result, Arrow Up and Arrow Down to move, Home and End to jump, and Enter
or Space to open the focused note. The list also states each note's backlink and
outgoing-link counts.

The worker reparses only documents supplied by Denote as changed. Removed paths
are deleted from the in-memory index. Link targets are resolved against the
current path set at query time, so adding or removing a target can fix or remove
an older note's connection without reparsing that unchanged source note.

Inline links and full, collapsed, or shortcut reference links are supported.
Root-relative and note-relative paths, percent-encoded paths, and extensionless
links to `.md` or `.markdown` files are resolved. Exact path case wins; a
case-insensitive fallback is used only when it identifies one unique note.
Images, web and protocol links, fragment-only links, self-links, malformed
percent encoding, and paths that escape the vault are ignored. Legacy
destinations containing bare spaces are recognized outside code, HTML, and
frontmatter; prefer portable Markdown such as
`[Plan](<Project Plan.md>)`.

Each note contributes at most 128 local link occurrences. Repeated links between
the same pair of notes become one edge. The host renders at most 500 nodes and
2,000 edges per query; counts continue to describe the complete indexed graph,
and notices identify omitted content.

## Settings

This plugin has no settings. Scope, presentation, folder, tag, orphan, and depth
controls are temporary view filters.

## Disable behavior

Disabling removes the Note graph view, stops the worker, discards its in-memory
index, and deletes the downloaded plugin package. Markdown notes and their links
remain untouched.

## Troubleshooting

If a connection is missing, check that the destination stays inside the vault,
uses valid percent encoding, and resolves to one uniquely cased path. When two
notes differ only by case, use the target's exact case. For a path with spaces,
use angle brackets or percent encoding.

A notice reports notes that could not be parsed, links omitted after the
128-link per-note bound, host indexing limits, or the 500-node and 2,000-edge
rendering limits. Simplify an unusually dense note or narrow the folder, tag,
or local-depth filters when the view is truncated.

`mdast-util-from-markdown` parses Markdown inside the worker. It is distributed
under the MIT license.

## Licenses and notices

The Note graph plugin and its bundled `mdast-util-from-markdown` dependency are
available under the MIT license:

Copyright (c) Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
