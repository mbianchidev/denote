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

The rich-text/source toggle is a global preference. Your last choice is used for
the next Markdown file and after restarting Denote. Files with unsupported rich
syntax and enabled editor display guides still use source mode for safety
without changing that preference.

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
