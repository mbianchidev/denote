import { describe, expect, it } from "vitest";
import type { PluginStorage } from "@denote/plugin-sdk";
import {
  addRecurrence,
  nextRecurringSchedule,
  ReminderStore,
  parseReminderTargets,
  resolveWallClock,
} from "../src/reminders";

interface MemoryStorage extends PluginStorage {
  values: Map<string, unknown>;
}

function memoryStorage(
  entries: Array<[string, unknown]> = [],
): MemoryStorage {
  const values = new Map<string, unknown>(entries);
  return {
    values,
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
      ["standalone", null],
      ["note", null],
      ["heading", 4],
      ["task", 6],
    ]);
  });

  it("offers a standalone reminder without an open note", () => {
    expect(parseReminderTargets({ document: null }).targets).toEqual([
      {
        id: "standalone",
        kind: "standalone",
        path: null,
        noteTitle: null,
        line: null,
        label: "No note",
      },
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

  it("advances recurring civil dates and clamps short months", () => {
    expect(
      addRecurrence("2026-01-31T09:00", {
        interval: 1,
        unit: "month",
      }),
    ).toBe("2026-02-28T09:00");
    expect(
      addRecurrence("2024-02-29T09:00", {
        interval: 1,
        unit: "year",
      }),
    ).toBe("2025-02-28T09:00");
    expect(
      nextRecurringSchedule(
        {
          kind: "wall-clock",
          localDateTime: "2026-01-01T09:00",
          timeZone: "UTC",
        },
        { interval: 2, unit: "week" },
        Date.parse("2026-02-01T00:00:00Z"),
      ),
    ).toEqual({
      kind: "wall-clock",
      localDateTime: "2026-02-12T09:00",
      timeZone: "UTC",
    });
    expect(
      nextRecurringSchedule(
        {
          kind: "wall-clock",
          localDateTime: "2026-03-28T02:30",
          timeZone: "Europe/Rome",
        },
        { interval: 1, unit: "day" },
        Date.parse("2026-03-28T02:00:00Z"),
      ),
    ).toEqual({
      kind: "wall-clock",
      localDateTime: "2026-03-30T02:30",
      timeZone: "Europe/Rome",
    });
    expect(
      nextRecurringSchedule(
        {
          kind: "wall-clock",
          localDateTime: "2026-10-01T09:00",
          timeZone: "UTC",
        },
        { interval: 15, unit: "minute" },
        Date.parse("2026-10-01T09:05:00Z"),
      ),
    ).toEqual({
      kind: "instant",
      dueAt: Date.parse("2026-10-01T09:15:00Z"),
      timeZone: "UTC",
    });
    expect(
      nextRecurringSchedule(
        {
          kind: "wall-clock",
          localDateTime: "2026-10-01T09:00",
          timeZone: "UTC",
        },
        { interval: 2, unit: "hour" },
        Date.parse("2026-10-01T10:00:00Z"),
      ),
    ).toEqual({
      kind: "instant",
      dueAt: Date.parse("2026-10-01T11:00:00Z"),
      timeZone: "UTC",
    });
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
        recurrence: null,
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
        dueAt: dueAt + 15 * 60_000,
        timeZone: "Europe/Rome",
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

  it("edits standalone reminders and advances a recurring occurrence", async () => {
    const store = new ReminderStore(memoryStorage());
    const workspaceId = "scope-recurring";
    const createdAt = Date.parse("2026-01-01T00:00:00Z");
    const standalone = {
      id: "standalone",
      kind: "standalone" as const,
      path: null,
      noteTitle: null,
      line: null,
      label: "No note",
    };
    let model = await store.mutate({
      workspaceId,
      now: createdAt,
      mutation: {
        type: "create",
        id: "recurring-reminder",
        title: "Monthly review",
        target: standalone,
        schedule: {
          kind: "wall-clock",
          localDateTime: "2026-01-31T09:00",
          timeZone: "UTC",
        },
        recurrence: { interval: 1, unit: "month" },
        createdAt,
      },
    });
    const dueAt = model.reminders[0].dueAt;
    model = await store.mutate({
      workspaceId,
      now: createdAt,
      mutation: {
        type: "update",
        id: "recurring-reminder",
        title: "Edited monthly review",
        target: standalone,
        schedule: {
          kind: "wall-clock",
          localDateTime: "2026-01-31T10:00",
          timeZone: "UTC",
        },
        recurrence: { interval: 1, unit: "month" },
        updatedAt: createdAt + 1,
      },
    });
    expect(model.reminders[0]).toMatchObject({
      title: "Edited monthly review",
      target: { kind: "standalone", path: null },
      recurrence: { interval: 1, unit: "month" },
    });

    const editedDueAt = model.reminders[0].dueAt;
    model = await store.mutate({
      workspaceId,
      now: editedDueAt,
      mutation: {
        type: "delivery-started",
        id: "recurring-reminder",
        startedAt: editedDueAt,
      },
    });
    model = await store.mutate({
      workspaceId,
      now: editedDueAt + 1,
      mutation: {
        type: "delivery-succeeded",
        id: "recurring-reminder",
        completedAt: editedDueAt + 1,
      },
    });
    expect(model.reminders[0].status).toBe("notified");

    model = await store.mutate({
      workspaceId,
      now: editedDueAt + 2,
      mutation: {
        type: "dismiss",
        id: "recurring-reminder",
        updatedAt: editedDueAt + 2,
      },
    });
    expect(model.reminders[0]).toMatchObject({
      status: "scheduled",
      recurrence: { interval: 1, unit: "month" },
    });
    expect(model.reminders[0].dueAt).toBe(
      Date.parse("2026-02-28T10:00:00Z"),
    );
    expect(dueAt).not.toBe(editedDueAt);
  });

  it("migrates stored version-one reminders without losing them", async () => {
    const workspaceId = "scope-migration";
    const key = `reminders-v1-${workspaceId}`;
    const storage = memoryStorage([
      [
        key,
        {
          version: 1,
          reminders: [
            {
              id: "legacy-reminder",
              title: "Legacy reminder",
              target: {
                kind: "note",
                path: "Legacy.md",
                noteTitle: "Legacy",
                line: null,
              },
              schedule: {
                kind: "wall-clock",
                localDateTime: "2026-10-01T09:00",
                timeZone: "UTC",
              },
              status: "scheduled",
              createdAt: Date.parse("2026-09-01T09:00:00Z"),
              updatedAt: Date.parse("2026-09-01T09:00:00Z"),
              attemptCount: 0,
              deliveringAt: null,
              notifiedAt: null,
              lastError: null,
            },
          ],
        },
      ],
    ]);
    const store = new ReminderStore(storage);

    const model = await store.query({
      workspaceId,
      now: Date.parse("2026-09-01T10:00:00Z"),
    });

    expect(model.reminders[0]).toMatchObject({
      id: "legacy-reminder",
      recurrence: null,
      snoozedUntil: null,
      snoozeTimeZone: null,
    });
    expect(storage.values.get(key)).toMatchObject({ version: 2 });
  });
});
