# Code intelligence exercise

This is an invented, opt-in exercise. Opening this file never starts a server,
debugger, installer, shell command, or project build.

1. Read [Code intelligence](<../docs/Optional plugins.md#code-intelligence>).
2. Install a maintained language server yourself and enable the optional plugin
   in **Settings → Plugins**.
3. Open a synthetic source sample: [Rust](../code/hello.rs),
   [Go](../code/hello.go), [Python](../code/hello.py),
   [Java](../code/Hello.java), [C++](../code/hello.cpp), or
   [TypeScript](../code/hello.ts).
4. If you want a project boundary, explicitly mark the `code` folder as a
   project. Otherwise the language marker/vault fallback is used.
5. Choose the installed executable and arguments, then **Save and approve**.
   Start the server separately. Try hover, symbols, diagnostics, and an exact
   `code/hello.rs:1:1` jump. Use Back/Forward to restore the prior cursor.

The samples demonstrate source editing, not complete buildable/debuggable
projects. For debugging create a separate, synthetic practice project, install
an adapter yourself, approve it, and provide its documented launch/attach JSON.
Never initialize Git, install dependencies, or launch programs automatically as
part of this Welcome exercise.

Native tools have ordinary operating-system privileges. Use only trusted tools
and projects, keep secrets out of configuration, and use an unencrypted code
vault. Source remains usable if tooling is absent, stopped, or unsupported.

[Plugin examples](README.md) | [Optional plugins](<../docs/Optional plugins.md>)
