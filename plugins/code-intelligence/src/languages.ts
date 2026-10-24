import { codeLanguageForPath, type PluginCodeLanguageAdapter } from "@denote/plugin-sdk";

export const LANGUAGE_ADAPTERS: PluginCodeLanguageAdapter[] = [
  {
    id: "rust", title: "Rust", server: "rust-analyzer", debugger: "CodeLLDB or lldb-dap",
    setup: "Install rust-analyzer separately and choose its executable with no arguments. For CodeLLDB use loopback TCP and arguments [\"--port\", \"%PORT%\"]. lldb-dap uses stdio.",
  },
  {
    id: "go", title: "Go", server: "gopls", debugger: "Delve",
    setup: "Install gopls separately and choose its executable with arguments [\"serve\"]. Choose dlv for debugging, loopback TCP, and arguments [\"dap\", \"--listen=127.0.0.1:%PORT%\"].",
  },
  {
    id: "python", title: "Python", server: "python-lsp-server", debugger: "debugpy",
    setup: "Install python-lsp-server and debugpy into your chosen Python environment. Choose python with server arguments [\"-m\", \"pylsp\"] and debugger arguments [\"-m\", \"debugpy.adapter\"], both stdio.",
  },
  {
    id: "java", title: "Java", server: "Eclipse JDT Language Server", debugger: "java-debug",
    setup: "Install Eclipse JDT LS and choose its Java launcher with the documented launcher jar/configuration arguments. Add the maintained java-debug jar to initialization options bundles. Choose Java language-server transport for debugging.",
  },
  {
    id: "cpp", title: "C and C++", server: "clangd", debugger: "lldb-dap or GDB DAP",
    setup: "Install clangd and choose its executable, usually with no arguments. Provide compile_commands.json in the project. Choose lldb-dap with stdio, or a DAP-capable gdb with arguments [\"--interpreter=dap\"].",
  },
  {
    id: "typescript", title: "JavaScript and TypeScript", server: "typescript-language-server", debugger: "vscode-js-debug",
    setup: "Install TypeScript and typescript-language-server separately. Choose its executable with [\"--stdio\"]. On Windows choose node.exe and put the installed CLI entrypoint first. For js-debug choose node and its dapDebugServer.js with %PORT%, using loopback TCP.",
  },
];

export const languageForPath = codeLanguageForPath;
