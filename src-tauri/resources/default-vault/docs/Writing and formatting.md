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

Long documents scroll directly in the editor; you do not need to move the caret
to reveal content below the current viewport.

The rich-text/source toggle is a global preference. Your last choice is used for
the next Markdown file and after restarting Denote. Files with unsupported rich
syntax and enabled editor display guides still use source mode for safety
without changing that preference.

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

HTTP, HTTPS, email, and telephone links open in the operating system's default
browser or handler. Denote never becomes a web browser. Use Command-click or
Control-click to follow relative vault links while editing.

[Next: Search and replace](<Search and replace.md>)
