# Linter exercise

This invented exercise does not install or start anything when opened.

1. Read [Linter](<../docs/Optional plugins.md#linter>).
2. Enable Linter in **Settings → Plugins** and open [TypeScript](../code/hello.ts).
3. Use a separate, synthetic practice project for a real lint run. Install its
   linter yourself, then choose the installed executable and JSON arguments.
4. Choose the matching parser and column units. For stdin-capable linters,
   enable **Send current source through stdin** before approving on-edit runs.
5. **Save and approve**, then **Run linter**. Inspect Problems, source markers,
   severity filters, and file/line navigation.
6. If the tool returns a fix proposal, choose **Preview fix** in editable
   Source mode. Inspect Before and After before **Apply fix**. An edit made
   after preview must invalidate that fix.
7. Cancel a long run, try a clean run to clear earlier problems, and disable
   the plugin. Source files remain unchanged unless you explicitly apply a fix.

Use only trusted tools and projects. No native tooling is available in an
encrypted vault, even while unlocked. There is no plaintext tooling mirror.

[Plugin examples](README.md) | [Optional plugins](<../docs/Optional plugins.md>)
