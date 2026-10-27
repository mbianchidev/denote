# Text highlighting and coloring

## Purpose

Apply accessible named highlights and foreground colors without converting a
note to HTML or a proprietary format. The plugin is optional and off by default.

## Enablement and permissions

Enable Text highlighting and coloring in Settings → Plugins. Text styling
permission allows bounded Markdown parsing and explicit selection formatting.
The host owns controls, rendering, saves, and search. The worker has no DOM,
filesystem, network, clipboard, or encryption-key access.

## Usage

Select plain text in Markdown Rich or Source mode and choose Text style, or
press Command-Shift-H on macOS / Ctrl-Shift-H on Windows and Linux. Choose
Highlight or Text color, a named color, and Apply style.

The explicit, case-sensitive extension is:

```markdown
=red=Highlighted text=red=
=blue:text=Colored text=blue:text=
```

Yellow, red, green, blue, and purple are supported. Both delimiters must use the
same name and kind. Text remains readable as literal Markdown without this
extension. A style covers plain text on one line, at most 4 KiB. Nesting, code,
frontmatter, and selections crossing Markdown structure are refused rather than
rewritten. Use Source when a Rich selection cannot be mapped unambiguously.

Source always shows complete delimiters. Styled excerpts offers Show and Clear
for existing spans. Clearing removes only that span's delimiters. Opening a
palette or switching views never edits a note.

Search → Filters → Notes with highlights filters saved Markdown notes. With an
empty query, every indexed highlighted excerpt has its own navigable result.
Foreground-only colors do not count as highlights. Ordinary full-text search
continues to find the underlying text.

Every supplied foreground/background pair meets WCAG AA 4.5:1 in both themes.
Color controls have written names, styles have tooltips, and foreground styles
are underlined. Keep meaning in words, not color alone. Forced colors use system
text, canvas, and borders.

## Settings

There are no persistent plugin settings. Palette choices are local to the open
editor. Sources are limited to 4 MiB and render models to 2,000 spans.
Highlight search shares bounded Markdown snapshots: 5,000 notes, 256 KiB per
note, and 8 MiB total, with 128 excerpts per note and 10,000 total. Omitted input
and output are reported. Unchanged saved sources are reused.

## Disable behavior

Disabling stops the worker and removes downloaded code, controls, and derived
search metadata. It never rewrites notes or removes delimiters or text. Vault
lock/switch and application teardown release source snapshots and models.

## Troubleshooting

For an ambiguous selection, select a smaller plain-text range in Source.
For unsupported or mismatched delimiters, correct the source explicitly; no
automatic repair occurs. Oversized notes remain available in the core editor.
Search uses saved notes, so finish saving before expecting a new excerpt.
