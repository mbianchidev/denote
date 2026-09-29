import type {
  PluginReminderLink,
  PluginReminderModel,
  PluginReminderMutation,
  PluginReminderMutationRequest,
  PluginReminderQuery,
  PluginReminderRecurrence,
  PluginReminderRecord,
  PluginReminderSchedule,
  PluginReminderTarget,
  PluginReminderTargetsModel,
  PluginReminderTargetsRequest,
} from "./contracts";

export const MAX_PLUGIN_REMINDER_DOCUMENT_BYTES = 256 * 1024;
export const MAX_PLUGIN_REMINDER_TARGETS = 512;
export const MAX_PLUGIN_REMINDERS = 128;
export const MAX_PLUGIN_REMINDER_TITLE_BYTES = 512;
export const MAX_PLUGIN_REMINDER_NOTIFICATION_TITLE_BYTES = 120;
export const MAX_PLUGIN_REMINDER_NOTIFICATION_BODY_BYTES = 1_024;
export const MAX_PLUGIN_REMINDER_ERROR_BYTES = 2_048;
export const MAX_PLUGIN_REMINDER_DELIVERY_ATTEMPTS = 10_000;
export const MAX_PLUGIN_REMINDER_RECURRENCE_INTERVAL = 999;

const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
const REMINDER_LOCAL_DATE_TIME =
  /^(?!0000)(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

export function isPluginReminderRegistration(
  value: unknown,
): value is {
  id: string;
  title: string;
  defaultSnoozeMinutes: number;
} {
  return (
    isRecord(value) &&
    safeSingleLine(value.id, 160) &&
    safeSingleLine(value.title, 160) &&
    positiveInteger(value.defaultSnoozeMinutes) &&
    value.defaultSnoozeMinutes <= 24 * 60
  );
}

export function isPluginReminderTargetsRequest(
  value: unknown,
): value is PluginReminderTargetsRequest {
  return (
    isRecord(value) &&
    (value.document === null ||
      (isRecord(value.document) &&
        safePath(value.document.path) &&
        safeSingleLine(value.document.title, 200) &&
        typeof value.document.source === "string" &&
        stringBytes(value.document.source) <=
          MAX_PLUGIN_REMINDER_DOCUMENT_BYTES))
  );
}

export function isPluginReminderTargetsModel(
  value: unknown,
): value is PluginReminderTargetsModel {
  if (
    !isRecord(value) ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_PLUGIN_REMINDER_TARGETS ||
    typeof value.truncated !== "boolean" ||
    !isNotices(value.notices)
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value.targets.every((target) => {
    if (!isPluginReminderTarget(target) || ids.has(target.id)) {
      return false;
    }
    ids.add(target.id);
    return true;
  });
}

export function isPluginReminderQuery(
  value: unknown,
): value is PluginReminderQuery {
  return (
    isRecord(value) &&
    isWorkspaceId(value.workspaceId) &&
    isTimestamp(value.now)
  );
}

export function isPluginReminderMutationRequest(
  value: unknown,
): value is PluginReminderMutationRequest {
  return (
    isRecord(value) &&
    isWorkspaceId(value.workspaceId) &&
    isTimestamp(value.now) &&
    isPluginReminderMutation(value.mutation)
  );
}

export function isPluginReminderModel(
  value: unknown,
): value is PluginReminderModel {
  if (
    !isRecord(value) ||
    !Array.isArray(value.reminders) ||
    value.reminders.length > MAX_PLUGIN_REMINDERS ||
    typeof value.truncated !== "boolean" ||
    !isNotices(value.notices)
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value.reminders.every((reminder) => {
    if (!isPluginReminderRecord(reminder) || ids.has(reminder.id)) {
      return false;
    }
    ids.add(reminder.id);
    return true;
  });
}

export function isReminderLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = REMINDER_LOCAL_DATE_TIME.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute)
  );
}

export function isReminderTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }
  let result = "";
  for (const character of value) {
    const next = result + character;
    if (encoder.encode(next).byteLength > maxBytes) {
      break;
    }
    result = next;
  }
  return result;
}

function isPluginReminderMutation(
  value: unknown,
): value is PluginReminderMutation {
  if (!isRecord(value) || !safeId(value.id)) {
    return false;
  }
  switch (value.type) {
    case "create":
      return (
        safeDisplayText(value.title, MAX_PLUGIN_REMINDER_TITLE_BYTES) &&
        isPluginReminderTarget(value.target) &&
        isPluginReminderSchedule(value.schedule) &&
        isNullableRecurrence(value.recurrence) &&
        isTimestamp(value.createdAt)
      );
    case "update":
      return (
        safeDisplayText(value.title, MAX_PLUGIN_REMINDER_TITLE_BYTES) &&
        isPluginReminderTarget(value.target) &&
        isPluginReminderSchedule(value.schedule) &&
        isNullableRecurrence(value.recurrence) &&
        isTimestamp(value.updatedAt)
      );
    case "snooze":
      return (
        isTimestamp(value.dueAt) &&
        isReminderTimeZone(value.timeZone) &&
        isTimestamp(value.updatedAt)
      );
    case "dismiss":
      return isTimestamp(value.dismissedAt);
    case "complete":
      return (
        safeId(value.historyId) &&
        value.historyId !== value.id &&
        isTimestamp(value.completedAt)
      );
    case "restore":
      return isTimestamp(value.restoredAt);
    case "advance":
      return isTimestamp(value.advancedAt);
    case "remove":
      return isTimestamp(value.updatedAt);
    case "delivery-started":
      return isTimestamp(value.startedAt);
    case "delivery-succeeded":
      return isTimestamp(value.completedAt);
    case "delivery-failed":
      return (
        isTimestamp(value.failedAt) &&
        safeDisplayText(value.error, MAX_PLUGIN_REMINDER_ERROR_BYTES)
      );
    default:
      return false;
  }
}

