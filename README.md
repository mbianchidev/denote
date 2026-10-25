# Denote

Denote is a local-first Markdown workspace for macOS, Windows, and Linux.
Open any folder as a vault, edit its files in place, and keep navigation,
search, and recovery on your device. No account or hosted service is required.

<img width="1707" height="1094" alt="Denote showing a Markdown vault, file tree, tabs, and focused editor" src="https://github.com/user-attachments/assets/82c52973-0f60-4345-8dda-309ed0d6d9d4" />

## What you can do

- **Write and read locally.** Use rich Markdown or exact Source mode, edit
  syntax-highlighted text and code, preview images, and read multi-page PDFs
  with zoom, rotation, selectable text, and in-document search.
- **Find and connect notes.** Search content, filenames, paths, tags, bookmarks,
  and recent work. Follow relative note links and heading anchors, or preview
  find-and-replace changes before applying them across the vault.
- **Arrange your workspace.** Switch between vaults, organize named tab groups,
  and work in up to four resizable editor panes. Mark folders as projects or
  multi-project workspaces without moving their files.
- **Recover changes.** Autosave, revision history, Denote Trash, and
  conflict-safe writes help protect work from unwanted edits or changes made
  by another application.
- **Encrypt a vault.** Protect file and revision contents with a password and
  ten one-time recovery codes.

Unencrypted notes remain ordinary Markdown files. Opening a note or switching
between Rich and Source does not rewrite its source.

## Download

