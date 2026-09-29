import { describe, expect, it } from "vitest";
import {
  isPluginReminderModel,
  isPluginReminderMutationRequest,
  isPluginReminderQuery,
  isPluginReminderRecurrence,
  isPluginReminderRegistration,
  isPluginReminderTargetsModel,
  isPluginReminderTargetsRequest,
  isReminderLocalDateTime,
  isReminderTimeZone,
  truncateUtf8,
} from "./reminders";
import { validatePluginManifest } from "./validation";

const target = {
  id: "task:8",
  kind: "task" as const,
  path: "notes/Release.md",
  noteTitle: "Release",
  line: 8,
  label: "Ship the desktop build",
};

const reminder = {
  id: "66fe259f-8966-4a3e-b29e-5c7c640268ed",
  title: "Ship release",
  target: {
    kind: target.kind,
    path: target.path,
    noteTitle: target.noteTitle,
    line: target.line,
  },
  schedule: {
    kind: "wall-clock" as const,
    localDateTime: "2026-10-25T09:30",
    timeZone: "Europe/Rome",
  },
  recurrence: null,
  dueAt: 1_793_000_000_000,
  snoozedUntil: null,
  snoozeTimeZone: null,
  status: "scheduled" as const,
  createdAt: 1_792_000_000_000,
  updatedAt: 1_792_000_000_000,
  attemptCount: 0,
  deliveringAt: null,
  notifiedAt: null,
  lastError: null,
};

describe("reminder contracts", () => {
  it("validates registrations, bounded target parsing, and vault-scoped queries", () => {
    expect(
      isPluginReminderRegistration({
        id: "denote.reminders.main",
        title: "Reminders",
        defaultSnoozeMinutes: 15,
      }),
    ).toBe(true);
    expect(
      isPluginReminderRegistration({
        id: "denote.reminders.main",
        title: "Reminders",
        defaultSnoozeMinutes: 0,
      }),
    ).toBe(false);
    expect(
      isPluginReminderTargetsRequest({
        document: {
          path: "notes/Release.md",
          title: "Release",
          source: "# Release\n\n- [ ] Ship the desktop build",
        },
      }),
    ).toBe(true);
    expect(isPluginReminderTargetsRequest({ document: null })).toBe(true);
    expect(
      isPluginReminderTargetsModel({
        targets: [
          {
            id: "standalone",
            kind: "standalone",
            path: null,
            noteTitle: null,
            line: null,
            label: "No note",
          },
          {
            id: "note",
            kind: "note",
            path: "notes/Release.md",
            noteTitle: "Release",
            line: null,
            label: "Whole note",
          },
          target,
        ],
        truncated: false,
        notices: [],
      }),
    ).toBe(true);
    expect(
      isPluginReminderQuery({
        workspaceId: "ce862ce4-cfd2-4b83-8499-e387c71f120d",
        now: Date.now(),
      }),
    ).toBe(true);
  });

  it("validates civil-time schedules and all delivery mutations", () => {
    expect(isReminderLocalDateTime("2026-10-25T02:30")).toBe(true);
    expect(isReminderLocalDateTime("2026-02-29T09:00")).toBe(false);
    expect(isReminderLocalDateTime("2026-10-25T24:00")).toBe(false);
    expect(isReminderTimeZone("Europe/Rome")).toBe(true);
    expect(isReminderTimeZone("Not/AZone")).toBe(false);
    expect(
      isPluginReminderRecurrence({ interval: 2, unit: "week" }),
    ).toBe(true);
    expect(
      isPluginReminderRecurrence({ interval: 15, unit: "minute" }),
    ).toBe(true);
    expect(
      isPluginReminderRecurrence({ interval: 0, unit: "week" }),
    ).toBe(false);

    for (const mutation of [
      {
        type: "create",
        id: reminder.id,
        title: reminder.title,
        target,
        schedule: reminder.schedule,
        recurrence: { interval: 2, unit: "week" },
        createdAt: reminder.createdAt,
      },
      {
        type: "update",
        id: reminder.id,
        title: "Updated release",
        target,
        schedule: reminder.schedule,
        recurrence: null,
        updatedAt: reminder.updatedAt,
      },
      {
        type: "snooze",
        id: reminder.id,
        dueAt: reminder.dueAt + 15 * 60_000,
        timeZone: "Europe/Rome",
        updatedAt: reminder.updatedAt,
      },
      { type: "dismiss", id: reminder.id, updatedAt: reminder.updatedAt },
      { type: "remove", id: reminder.id, updatedAt: reminder.updatedAt },
      {
        type: "delivery-started",
        id: reminder.id,
        startedAt: reminder.updatedAt,
      },
      {
        type: "delivery-succeeded",
        id: reminder.id,
        completedAt: reminder.updatedAt,
      },
      {
        type: "delivery-failed",
        id: reminder.id,
        failedAt: reminder.updatedAt,
        error: "Notification service unavailable",
      },
    ]) {
      expect(
        isPluginReminderMutationRequest({
          workspaceId: "ce862ce4-cfd2-4b83-8499-e387c71f120d",
          now: reminder.updatedAt,
          mutation,
        }),
      ).toBe(true);
    }
  });

  it("validates delivery state invariants and UTF-8 notification limits", () => {
    expect(
      isPluginReminderModel({
        reminders: [reminder],
        truncated: false,
        notices: [],
      }),
    ).toBe(true);
    expect(
      isPluginReminderModel({
        reminders: [
          {
            ...reminder,
            status: "failed",
            lastError: null,
          },
        ],
        truncated: false,
        notices: [],
      }),
    ).toBe(false);
    expect(new TextEncoder().encode(truncateUtf8("🚀".repeat(100), 120)).byteLength)
      .toBeLessThanOrEqual(120);
  });

  it("requires notifications whenever a manifest requests reminders", () => {
    const manifest = {
      schemaVersion: 1,
      id: "denote.synthetic-reminders",
      name: "Synthetic reminders",
      version: "0.1.0",
      description: "Synthetic reminder contract fixture.",
      publisher: { name: "Denote" },
      license: "MIT",
      repository: "https://github.com/mbianchidev/denote",
      icon: "icon.svg",
      category: "productivity",
      compatibility: {
        apiVersion: 1,
        minimumDenoteVersion: "0.8.0",
      },
      permissions: [{ capability: "reminders" }],
      entrypoint: "dist/index.js",
      documentation: "guide.md",
    };
    expect(validatePluginManifest(manifest).valid).toBe(false);
    expect(
      validatePluginManifest({
        ...manifest,
        permissions: [
          { capability: "reminders" },
          { capability: "notifications" },
        ],
      }).valid,
    ).toBe(true);
  });
});
