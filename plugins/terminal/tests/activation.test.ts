import { describe, expect, it, vi } from "vitest";
import { type PluginActivationContext, type PluginDisposable } from "@denote/plugin-sdk";
import plugin from "../src";

describe("optional terminal package", () => {
  it("only declares a host-owned terminal and never selects or starts a shell on activation", async () => {
    const registrations: Array<{ id: string; title: string }> = [];
    const subscriptions: PluginDisposable[] = [];
    const dispose = vi.fn();
    const writes = vi.fn(async () => {});
    const context: PluginActivationContext = {
      pluginId: plugin.manifest.id, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: async () => null, set: writes, delete: writes, clear: writes },
      settings: { getAll: async () => ({}) }, subscriptions: { add: (value) => subscriptions.push(value) },
      capabilities: {
        terminal: { register: (terminal) => { registrations.push(terminal); return { dispose }; } },
        sidebar: { register: () => ({ dispose }) },
      },
    };
    await plugin.activate(context);
    expect(registrations).toEqual([{ id: "denote.terminal.sessions", title: "Ghostty terminal" }]);
    expect(plugin.manifest.permissions.map((permission) => permission.capability)).toEqual(["terminal", "project-context", "sidebar"]);
    expect(writes).not.toHaveBeenCalled();
    await Promise.all(subscriptions.map((subscription) => subscription.dispose()));
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
