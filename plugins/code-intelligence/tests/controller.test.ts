import { describe, expect, it, vi } from "vitest";
import { record, type PluginCodeDocument, type PluginCodeRequest, type PluginCodeTransport } from "@denote/plugin-sdk";
import { CodeIntelligenceController } from "../src/controller";

const document: PluginCodeDocument = {
  path: "sample/main.rs", language: "rust", version: 1, text: "fn main() {}\n",
};
const base = { language: "rust" as const, scope: { projectId: "project-example", rootPath: "sample" }, document };
const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 7 } };

function fixture() {
  const transport: PluginCodeTransport = {
    start: vi.fn(async (kind) => ({ sessionId: kind, rootPath: "sample" })),
    request: vi.fn(async (_id, method, params) => {
      if (method === "initialize") return {
        capabilities: { hoverProvider: true, definitionProvider: true, completionProvider: {},
          documentSymbolProvider: true, workspaceSymbolProvider: true, documentFormattingProvider: true, textDocumentSync: 1 },
      };
      if (method === "textDocument/definition") return [{ uri: "denote://vault/sample/other.rs", range }];
      if (method === "textDocument/formatting") return [{ range, newText: "entry" }];
      if (method === "textDocument/hover") return { contents: { kind: "markdown", value: "**Synthetic** documentation" } };
      if (method === "textDocument/documentSymbol") return [{ name: "main", range, selectionRange: range, kind: 12 }];
      if (method === "workspace/symbol") return [{ name: "main", kind: 12, location: { uri: "denote://vault/sample/other.rs", range } }];
      return params ?? null;
    }),
    notify: vi.fn(async () => {}),
    poll: vi.fn(async () => []),
    respond: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
  const controller = new CodeIntelligenceController();
  const context = { transport, signal: new AbortController().signal };
  return { controller, transport, context };
}

describe("language-server controller", () => {
  it("starts only explicitly and negotiates UTF-16 without changing a source file", async () => {
    const { controller, transport, context } = fixture();
    expect(transport.start).not.toHaveBeenCalled();
    await expect(controller.run({ ...base, operation: "hover", position: range.start }, context)).rejects.toThrow(/Start/);
    const result = await controller.run({ ...base, operation: "start" }, context);
    expect(result.capabilities).toContain("definition");
    expect(transport.start).toHaveBeenCalledWith("lsp");
    expect(transport.request).toHaveBeenCalledWith("lsp", "initialize", expect.objectContaining({
      rootUri: "denote://vault/sample", capabilities: expect.objectContaining({
        general: { positionEncodings: ["utf-16"] },
      }),
    }));
    expect(transport.notify).toHaveBeenCalledWith("lsp", "textDocument/didOpen", expect.objectContaining({
      textDocument: expect.objectContaining({ version: 1, text: document.text }),
    }));
    expect((await controller.run({ ...base, operation: "definition", position: range.start }, context)).locations)
      .toEqual([{ path: "sample/other.rs", range, language: "rust", project: "sample" }]);
    expect((await controller.run({ ...base, operation: "format" }, context)).edits)
      .toEqual([{ range, text: "entry" }]);
  });

  it("discards results when the document changes or closes during a request", async () => {
    const { controller, transport, context } = fixture();
    await controller.run({ ...base, operation: "start" }, context);
    let finish: (value: unknown) => void = () => { throw new Error("No request pending"); };
    vi.mocked(transport.request).mockImplementation(async (_id, method) => {
      if (method === "textDocument/definition") return new Promise((resolve) => { finish = resolve; });
      return null;
    });
    const pending = controller.run({ ...base, operation: "definition", position: range.start }, context);
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledWith("lsp", "textDocument/definition", expect.anything()));
    await controller.run({ ...base, operation: "change", document: { ...document, version: 2, text: "fn entry() {}\n" } }, context);
    finish([{ uri: "denote://vault/sample/other.rs", range }]);
    await expect(pending).rejects.toThrow(/changed|stale|cancelled/i);
    await controller.run({ ...base, operation: "close", document: { ...document, version: 2 } }, context);
    expect(transport.notify).toHaveBeenCalledWith("lsp", "textDocument/didClose", { textDocument: { uri: "denote://vault/sample/main.rs" } });
  });

  it("bounds symbols, keeps duplicate contexts, and reports unsupported server features", async () => {
    const { controller, transport, context } = fixture();
    await controller.run({ ...base, operation: "start" }, context);
    const result = await controller.run({ ...base, operation: "workspace-symbols", query: "main" }, context);
    expect(result.locations?.[0]).toMatchObject({ name: "main", path: "sample/other.rs", project: "sample", language: "rust" });
    expect((await controller.run({ ...base, operation: "declaration", position: range.start }, context)).status).toMatch(/does not support/);
    vi.mocked(transport.request).mockResolvedValue(Array.from({ length: 1000 }, (_, index) => ({
      name: `symbol${index}`, location: { uri: "denote://vault/sample/other.rs", range },
    })));
    const bounded = await controller.run({ ...base, operation: "workspace-symbols", query: "symbol" }, context);
    expect(bounded.locations).toHaveLength(500);
    expect(bounded.notices?.join(" ")).toMatch(/500/);
  });

  it("clears stale diagnostics and rejects server-requested workspace edits", async () => {
    const { controller, transport, context } = fixture();
    await controller.run({ ...base, operation: "start" }, context);
    vi.mocked(transport.poll).mockResolvedValueOnce([
      { kind: "message", message: { method: "textDocument/publishDiagnostics", params: {
        uri: "denote://vault/sample/main.rs", version: 1,
        diagnostics: [{ range, message: "Synthetic warning", severity: 2 }],
      } } },
      { kind: "message", message: { id: 42, method: "workspace/applyEdit", params: {} } },
    ]);
    expect((await controller.run({ ...base, operation: "poll" }, context)).diagnostics).toHaveLength(1);
    expect(transport.respond).toHaveBeenCalledWith("lsp", 42, expect.objectContaining({ applied: false }));
    await controller.run({ ...base, operation: "change", document: { ...document, version: 2 } }, context);
    vi.mocked(transport.poll).mockResolvedValueOnce([{ kind: "message", message: {
      method: "textDocument/publishDiagnostics", params: {
        uri: "denote://vault/sample/main.rs", version: 1, diagnostics: [{ range, message: "Stale", severity: 1 }],
      },
    } }]);
    expect((await controller.run({ ...base, operation: "poll", document: { ...document, version: 2 } }, context)).diagnostics).toEqual([]);
  });
});

