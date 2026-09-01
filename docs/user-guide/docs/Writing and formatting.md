# Writing and formatting

Markdown files use a rich editor in each pane. Files containing MDX, unsupported
raw HTML, footnotes, or math stay in source mode so
Denote cannot silently rewrite unsupported syntax.

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
marker lines render as tables of contents in Rich mode. Every item must
be a link; nested link-only lists are supported. Denote preserves those markers
after Rich edits and when switching to Source. Other HTML comments remain
locked to source mode. A line containing `---` renders as a full-width thematic
separator.

Denote also renders a small README-style HTML subset as a locked Rich block:
`p`, `h1` through `h6`, `a`, `strong`, and `img`. It supports safe alignment,
links, relative vault images, and HTTP(S) images while preserving the original
HTML exactly. Unsupported tags, attributes, URLs, nesting, and malformed HTML
stay in Source mode.

Well-formed disclosure sections are another supported raw HTML exception. Put
`<details>` and `</details>` on their own lines, followed immediately by one
plain `<summary>` line. Markdown inside the expanded section renders normally.
Files mixing disclosure sections with README-style HTML currently stay in
Source mode.

```markdown
<details>
<summary>Show the example</summary>

This can include **Markdown**, lists, links, and code.

</details>
```

Add `open` as the only supported attribute when the section should start
expanded: `<details open>`. Other attributes, nested raw HTML, and malformed
disclosure blocks stay in source mode.

