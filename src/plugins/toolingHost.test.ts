import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToolDiagnostics, type PluginToolContribution, type PluginToolParseRequest } from "@denote/plugin-sdk";
import { api } from "../lib/api";
import { ToolingHost } from "./toolingHost";
import type { ToolConfiguration } from "../lib/projectTools";

const provider: PluginToolContribution = {
  pluginId: "denote.example", id: "denote.example.tools", kind: "linter", title: "Linter", formats: ["unix", "eslint-json"],
};
const configuration: ToolConfiguration = {
  enabled: true, executable: "/synthetic/linter", executableSha256: "a".repeat(64), arguments: [],
  format: "unix", columns: "utf16", stdin: true, runOn: "manual", debounceMs: 100, timeoutMs: 1000,
};
const path = "sample/example.ts";
const hash = "b".repeat(64);

function setup(tool = provider, parse = vi.fn(async (request: PluginToolParseRequest) => parseToolDiagnostics(request))) {
  const host = new ToolingHost(vi.fn());
  host.configure([tool], (_pluginId, _providerId, request) => parse(request), "vault-example", "project-example", false);
  host.setFiles([path]);
  host.syncDocuments([{ path, content: "const demo = 1;\n", savedContent: "const demo = 1;\n", savedHash: hash, projectId: "project-example" }]);
  return { host, parse, tool };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "toolEnvironment").mockResolvedValue({
    scope: { projectId: "project-example", rootPath: "sample" }, configuration,
    configured: true, platform: "macos", terminalSupported: true, limitation: null,
  });
  vi.spyOn(api, "startToolSession").mockResolvedValue({
    runId: "run-example", scope: { projectId: "project-example", rootPath: "sample" },
    documents: [{ path, version: hash }],
  });
  vi.spyOn(api, "pollToolSession").mockResolvedValue({
    status: "succeeded", exitCode: 0, error: null,
    events: [{ stream: "stdout", data: "example.ts:1:7: warning: Example.\n" }],
  });
  vi.spyOn(api, "validateToolDocuments").mockResolvedValue([]);
  vi.spyOn(api, "stopToolSession").mockResolvedValue(undefined);
  vi.spyOn(api, "stopToolSessions").mockResolvedValue(undefined);
});