Use the [Denote website](https://mbianchidev.github.io/denote/) or
[latest GitHub Release](https://github.com/mbianchidev/denote/releases/latest)
to download the package for your platform.

| Platform | Architecture | Packages |
| --- | --- | --- |
| macOS | Apple Silicon (arm64) or Intel (x86_64) | `.dmg` |
| Windows | x86_64 | NSIS `.exe` or `.msi` installer |
| Linux | x86_64 | `.AppImage`, Debian/Ubuntu `.deb`, or Fedora/RPM `.rpm` |

Releases also publish platform-specific SHA-256 checksum files, SBOMs, and
build provenance. Node.js and Rust are needed only for development, not to run
an installed desktop build.

### Opening Denote on macOS

Current macOS releases are unsigned. Only use this workaround for a trusted
download from the [official Denote releases](https://github.com/mbianchidev/denote/releases).
Verify the disk image against that release's matching checksum file before
continuing.

1. Open the disk image and drag `Denote.app` into **Applications**.
2. If macOS blocks launch or reports that the app is damaged, open **Terminal**
   and run:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Denote.app"
   ```

3. Reopen Denote from **Applications**.

This removes quarantine only from `Denote.app`, not system-wide Gatekeeper
protection. See the [getting-started guide](docs/user-guide/docs/Getting%20started.md)
for first steps.

## Start writing

On first launch, Denote opens **Denote Welcome**, an editable offline guide.
Denote creates it once and never overwrites your changes. Its
[plugin examples](docs/user-guide/plugins/README.md) cover optional workflows
without enabling plugins or initializing a Git repository.

1. Open the vault switcher in the sidebar header and choose **Open another
   folder**. Select an existing folder or create a new one in the native dialog.
2. Select a Markdown file, or create one with `Command-N` / `Ctrl-N`.
3. Start writing; autosave runs after a short pause. Use **Rich** and **Source**
   in the editor toolbar to choose how you edit Markdown.
4. Open **Settings** with `Command-,` / `Ctrl-,` to choose Light, Dark, or System
   appearance, text size, indentation, display guides, and session restore.

Press `Command-P` / `Ctrl-P` for commands or filename search. Installed desktop
bundles also handle `denote:///` links containing an absolute file path, switching
vaults and focusing the linked file. See
[files, tabs, and vaults](docs/user-guide/docs/Files,%20tabs,%20and%20vaults.md)
and the [keyboard shortcuts](docs/user-guide/docs/Keyboard%20shortcuts.md).

Project files always show line numbers, and project Markdown uses Source mode.
A workspace discovers its direct child folders as projects. These marks are
local metadata, not changes to your folder structure. Display guides can also
temporarily force Markdown into Source mode; see
[editor settings](docs/user-guide/docs/Editor%20display.md).

## Optional plugins

In **Settings**, open **Plugins** to inspect permissions and enable only what
you need. Plugin code is downloaded from verified GitHub Release assets after
approval; it is not included in the desktop installer or enabled by default.

- **Git vault versioning:** manual or automatic commits, staged and unstaged
  diffs and line counts, pull change reports, branches, and merge/rebase recovery
  after rejected pushes.
  Sign with system OpenPGP or SSH keys and optionally store key passphrases in
  the operating-system credential store.
- **[Code intelligence](docs/user-guide/docs/Optional%20plugins.md#code-intelligence):**
  approve local language servers and optional debuggers for Rust, Go, Python,
  Java, C/C++, and JavaScript/TypeScript.
- **Writing and planning:** Emoji picker, Calendar and daily notes, Advanced
  task lists, Reminders, and Note graph. Calendar includes daily, created, and
  last-updated views; daily-note creation never overwrites existing files.
- **Structured and visual content:** JSON and YAML viewer, Mermaid diagrams,
  and Kanban boards. Existing Obsidian Kanban boards, including escaped exports,
  open read-only without changing their source; explicit migration makes them
  editable while retaining the original source for recovery.

Disabling a plugin stops its worker and removes its downloaded code, not your
notes. Read the [plugin guide](docs/user-guide/docs/Optional%20plugins.md) for
setup, permission, update, and cleanup details.

## Privacy and safety

Search, metadata, preferences, history, and optional encryption stay local.
There is no telemetry, built-in cloud synchronization, or hosted content
storage. App updates, plugin downloads, remote Git operations, external links,
and remote Markdown images can use the network. HTTP(S) links to unapproved
domains require confirmation. Bug reports open as editable GitHub drafts with
bounded, redacted diagnostics; Denote never submits them automatically.

Important limits:

- Regular files have a 25 MB open/edit limit. Valid UTF-8 opens as text; invalid
  UTF-8 and mixed line endings use reversible Base64 rather than lossy conversion.
- PDFs are read-only, limited to 5,000 pages, with search available up to
  500 pages. Rendering uses bundled local assets and no external requests.
  Scripting, forms, annotations, attachments, OCR, and embedded link activation
  are not supported.
- Vault encryption protects contents, not filenames, folder structure, sizes,
  timestamps, or operational metadata. It does not erase earlier plaintext
  backups or Git history. Keep recovery codes outside the vault and read the
  [encryption guide](docs/user-guide/docs/Vault%20encryption.md) before enabling it.
- Project organization, syntax highlighting, and optional language-server
  integration are implemented. Persistent terminal sessions remain future
  plugin work.

## Run from source

Denote uses Tauri 2, React, TypeScript, and a Rust native core. Install:

- Git, npm, and Node.js 26.12.1, the version pinned in
  [`.node-version`](.node-version). Other supported Node versions are declared
  in [`package.json`](package.json).
- Stable Rust and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  for your operating system, including its native build tools and libraries.
- On macOS and Linux, GnuPG (`gpg`), Make, and Git's native build dependencies
  for the bundled-tool preparation step. The
  [CI workflow](.github/workflows/ci.yml) lists the Linux dependency packages.

```bash
git clone https://github.com/mbianchidev/denote.git
cd denote
node scripts/preinstall-validate-plugins.mjs
npm ci --ignore-scripts
npm run prepare:pdf-assets
npm run prepare:bundled-tools
npm run verify:bundled-tools
npm run dev:desktop
```

Bundled-tool preparation verifies pinned downloads and builds Git from source
on macOS and Linux. Authenticate the GitHub CLI with `gh auth login` if
preparation hits GitHub's anonymous API rate limit.

The last command opens **Denote Development**, with separate application data,
plugins, locks, and keychain entries from an installed release. `npm run dev`
alone serves the frontend; it does not provide native vault access or register
the installed app-link scheme.

Build a desktop bundle after setup with `npm run tauri build`. The
[development guide](docs/development.md) covers validation, plugin authoring,
platform-specific checks, and release packaging.

## Documentation

Run Rust audits with `node scripts/audit-rust-dependencies.mjs` so local
compatibility backports remain visible to RustSec. The
[backport policy](docs/development.md#rust-dependency-audits-and-linux-backports)
records their provenance, remaining version-based warning, and required checks.

- [Built-in user guide](docs/user-guide/Welcome.md)
- [Complete feature reference](docs/user-guide/docs/Feature%20reference.md)
- [Product and design documentation](docs/index.md)
- [Development setup and validation](docs/development.md)
- [Optional plugin model](docs/plugins.md)
- [GitHub Releases](https://github.com/mbianchidev/denote/releases)

## Contributing

Bug reports and pull requests are welcome. Use
[GitHub issues](https://github.com/mbianchidev/denote/issues) to report a problem
with reproduction steps and the build details from **About Denote**. Do not
include private vault content or credentials. For changes, follow the
[development guide](docs/development.md) and
[architecture boundaries](docs/architecture.md), and use synthetic test data.

## License

Denote is released under the [MIT License](LICENSE).
