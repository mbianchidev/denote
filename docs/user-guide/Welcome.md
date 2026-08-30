# Welcome to Denote 👋

![Orbiting note](assets/orbit.svg)

<!-- toc -->
- [What is Denote](#what-is-denote)
- [Try a little of everything](#try-a-little-of-everything)
- [Syntax highlighting](#syntax-highlighting)
- [Read the guide](#read-the-guide)
- [Test heading navigation](#test-heading-navigation)
- [Tags](#tags)
<!-- /toc -->

>![info]
> This ordinary local folder is your built-in guide. Edit it, encrypt it, move it,
> or delete it. Denote never replaces your changes.

## What is Denote

Denote is a file-native workspace for Markdown, text, images, and any other
regular file. Your files remain the source of truth.

## Try a little of everything

- [x] Open a note in a tab
- [ ] Split the editor, choose a layout, and move a tab to another pane
- [ ] Switch this file to read mode, then return to write mode
- [ ] Press `Command-F` or `Ctrl-F` and search for `tag:guide`
- [ ] Press `Command-P` or `Ctrl-P`, run a command, then find a filename
- [ ] Highlight words and press `Command-K` or `Ctrl-K` to create a link
- [ ] Pin a page in the file tree
- [ ] Open **Editor settings**, change text size and Tab indentation
- [ ] Open this page's external links together from the editor toolbar
- [ ] Use the table of contents above to jump between headings
- [ ] Edit this checklist and wait for autosave
- [ ] Open **History** and restore an earlier revision

| Feature | Where to try it |
| --- | --- |
| Rich Markdown | This page |
| Internal links | [Getting started](<docs/Getting started.md>) |
| External links | [Denote on GitHub](https://github.com/mbianchidev/denote) |
| Edge cases | The multilingual `test` folder |
| Images | The orbit above |
| Callouts | The information and warning boxes |
| Code themes | The block below |

## Syntax highlighting

JavaScript and TypeScript fences accept both long names and common `js` / `ts`
aliases. PHP, Java, and other common languages use the same adaptive palette.

```js
const vaults = ["work", "music", "random"];
```

```typescript
const activeVault = vaults.find((vault) => vault === "music");
```

```php
<?php echo "Denote"; ?>
```

```java
record Note(String title) {}
```

>![warning]
> A vault password cannot be recovered without an unused recovery code. Save the
> ten codes somewhere outside the encrypted vault.

## Read the guide

1. [Complete feature reference](<docs/Feature reference.md>)
2. [Getting started](<docs/Getting started.md>)
3. [Writing and formatting](<docs/Writing and formatting.md>)
4. [Search and replace](<docs/Search and replace.md>)
5. [Files, tabs, and vaults](<docs/Files, tabs, and vaults.md>)
6. [History, trash, and recovery](<docs/History, trash, and recovery.md>)
7. [Vault encryption](<docs/Vault encryption.md>)
8. [Editor display](<docs/Editor display.md>)
9. [Keyboard shortcuts](<docs/Keyboard shortcuts.md>)
10. [Optional plugins](<docs/Optional plugins.md>)

Explore the `test` folder for Japanese, Russian, mixed-script, emoji, punctuation,
nested-path, source-code, link, rename, and move fixtures.

## Test heading navigation

Use the generated table of contents at the top of this page, or follow
[What is Denote](welcome.md#what-is-denote) to verify case-insensitive file and
heading navigation. [Try a little of everything](#try-a-little-of-everything)
tests a same-file-only anchor.

## Tags

Keep document tags on a tag-only final line. Rich mode renders that last line as
colored pills. Hashtags in headings, tables of contents, prose, code, or earlier
lines remain ordinary text.

---

Unicode and emoji can live together: English · 日本語 · Русский · Español · 🎵

#welcome #denote #getting-started #project/日本語