describe("optional debugger controller", () => {
  it("accepts empty control responses, groups source breakpoints and retains explicit watches", async () => {
    const { controller, transport, context } = fixture();
    vi.mocked(transport.request).mockImplementation(async (_id, method) => {
      if (method === "initialize") return { supportsConfigurationDoneRequest: true, supportsConditionalBreakpoints: true, supportsLogPoints: true };
      if (method === "setBreakpoints") return { breakpoints: [{ line: 2, verified: true }] };
      if (method === "evaluate") return { result: "7", type: "integer", variablesReference: 0 };
      return null;
    });
    vi.mocked(transport.poll).mockResolvedValueOnce([{ kind: "message", message: { type: "event", event: "initialized" } }]);
    await controller.run({ ...base, operation: "debug", debug: { command: "launch", arguments: {
      breakpointGroups: [
        { source: { path: "denote://vault/sample/main.rs" }, breakpoints: [{ line: 2 }] },
        { source: { path: "denote://vault/sample/other.rs" }, breakpoints: [{ line: 3, condition: "counter > 0" }] },
      ],
    } } }, context);
    expect(transport.request).toHaveBeenCalledWith("dap", "setBreakpoints", {
      source: { path: "denote://vault/sample/other.rs" }, breakpoints: [{ line: 3, condition: "counter > 0" }],
    });
    vi.mocked(transport.poll).mockResolvedValueOnce([{ kind: "message", message: {
      type: "event", event: "stopped", body: { threadId: 1 },
    } }]);
    await controller.run({ ...base, operation: "poll" }, context);
    const watch = await controller.run({ ...base, operation: "debug", debug: {
      command: "evaluate", arguments: { expression: "counter", context: "watch" },
    } }, context);
    expect(watch.debug?.watches).toEqual([{ expression: "counter", value: "7", variablesReference: 0, type: "integer" }]);
    const stepped = await controller.run({ ...base, operation: "debug", debug: { command: "next" } }, context);
    expect(stepped.debug?.state).toBe("running");
    expect(stepped.debug?.watches?.[0].variablesReference).toBe(0);
  });
  it("configures only after initialized and preserves the independent language server when stopped", async () => {
    const { controller, transport, context } = fixture();
    await controller.run({ ...base, operation: "start" }, context);
    let launched: (value: unknown) => void = () => { throw new Error("Launch not pending"); };
    vi.mocked(transport.request).mockImplementation(async (id, method, params) => {
      if (id === "dap" && method === "initialize") return { supportsConfigurationDoneRequest: true, supportsConditionalBreakpoints: true };
      if (method === "launch") return new Promise((resolve) => { launched = resolve; });
      if (method === "configurationDone") { launched({}); return {}; }
      if (method === "textDocument/hover") return { contents: "Synthetic hover" };
      return record(params) ? params : {};
    });
    vi.mocked(transport.poll).mockResolvedValueOnce([{ kind: "message", message: { type: "event", event: "initialized" } }]);
    const request: PluginCodeRequest = { ...base, operation: "debug", debug: { command: "launch" } };
    const result = await controller.run(request, context);
    expect(result.debug?.state).toBe("running");
    expect(transport.request).toHaveBeenCalledWith("dap", "configurationDone", {});
    await controller.run({ ...request, debug: { command: "disconnect" } }, context);
    expect(transport.stop).toHaveBeenCalledWith("dap");
    expect(transport.stop).not.toHaveBeenCalledWith("lsp");
    expect((await controller.run({ ...base, operation: "hover", position: range.start }, context)).hover).toBe("Synthetic hover");
  });
});
