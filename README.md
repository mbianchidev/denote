# Denote

Denote is a local-first Markdown vault for macOS, Windows, and Linux. It pairs
an Obsidian-like file workspace with a Typora-like rich editor while keeping
plain UTF-8 files as the source of truth.

## Included

- Rich single-pane Markdown editing with optional source mode
- Autosave and the previous 10 changed revisions per note
- Local SQLite metadata for open, edit, and save counts
- ZBSearch full-text search with filename, path, content, tag, type, bookmark,
  and recency filters
- Tabs, bookmarks, recently opened files, and search navigation
- File and folder creation, rename, reorder, trash, and restore
- Table of contents, task lists, tables, code blocks, images, and links
- `>![info]`, `>![warning]`, and `>![danger]` callout blocks
- Mixed Unicode scripts and emoji in the same document
- Dark mode by default with persistent light mode
- A typed host contract for separately shipped optional plugins

Markdown, text, and images remain in the selected vault. Denote's SQLite
database lives in the operating system's application-data directory.

Notes containing raw HTML, footnotes, or math open in source mode by default so
unsupported rich-editor transforms cannot silently rewrite that syntax.

## Search

Search uses ZBSearch locally. Filters can be combined with ordinary terms:

```text
release notes tag:work file:"project atlas" path:projects
content:"follow up" bookmarked:true recent:7d
type:markdown
```

Supported filters are `tag:`, `file:`/`filename:`, `path:`/`folder:`,
`content:`, `type:`, `bookmarked:`, and `recent:Nd`.

## Callouts

```markdown
>![warning]
> This note needs attention.

>![info]
> Markdown works inside the callout.
```

## Development

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, Node.js 20 or newer, and stable Rust.

```bash
npm install
npm run tauri dev
```

Run the focused checks:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Build a desktop bundle:

```bash
npm run tauri build
```

## Documentation

- [Architecture](docs/architecture.md)
- [Optional plugin host](docs/plugins.md)
