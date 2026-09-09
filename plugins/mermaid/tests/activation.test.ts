import { describe, expect, it, vi } from "vitest";
import type {
  PluginActivationContext,
  PluginDiagramRenderer,
} from "@denote/plugin-sdk";
import plugin from "../src/index";

describe("Mermaid plugin activation", () => {
  it("registers one declarative renderer and no privileged capability", async () => {
    const dispose = vi.fn();
    const register = vi.fn((_renderer: PluginDiagramRenderer) => ({ dispose }));
    const add = vi.fn();
    const context = {
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
      capabilities: {
        diagramRenderer: { register },
      },
      subscriptions: { add },
    } satisfies PluginActivationContext;

    await plugin.activate(context);

    expect(plugin.manifest.permissions).toEqual([
      { capability: "diagram-renderer" },
    ]);
    expect(register).toHaveBeenCalledWith({
      id: "denote.mermaid.renderer",
      title: "Mermaid diagrams",
      languages: ["mermaid"],
    });
    expect(add).toHaveBeenCalledWith({ dispose });
  });

  it("fails clearly when the approved renderer capability is absent", async () => {
    const context = {
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
      capabilities: {},
      subscriptions: { add: vi.fn() },
    } satisfies PluginActivationContext;

    expect(() => plugin.activate(context)).toThrow(
      /Diagram renderer permission/,
    );
  });
});
