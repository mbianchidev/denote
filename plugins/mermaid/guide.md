# Mermaid diagrams

## Purpose

Render a safe, local subset of fenced `mermaid` blocks inside Markdown Rich
view while keeping the exact portable fence source available for editing.

## Enablement and permissions

This version requires Denote 0.5.2 or newer and is disabled by default.
Enabling it asks only for **Diagram
renderer**. Denote downloads and verifies the executable package after approval,
runs its renderer in an opaque no-network sandbox, and independently sanitizes
the returned SVG before display, copy, or export.

## Usage

Create a fenced block whose language is `mermaid`. Pele 1.12.0 renders the
existing C4, flowchart, swimlane, ER, Git graph, Gantt, pie, quadrant, XY
chart, requirement, sequence, class, state, journey, timeline, mindmap, Kanban,
Sankey, packet, radar, block, tree-view, architecture, event-modeling,
Ishikawa, Venn, treemap, Wardley, Cynefin, and railroad detector families.
Use **Show diagram source** to edit the exact fence, **Copy SVG** to copy
sanitized SVG text, or **Export SVG** to choose a local file.

Pele uses its own layout rather than Mermaid.js. Node positions, spacing, and
edge paths can differ; explicit diagram directions are preserved. Pele targets
Mermaid 12.1 syntax, not every Mermaid.js 12.2 feature. Math expressions remain
literal TeX, as in Denote's previous strict renderer; no separate math
typesetter is included.

An optional first line such as `%% denote:title: Build flow` supplies the
bounded accessible figure name. Without it, Denote uses **Mermaid diagram**.
YAML frontmatter may instead contain a simple `title` and Gantt
`displayMode: compact`. Other frontmatter keys, nested configuration, YAML
tags/anchors/aliases, initialization directives, HTML labels, links, callbacks,
images, icons, external resources, and custom style directives are rejected.

Source is limited to 32 KiB, 1,000 lines, 4 KiB per line, 500 statements, and
300 edges. Sanitized SVG is limited to 10,000 elements and 2 MiB. Denote runs
one render at a time, queues at most 32, stops a render after five seconds,
caches at most 32 successful results or 16 MiB, and does not retry or cache
failures.

## Settings

This plugin has no settings. Denote follows the live Light, Dark, high-contrast,
and forced-colors environment automatically. Theme colors are resolved into
SVG attributes before sanitization, so copied and exported diagrams keep their
colors and a matching solid background without application CSS.

## Disable behavior

Disabling, removing, updating, or crashing the plugin restores ordinary fenced
code rendering. Denote unregisters the contribution, destroys render sandboxes,
clears derived SVG and caches, and deletes downloaded package code without
changing Markdown.

## Troubleshooting

Located parse errors appear beside only the affected block and keep its source
editor available. Simplify diagrams that exceed the documented source,
statement, edge, time, element, or SVG limits. The plugin is unavailable while
an encrypted vault is locked and resumes from verified package code after
unlock.

## Third-party licenses

The downloaded renderer bundles exactly Pele 1.12.0, with no runtime
dependencies. Its MIT license and upstream Lucide ISC notice ship under
`legal/`. Denote's independent host SVG sanitizer remains separate.
