# Writing and formatting

#guide #markdown

Markdown files use a rich single-pane editor. Files containing MDX, raw HTML,
footnotes, math, or reference definitions stay in source mode so Denote cannot
silently rewrite unsupported syntax.

## Common Markdown

```markdown
# Heading

**Bold**, *italic*, `inline code`, and [a link](https://example.com).

- Bullet
- [ ] Task

> Quoted text
```

Use the toolbar for headings, emphasis, lists, links, images, tables, code
blocks, thematic breaks, frontmatter, and callouts.

Generated tables of contents using exact `<!-- toc -->` and `<!-- /toc -->`
marker lines render as labeled navigation panels in Rich mode. Every item must
be a link; nested link-only lists are supported. Denote preserves those markers
after Rich edits and when switching to Source. Other HTML comments remain
locked to source mode. A line containing `---` renders as a full-width thematic
separator.

Regular `.md` files follow standard Markdown rules for angle brackets. Text such
as `<100k`, `<3`, and `<account-slug>` remains literal instead of being parsed as
JSX. `.mdx` and `.jsx` open as non-executing JSX-highlighted source files.

Press `Command-K` on macOS or `Ctrl-K` on Windows and Linux to create a link.
Rich mode opens the link dialog and preserves highlighted text as the anchor.
Source mode wraps highlighted text as `[text]()` or inserts `[]()` with the
caret ready for the label.

Long documents scroll directly in the editor; you do not need to move the caret
to reveal content below the current viewport.

Each vault remembers one rich-text/source choice for all of its Markdown files
and restores it after restarting Denote. Your most recent choice is the default
for vaults without a saved preference. Files with unsupported rich syntax and
enabled editor display guides still use source mode for safety without changing
the vault choice.

Programming and markup files outside Markdown use the source editor. Recognized
extensions such as `.js`, `.ts`, `.py`, `.rs`, `.json`, and many others load
CodeMirror syntax highlighting automatically.

Rich fenced blocks support common aliases and languages including `js`,
`javascript`, `ts`, `typescript`, `php`, `java`, C/C++, C#, Go, Python, Ruby,
Kotlin, Swift, Scala, shells, HTML/XML, CSS/SCSS/LESS, JSON, YAML, TOML, SQL,
Markdown, and Dockerfiles.

Fenced code blocks in rich mode include an inline **Copy** button. It copies the
live code block text, including edits made inside the block.

## Tags

Write a hashtag such as `#guide`, `#project/atlas`, or `#研究`. Rich mode renders
it as a colored pill while the Markdown source stays unchanged. Every occurrence
of the same tag uses one color across the current vault. Use the palette control
beside a tag in the document tag bar to choose a different color.

Tags inside inline or fenced code stay literal. Prefix a hashtag with `\` when
you want literal text instead of a tag; notes using escaped hashtags open in
source mode so Denote preserves the escape exactly.

## Callouts

```markdown
>![info]
> Helpful context.

>![warning]
> Something needs attention.

>![danger]
> A destructive action is nearby.
```

## Images and links

Paste or insert an image to save it beside the note in an `assets` folder.
Relative image paths stay portable.

Links without a protocol open inside the vault relative to the current note.
`Optional plugins.md` means a file in the same folder;
`../assets/orbit.svg` moves up one folder and opens the image.
Append a heading fragment to navigate inside a file:
`Welcome.md#what-is-denote`. A fragment such as `#images-and-links` navigates
within the current file.

HTTP and HTTPS links open in the operating system browser after confirmation for
an unknown domain. Choose **Allow domain** or **Allow all external domains**;
manage permissions later in **Settings**. Email, telephone, hostless local file,
and confirmed custom application protocols use their operating system handlers.
Remote file hosts are blocked.

When the active file contains web links, choose **Open all external links** in
the editor toolbar or command palette. Denote deduplicates destinations, opens
trusted domains in order, and pauses at each unknown domain until you allow or
cancel the remaining queue.

Renaming or moving a file/folder updates relative inline links, images, and
reference definitions in eligible Markdown files.

If Markdown parsing fails, the error banner identifies the line and column.
Denote opens source mode without changing the vault preference, highlights the
line and character, and provides **Navigate to error**. The error stays with that
file, hides while another file is active, and clears when fixed or dismissed.
Link-navigation errors fade automatically.

[Next: Search and replace](<Search and replace.md>)
