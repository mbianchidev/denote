---
name: Denote
description: A restrained file-native writing workbench for long sessions.
colors:
  graphite-deep: "#121315"
  graphite-rail: "#17191c"
  graphite-sidebar: "#1b1d20"
  graphite-panel: "#202327"
  graphite-border: "#30343a"
  paper-ink: "#e8e5de"
  muted-ink: "#aaa9a2"
  moss-accent: "#9fbe85"
  moss-bright: "#b1cf98"
  danger: "#e28b86"
  light-paper: "#f8f6f1"
  light-sidebar: "#e8e5de"
  light-moss: "#537642"
  light-moss-strong: "#3f6132"
  light-secondary-ink: "#51554d"
  light-tertiary-ink: "#585b53"
  light-warning: "#6f4a00"
  dialog-scrim: "rgba(8, 9, 10, 0.66)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "2rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 680
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.72
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    lineHeight: 1.2
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  sidebar-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.3
  supporting:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  empty-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
  brand-mark:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1
  dialog-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
  welcome-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.18
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, sans-serif"
    fontSize: "1.48rem"
    fontWeight: 680
    lineHeight: 1.3
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "0.88em"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  micro: "3px"
  mark-tight: "7px 3px 7px 3px"
  tight: "4px"
  control: "5px"
  dialog: "8px"
  brand: "12px 5px 12px 5px"
  pill: "999px"
spacing:
  compact: "4px"
  control: "8px"
  panel: "14px"
  document-top: "52px"
components:
  button-primary:
    backgroundColor: "{colors.moss-accent}"
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    size: "30px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  input-search:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.control}"
    height: "36px"
  chip-tag:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.moss-bright}"
    rounded: "999px"
    padding: "3px 7px"
---

# Design system: Denote

## Overview

**Creative North Star: "The Quiet Workbench"**

Denote should feel like a dependable desktop tool that has receded around the
document. The interface borrows the density and familiar topology of code and
knowledge tools, then removes the visual noise that interrupts long writing
sessions. Structure comes from tonal layers, fine dividers, and selected-state
contrast rather than decorative containers.

The product is dark by default because it is designed for sustained focus, with
a complete light counterpart rather than a partially inverted afterthought.
The file tree and per-pane tabs stay compact; the document keeps generous
measure and vertical breathing room.

**Key Characteristics:**

- Restrained graphite surfaces with one muted moss accent.
- Dense, familiar workspace chrome around a calm reading column.
- Small radii and one-pixel structure instead of card-heavy composition.
- State motion only; no decorative page-load choreography.

## Colors

The palette is a cool graphite workbench softened by paper ink and a
low-saturation moss accent.

### Primary

- **Workbench Moss:** Current selection, primary action, keyboard focus, and
  durable brand mark.
- **Bright Moss:** Link text and high-emphasis active states on dark surfaces.

### Secondary

- **Measured Danger:** Destructive actions and recoverable error messages only.

### Neutral

- **Deep Graphite:** Application canvas and deepest surface.
- **Rail Graphite:** Activity rail, tabs, and status bar.
- **Sidebar Graphite:** Navigation and file-management surface.
- **Raised Graphite:** Toolbars, hover states, fields, and secondary panels.
- **Paper Ink:** Primary text on dark surfaces.
- **Muted Ink:** Secondary labels, paths, metadata, and placeholders.
- **Light Paper / Light Sidebar:** The light-mode writing and navigation pair.

**The One Accent Rule.** Moss indicates action, selection, or navigation state;
it is not scattered as decoration.

## Typography

**Display Font:** Native system sans
**Body Font:** Native system sans
**Label/Mono Font:** Platform monospace only for code and measurements

**Character:** Familiar desktop typography keeps the interface trustworthy
across macOS, Windows, and Linux. Weight and spacing carry hierarchy without a
separate display face.

### Hierarchy

- **Headline:** Strong document heading with compact tracking and no decorative
  treatment.
- **Title:** Section and empty-state headings.
- **Body:** Comfortable reading copy constrained to an approximately 820px
  editor column.
- **Label:** Compact workspace labels; uppercase is reserved for short category
  markers such as `VAULT` and `OUTLINE`.

