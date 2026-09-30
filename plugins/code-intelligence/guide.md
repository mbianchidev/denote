# Code intelligence

## Purpose

Use installed local language servers for Rust, Go, Python, Java, C/C++, and
JavaScript/TypeScript. Completion, hover, signatures, diagnostics, formatting,
symbols, definitions, declarations, implementations, type definitions, and
references use the server's advertised capabilities. Debugging is an independent,
optional Debug Adapter Protocol session.

## Enablement and permissions

Enable **Code intelligence** in **Settings → Plugins**. The **Code intelligence**
permission allows versioned source snapshots and the bounded native protocol
bridge; **Project context** supplies opaque project identities and relative roots;
**Sidebar** contributes the host-rendered controls. No downloaded plugin owns
DOM, native filesystem APIs, executable paths, ports, or encryption keys.

Enabling the plugin starts no native tool and changes no files. Denote never
installs a server, debugger, adapter, runtime, or project dependency. Select each
installed executable, review its arguments/options, enable that integration, and
choose **Save and approve**. Start it separately. Native tools and project
configuration have your operating-system privileges, including filesystem and
network access: approve only trusted tools and projects.

Native tools are unavailable in encrypted vaults, even while unlocked. Denote
never creates a plaintext project mirror.

## Usage

Open **Code intelligence** from the activity rail or find **Code:** actions in
the command palette. Each language has separate server and debugger approval.
The closest active core project wins. Without one, Denote finds the nearest safe
language marker, such as Cargo.toml, go.mod, pyproject.toml, pom.xml,
compile_commands.json, or tsconfig.json; otherwise it uses the vault root.

### Installed language-server adapters

| Language | Executable and JSON arguments | Upstream |
| --- | --- | --- |
| Rust | rust-analyzer, `[]` | https://rust-analyzer.github.io/ |
| Go | gopls, `["serve"]` | https://go.dev/gopls/ |
| Python | selected Python interpreter, `["-m","pylsp"]` | https://github.com/python-lsp/python-lsp-server |
| Java | selected Java interpreter with the installed Eclipse JDT LS launcher jar, configuration directory, and private data directory | https://github.com/eclipse-jdtls/eclipse.jdt.ls |
| C/C++ | clangd, usually `[]`; provide the project's compilation database | https://clangd.llvm.org/installation |
| JavaScript/TypeScript | typescript-language-server, `["--stdio"]`; TypeScript must also be installed | https://github.com/typescript-language-server/typescript-language-server |

On Windows choose the real node.exe, python.exe, or java.exe and put an installed
script or jar in its arguments. Batch and PowerShell wrappers are not executed.
For a Node-based server the argument array starts with its installed CLI
entrypoint, followed by `--stdio`. Choose the correct interpreter/environment
for the project; no runtime is bundled or downloaded.

Start the server, then use completion or hover in the source editor. Ctrl-Space
requests completion, F12 requests definition, Command/Ctrl-Shift-F12 requests
references, Command/Ctrl-Shift-Space requests signatures, Alt/Option-Shift-F
formats, and F8 visits diagnostics. Every action also has host-rendered controls.
Formatting is an explicit, single-document, undoable edit checked against the
same source version; read mode forbids it. Unsolicited workspace edits are refused.

**Current file**, **Active project**, and **Entire vault** choose symbol scope.
Vault scope has its own approvals and must be started explicitly. Results show
symbol/container, path, project, language, and line/column. Filter the bounded
result list or enter `path:line:column` to jump without a server. The existing
Back/Forward controls restore source cursor positions, including same-file jumps
and targets already open in another pane. History is transient, not Markdown.
Only files within the selected vault can be opened.

### Optional debugger adapters

