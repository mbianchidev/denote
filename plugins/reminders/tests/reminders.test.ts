import { describe, expect, it } from "vitest";
import type { PluginStorage } from "@denote/plugin-sdk";
import {
  ReminderStore,
  parseReminderTargets,
  resolveWallClock,
} from "../src/reminders";

function memoryStorage(): PluginStorage {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: async <T>(key: string, value: T) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key: string) => {
      values.delete(key);
    },
    clear: async () => {
      values.clear();
    },
  };
}

describe("reminder targets", () => {
  it("returns a note plus synthetic heading and task anchors", () => {
    const model = parseReminderTargets({
      document: {
        path: "plans/Release.md",
        title: "Release",
        source: [
          "---",
          "title: Synthetic plan",
          "---",
          "# Prepare",
          "",
          "- [ ] Sign the package",
          "",
          "```md",
          "# Not a target",
          "- [ ] Not a task target",
          "```",
        ].join("\n"),
      },
    });

    expect(model.targets.map(({ kind, line }) => [kind, line])).toEqual([
      ["note", null],
      ["heading", 4],
      ["task", 6],
    ]);
  });
});

describe("reminder schedules", () => {
  it("chooses the earlier repeated DST instant and rejects skipped local time", () => {
    expect(resolveWallClock("2026-10-25T02:30", "Europe/Rome")).toBe(
      Date.parse("2026-10-25T00:30:00Z"),
    );
    expect(() =>
      resolveWallClock("2026-03-29T02:30", "Europe/Rome"),
    ).toThrow(/does not exist/u);
  });
});

describe("reminder storage", () => {
  it("persists delivery state, snoozes, and dismisses per opaque workspace", async () => {
    const store = new ReminderStore(memoryStorage());
    const workspaceId = "scope-alpha";
    const createdAt = Date.parse("2026-09-28T18:00:00Z");
    const target = {
      id: "task:6:1",
      kind: "task" as const,
      path: "plans/Release.md",
      noteTitle: "Release",
      line: 6,
      label: "Task: Sign the package",
    };
    const schedule = {
      kind: "wall-clock" as const,
      localDateTime: "2026-09-28T21:00",
      timeZone: "Europe/Rome",
    };

    let model = await store.mutate({
      workspaceId,
      now: createdAt,
      mutation: {
        type: "create",
        id: "reminder-alpha",
        title: "Sign release",
        target,
        schedule,
        createdAt,
      },
    });
    expect(model.reminders[0]).toMatchObject({
      status: "scheduled",
      target: {
        kind: "task",
        path: "plans/Release.md",
        line: 6,
      },
    });
    expect(JSON.stringify(model.reminders[0])).not.toContain("Sign the package");

    const dueAt = model.reminders[0].dueAt;
    model = await store.mutate({
      workspaceId,
      now: dueAt,
      mutation: {
        type: "delivery-started",
        id: "reminder-alpha",
        startedAt: dueAt,
      },
    });
    expect(model.reminders[0].status).toBe("delivering");

    model = await store.mutate({
      workspaceId,
      now: dueAt + 1,
      mutation: {
        type: "delivery-failed",
        id: "reminder-alpha",
        failedAt: dueAt + 1,
        error: "Synthetic notification failure",
      },
    });
    expect(model.reminders[0]).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastError: "Synthetic notification failure",
    });

    model = await store.mutate({
      workspaceId,
      now: dueAt + 2,
      mutation: {
        type: "snooze",
        id: "reminder-alpha",
        schedule: {
          kind: "instant",
          dueAt: dueAt + 15 * 60_000,
          timeZone: "Europe/Rome",
        },
        updatedAt: dueAt + 2,
      },
    });
    expect(model.reminders[0]).toMatchObject({
      status: "scheduled",
      dueAt: dueAt + 15 * 60_000,
      lastError: null,
    });

    model = await store.mutate({
      workspaceId,
      now: dueAt + 3,
      mutation: {
        type: "dismiss",
        id: "reminder-alpha",
        updatedAt: dueAt + 3,
      },
    });
    expect(model.reminders).toEqual([]);
  });
});
