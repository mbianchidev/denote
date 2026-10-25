import {
  MAX_PLUGIN_REMINDERS,
  MAX_PLUGIN_REMINDER_TARGETS,
  isPluginReminderModel,
  nextRecurringSchedule,
  resolveReminderSchedule,
  type PluginReminderLink,
  type PluginReminderModel,
  type PluginReminderMutationRequest,
  type PluginReminderQuery,
  type PluginReminderRecord,
  type PluginReminderTarget,
  type PluginReminderTargetsModel,
  type PluginReminderTargetsRequest,
  type PluginStorage,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

export { addRecurrence, nextRecurringSchedule, resolveWallClock } from "@denote/plugin-sdk";

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
  version: 3;
  reminders: StoredReminder[];
}

type StoredReminder = Omit<PluginReminderRecord, "dueAt">;
type StoredReminderV2 = Omit<
  StoredReminder,
  "completedAt" | "dismissedAt"
>;
type StoredReminderV1 = Omit<
  StoredReminderV2,
  "recurrence" | "snoozedUntil" | "snoozeTimeZone"
>;

interface StoredWorkspaceV1 {
  version: 1;
  reminders: StoredReminderV1[];
}

interface StoredWorkspaceV2 {
  version: 2;
  reminders: StoredReminderV2[];
}

const STORAGE_PREFIX = "reminders-v1-";
const MAX_STORED_BYTES = 240 * 1024;
const STALE_DELIVERY_MS = 2 * 60_000;
const TASK_LINE = /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/u;

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
          completedAt: null,
          dismissedAt: null,
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
          completedAt: null,
          dismissedAt: null,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "dismiss": {
        const reminder = requireReminder(workspace.reminders, index);
        Object.assign(reminder, {
          status: "dismissed",
          updatedAt: mutation.dismissedAt,
          deliveringAt: null,
          notifiedAt: null,
          completedAt: null,
          dismissedAt: mutation.dismissedAt,
          lastError: null,
        } satisfies Partial<StoredReminder>);
        break;
      }
      case "complete": {
        const reminder = requireReminder(workspace.reminders, index);
        if (
          reminder.status !== "notified" &&
          reminder.status !== "failed"
        ) {
          throw new Error("Only a running reminder can be completed.");
        }
        if (reminder.recurrence) {
          if (
            workspace.reminders.some(
              (candidate) => candidate.id === mutation.historyId,
            )
          ) {
            throw new Error("The completed occurrence ID already exists.");
          }
          pruneArchivedReminder(workspace.reminders);
          workspace.reminders.push({
            ...reminder,
            id: mutation.historyId,
            recurrence: null,
            status: "completed",
            updatedAt: mutation.completedAt,
            attemptCount: 0,
            deliveringAt: null,
            notifiedAt: null,
            completedAt: mutation.completedAt,
            dismissedAt: null,
            lastError: null,
          });
          advanceRecurringReminder(reminder, mutation.completedAt);
        } else {
          Object.assign(reminder, {
            status: "completed",
            updatedAt: mutation.completedAt,
            deliveringAt: null,
            notifiedAt: null,
            completedAt: mutation.completedAt,
            dismissedAt: null,
            lastError: null,
          } satisfies Partial<StoredReminder>);
        }
        break;
      }
      case "restore": {
        const reminder = requireReminder(workspace.reminders, index);
        if (reminder.status !== "dismissed") {
          throw new Error("Only a dismissed reminder can be restored.");
        }
        if (
          reminder.recurrence &&
          reminderDueAt(reminder) <= mutation.restoredAt
        ) {
          advanceRecurringReminder(reminder, mutation.restoredAt);
        } else {
          const due = reminderDueAt(reminder);
          Object.assign(reminder, {
            status: due <= mutation.restoredAt ? "notified" : "scheduled",
            updatedAt: mutation.restoredAt,
            deliveringAt: null,
            notifiedAt: due <= mutation.restoredAt
              ? mutation.restoredAt
              : null,
            completedAt: null,
            dismissedAt: null,
            lastError: null,
          } satisfies Partial<StoredReminder>);
        }
        break;
      }
      case "advance": {
        const reminder = requireReminder(workspace.reminders, index);
        if (!reminder.recurrence) {
          throw new Error("The reminder is not recurring.");
        }
        advanceRecurringReminder(reminder, mutation.advancedAt);
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
          completedAt: null,
          dismissedAt: null,
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
          completedAt: null,
          dismissedAt: null,
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
          completedAt: null,
          dismissedAt: null,
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
          completedAt: null,
          dismissedAt: null,
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
        workspace: { version: 3, reminders: [] },
        migrated: false,
      };
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      ![1, 2, 3].includes(
        (value as { version?: unknown }).version as number,
      ) ||
      !Array.isArray((value as { reminders?: unknown }).reminders)
    ) {
      throw new Error(
        "Stored reminder data is invalid. Clear Reminders data in plugin settings to recover.",
      );
    }
    const version = (value as { version: number }).version;
    const migrated = version !== 3;
    const candidate =
      version === 1
        ? migrateWorkspaceV1(value as StoredWorkspaceV1)
        : version === 2
          ? migrateWorkspaceV2(value as StoredWorkspaceV2)
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
  reminder.completedAt = null;
  reminder.dismissedAt = null;
  reminder.lastError = null;
}

function pruneArchivedReminder(reminders: StoredReminder[]): void {
  if (reminders.length < MAX_PLUGIN_REMINDERS) {
    return;
  }
  const archived = reminders
    .map((reminder, index) => ({ reminder, index }))
    .filter(({ reminder }) =>
      reminder.status === "completed" ||
      reminder.status === "dismissed"
    )
    .sort(
      (left, right) =>
        left.reminder.updatedAt - right.reminder.updatedAt,
    )[0];
  if (!archived) {
    throw new Error(
      `This vault already has the maximum of ${MAX_PLUGIN_REMINDERS} reminders.`,
    );
  }
  reminders.splice(archived.index, 1);
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

function migrateWorkspaceV1(workspace: StoredWorkspaceV1): StoredWorkspace {
  return {
    version: 3,
    reminders: workspace.reminders.map((reminder) => ({
      ...reminder,
      target: { ...reminder.target },
      schedule: { ...reminder.schedule },
      recurrence: null,
      snoozedUntil: null,
      snoozeTimeZone: null,
      completedAt: null,
      dismissedAt: null,
    })),
  };
}

function migrateWorkspaceV2(workspace: StoredWorkspaceV2): StoredWorkspace {
  return {
    version: 3,
    reminders: workspace.reminders.map((reminder) => ({
      ...reminder,
      target: { ...reminder.target },
      schedule: { ...reminder.schedule },
      recurrence: reminder.recurrence
        ? { ...reminder.recurrence }
        : null,
      completedAt: null,
      dismissedAt: null,
    })),
  };
}

function cloneWorkspace(workspace: StoredWorkspace): StoredWorkspace {
  return {
    version: 3,
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
