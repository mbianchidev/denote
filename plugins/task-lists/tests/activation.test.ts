import { describe, expect, it, vi } from "vitest";
import type {
  PluginActivationContext,
  PluginTaskListProvider,
} from "@denote/plugin-sdk";
import plugin from "../src";

function activationContext(
  taskList?: PluginActivationContext["capabilities"]["taskList"],
): PluginActivationContext {
  return {
    pluginId: plugin.manifest.id,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    storage: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    },
    settings: { getAll: vi.fn() },
    capabilities: taskList ? { taskList } : {},
    subscriptions: { add: vi.fn() },
  };
}

describe("Advanced task lists activation", () => {
  it("registers one bounded provider", () => {
    const dispose = vi.fn();
    const register = vi.fn((_provider: PluginTaskListProvider) => ({
      dispose,
    }));
    const context = activationContext({ register });

    plugin.activate(context);

    expect(plugin.manifest).toMatchObject({
      id: "denote.task-lists",
      version: "0.1.0",
      category: "productivity",
      compatibility: { apiVersion: 1, minimumDenoteVersion: "0.6.0" },
      permissions: [{ capability: "task-list" }],
    });
    expect(register).toHaveBeenCalledExactlyOnceWith({
      id: "denote.task-lists.tasks",
      title: "Advanced task lists",
      index: expect.any(Function),
      query: expect.any(Function),
      toggle: expect.any(Function),
    });
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
  });

  it("fails closed without the approved capability", () => {
    const context = activationContext();

    expect(() => plugin.activate(context)).toThrow(/Task list permission/);
    expect(context.subscriptions.add).not.toHaveBeenCalled();
  });
});
