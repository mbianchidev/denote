# Markdown presentation slides

## Purpose

Author and present ordinary Markdown decks stored in one file. The optional
plugin is off by default. Standalone `---` and `===` lines are slide separators
only after you choose Open as presentation; ordinary notes keep thematic breaks
and Setext headings.

## Enablement and permissions

Enable Markdown presentation slides in Settings → Plugins. Presentation
permission allows bounded source parsing and explicit slide reordering. The
worker returns positions and validated defaults, not HTML, scripts, styles,
filesystem access, timers, or encryption keys.

## Usage

Open a Markdown note and choose Open as presentation, or Command-Option-P on
macOS / Ctrl-Alt-P on Windows and Linux. Source and preview share the same
in-memory file. Moving the source caret selects its slide; preview navigation
reveals the matching source. Edits use ordinary autosave, revision history, and
conflict checks.

```markdown
# Example deck

A small Markdown presentation.

---

## Formatting

Use *emphasis* and **bold** text.

---

## Last slide

Use `---` to separate slides.
```

Optional opening YAML frontmatter configures the presentation:

```markdown
---
title: Synthetic deck
author: Example team
presentation:
  theme: dark
  aspect-ratio: "16:9"
  alignment: left
  slide-numbers: true
  autoplay: false
  advance-seconds: 10
  loop: false
  transition: none
---
# First slide

---

# Second slide
```

Only a line containing exactly `---` or `===` is a separator. An opening
`---` frontmatter block is metadata, not a slide; fenced-code contents are not
split. Empty slides and unclosed fences produce non-blocking feedback.
Overview navigates slides and offers Earlier/Later reorder actions by pointer
or keyboard. Reordering preserves frontmatter, unknown fields, slide slices,
and separator bytes, adding only a missing boundary newline when necessary.

Present enters full screen. Arrows, Page Up/Down, Home, and End navigate.
Space on the slide toggles playback, P pauses, and Escape exits. Native buttons
remain keyboard operable. Play, Pause, Restart, Stop, Advance seconds, Loop,
and a visible countdown remain available. Frontmatter autoplay starts only
after an explicit Present action; opening authoring mode never starts it.
Where the webview lacks element fullscreen, the trusted host uses its native
window with a modal focus boundary and restores the previous window state.

Playback uses absolute monotonic deadlines instead of chained relative delays.
Late ticks catch up without accumulating drift. Manual navigation resets the
deadline. Changing interval or loop pauses playback. Hidden windows, lost
focus, inactive panes, source edits, exiting full screen, closing the deck,
and plugin withdrawal pause it; no automatic resume occurs.

## Settings

Frontmatter accepts title and author as single lines of at most 200 UTF-8 bytes.
The presentation mapping accepts theme system/dark/light, aspect-ratio 16:9,
4:3, or 16:10, alignment left/center/right, boolean slide-numbers/autoplay/loop,
advance-seconds from 1 to 3600, and transition none/fade. Defaults are system,
16:9, left, true/false/false, 10 seconds, and none. Invalid fields identify the
correction and use safe defaults. Invalid YAML, aliases, custom tags, duplicate
keys, or non-mapping metadata leave Source available and use safe defaults.
Metadata is never rewritten to apply defaults.

Limits are 4 MiB source, 256 slides, 64 KiB frontmatter, 5,000 YAML nodes,
64 levels, and 32 notices. The ordinary host renderer provides headings, lists,
tasks, quotes, tables, links, local/remote image policy, code highlighting, and
callouts. Enabled Mermaid renderers may render their own fences; no plugin is
required for ordinary code. Unsafe HTML is not executed. Links keep Denote's
existing review flow. Themes remain accessible, forced colors use system
colors, and reduced motion disables the optional fade.

## Disable behavior

Return to note restores ordinary Markdown without rewriting it. Disabling or
removing the plugin stops its worker, exits presentation, clears timers,
listeners and derived previews, and removes downloaded code. The original
Markdown, separators, frontmatter, and unknown fields stay on disk. Locked
vaults expose no deck content; unlock uses the normal host read boundary.

## Troubleshooting

Correct frontmatter in Source when a notice names an invalid field. Split an
oversized deck into smaller Markdown files. Full-screen failures are reported;
the authoring preview remains available. Correct the source or retry after a
stale reorder rather than applying an old slide order to a changed deck.
