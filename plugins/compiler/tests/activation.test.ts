import { describe, expect, it, vi } from "vitest";
import { type PluginActivationContext, type PluginDisposable, type PluginToolingProvider } from "@denote/plugin-sdk";
import plugin from "../src";

describe("optional compiler package", () => {
  it("registers an independent build parser without starting tools or importing Linter", async () => {
    const providers: PluginToolingProvider[] = [];
    const subscriptions: PluginDisposable[] = [];
    const dispose = vi.fn();
    const writes = vi.fn(async () => {});
    const context: PluginActivationContext = {
      pluginId: plugin.manifest.id, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: async () => null, set: writes, delete: writes, clear: writes },
      settings: { getAll: async () => ({}) }, subscriptions: { add: (value) => subscriptions.push(value) },
      capabilities: {
        tooling: { register: (provider) => { providers.push(provider); return { dispose }; } },
        sidebar: { register: () => ({ dispose }) },
      },
    };
    await plugin.activate(context);
    expect(providers[0].kind).toBe("build");
    const result = await providers[0].parse({ runId: "synthetic-build", scope: { projectId: null, rootPath: "" },
      format: "msvc", stdout: "", stderr: "example.cpp(2,3): error C1000: Example error.\n",
      documents: [{ path: "example.cpp", version: "synthetic-version" }] });
    expect(result).toMatchObject({ runId: "synthetic-build", diagnostics: [{ severity: "error", rule: "C1000" }] });
    expect(result.diagnostics[0].fix).toBeUndefined();
    expect(writes).not.toHaveBeenCalled();
    await Promise.all(subscriptions.map((subscription) => subscription.dispose()));
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
