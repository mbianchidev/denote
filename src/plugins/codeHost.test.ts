import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginCodeRequest, PluginCodeResult } from "@denote/plugin-sdk";
import { CodeIntelligenceHost } from "./codeHost";
import { api } from "../lib/api";
import type { PluginCodeContribution } from "./codeIntelligence";

vi.mock("../lib/api", () => ({
  api: { codeToolEnvironment: vi.fn() },
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
const provider: PluginCodeContribution = {
  pluginId: "denote.synthetic", id: "denote.synthetic.code", title: "Code",
  languages: [{ id: "rust", title: "Rust", server: "Synthetic server", debugger: "Synthetic debugger", setup: "Choose an installed tool." }],
};
const configuration = { enabled: false, executable: "", executableSha256: "", arguments: [], transport: "stdio" as const, options: {}, launch: {}, attach: {} };
const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 7 } };

beforeEach(() => {
  vi.mocked(api.codeToolEnvironment).mockResolvedValue({
    scope: { projectId: "project-example", rootPath: "sample" }, language: "rust", lsp: configuration, dap: configuration,
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
});

describe("code intelligence host", () => {
  it("continues bounded polling and opens new documents only in an explicitly started scope", async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async (_plugin: string, _id: string, _request: PluginCodeRequest): Promise<PluginCodeResult> => ({ status: "Ready", capabilities: ["hover"] }));
    const host = new CodeIntelligenceHost();
    host.configure(provider, execute, "/synthetic/vault", "project-example", false);
    host.attach("sample/main.rs", "project-example", "fn main() {}\n", { apply: vi.fn(), readOnly: () => false });
    await host.run("rust", "project-example", "sample/main.rs", "start");
    host.attach("sample/other.rs", "project-example", "fn helper() {}\n", { apply: vi.fn(), readOnly: () => false });
    await vi.advanceTimersByTimeAsync(1600);
    expect(execute.mock.calls.filter((call) => call[2]?.operation === "poll").length).toBeGreaterThanOrEqual(3);
    expect(execute).toHaveBeenCalledWith("denote.synthetic", "denote.synthetic.code",
      expect.objectContaining({ operation: "open", document: expect.objectContaining({ path: "sample/other.rs" }) }),
      "/synthetic/vault", expect.any(AbortSignal));
    host.dispose();
    vi.useRealTimers();
  });
  it("does not start tools on attachment and rejects stale or read-only formatting", async () => {
    const execute = vi.fn(async (_plugin: string, _id: string, request: PluginCodeRequest): Promise<PluginCodeResult> => ({
      status: "Ready", capabilities: ["format", "hover"], ...(request.operation === "format" ? { edits: [{ range, text: "entry" }] } : {}),
    }));
    const host = new CodeIntelligenceHost();
    host.configure(provider, execute, "/synthetic/vault", "project-example", false);
    const apply = vi.fn();
    const release = host.attach("sample/main.rs", "project-example", "fn main() {}\n", { apply, readOnly: () => false });
    await host.environment("rust", "project-example", "sample/main.rs");
    expect(execute).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ operation: "start" }), expect.anything(), expect.anything());
    await host.run("rust", "project-example", "sample/main.rs", "start");
    await host.format("sample/main.rs");
    expect(apply).toHaveBeenCalledWith("fn main() {}\n", [{ range, text: "entry" }]);
    let finish: (result: PluginCodeResult) => void = () => { throw new Error("No request"); };
    execute.mockImplementation(async (_plugin, _id, request) => request.operation === "format" ?
      new Promise((resolve) => { finish = resolve; }) : { status: "Ready" });
    const pending = host.format("sample/main.rs");
    await vi.waitFor(() => expect(execute.mock.calls[execute.mock.calls.length - 1]?.[2].operation).toBe("format"));
    host.update("sample/main.rs", "fn changed() {}\n");
    finish({ status: "Ready", edits: [{ range, text: "entry" }] });
    await expect(pending).rejects.toThrow(/changed|cancelled|stale/i);
    await release();
    host.dispose();
    const readOnly = new CodeIntelligenceHost();
    readOnly.configure(provider, execute, "/synthetic/vault", "project-example", false);
    readOnly.attach("sample/main.rs", "project-example", "fn main() {}\n", { apply, readOnly: () => true });
    await expect(readOnly.format("sample/main.rs")).rejects.toThrow(/read mode|read.only/i);
    readOnly.dispose();
  });

  it("clears models and aborts pending work on workspace change or encryption", async () => {
    const execute = vi.fn(async (): Promise<PluginCodeResult> => ({ status: "Ready", capabilities: ["hover"], diagnostics: [{ range, message: "Synthetic", severity: "warning" }] }));
    const host = new CodeIntelligenceHost();
    host.configure(provider, execute, "/synthetic/vault", "project-example", false);
    host.attach("sample/main.rs", "project-example", "fn main() {}\n", { apply: vi.fn(), readOnly: () => false });
    await host.run("rust", "project-example", "sample/main.rs", "start");
    expect(host.model({ projectId: "project-example", rootPath: "sample" }, "rust").diagnostics).toHaveLength(1);
    host.configure(provider, execute, "/synthetic/other", "project-example", true);
    await expect(host.environment("rust", "project-example", "sample/main.rs")).rejects.toThrow(/encrypted/i);
    expect(host.document("sample/main.rs")).toBeNull();
    host.dispose();
  });
});