| Language | Installed adapter | Transport and JSON arguments |
| --- | --- | --- |
| Rust | CodeLLDB or lldb-dap | CodeLLDB: Loopback TCP, `["--port","%PORT%"]`; lldb-dap: stdio, `[]` |
| Go | Delve | Loopback TCP, `["dap","--listen=127.0.0.1:%PORT%"]` |
| Python | debugpy | selected Python interpreter, stdio, `["-m","debugpy.adapter"]` |
| Java | java-debug extension loaded by Eclipse JDT LS | Java language server transport; start the approved Java server first |
| C/C++ | lldb-dap or DAP-capable GDB | stdio, `[]` or `["--interpreter=dap"]` |
| JavaScript/TypeScript | vscode-js-debug's standalone dapDebugServer.js | selected Node interpreter, Loopback TCP, `["/installed/path/dapDebugServer.js","%PORT%"]` |

Maintained adapter sources: https://github.com/vadimcn/codelldb,
https://github.com/go-delve/delve, https://github.com/microsoft/debugpy,
https://github.com/microsoft/java-debug, https://lldb.llvm.org/use/dap.html,
https://sourceware.org/gdb/current/onlinedocs/gdb.html/Debugger-Adapter-Protocol.html,
and https://github.com/microsoft/vscode-js-debug.

Denote allocates the loopback port and substitutes `%PORT%`. Remote adapter
connections and debugger-requested terminal/child-session launches are not
supported. Use the adapter's internal console. Java initialization options must
include the installed java-debug jar in `bundles`; the approved Java debug
action requests its loopback session through the Java server.

Save separate **Launch configuration** and **Attach configuration** JSON for
each project. `${workspaceFolder}` and `${file}` are expanded only by the host.
For example, an LLDB launch may use
`{"program":"${workspaceFolder}/target/debug/sample","cwd":"${workspaceFolder}"}`;
a Python launch may use
`{"program":"${file}","cwd":"${workspaceFolder}","console":"internalConsole"}`.
Use the maintained adapter's own launch/attach fields. Attach never asks the
host to terminate an independently launched target when disconnecting.

Choose **Launch** or **Attach** explicitly. Add breakpoints by source line,
optionally with a condition or log message. Unsupported conditional/logpoint
capabilities report an error instead of silently changing the breakpoint.
Continue, Pause, Step over/into/out, Restart, and Stop use the adapter's
capabilities. A stop exposes threads and call stacks; select a frame, scope, or
variable to inspect it. Explicit watches are re-evaluated on later stops.
Exception filter IDs follow the adapter's documentation. Console expressions
are explicit evaluation actions. External library frames remain visible without
exposing or navigating filesystem paths outside the vault.

## Settings

Server and debugger enablement, executable approval, arguments, initialization
options, and independent launch/attach JSON live in host-owned local plugin
metadata, separately for each vault/project/language. Marked projects retain
their configuration when moved or renamed. Never put credentials in these
fields; use the operating-system environment or the tool's secure credential
support. Executable changes require reapproval.

Breakpoints and watches are project/language-scoped in-memory debug metadata.
Source snapshots, diagnostics, logs, symbols, and variable references are
bounded and discarded across the relevant document/session lifecycle.

## Disable behavior

Stopping a language integration also stops its debugger. Stopping only debugging
keeps language intelligence available. Project/vault changes, plugin updates,
disablement, crashes, and application teardown cancel protocol requests and stop
owned process groups/connections. Package code is removed on disablement; source
files and user-installed tools are never removed. Approved configuration is
retained for an explicit later start. **Clear plugin data** forgets it.

## Troubleshooting

Missing tools: install one yourself, select its real executable/interpreter,
review arguments, and save approval. A changed executable must be approved again.
A server/adapter exit shows its bounded log and restart controls; a missing
debugger does not stop completion or navigation.

Unsupported features remain unavailable rather than guessed. Snippet completion
and additional cross-file completion edits are not executed. Diagnostics without
document versions are ignored after edits unless the server provides a pull
diagnostic response. Requests/results are discarded when documents change or
close; cancellation does not require closing Denote.

Source is limited to 4 MiB, results to 500, logs to 200 entries, native sessions
to 12, and pending native requests to 32 per session. Protocol requests have a
30-second native timeout; adapter connection and initialization are separately
bounded. Narrow a query, close unused files, or restart after an exhausted limit.
