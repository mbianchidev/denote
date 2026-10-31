import { describe, expect, it, vi } from "vitest";
import { checkPluginCompatibility, type PluginActivationContext, type PluginDisposable, type PluginToolingProvider } from "@denote/plugin-sdk";
import plugin from "../src";

describe("optional linter package", () => {
  it("only registers disposable host surfaces on enablement and shares typed diagnostics", async () => {
    const providers: PluginToolingProvider[] = [];
    const subscriptions: PluginDisposable[] = [];
    const dispose = vi.fn();
    const writes = vi.fn(async () => {});
    const context: PluginActivationContext = {
      pluginId: plugin.manifest.id,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: async () => null, set: writes, delete: writes, clear: writes },
      settings: { getAll: async () => ({}) }, subscriptions: { add: (value) => subscriptions.push(value) },
      capabilities: {
        tooling: { register: (provider) => { providers.push(provider); return { dispose }; } },
        sidebar: { register: () => ({ dispose }) },
      },
    };
    await plugin.activate(context);
    expect(providers[0].kind).toBe("linter");
    const result = await providers[0].parse({ runId: "synthetic-run", scope: { projectId: null, rootPath: "" },
      format: "unix", stdout: "example.ts:1:1: warning: Example. [example]\n", stderr: "",
      documents: [{ path: "example.ts", version: "synthetic-version" }] });
    expect(result.diagnostics[0]).toMatchObject({ path: "example.ts", version: "synthetic-version", rule: "example" });
    expect(writes).not.toHaveBeenCalled();
    await Promise.all(subscriptions.map((subscription) => subscription.dispose()));
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(checkPluginCompatibility(plugin.manifest, "0.11.0", 1).compatible).toBe(false);
    expect(checkPluginCompatibility(plugin.manifest, "0.12.0", 1).compatible).toBe(true);
  });
});