````markdown
<!-- toc -->
- [Common Markdown](#common-markdown)
- [Tags](#tags)
<!-- /toc -->
````

Regular `.md` files follow standard Markdown rules for angle brackets. Text such
as `<100k`, `<3`, and `<account-slug>` remains literal instead of being parsed as
JSX. `.mdx` and `.jsx` open as non-executing JSX-highlighted source files.

Press `Command-K` on macOS or `Ctrl-K` on Windows and Linux to create a link.
Rich mode opens the link dialog and preserves highlighted text as the anchor.
Source mode wraps highlighted text as `[text]()` or inserts `[]()` with the
caret ready for the label.

Full, collapsed, and shortcut reference links also render in Rich mode:

```markdown
[Guide text][guide-home]
[Guide text][]
[guide-home]

[guide-home]: https://docs.example.test/guide "Optional title"
[guide text]: notes/start.md
```

Definitions remain invisible in Rich mode. Denote preserves unused definitions,
duplicate ordering, labels, titles, angle delimiters, and exact definition
formatting when other content changes.

Long documents scroll directly in the editor; you do not need to move the caret
to reveal content below the current viewport.

Each vault remembers one rich-text/source choice for all of its Markdown files
and restores it after restarting Denote. Your most recent choice is the default
for vaults without a saved preference. Files with unsupported rich syntax and
enabled editor display guides still use source mode for safety without changing
the vault choice.

Programming and markup files outside Markdown use the source editor. Recognized
filenames load CodeMirror syntax highlighting automatically. Core extensions
include `.js`, `.jsx`, `.ts`, `.tsx`, `.java`, `.jsp`, `.go`, `.rs`, `.py`,
`.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hpp`, `.cs`, `.kt`, `.kts`, `.swift`,
`.rb`, `.php`, `.phtml`, `.dart`, `.lua`, `.r`, `.R`, `.scala`, `.sc`, `.ex`,
`.exs`, `.json`, `.xml`, `.html`, `.htm`, `.css`, `.md`, `.markdown`, `.sh`,
`.bash`, `.zsh`, `.yaml`, `.yml`, `.toml`, `.sql`, `.ps1`, `.scss`, and
`.less`. Auxiliary formats include `.csproj`, `.fsproj`, `.vbproj`, `.vcxproj`,
`.props`, `.targets`, `.nuspec`, `.slnx`, `.sln`, `.cmake`, `.cmake.in`, `.mk`,
`.mak`, `.gradle`, `.groovy`, `.properties`, `.ini`, `.cfg`, `.editorconfig`,
`.proto`, `.tex`, `.ltx`, `.psql`, `.pgsql`, `.mysql`, `.tsql`, `.pls`,
`.plsql`, `.pkb`, `.pks`, `.cql`, `.j2`, `.jinja`, `.jinja2`, `.vue`, `.hs`,
`.lhs`, `.clj`, `.cljc`, `.cljx`, `.cljs`, `.erl`, `.hrl`, `.ml`, `.mli`,
`.mll`, `.mly`, `.fs`, `.fsx`, `.fsi`, `.f77`, `.f90`, `.f95`, `.f03`,
`.f08`, `.jl`, `.pl`, `.pm`, `.pas`, `.vb`, `.cob`, `.cpy`, and `.cbl`.
Terraform/HCL adds `.tf`, `.tfvars`, and `.hcl`; Common Lisp adds `.cl`,
`.lisp`, and `.lsp`; Helm `.tpl` files use the Helm template grammar.
Angular `*.component.html` files use the Angular template grammar. Dialect
compound suffixes include `.mariadb.sql`, `.mssql.sql`, and `.sqlite.sql`.
`go.mod`, `go.sum`, `go.work`, `go.work.sum`, `CMakeLists.txt`,
`Makefile`, `GNUmakefile`, `Cargo.lock`, `poetry.lock`, `uv.lock`,
`Jenkinsfile`, `.editorconfig`, `.env` variants, `Procfile`, `Gemfile`,
`Rakefile`, `BUILD`, `BUILD.bazel`, `BUCK`, `WORKSPACE`, `MODULE.bazel`,
`meson.build`, and `meson_options.txt` are recognized by filename.

Rich fenced blocks use the same registry. The active block's language control
opens a searchable combobox that matches names, aliases, and extensions.
**Automatic** removes the fence identifier and uses readable plain code;
**Plain text** writes `text`. Searching does not edit the document. Unknown
identifiers remain visible and unchanged until you explicitly choose a supported
language, and the language change is undoable without changing the block text.

Supported languages are JavaScript, JSX, TypeScript, TSX, Java, JSP, Go, Rust,
Python, C/C++, C#, Kotlin, Swift, Ruby, PHP, Dart, Lua, R, Scala, Elixir, JSON,
XML, HTML, CSS, Markdown, shell, YAML, TOML, SQL, PowerShell, SCSS, LESS, and
Dockerfiles. Go module/workspace files, CMake, Makefiles, Gradle/Groovy,
Protocol Buffers, properties/INI/CFG files, Visual Studio solutions, and common
XML project manifests are also highlighted. Additional choices include LaTeX,
PostgreSQL, MySQL, MariaDB, MS SQL, PL/SQL, SQLite SQL, CQL, Jinja, Vue,
Angular templates, Haskell, Clojure/ClojureScript, Erlang, OCaml, F#, Fortran,
Julia, Perl, Pascal, VB.NET, Cobol, and Puppet. JSX and TSX cover React. JSP
uses HTML highlighting; Java scriptlets remain uncolored. Common Lisp,
Terraform/HCL, and Helm templates are also available.

Because `.pp` is shared by Pascal and Puppet, Automatic leaves it plain; select
the intended language from the status bar. Diff highlighting is deferred to the
Git plugin.
Helm chart YAML stays ordinary YAML under Automatic because a `templates`
directory is not sufficient proof that a file is a Helm template. Select
**Helm template** as a per-tab override for those files.

Fenced code blocks in rich mode include an inline **Copy** button. It copies the
live code block text, including edits made inside the block.

## Tags

Put tags on a tag-only final line, such as `#guide #project/atlas #研究`. Rich
mode renders that line as colored pills while the Markdown source stays
unchanged. Hashtags elsewhere remain ordinary text, including headings and table
of contents links. Every occurrence of the same tag uses one color across the
current vault. Select a pill to search for it, or use the palette control in the
document tag bar to choose a different color.

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

#guide #markdown