**The Native Voice Rule.** UI labels use the system family; monospace never
costumes ordinary controls as technical.

## Layout

The desktop workspace uses a fixed 48px activity rail, a user-resizable vault
sidebar that defaults to 272px, a five-pixel divider target, and a flexible
one-to-four-pane editor grid. Pane dividers are pointer- and keyboard-resizable.
The focused pane may add a 218px outline panel. Below 1100px, the outline drops
and the document padding tightens; below 860px, the rail contracts.

Chrome uses compact 24–42px rows. Document content has substantially more
vertical space than surrounding controls. The writing column remains centered
and does not become a card.

## Elevation & Depth

Denote is flat by default. Tonal layers and one-pixel borders establish
workspace depth. Shadows appear only where a surface genuinely floats: dialogs,
the brand mark, and isolated image previews.

### Shadow Vocabulary

- **Floating Surface:** A soft downward shadow for dialogs and standalone image
  previews.

**The Flat Workbench Rule.** Navigation and editor panels never use decorative
shadows to simulate hierarchy already expressed by layout.

## Shapes

Most controls use tight 4–5px corners. Dialogs use 8px corners. The Denote mark
uses an asymmetric 12px/5px corner signature so the identity remains visible
without changing standard control geometry.

Borders are one pixel. Pills are reserved for tags, where the silhouette carries
semantic meaning.

## Components

### Buttons

- **Shape:** Compact and gently squared (5px).
- **Primary:** Moss fill with deep graphite text and 10px/16px padding.
- **Hover / Focus:** Slightly brighter moss; keyboard focus is a two-pixel ring.
- **Ghost:** Transparent at rest, raised graphite on hover.
- **Danger:** Reserved for permanent deletion confirmations.

### Chips

- **Style:** Compact pill with a low-dose tint of its assigned tag color, normal
  document ink, and a one-pixel color-derived border. Custom color never replaces
  the theme surface or text tokens, preserving contrast in both themes.
- **State:** Used for tags and filters, never as a generic container. A tag keeps
  one stable color throughout a vault, and the document tag bar exposes a
  keyboard-focusable native color picker. In the editor, pills are reserved for
  a tag-only final line.

### Inputs / Fields

- **Style:** Deep graphite field, one-pixel strong border, 5px radius.
- **Focus:** Moss border plus a one-pixel outer emphasis.
- **Error / Disabled:** Error uses measured danger; disabled state remains
  visible but clearly recedes.

### Navigation

The activity rail is icon-led and uses an active indicator on the leading edge.
File rows, tabs, and outline entries share compact hover and selected states.
Each pane owns a compact tab row. Tabs use the editor surface plus a two-pixel
moss top edge when active.
Tabs support pointer-driven ordering with a quiet full-outline drop target and a
keyboard equivalent; reordering never changes the underlying file tree.
The row ends with one small plus control. File selection replaces the active tab
in the focused pane; the plus control or Command-T creates the explicit empty
slot needed for another open document. Named tab groups use a compact labeled
header, disclosure icon, and count rather than a separate panel. Collapsing a
group preserves access to its active tab. The tab context menu keeps group,
cross-pane move, and bulk close commands in one keyboard-operable surface.
Global pane controls add or close panes and select only layouts valid for the
current pane count. Focused-pane contrast stays quiet but visible, and separator
focus uses the normal two-pixel moss ring. Back and forward arrows act on the
focused pane's active tab history, remain disabled when no destination exists,
and never look like global application history.
Pinned tree entries use a compact pin marker and remain above ordinary siblings.
Right-click creation uses a compact two-action native-style menu adjacent to the
file-tree target. Entry menus extend that surface with rename, move, and trash.
Dragging an entry highlights folder or root drop targets; the menu move action
preserves a keyboard path. The sidebar divider is visually one pixel but keeps a
larger pointer target and exposes arrow-key resizing.
The vault switcher is a compact recent-folder list with clear current and
unavailable states; adding a new folder remains a separate native-picker action.
Vault removal is a two-step inline confirmation. Removing only metadata is
separate from the explicit, danger-styled option to move the folder to system
Trash.

