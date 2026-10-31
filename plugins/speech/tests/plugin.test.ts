import { describe, expect, it, vi } from "vitest";
import type { PluginActivationContext } from "@denote/plugin-sdk";
import plugin from "../src/index";

describe("isolated speech package", () => {
  it("registers only a disposable declarative host tool without opening a microphone or reading notes", async () => {
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
    expect(plugin.manifest.permissions).toEqual([{ capability: "speech" }]);
    await plugin.activate(context);
    expect(register).toHaveBeenCalledWith({ id: "denote.speech.local", title: "Speech", feature: "speech" });
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
    expect(context.storage.set).not.toHaveBeenCalled();
  });
});