describe("shared linter and build host", () => {
  it("uses an explicitly approved vault profile for automatic runs when a project has no override", async () => {
    vi.useFakeTimers();
    const { host } = setup();
    try {
      vi.mocked(api.toolEnvironment).mockImplementation(async (_id, context) => ({
        configured: context.projectId === null, scope: { projectId: context.projectId, rootPath: context.projectId ? "sample" : "" },
        configuration: { ...configuration, enabled: context.projectId === null, runOn: "save" },
        platform: "macos", terminalSupported: true, limitation: null,
      }));
      vi.mocked(api.pollToolSession).mockResolvedValue({ status: "succeeded", exitCode: 0, error: null, events: [] });
      await host.saved(path, "const demo = 1;\n", hash);
      await vi.advanceTimersByTimeAsync(250);
      expect(api.startToolSession).toHaveBeenCalledWith(provider.pluginId,
        expect.objectContaining({ projectId: null }), expect.objectContaining({ trigger: "save" }));
    } finally { host.dispose(); vi.useRealTimers(); }
  });

  it("does not bypass an explicitly disabled project profile with vault automatic settings", async () => {
    vi.useFakeTimers();
    const { host } = setup();
    try {
      vi.mocked(api.toolEnvironment).mockResolvedValue({
        configured: true, scope: { projectId: "project-example", rootPath: "sample" },
        configuration: { ...configuration, enabled: false, runOn: "save" },
        platform: "macos", terminalSupported: true, limitation: null,
      });
      await host.saved(path, "const demo = 1;\n", hash);
      await vi.advanceTimersByTimeAsync(250);
      expect(api.startToolSession).not.toHaveBeenCalled();
      expect(api.toolEnvironment).toHaveBeenCalledTimes(1);
    } finally { host.dispose(); vi.useRealTimers(); }
  });

  it("excludes ignored dependency trees while retaining an explicitly opened ignored source", async () => {
    const { host } = setup();
    const dependency = "sample/node_modules/example.ts";
    host.setFiles([path, dependency], new Set(["sample/node_modules"]));
    await host.run(provider, "project-example", "typescript", path);
    expect(vi.mocked(api.startToolSession).mock.calls[0][2].paths).toEqual([path]);
    host.syncDocuments([{ path, content: "const demo = 1;\n", savedContent: "const demo = 1;\n", savedHash: hash, projectId: "project-example" },
      { path: dependency, content: "export {};\n", savedContent: "export {};\n", savedHash: hash, projectId: "project-example" }]);
    await host.run(provider, "project-example", "typescript", path);
    expect(vi.mocked(api.startToolSession).mock.calls[1][2].paths).toEqual([path, dependency]);
    host.dispose();
  });

  it("clears old diagnostics after a clean run and invalidates them immediately on edits", async () => {
    const { host } = setup();
    await host.run(provider, "project-example", "typescript", path);
    expect(host.diagnosticsForEditor(path)).toHaveLength(1);
    vi.mocked(api.pollToolSession).mockResolvedValue({ status: "succeeded", exitCode: 0, error: null, events: [] });
    await host.run(provider, "project-example", "typescript", path);
    expect(host.diagnosticsForEditor(path)).toEqual([]);
    vi.mocked(api.pollToolSession).mockResolvedValue({
      status: "failed", exitCode: 1, error: null, events: [{ stream: "stdout", data: "example.ts:1:1: error: Example.\n" }],
    });
    await host.run(provider, "project-example", "typescript", path);
    expect(host.model(provider.id, "project-example", "typescript").status).toBe("failed");
    host.update(path, "const changed = 2;\n");
    expect(host.diagnosticsForEditor(path)).toEqual([]);
    host.dispose();
  });

  it("discards parsing results after their document changes", async () => {
    let finish!: (value: ReturnType<typeof parseToolDiagnostics>) => void;
    const parse = vi.fn((request: PluginToolParseRequest) => new Promise<ReturnType<typeof parseToolDiagnostics>>((resolve) => {
      finish = () => resolve(parseToolDiagnostics(request));
    }));
    const { host } = setup(provider, parse);
    const running = host.run(provider, "project-example", "typescript", path);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());
    host.update(path, "const newer = 3;\n");
    finish({ runId: "", diagnostics: [], notices: [] });
    await running;
    expect(host.diagnosticsForEditor(path)).toEqual([]);
    expect(api.stopToolSession).toHaveBeenCalledWith(provider.pluginId, "run-example");
    host.dispose();
  });

  it("requires an explicit saved-files choice before building with unsaved edits", async () => {
    const build = { ...provider, kind: "build" as const };
    vi.mocked(api.toolEnvironment).mockResolvedValue({
      scope: { projectId: "project-example", rootPath: "sample" }, configuration: { ...configuration, stdin: false },
      configured: true, platform: "macos", terminalSupported: true, limitation: null,
    });
    const { host } = setup(build);
    host.update(path, "const unsaved = 4;\n");
    await expect(host.run(build, "project-example", "typescript", path)).rejects.toThrow(/unsaved/i);
    expect(api.startToolSession).not.toHaveBeenCalled();
    await host.run(build, "project-example", "typescript", path, "manual", true);
    expect(host.diagnosticsForEditor(path)).toEqual([]);
    host.dispose();
  });

  it("checks source and run identity again before applying a previewed fix", async () => {
    vi.mocked(api.toolEnvironment).mockResolvedValue({
      scope: { projectId: "project-example", rootPath: "sample" }, configuration: { ...configuration, format: "eslint-json" },
      configured: true, platform: "macos", terminalSupported: true, limitation: null,
    });
    vi.mocked(api.pollToolSession).mockResolvedValue({
      status: "failed", exitCode: 1, error: null, events: [{ stream: "stdout", data: JSON.stringify([{
        filePath: "example.ts", messages: [{ line: 1, column: 7, severity: 1, message: "Rename.",
          fix: { range: [6, 10], text: "renamed" } }],
      }]) }],
    });
    const { host } = setup();
    const apply = vi.fn();
    host.attach(path, { readOnly: () => false, apply });
    await host.run(provider, "project-example", "typescript", path);
    const model = host.model(provider.id, "project-example", "typescript");
    const preview = await host.previewFix(model.diagnostics[0]);
    expect(preview.after).toBe("const renamed = 1;\n");
    expect(apply).not.toHaveBeenCalled();
    host.update(path, "const newer = 5;\n");
    await expect(host.applyFix(preview)).rejects.toThrow(/changed|stale/i);
    expect(apply).not.toHaveBeenCalled();
    host.dispose();
  });

  it("refuses all native tooling in encrypted vaults without making an IPC start", async () => {
    const { host, parse } = setup();
    host.configure([provider], (_pluginId, _providerId, request) => parse(request), "vault-example", "project-example", true);
    await expect(host.run(provider, "project-example", "typescript", path)).rejects.toThrow(/encrypted/i);
    expect(api.startToolSession).not.toHaveBeenCalled();
    host.dispose();
  });

  it("maps saved-file CRLF fix offsets to normalized editor source before preview", async () => {
    const source = "const first = 1;\nconst demo = \"example\";\n";
    const raw = source.replace(/\n/g, "\r\n");
    const from = raw.indexOf('"example"');
    vi.mocked(api.toolEnvironment).mockResolvedValue({
      scope: { projectId: "project-example", rootPath: "sample" },
      configuration: { ...configuration, stdin: false, format: "eslint-json" },
      configured: true, platform: "macos", terminalSupported: true, limitation: null,
    });
    vi.mocked(api.pollToolSession).mockResolvedValue({
      status: "failed", exitCode: 1, error: null, events: [{ stream: "stdout", data: JSON.stringify([{
        filePath: "example.ts", messages: [{ line: 2, column: 14, severity: 1, message: "Use single quotes.",
          fix: { range: [from, from + 9], text: "'example'" } }],
      }]) }],
    });
    const { host } = setup();
    host.syncDocuments([{ path, content: source, savedContent: source, savedHash: hash,
      projectId: "project-example", lineEnding: "crlf" }]);
    host.attach(path, { readOnly: () => false, apply: vi.fn() });
    await host.run(provider, "project-example", "typescript", path);
    const preview = await host.previewFix(host.model(provider.id, "project-example", "typescript").diagnostics[0]);
    expect(preview.after).toBe(source.replace('"example"', "'example'"));
    host.dispose();
  });
});
