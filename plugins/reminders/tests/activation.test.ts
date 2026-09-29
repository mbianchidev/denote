import { describe, expect, it, vi } from "vitest";
import type {
  PluginActivationContext,
  PluginReminderProvider,
} from "@denote/plugin-sdk";
import plugin from "../src";

describe("reminders activation", () => {
  it("registers the configured default snooze interval", async () => {
    const dispose = vi.fn();
    const register = vi.fn((_provider: PluginReminderProvider) => ({
      dispose,
    }));
    const context = {
      pluginId: "denote.reminders",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      storage: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      },
      settings: {
        getAll: vi.fn(async () => ({ defaultSnoozeMinutes: 30 })),
      },
      capabilities: { reminders: { register } },
      subscriptions: { add: vi.fn() },
    } satisfies PluginActivationContext;

    await plugin.activate(context);

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "denote.reminders.main",
        defaultSnoozeMinutes: 30,
      }),
    );
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
  });
});
