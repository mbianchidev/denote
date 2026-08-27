# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who keep a personal or professional knowledge base in plain Markdown and
want a focused desktop editor without giving up direct ownership of their
files.

## Product Purpose

Denote is a local-first Markdown workspace for macOS, Windows, and Linux. It
opens a user-selected folder as a vault, supports rich single-pane editing, and
keeps navigation, search, metadata, and recovery close to the writing flow.
Success means users can create, find, edit, connect, and recover notes without
moving their content into a proprietary format or hosted service.

## Positioning

Denote combines an Obsidian-like vault and file workflow with a Typora-like
single-pane Markdown editing experience. Markdown files remain the source of
truth while optional workspace metadata is stored locally in SQLite.

## Operating Context

Users work with existing or new folders containing Markdown, text, and image
files. Notes may mix any Unicode languages and emoji in the same document.
Users commonly switch among several notes, browse folders, search by content
or metadata, follow links, and recover earlier content after an unwanted edit.

## Capabilities and Constraints

- Tauri desktop application with React and TypeScript.
- macOS, Windows, and Linux support.
- A user-selected local folder is the active vault.
- Markdown and text files remain plain UTF-8 files on disk.
- Rich single-pane Markdown editing is the default.
- Autosave is available and keeps the previous 10 changed revisions by
  default.
- SQLite stores local workspace metadata, including open, edit, and save
  counters, bookmarks, recent activity, ordering, trash records, and revision
  history.
- ZBSearch provides local full-text search with filters for tags, filename,
  path, content, file type, bookmarks, and recency.
- The core application stays minimal. Additional capabilities are tracked as
  optional plugins rather than bundled into the first release.
- No cloud account, synchronization service, telemetry, or remote content
  storage is part of the initial product.

## Brand Commitments

The product name is Denote. The interface is dark by default and also provides
a persistent light mode. Its interaction model should feel familiar beside
Obsidian and Typora without copying their branding.

## Evidence on Hand

No customer claims, benchmarks, testimonials, or production assets are
available. Future work must not fabricate them.

## Product Principles

1. Files first: Markdown on disk is always the durable source of truth.
2. Writing stays central: editing should feel immediate and visually calm.
3. Recovery is routine: autosave, history, and trash prevent avoidable loss.
4. Search is local and fast: useful retrieval does not require a server.
5. Capability is optional: advanced workflows belong in explicitly enabled
   plugins.

## Accessibility & Inclusion

Core workflows must be keyboard operable with visible focus, semantic controls,
and accessible names. Text handling must preserve full Unicode content and
emoji without language-specific restrictions.
