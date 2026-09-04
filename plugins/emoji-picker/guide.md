# Emoji picker

## Purpose

Insert standard Unicode emoji without leaving Denote. The independently installed
package supplies English names, keywords, shortcodes, categories, skin tones, and
other standard variants. Denote renders the picker, searches the bundled data,
and inserts plain Unicode through the focused editor's normal editing and undo
flow. Your notes need no plugin-specific markup.

## Enablement and permissions

Requires Denote 0.1.3 or newer and plugin API 1 with the Emoji picker capability.
Older hosts without that capability reject the package. Open **Settings → Plugins**,
choose **Emoji picker**, review its single **Emoji picker** permission, and
enable it. Denote downloads and verifies the package before starting it.

The permission registers a static catalog, not executable editor UI. Enabling
does not edit notes. The plugin never receives your search queries, note text,
selection, editor objects, or vault paths. It requests no network, workspace,
process, clipboard, or commands permission, and depends on no other plugin.
After installation, emoji data and all picker operations stay local; there are
no runtime downloads, remote images, fonts, analytics, or accounts.

## Usage

The picker supports editable Markdown notes (`.md` and `.markdown`) in both
**Rich** and **Source** modes, including project Markdown in Source mode. Other
file types, including arbitrary plain-text and source-code files, are not supported.

- Focus an editable Markdown note and press **Mod+Shift+E**: **Command+Shift+E** on
  macOS or **Control+Shift+E** on Windows and Linux.
- Alternatively use **Emoji picker** in the editor toolbar or the **Emoji picker**
  command in Denote's command palette.
- Search by name, category, keyword, or shortcode. Try `smile`, `family`,
  `rainbow_flag`, or `+1`. You can type a category such as `food & drink` into
  search or browse the category controls.
- Choose an emoji or one of its variants. Denote inserts the exact Unicode
  sequence, including any required joiners, variation selectors, or modifiers.
  Use the editor's normal Undo to reverse an insertion.
- With **Shortcode suggestions** enabled, type a colon followed by at least two
  shortcode characters, such as `:sm` or `:+1`, and choose a suggestion.
  Suggestions do not appear in inline code, fenced code blocks, or while
  composing with an input method (IME). Existing text is never converted in bulk.
- Use the picker's recent and favorite sections to revisit selections. Choose a
  preferred skin tone where that emoji supports it; mixed-tone, hair, gender, and
  direction variants remain explicit choices.
- Use the keyboard to navigate the host's controls and **Escape** to dismiss the
  picker or suggestions without inserting anything.

The picker is unavailable while the vault is locked, while the focused document
is read-only, or when there is no supported editable Markdown selection. It does not
bypass editor safety checks.

## Settings

Open **Settings → Plugins → Emoji picker**:

- **Shortcode suggestions** (`autocomplete`): enabled by default. Turn it off to
  stop colon suggestions; the toolbar, shortcut, and command picker still work.
- **Recent emoji** (`recents`): a local JSON array, initially `[]`, maintained by
  Denote. Set it to `[]` to clear recent selections.
- **Favorite emoji** (`favorites`): a local JSON array, initially `[]`, maintained
  by Denote. Set it to `[]` to clear favorites.
- **Preferred skin tone** (`tone`): `0` (default emoji), `1` (light),
  `2` (medium-light), `3` (medium), `4` (medium-dark), or `5` (dark).

These are plugin-scoped application settings, not files inside your vault.
Denote owns preference reads and writes for the picker; the plugin reads only
the autocomplete option during activation. Recent selections, favorites, and
skin-tone changes made in the picker persist immediately without a restart.
Explicit edits in **Settings → Plugins** use Denote's normal plugin restart.
Settings can also be reset or imported and exported through Denote's existing
versioned settings controls; applying a reset or import uses that same restart.

## Disable behavior

Disabling removes the picker registration and suggestions, stops the worker,
and deletes the downloaded package, cached archive, staging content, and removal
backups. Already inserted emoji stay as ordinary Unicode in your notes. No note
is edited or deleted. Local preferences remain separate from package code; use
the settings reset or the fields above to clear them before disabling.

## Troubleshooting

- If no picker is available, check that the plugin is enabled, Denote is at least
  0.1.3 with the Emoji picker capability, the vault is unlocked, and the focused
  document is an editable `.md` or `.markdown` note in Rich or Source mode.
- If suggestions are absent, check **Shortcode suggestions** and type at least
  two shortcode characters after the colon in ordinary Markdown text. Suggestions
  stay hidden in inline/fenced code and during IME composition. **Escape**
  dismisses suggestions without inserting anything.
- Search uses bundled English names, categories, keywords, and shortcodes.
  Emoji appearance depends on your operating system's fonts. Newer emoji can
  appear as missing glyphs on an older system even though the saved Unicode
  sequence is correct.
- If activation fails, Denote rolls back the registration and removes the failed
  package. Re-enable it from Settings to reinstall; disabling never removes notes.

## Data source and reproducibility

This snapshot uses [Emojibase data 17.0.0](https://www.npmjs.com/package/emojibase-data/v/17.0.0)
from [milesj/emojibase](https://github.com/milesj/emojibase), with its English
CLDR-derived names, keywords, categories, and GitHub/Emojibase shortcodes.
Sequences are taken from the fully-qualified records in
[Unicode Emoji 17.0](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt).
The package contains 1,914 base entries covering all 3,944 fully-qualified
sequences, excluding standalone components. Skin tones are grouped under their
base entries, including mixed-tone sequences. Gender, hair, and direction
alternatives link only to other actual standard entries, never synthesized emoji.
Entries remain in upstream CLDR display order.

The source tree's `data/upstream.json` records every exact source URL, version,
byte count, and SHA-256 digest, plus the upstream license digests.
`data/snapshot.json` records generated-data and full-sequence-set digests.
`src/emoji.json` is minimized JSON bundled directly into the isolated worker
entrypoint; only data and the small SDK registration module ship as code.

From the repository root, using its supported Node.js version:

```bash
node packages/plugins/denote.emoji-picker/scripts/import-emoji.mjs
node packages/plugins/denote.emoji-picker/scripts/import-emoji.mjs --check
npx vitest run packages/plugins/denote.emoji-picker/tests
npm run build:plugin -- denote.emoji-picker
```

The importer alone fetches the five pinned public inputs, in memory, verifies
their exact sizes and SHA-256 digests, and checks full Unicode coverage and
contract bounds before writing the two generated JSON files. `--check` compares
the result without writing. It preserves required variation selectors, uses
stable hexadecimal IDs, removes bare components, adds ASCII aliases derived from
CLDR names, deduplicates aliases, and omits aliases outside the host's ASCII/length
limits. Mixed-tone variants do not
pretend to have a single preferred tone. There are no npm data dependencies or
package lifecycle scripts. Unit tests are offline; importing upstream data is
an explicit maintainer task, never an installation or runtime step.

The complete upstream notices below are intentionally included in this guide,
which Denote includes in every downloadable archive. The source-only `legal/`
copies are checksum-verified by the importer and tests.

## Licenses and notices

Plugin implementation: Copyright (c) 2026 Matteo Bianchi, under the MIT terms
below. Emojibase data is MIT-licensed. Unicode data and CLDR-derived annotations
are provided under Unicode License V3.

### Emojibase — MIT

```text
MIT License

Copyright (c) 2017-2019 Miles Johnson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Unicode

Emoji test data: © 2025 Unicode®, Inc.
Unicode and the Unicode Logo are registered trademarks of Unicode, Inc. in the
U.S. and other countries. For terms of use, see
<https://www.unicode.org/terms_of_use.html>.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