function isPluginReminderRecord(
  value: unknown,
): value is PluginReminderRecord {
  if (
    !isRecord(value) ||
    !safeId(value.id) ||
    !safeDisplayText(value.title, MAX_PLUGIN_REMINDER_TITLE_BYTES) ||
    !isPluginReminderLink(value.target) ||
    !isPluginReminderSchedule(value.schedule) ||
    !isNullableRecurrence(value.recurrence) ||
    !isTimestamp(value.dueAt) ||
    !isNullableTimestamp(value.snoozedUntil) ||
    (value.snoozeTimeZone !== null &&
      !isReminderTimeZone(value.snoozeTimeZone)) ||
    (value.snoozedUntil === null) !== (value.snoozeTimeZone === null) ||
    ![
      "scheduled",
      "delivering",
      "notified",
      "failed",
      "completed",
      "dismissed",
    ].includes(
      String(value.status),
    ) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !nonNegativeInteger(value.attemptCount) ||
    value.attemptCount > MAX_PLUGIN_REMINDER_DELIVERY_ATTEMPTS ||
    !isNullableTimestamp(value.deliveringAt) ||
    !isNullableTimestamp(value.notifiedAt) ||
    !isNullableTimestamp(value.completedAt) ||
    !isNullableTimestamp(value.dismissedAt) ||
    (value.lastError !== null &&
      !safeDisplayText(value.lastError, MAX_PLUGIN_REMINDER_ERROR_BYTES))
  ) {
    return false;
  }
  switch (value.status) {
    case "scheduled":
      return (
        value.deliveringAt === null &&
        value.notifiedAt === null &&
        value.completedAt === null &&
        value.dismissedAt === null &&
        value.lastError === null
      );
    case "delivering":
      return (
        value.deliveringAt !== null &&
        value.notifiedAt === null &&
        value.completedAt === null &&
        value.dismissedAt === null &&
        value.lastError === null
      );
    case "notified":
      return (
        value.deliveringAt === null &&
        value.notifiedAt !== null &&
        value.completedAt === null &&
        value.dismissedAt === null &&
        value.lastError === null
      );
    case "failed":
      return (
        value.deliveringAt === null &&
        value.notifiedAt === null &&
        value.completedAt === null &&
        value.dismissedAt === null &&
        value.lastError !== null
      );
    case "completed":
      return (
        value.deliveringAt === null &&
        value.notifiedAt === null &&
        value.completedAt !== null &&
        value.dismissedAt === null &&
        value.lastError === null
      );
    case "dismissed":
      return (
        value.deliveringAt === null &&
        value.notifiedAt === null &&
        value.completedAt === null &&
        value.dismissedAt !== null &&
        value.lastError === null
      );
  }
  return false;
}

function isPluginReminderTarget(
  value: unknown,
): value is PluginReminderTarget {
  return (
    isRecord(value) &&
    safeId(value.id) &&
    isPluginReminderLink(value) &&
    safeDisplayText(value.label, 800)
  );
}

function isPluginReminderLink(value: unknown): value is PluginReminderLink {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "standalone") {
    return (
      value.path === null &&
      value.noteTitle === null &&
      value.line === null
    );
  }
  if (
    !["note", "heading", "task"].includes(String(value.kind)) ||
    !safePath(value.path) ||
    !safeSingleLine(value.noteTitle, 200)
  ) {
    return false;
  }
  return value.kind === "note"
    ? value.line === null
    : positiveInteger(value.line);
}

export function isPluginReminderRecurrence(
  value: unknown,
): value is PluginReminderRecurrence {
  return (
    isRecord(value) &&
    positiveInteger(value.interval) &&
    value.interval <= MAX_PLUGIN_REMINDER_RECURRENCE_INTERVAL &&
    ["minute", "hour", "day", "week", "month", "year"].includes(
      String(value.unit),
    )
  );
}

function isNullableRecurrence(
  value: unknown,
): value is PluginReminderRecurrence | null {
  return value === null || isPluginReminderRecurrence(value);
}

function isPluginReminderSchedule(
  value: unknown,
): value is PluginReminderSchedule {
  if (!isRecord(value) || !isReminderTimeZone(value.timeZone)) {
    return false;
  }
  if (value.kind === "wall-clock") {
    return isReminderLocalDateTime(value.localDateTime);
  }
  return value.kind === "instant" && isTimestamp(value.dueAt);
}

function isNotices(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((notice) => safeDisplayText(notice, 2_048))
  );
}

function safeId(value: unknown): value is string {
  return safeSingleLine(value, 256);
}

function isWorkspaceId(value: unknown): value is string {
  return safeSingleLine(value, 128);
}

function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    value.split("/").every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment !== ".denote" &&
        segment !== ".git" &&
        !segment.includes("\\") &&
        SAFE_TEXT.test(segment),
    )
  );
}

function safeSingleLine(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    SAFE_TEXT.test(value)
  );
}

function safeDisplayText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    stringBytes(value) <= maxBytes &&
    SAFE_TEXT.test(value)
  );
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function positiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
