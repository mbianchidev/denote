import { describe, expect, it, vi } from "vitest";
import type {
  PluginActivationContext,
  PluginNoteGraphProvider,
} from "@denote/plugin-sdk";
import plugin from "../src";

function activationContext(
  noteGraph?: PluginActivationContext["capabilities"]["noteGraph"],
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
    capabilities: noteGraph ? { noteGraph } : {},
    subscriptions: { add: vi.fn() },
  };
}

describe("Note graph plugin activation", () => {
  it("declares the required manifest contract", () => {
    expect(plugin.manifest).toMatchObject({
      id: "denote.note-graph",
      name: "Note graph",
      version: "0.1.0",
      license: "MIT",
      category: "knowledge-management",
      compatibility: {
        apiVersion: 1,
        minimumDenoteVersion: "0.4.0",
        maximumDenoteVersion: "1.0.0",
      },
      permissions: [{ capability: "note-graph" }],
      entrypoint: "dist/index.js",
    });
  });

  it("registers exactly one provider and adds its disposable", async () => {
    const dispose = vi.fn();
    const register = vi.fn((_provider: PluginNoteGraphProvider) => ({
      dispose,
    }));
    const context = activationContext({ register });

    await plugin.activate(context);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      id: "denote.note-graph.graph",
      title: "Note graph",
      index: expect.any(Function),
      query: expect.any(Function),
    });
    expect(context.subscriptions.add).toHaveBeenCalledWith({ dispose });
  });

  it("fails closed when the approved capability is absent", () => {
    const context = activationContext();

    expect(() => plugin.activate(context)).toThrow(
      /Note graph permission/,
    );
    expect(context.subscriptions.add).not.toHaveBeenCalled();
  });
});
