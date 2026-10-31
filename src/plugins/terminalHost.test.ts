import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginToolContribution } from "@denote/plugin-sdk";
import { api } from "../lib/api";
import { TerminalHost } from "./terminalHost";

const provider: PluginToolContribution = { pluginId: "denote.example-terminal", id: "denote.example-terminal.sessions",
  title: "Terminal", kind: "terminal", formats: [] };
const context = { workspaceScope: "vault-example", projectId: "project-example", kind: "terminal" as const, language: "shell" };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "startToolSession").mockResolvedValue({
    runId: "terminal-example", scope: { projectId: "project-example", rootPath: "sample" }, documents: [],
  });
  vi.spyOn(api, "pollToolSession").mockResolvedValue({ status: "running", exitCode: null, error: null, events: [] });
  vi.spyOn(api, "stopToolSession").mockResolvedValue(undefined);
  vi.spyOn(api, "stopToolSessions").mockResolvedValue(undefined);
  vi.spyOn(api, "writeToolInput").mockResolvedValue(undefined);
  vi.spyOn(api, "resizeToolTerminal").mockResolvedValue(undefined);
});

describe("interactive terminal host", () => {
  it("keeps a tab bound to its starting project when focus moves within the same vault", async () => {
    const host = new TerminalHost(vi.fn());
    host.configure([provider], "vault-example", "project-example", false);
    const tab = await host.start(provider, context, "sample");
    host.configure([provider], "vault-example", "project-other", false);
    expect(host.tabs(provider.id)[0].context.projectId).toBe("project-example");
    expect(api.stopToolSessions).not.toHaveBeenCalled();
    await host.close(tab.id, true);
    host.dispose();
  });
  it("requires confirmation to close a running terminal and cleans up on disable", async () => {
    const host = new TerminalHost(vi.fn());
    host.configure([provider], "vault-example", "project-example", false);
    const tab = await host.start(provider, context, "sample");
    await expect(host.close(tab.id, false)).rejects.toThrow(/confirm/i);
    expect(api.stopToolSession).not.toHaveBeenCalled();
    await host.close(tab.id, true);
    expect(api.stopToolSession).toHaveBeenCalledWith(provider.pluginId, tab.id);
    expect(host.tabs(provider.id)).toEqual([]);
    host.dispose();
  });

  it("stops a process whose pending start finishes after a scope change", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.startToolSession>>) => void;
    vi.mocked(api.startToolSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const host = new TerminalHost(vi.fn());
    host.configure([provider], "vault-example", "project-example", false);
    const started = host.start(provider, context, "sample").catch((error: unknown) => error);
    host.configure([provider], "another-vault", "another-project", false);
    finish({ runId: "late-terminal", scope: { projectId: "project-example", rootPath: "sample" }, documents: [] });
    expect(await started).toBeInstanceOf(DOMException);
    expect(api.stopToolSession).toHaveBeenCalledWith(provider.pluginId, "late-terminal");
    expect(host.tabs(provider.id)).toEqual([]);
    host.dispose();
  });

  it("preserves binary terminal chunks and nonzero exit codes without a success fallback", async () => {
    vi.mocked(api.pollToolSession).mockResolvedValue({
      status: "failed", exitCode: 7, error: null, events: [{ stream: "terminal", data: btoa("example\r\n") }],
    });
    const host = new TerminalHost(vi.fn());
    host.configure([provider], "vault-example", "project-example", false);
    const tab = await host.start(provider, context, "sample");
    await vi.waitFor(() => expect(host.tabs(provider.id)[0].exitCode).toBe(7));
    expect(new TextDecoder().decode(host.events(tab.id, 0)[0].data)).toBe("example\r\n");
    expect(host.tabs(provider.id)[0].status).toBe("failed");
    host.dispose();
  });

  it("blocks encrypted vaults and serializes keyboard input", async () => {
    const host = new TerminalHost(vi.fn());
    host.configure([provider], "vault-example", "project-example", true);
    await expect(host.start(provider, context, "sample")).rejects.toThrow(/encrypted/i);
    expect(api.startToolSession).not.toHaveBeenCalled();
    host.configure([provider], "vault-example", "project-example", false);
    const tab = await host.start(provider, context, "sample");
    await Promise.all([host.write(tab.id, "a"), host.write(tab.id, "λ")]);
    expect(vi.mocked(api.writeToolInput).mock.calls.map((call) => call[3])).toEqual(["a", "λ"]);
    host.dispose();
  });
});
