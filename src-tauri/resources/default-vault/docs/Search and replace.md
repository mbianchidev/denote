# Search and replace

#guide #search

## Search

Press `Command-F` on macOS or `Ctrl-F` on Windows and Linux. Search uses a local
ZBSearch index and accepts ordinary text plus filters:

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

## Replace

Use `Option-Command-F` on macOS or `Ctrl-H` on Windows and Linux. Replace can
target the current file or the vault. Vault-wide replacement shows selectable
before/after previews and checks that files did not change after preview.

[Next: Files, tabs, and vaults](<Files, tabs, and vaults.md>)
