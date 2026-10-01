import { describe, expect, it } from "vitest";
import { codeProtocolAllowed } from "./codeIntelligence";
import type { PluginCodeRequest } from "@denote/plugin-sdk";

const request: PluginCodeRequest = {
  operation: "completion", language: "rust", scope: { projectId: null, rootPath: "" },
  document: { path: "main.rs", language: "rust", version: 1, text: "fn main() {}\n" },
  position: { line: 0, character: 3 },
};

describe("code protocol action leases", () => {
  it("does not let passive completion requests start or evaluate a debugger", () => {
    expect(codeProtocolAllowed(request, "request", "textDocument/completion", {})).toBe(true);
    expect(codeProtocolAllowed(request, "start", "dap", {})).toBe(false);
    expect(codeProtocolAllowed(request, "request", "launch", {})).toBe(false);
    expect(codeProtocolAllowed(request, "request", "evaluate", { expression: "synthetic()" })).toBe(false);
    const watch: PluginCodeRequest = { ...request, operation: "debug", debug: {
      command: "evaluate", arguments: { expression: "counter", context: "watch" },
    } };
    expect(codeProtocolAllowed(watch, "request", "evaluate", { expression: "counter", context: "watch" })).toBe(true);
    expect(codeProtocolAllowed(watch, "request", "evaluate", { expression: "synthetic()", context: "watch" })).toBe(false);
    expect(codeProtocolAllowed({ ...request, operation: "start" }, "start", "lsp", {})).toBe(true);
  });
});