The command palette is one searchable listbox for commands and filenames. Command
rows lead with a command mark, keep category and description quiet, and align an
assigned shortcut on the trailing edge. File rows lead with the filename, keep
vault identity visible, and relegate the relative path to quiet metadata. Arrow
keys skip unavailable commands; Enter runs or opens the active result. A
file-only scope remains available without opening a second dialog.

Vault search separates **Where to search** from search text. The location field
uses compact helper copy for `*`, exact paths, and globs such as `*.html`.
**Filters** is an ordinary disclosure button with visible state and a contained,
scrollable form for tags, types, recency, bookmarks, filename, path, and content.
Command-F / Control-F selects the active file path so typing immediately replaces
the scope rather than editing it character by character.

External web navigation uses a compact confirmation dialog that states the exact
domain and full destination. The primary choices are explicit: allow that domain
or allow all external domains. Settings show exact trusted domains as removable
rows, or one `*` row when wildcard trust is enabled. The editor toolbar exposes
one compact open-all action only when the active file contains browser links;
the same trust dialog pauses and resumes its ordered queue.

Recoverable editor errors use the existing danger banner with a text-labeled
**Navigate to error** action before the dismiss control. The source editor marks
the full failing line and underlines the precise character; anchor destinations
use a short moss outline instead of a persistent selection color.

### Built-in Welcome Vault

The first-run content is a real editable vault, not a disposable onboarding
overlay. Its welcome note demonstrates headings, tags, tasks, tables, callouts,
code, links, imagery, Unicode, and internal navigation, while the `docs` folder
provides concise task-based reference pages. A `test` folder deliberately uses
Japanese, Russian, mixed scripts, emoji, punctuation, nested paths, links, and
source code so edge cases remain easy to exercise.

### Callouts

Callouts are tonal boxes inside the document. Semantic color appears in the
border and low-chroma background; body text keeps normal reading contrast.

### Generated tables of contents

Canonical comment-delimited TOCs render as tables of contents with ordinary
nested links. Marker comments stay invisible in Rich mode but remain present in
Source and saved Markdown. Other comments do not receive this exception.

### Code Blocks

Code uses a distinct but nearby editor surface in both themes, never a fixed
light panel inside dark mode. Syntax roles use restrained lavender, moss, amber,
blue, and neutral ink variants with WCAG AA contrast. Gutters, selections,
active lines, matching brackets, and editable fenced blocks share the same
semantic palette. Rich fenced blocks add one compact copy action; editable blocks
place it at the lower edge so the language and delete controls remain clear.

### Replace Preview

Find and replace uses a wide modal with paired fields, explicit scope controls,
and selectable per-file source snippets. Destructive text is shown in measured
danger; replacement text uses the moss accent.

### Binary Editor Notice

Binary files use the plain monospace editor with a persistent warning strip
that names Base64 as the reversible representation and explains save
validation.

### Editor Settings

Editor text size uses a compact 12–24 px range with minus/plus controls and a
tabular numeric value. A two-choice radio group controls two- or four-space Tab
indentation. Both settings change document and source surfaces, not application
chrome. Line numbers use a quiet gutter. Spaces, tabs, line endings, and trailing
whitespace are low-contrast source annotations that become prominent only when
explicitly enabled. The settings dialog applies changes immediately and states
that markers never change saved content.
Rich/source controls remain visible in a disabled segmented state while guides
force source mode; their tooltip names the setting that restores mode switching.

### Vault Security

The locked vault replaces the workspace with one focused unlock surface and
keeps theme and vault-switch controls available. Encryption management uses a
compact modal, explicit password confirmation, and plain-language disclosure
that paths remain visible. Recovery codes use a dense two-column monospace list
and cannot be dismissed until the user confirms they were saved. Full
decryption is the only danger-styled encryption action.

## Do's and Don'ts

### Do:

- **Do** keep the document column visually dominant over workspace chrome.
- **Do** use moss for selected state, focus, links, and primary actions.
- **Do** preserve complete dark and light token pairs.
- **Do** keep all core workflows keyboard operable with visible focus.

### Don't:

- **Don't** turn files, settings, or editor sections into nested cards.
- **Don't** use pure black, pure white, neon accents, or glowing borders.
- **Don't** add decorative motion to a task-focused workspace.
- **Don't** replace familiar desktop affordances with novel control shapes.
