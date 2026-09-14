import { describe, expect, it } from "vitest";
import plugin from "../src";

describe("Kanban plugin activation", () => {
  it("registers one self-contained Kanban board provider", async () => {
    const registrations: unknown[] = [];
    await plugin.activate({
      pluginId: plugin.manifest.id,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
      storage: {
        async get() {
          return null;
        },
        async set() {},
        async delete() {},
        async clear() {},
      },
      settings: {
        async getAll() {
          return {};
        },
      },
      capabilities: {
        kanbanBoard: {
          register(provider) {
            registrations.push(provider);
            return { dispose() {} };
          },
        },
      },
      subscriptions: {
        add() {},
      },
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      id: "denote.kanban.board",
      fileSuffixes: [".kanban.md", ".kanban.markdown"],
      defaultFileName: "Board.kanban.md",
    });
  });
});
