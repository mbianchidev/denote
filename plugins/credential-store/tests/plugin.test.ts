import { describe, expect, it, vi } from "vitest";
import type { PluginActivationContext } from "@denote/plugin-sdk";
import plugin from "../src/index";

describe("isolated credential package", () => {
  it("registers no entry, keychain, clipboard, or workspace service in the downloaded worker", async () => {
    const dispose = vi.fn();
    const register = vi.fn(() => ({ dispose }));
    const context: PluginActivationContext = {
      pluginId: plugin.manifest.id,
      subscriptions: { add: vi.fn() },
      capabilities: { sensitiveTools: { register } },
      storage: { get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn(), clear: vi.fn() },
      settings: { getAll: vi.fn(async () => ({})) },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    expect(plugin.manifest.permissions).toEqual([{ capability: "credential-store" }]);
    await plugin.activate(context);
    expect(register).toHaveBeenCalledWith({ id: "denote.credential-store.entries", title: "Credential store", feature: "credential-store" });
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
    expect(context.storage.set).not.toHaveBeenCalled();
  });
});
