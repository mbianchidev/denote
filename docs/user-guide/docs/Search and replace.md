# Search and replace

## Search

Press `Command-F` on macOS or `Ctrl-F` on Windows and Linux. Denote opens search,
places the active file in **Where to search**, and focuses **Search text**. Use:

- `*` for every indexed file in the vault;
- an exact relative path for one file;
- a filename glob such as `*.html`;
- a path glob such as `docs/*.md` or `docs/**/*.md`.

Enter words in the separate search-text field. Open **Filters** to choose tags,
file types, recency, bookmark state, filename, path, or content visually. The
controls are fully keyboard operable. Every matching content occurrence appears
as its own result. Choose one to open its file and move the editor to that exact
term.

Inline filters remain available for saved or pasted queries:

```text
release notes tag:work file:"project atlas"
content:"follow up" path:projects
type:markdown bookmarked:true recent:7d
```

Supported filters:

- `tag:`
- `file:` or `filename:`
- `path:` or `folder:`
- `content:`
- `type:`
- `bookmarked:`
- `recent:Nd`

Automatic indexing reads up to 10 MB per file and stops at a 64 MB aggregate
content budget.

Opening a search result clears errors that belonged to the previous file.

## Command palette and filename search

Press `Command-P` on macOS or `Ctrl-P` on Windows and Linux. The command palette
lists all available actions and shows shortcuts where assigned. Search commands
by name, description, category, or keyword.

Type a filename directly to include filename matches from all known available
vaults, or choose **Find file across vaults** for a file-only list. File matching
does not search paths, tags, or content. Use the arrow keys and Enter to run a
command or open a file.

## Replace

Use `Command-H` on macOS or `Ctrl-H` on Windows and Linux. Replace can target the
current file or the vault. Choose **Find** to build selectable before/after
previews, then choose **Replace**. The dialog stays open and reports how many
instances were replaced. Vault-wide replacement checks that files did not
change after preview.

[Next: Files, tabs, and vaults](<Files, tabs, and vaults.md>)

#guide #search
