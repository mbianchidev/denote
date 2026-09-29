import {
  MAX_PLUGIN_REMINDERS,
  MAX_PLUGIN_REMINDER_TARGETS,
  isPluginReminderModel,
  isReminderLocalDateTime,
  isReminderTimeZone,
  type PluginReminderLink,
  type PluginReminderModel,
  type PluginReminderMutationRequest,
  type PluginReminderQuery,
  type PluginReminderRecurrence,
  type PluginReminderRecord,
  type PluginReminderSchedule,
  type PluginReminderTarget,
  type PluginReminderTargetsModel,
  type PluginReminderTargetsRequest,
  type PluginStorage,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  checked?: boolean | null;
  children?: MarkdownNode[];
  position?: {
    start: { line: number };
  };
}

interface StoredWorkspace {
  version: 2;
  reminders: StoredReminder[];
}

type StoredReminder = Omit<PluginReminderRecord, "dueAt">;
type StoredReminderV1 = Omit<
  StoredReminder,
  "recurrence" | "snoozedUntil" | "snoozeTimeZone"
>;

interface StoredWorkspaceV1 {
  version: 1;
  reminders: StoredReminderV1[];
}

const STORAGE_PREFIX = "reminders-v1-";
const MAX_STORED_BYTES = 240 * 1024;
const STALE_DELIVERY_MS = 2 * 60_000;
const TASK_LINE = /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/u;
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export class ReminderStore {
  constructor(private readonly storage: PluginStorage) {}

  targets(request: PluginReminderTargetsRequest): PluginReminderTargetsModel {
    return parseReminderTargets(request);
  }

  async query(request: PluginReminderQuery): Promise<PluginReminderModel> {
    const { workspace, migrated } = await this.load(request.workspaceId);
    const recovered = recoverInterruptedDeliveries(
      workspace.reminders,
      request.now,
    );
    if (migrated || recovered > 0) {
      await this.save(request.workspaceId, workspace);
    }
    return toModel(
      workspace.reminders,
      recovered > 0
        ? [
            `${recovered} interrupted notification ${
              recovered === 1 ? "attempt was" : "attempts were"
            } returned to the schedule.`,
          ]
        : [],
    );
  }

  async mutate(
    request: PluginReminderMutationRequest,
  ): Promise<PluginReminderModel> {
    const { workspace } = await this.load(request.workspaceId);
    recoverInterruptedDeliveries(workspace.reminders, request.now);
    const mutation = request.mutation;
    const index = workspace.reminders.findIndex(
      (reminder) => reminder.id === mutation.id,
    );

    switch (mutation.type) {
      case "create": {
        if (index !== -1) {
          throw new Error("A reminder with this ID already exists.");
        }
        if (workspace.reminders.length >= MAX_PLUGIN_REMINDERS) {
          throw new Error(
            `This vault already has the maximum of ${MAX_PLUGIN_REMINDERS} reminders.`,
          );
        }
        const dueAt = resolveReminderSchedule(mutation.schedule);
        if (dueAt <= request.now) {
          throw new Error("Choose a reminder time in the future.");
        }
        workspace.reminders.push({
          id: mutation.id,
          title: mutation.title.trim(),
          target: storedLink(mutation.target),
          schedule: mutation.schedule,
          recurrence: mutation.recurrence,
          status: "scheduled",
          createdAt: mutation.createdAt,
          updatedAt: mutation.createdAt,
          attemptCount: 0,
          snoozedUntil: null,
          snoozeTimeZone: null,
          deliveringAt: null,
          notifiedAt: null,
          lastError: null,
        });
        break;
      }
      case "update": {
        const reminder = requireReminder(workspace.reminders, index);
        const dueAt = resolveReminderSchedule(mutation.schedule);
        if (dueAt <= request.now) {
          throw new Error("Choose a reminder time in the future.");
        }
        Object.assign(reminder, {
          title: mutation.title.trim(),
          target: storedLink(mutation.target),
          schedule: mutation.schedule,
          recurrence: mutation.recurrence,
          status: "scheduled",
          updatedAt: mutation.updatedAt,
          attemptCount: 0,
          snoozedUntil: null,
          snoozeTimeZone: null,
          deliveringAt: null,
          notifiedAt: null,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "dismiss": {
        const reminder = requireReminder(workspace.reminders, index);
        if (reminder.recurrence) {
          advanceRecurringReminder(reminder, mutation.updatedAt);
        } else {
          workspace.reminders.splice(index, 1);
        }
        break;
      }
      case "remove":
        requireReminder(workspace.reminders, index);
        workspace.reminders.splice(index, 1);
        break;
      case "snooze": {
        const reminder = requireReminder(workspace.reminders, index);
        if (mutation.dueAt <= request.now) {
          throw new Error("Choose a snooze time in the future.");
        }
        Object.assign(reminder, {
          status: "scheduled",
          updatedAt: mutation.updatedAt,
          snoozedUntil: mutation.dueAt,
          snoozeTimeZone: mutation.timeZone,
          deliveringAt: null,
          notifiedAt: null,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "delivery-started": {
        const reminder = requireReminder(workspace.reminders, index);
        if (
          reminder.status !== "scheduled" &&
          reminder.status !== "failed"
        ) {
          throw new Error("The reminder is not ready for delivery.");
        }
        if (reminderDueAt(reminder) > request.now) {
          throw new Error("The reminder is not due yet.");
        }
        Object.assign(reminder, {
          status: "delivering",
          updatedAt: mutation.startedAt,
          attemptCount: reminder.attemptCount + 1,
          deliveringAt: mutation.startedAt,
          notifiedAt: null,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "delivery-succeeded": {
        const reminder = requireReminder(workspace.reminders, index);
        if (reminder.status !== "delivering") {
          throw new Error("The reminder has no delivery in progress.");
        }
        Object.assign(reminder, {
          status: "notified",
          updatedAt: mutation.completedAt,
          deliveringAt: null,
          notifiedAt: mutation.completedAt,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "delivery-failed": {
        const reminder = requireReminder(workspace.reminders, index);
        if (reminder.status !== "delivering") {
          throw new Error("The reminder has no delivery in progress.");
        }
        Object.assign(reminder, {
          status: "failed",
          updatedAt: mutation.failedAt,
          deliveringAt: null,
          notifiedAt: null,
          lastError: mutation.error.trim(),
        } satisfies Partial<StoredReminder>);
        break;
      }
    }

    await this.save(request.workspaceId, workspace);
    return toModel(workspace.reminders);
  }

  private async load(
    workspaceId: string,
  ): Promise<{ workspace: StoredWorkspace; migrated: boolean }> {
    const value = await this.storage.get<unknown>(storageKey(workspaceId));
    if (value === null) {
      return {
        workspace: { version: 2, reminders: [] },
        migrated: false,
      };
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      ![1, 2].includes(
        (value as { version?: unknown }).version as number,
      ) ||
      !Array.isArray((value as { reminders?: unknown }).reminders)
    ) {
      throw new Error(
        "Stored reminder data is invalid. Clear Reminders data in plugin settings to recover.",
      );
    }
    const migrated = (value as { version: number }).version === 1;
    const candidate = migrated
      ? migrateWorkspace(value as StoredWorkspaceV1)
      : cloneWorkspace(value as StoredWorkspace);
    const model = toModel(candidate.reminders);
    if (!isPluginReminderModel(model)) {
      throw new Error(
        "Stored reminder data is invalid. Clear Reminders data in plugin settings to recover.",
      );
    }
    return { workspace: candidate, migrated };
  }

  private async save(
    workspaceId: string,
    workspace: StoredWorkspace,
  ): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
    if (bytes > MAX_STORED_BYTES) {
      throw new Error(
        "Reminder data reached its local storage limit. Dismiss old reminders or clear plugin data.",
      );
    }
    await this.storage.set(storageKey(workspaceId), workspace);
  }
}

export function parseReminderTargets(
  request: PluginReminderTargetsRequest,
): PluginReminderTargetsModel {
  const { document } = request;
  const targets: PluginReminderTarget[] = [
    {
      id: "standalone",
      kind: "standalone",
      path: null,
      noteTitle: null,
      line: null,
      label: "No note",
    },
  ];
  if (!document) {
    return {
      targets,
      truncated: false,
      notices: [],
    };
  }
  targets.push(
    {
      id: "note",
      kind: "note",
      path: document.path,
      noteTitle: document.title,
      line: null,
      label: `Whole note: ${document.title}`,
    },
  );
  let root: MarkdownNode;
  try {
    root = fromMarkdown(maskFrontmatter(document.source), {
      extensions: [gfmTaskListItem()],
      mdastExtensions: [gfmTaskListItemFromMarkdown()],
    }) as MarkdownNode;
  } catch {
    return {
      targets,
      truncated: false,
      notices: ["The note could not be parsed for heading and task targets."],
    };
  }
  const lines = document.source.split("\n");
  let ordinal = 0;
  visit(root, (node) => {
    if (targets.length >= MAX_PLUGIN_REMINDER_TARGETS) {
      return;
    }
    const line = node.position?.start.line;
    if (!line) {
      return;
    }
    if (node.type === "heading") {
      const label = nodeText(node).replace(/\s+/g, " ").trim();
      if (label) {
        targets.push({
          id: `heading:${line}:${++ordinal}`,
          kind: "heading",
          path: document.path,
          noteTitle: document.title,
          line,
          label: `Heading: ${label.slice(0, 200)}`,
        });
      }
      return;
    }
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const match = TASK_LINE.exec(lines[line - 1] ?? "");
      const label = match?.[1].trim();
      if (label) {
        targets.push({
          id: `task:${line}:${++ordinal}`,
          kind: "task",
          path: document.path,
          noteTitle: document.title,
          line,
          label: `Task: ${label.slice(0, 200)}`,
        });
      }
    }
  });
  const truncated = targets.length >= MAX_PLUGIN_REMINDER_TARGETS;
  return {
    targets,
    truncated,
    notices: truncated
      ? [
          `Showing the first ${MAX_PLUGIN_REMINDER_TARGETS} note, heading, and task targets.`,
        ]
      : [],
  };
}

export function resolveReminderSchedule(
  schedule: PluginReminderSchedule,
): number {
  if (schedule.kind === "instant") {
    return schedule.dueAt;
  }
  return resolveWallClock(schedule.localDateTime, schedule.timeZone);
}

export function resolveWallClock(
  localDateTime: string,
  timeZone: string,
): number {
  if (
    !isReminderLocalDateTime(localDateTime) ||
    !isReminderTimeZone(timeZone)
  ) {
    throw new Error("The reminder date, time, or time zone is invalid.");
  }
  const [date, time] = localDateTime.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (const delta of [
    -36 * 60 * 60_000,
    -24 * 60 * 60_000,
    -12 * 60 * 60_000,
    0,
    12 * 60 * 60_000,
    24 * 60 * 60_000,
    36 * 60 * 60_000,
  ]) {
    const instant = naive + delta;
    offsets.add(partsAsUtc(zonedParts(instant, timeZone)) - instant);
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((instant) =>
      sameWallClock(zonedParts(instant, timeZone), {
        year,
        month,
        day,
        hour,
        minute,
      }),
    )
    .sort((left, right) => left - right);
  const resolved = candidates[0];
  if (resolved === undefined) {
    throw new Error(
      `The local time ${localDateTime} does not exist in ${timeZone} because of a daylight-saving transition.`,
    );
  }
  return resolved;
}

function toModel(
  reminders: StoredReminder[],
  notices: string[] = [],
): PluginReminderModel {
  return {
    reminders: reminders
      .map((reminder) => ({
        ...reminder,
        target: { ...reminder.target },
        schedule: { ...reminder.schedule },
        recurrence: reminder.recurrence
          ? { ...reminder.recurrence }
          : null,
        dueAt: reminderDueAt(reminder),
      }))
      .sort(
        (left, right) =>
          left.dueAt - right.dueAt ||
          left.createdAt - right.createdAt ||
          left.id.localeCompare(right.id),
      ),
    truncated: false,
    notices,
  };
}

function reminderDueAt(reminder: StoredReminder): number {
  return reminder.snoozedUntil ?? resolveReminderSchedule(reminder.schedule);
}

function advanceRecurringReminder(
  reminder: StoredReminder,
  now: number,
): void {
  if (!reminder.recurrence) {
    throw new Error("The reminder is not recurring.");
  }
  reminder.schedule = nextRecurringSchedule(
    reminder.schedule,
    reminder.recurrence,
    now,
  );
  reminder.status = "scheduled";
  reminder.updatedAt = now;
  reminder.attemptCount = 0;
  reminder.snoozedUntil = null;
  reminder.snoozeTimeZone = null;
  reminder.deliveringAt = null;
  reminder.notifiedAt = null;
  reminder.lastError = null;
}

export function nextRecurringSchedule(
  schedule: PluginReminderSchedule,
  recurrence: PluginReminderRecurrence,
  after: number,
): PluginReminderSchedule {
  if (recurrence.unit === "minute" || recurrence.unit === "hour") {
    const base = resolveReminderSchedule(schedule);
    const interval =
      recurrence.interval *
      (recurrence.unit === "minute" ? 60_000 : 60 * 60_000);
    const elapsed = Math.max(0, after - base);
    const steps = Math.floor(elapsed / interval) + 1;
    return {
      kind: "instant",
      dueAt: base + steps * interval,
      timeZone: schedule.timeZone,
    };
  }
  let localDateTime =
    schedule.kind === "wall-clock"
      ? schedule.localDateTime
      : localDateTimeForInstant(schedule.dueAt, schedule.timeZone);
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    localDateTime = addRecurrence(localDateTime, recurrence);
    const next: PluginReminderSchedule = {
      kind: "wall-clock",
      localDateTime,
      timeZone: schedule.timeZone,
    };
    try {
      if (resolveReminderSchedule(next) > after) {
        return next;
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("does not exist")
      ) {
        throw error;
      }
    }
  }
  throw new Error("The recurring reminder could not reach a future date.");
}

export function addRecurrence(
  localDateTime: string,
  recurrence: PluginReminderRecurrence,
): string {
  if (!isReminderLocalDateTime(localDateTime)) {
    throw new Error("The recurring reminder date is invalid.");
  }
  const [datePart, timePart] = localDateTime.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  let targetYear = year;
  let targetMonth = month;
  let targetDay = day;
  switch (recurrence.unit) {
    case "minute": {
      const date = new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          hour,
          minute + recurrence.interval,
        ),
      );
      targetYear = date.getUTCFullYear();
      targetMonth = date.getUTCMonth() + 1;
      targetDay = date.getUTCDate();
      return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    }
    case "hour": {
      const date = new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          hour + recurrence.interval,
          minute,
        ),
      );
      targetYear = date.getUTCFullYear();
      targetMonth = date.getUTCMonth() + 1;
      targetDay = date.getUTCDate();
      return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    }
    case "day": {
      const date = new Date(
        Date.UTC(year, month - 1, day + recurrence.interval, hour, minute),
      );
      targetYear = date.getUTCFullYear();
      targetMonth = date.getUTCMonth() + 1;
      targetDay = date.getUTCDate();
      break;
    }
    case "week": {
      const date = new Date(
        Date.UTC(
          year,
          month - 1,
          day + recurrence.interval * 7,
          hour,
          minute,
        ),
      );
      targetYear = date.getUTCFullYear();
      targetMonth = date.getUTCMonth() + 1;
      targetDay = date.getUTCDate();
      break;
    }
    case "month": {
      const monthIndex = month - 1 + recurrence.interval;
      targetYear = year + Math.floor(monthIndex / 12);
      targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
      targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
      break;
    }
    case "year":
      targetYear = year + recurrence.interval;
      targetDay = Math.min(day, daysInMonth(targetYear, month));
      break;
  }
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localDateTimeForInstant(instant: number, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function recoverInterruptedDeliveries(
  reminders: StoredReminder[],
  now: number,
): number {
  let recovered = 0;
  for (const reminder of reminders) {
    if (
      reminder.status === "delivering" &&
      reminder.deliveringAt !== null &&
      reminder.deliveringAt <= now - STALE_DELIVERY_MS
    ) {
      reminder.status = "scheduled";
      reminder.updatedAt = now;
      reminder.deliveringAt = null;
      reminder.notifiedAt = null;
      reminder.lastError = null;
      recovered += 1;
    }
  }
  return recovered;
}

function storedLink(target: PluginReminderTarget): PluginReminderLink {
  return {
    kind: target.kind,
    path: target.path,
    noteTitle: target.noteTitle,
    line: target.line,
  };
}

function migrateWorkspace(workspace: StoredWorkspaceV1): StoredWorkspace {
  return {
    version: 2,
    reminders: workspace.reminders.map((reminder) => ({
      ...reminder,
      target: { ...reminder.target },
      schedule: { ...reminder.schedule },
      recurrence: null,
      snoozedUntil: null,
      snoozeTimeZone: null,
    })),
  };
}

function cloneWorkspace(workspace: StoredWorkspace): StoredWorkspace {
  return {
    version: 2,
    reminders: workspace.reminders.map((reminder) => ({
      ...reminder,
      target: { ...reminder.target },
      schedule: { ...reminder.schedule },
      recurrence: reminder.recurrence
        ? { ...reminder.recurrence }
        : null,
    })),
  };
}

function requireReminder(
  reminders: StoredReminder[],
  index: number,
): StoredReminder {
  const reminder = reminders[index];
  if (!reminder) {
    throw new Error("The reminder no longer exists.");
  }
  return reminder;
}

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = FORMATTERS.get(timeZone);
  if (existing) {
    return existing;
  }
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, created);
  return created;
}

function zonedParts(
  instant: number,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const values = new Map(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function partsAsUtc(parts: ReturnType<typeof zonedParts>): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function sameWallClock(
  actual: ReturnType<typeof zonedParts>,
  expected: Omit<ReturnType<typeof zonedParts>, "second">,
): boolean {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === 0
  );
}

function maskFrontmatter(source: string): string {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    return source;
  }
  const end = lines.findIndex(
    (line, index) =>
      index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (end === -1) {
    return source;
  }
  return lines
    .map((line, index) => (index <= end ? " ".repeat(line.length) : line))
    .join("\n");
}

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(nodeText).join("");
}
