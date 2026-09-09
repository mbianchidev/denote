# JSON and YAML viewer

## Purpose

JSON and YAML viewer adds a read-only Structured view for `.json`, `.yaml`, and
`.yml` files. It keeps Denote's ordinary source editor available as Raw view, so
comments, spacing, document separators, anchors, aliases, encoding, and line
endings remain exactly under your control.

## Enablement and permissions

The plugin is disabled by default and requests only **Structured viewer**. This
permission lets its isolated worker receive the current UTF-8 source for a
matching open tab and return a bounded declarative tree. Denote owns the
renderer, controls, keyboard behavior, file routing, and Raw source editor.

The plugin requests no workspace read or write permission, no network access,
no process execution, and no clipboard access. Its executable package is
downloaded only after you explicitly enable it.

## Usage

Open a JSON or YAML file and use the **Structured** / **Raw** control in the
editor toolbar. Structured view labels every row as an object, array, mapping,
sequence, string, number, boolean, null, scalar, or alias; color is only
supplementary.

The root and its immediate children are visible initially. Select a non-empty
container row to expand or collapse it. **Collapse all** leaves the root and
first-level rows visible. **Expand all** expands at most 5,000 containers in one
action and announces when the bound is reached.

Inside the tree:

- Up and Down move among visible rows.
- Left collapses the current container or moves to its parent.
- Right expands the current container or moves to its first child.
- Home and End move to the first and last visible row.
- Enter or Space toggles a non-empty container.

Parsing and source content stay local. YAML streams, anchors, and aliases are
shown structurally; aliases are references and are never recursively expanded.
Invalid or unsupported content reports a line and column when the parser
provides one. Switch to Raw at any time to inspect or fix the exact source.

## Settings

The plugin has no settings. Expansion state is kept only in the open tab. It is
not written into the file, shared with another file, or restored after the tab
is closed.

## Disable behavior

Disabling the plugin unregisters its viewer, terminates its worker, releases
parsed models and per-tab expansion state, and returns matching tabs to Denote's
ordinary source editor. It does not edit, reformat, save, or delete any vault
file. Denote also removes the downloaded package, cached archive, staging
content, and removal backups.

Closing a tab, switching or locking a vault, a plugin crash, an update, or
application teardown releases the same derived tree data. Locked encrypted
vaults never expose decrypted content to the plugin.

## Troubleshooting

- **Structured view unavailable**: read the reported location, switch to Raw,
  and correct the source. Raw access remains available for every error.
- **Size limit**: Structured parsing accepts up to 4 MiB of UTF-8 source, 100
  YAML documents, 50,000 emitted nodes, 128 levels, and 500 aliases. Larger or
  deeper files stay editable in Raw view.
- **Bounded view**: the source parsed safely, but the 50,000-node presentation
  limit omitted later rows. Raw view is complete.
- **Unsupported YAML tag**: custom and YAML 1.1-specific constructors are not
  executed. Use YAML 1.2 core scalars or inspect the original tag in Raw view.
- **Duplicate YAML key**: mapping keys must be unique. JSON duplicate names use
  the JavaScript parser's deterministic last-value result in Structured view;
  Raw still shows every original token.
- If the viewer stops responding, disable and re-enable the plugin. Denote
  removes a crashed package automatically without changing open files.

The plugin bundles `yaml` 2.9.0 under the ISC license. It uses the YAML 1.2 core
schema with merge keys, known YAML 1.1 tags, and custom tags disabled. No parser
component loads schemas, scripts, constructors, or content from the network.

## Licenses and notices

The JSON and YAML viewer plugin is available under the MIT license. Its bundled
`yaml` dependency is available under the following ISC license:

Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
