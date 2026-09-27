import { describe, expect, it, vi } from "vitest";
import type { PluginActivationContext, PluginCalendarProvider } from "@denote/plugin-sdk";
import plugin from "../src";

describe("Calendar activation", () => {
  it("registers one read-only provider with approved settings and disposes it", async () => {
    const dispose = vi.fn();
    const register = vi.fn((_provider: PluginCalendarProvider) => ({ dispose }));
    const context: PluginActivationContext = {
      pluginId: plugin.manifest.id,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() },
      settings: { getAll: vi.fn().mockResolvedValue({ dailyFolder: "Journal" }) },
      capabilities: { calendar: { register } },
      subscriptions: { add: vi.fn() },
    };
    await plugin.activate(context);
    expect(plugin.manifest.permissions).toEqual([{ capability: "calendar" }]);
    expect(plugin.manifest.compatibility.minimumDenoteVersion).toBe("0.6.0");
    expect(register).toHaveBeenCalledExactlyOnceWith({
      id: "denote.calendar.main", title: "Calendar", query: expect.any(Function),
      views: ["dated", "created", "updated"],
    });
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
    const model = await register.mock.calls[0][0].query({
      startDate: "2026-09-01", endDate: "2026-09-01",
      documents: [], skippedCount: 0, truncated: false,
    });
    expect(model.days[0].dailyNotePath).toBe("Journal/2026-09-01.md");
    await expect(plugin.activate({ ...context, capabilities: {} })).rejects.toThrow(/Calendar permission/);
    expect(context.storage.set).not.toHaveBeenCalled();
  });
});
