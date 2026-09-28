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
  version: 1;
  reminders: StoredReminder[];
}

type StoredReminder = Omit<PluginReminderRecord, "dueAt">;

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
    const workspace = await this.load(request.workspaceId);
    const recovered = recoverInterruptedDeliveries(
      workspace.reminders,
      request.now,
    );
    if (recovered > 0) {
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
    const workspace = await this.load(request.workspaceId);
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
          status: "scheduled",
          createdAt: mutation.createdAt,
          updatedAt: mutation.createdAt,
          attemptCount: 0,
          deliveringAt: null,
          notifiedAt: null,
          lastError: null,
        });
        break;
      }
      case "dismiss":
        if (index === -1) {
          throw new Error("The reminder no longer exists.");
        }
        workspace.reminders.splice(index, 1);
        break;
      case "snooze": {
        const reminder = requireReminder(workspace.reminders, index);
        const dueAt = resolveReminderSchedule(mutation.schedule);
        if (dueAt <= request.now) {
          throw new Error("Choose a snooze time in the future.");
        }
        Object.assign(reminder, {
          schedule: mutation.schedule,
          status: "scheduled",
          updatedAt: mutation.updatedAt,
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
        if (resolveReminderSchedule(reminder.schedule) > request.now) {
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

  private async load(workspaceId: string): Promise<StoredWorkspace> {
    const value = await this.storage.get<unknown>(storageKey(workspaceId));
    if (value === null) {
      return { version: 1, reminders: [] };
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (value as { version?: unknown }).version !== 1 ||
      !Array.isArray((value as { reminders?: unknown }).reminders)
    ) {
      throw new Error(
        "Stored reminder data is invalid. Clear Reminders data in plugin settings to recover.",
      );
    }
    const candidate = value as StoredWorkspace;
    const model = toModel(candidate.reminders);
    if (!isPluginReminderModel(model)) {
      throw new Error(
        "Stored reminder data is invalid. Clear Reminders data in plugin settings to recover.",
      );
    }
    return {
      version: 1,
      reminders: candidate.reminders.map((reminder) => ({
        ...reminder,
        target: { ...reminder.target },
        schedule: { ...reminder.schedule },
      })),
    };
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
      id: "note",
      kind: "note",
      path: document.path,
      noteTitle: document.title,
      line: null,
      label: `Whole note: ${document.title}`,
    },
  ];
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
        dueAt: resolveReminderSchedule(reminder.schedule),
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
