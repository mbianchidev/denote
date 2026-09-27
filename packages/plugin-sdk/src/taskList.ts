import type {
  PluginTaskListDocument,
  PluginTaskListIndexRequest,
  PluginTaskListItem,
  PluginTaskListLocator,
  PluginTaskListModel,
  PluginTaskListQuery,
  PluginTaskListToggleRequest,
  PluginTaskListToggleResult,
} from "./contracts";

export const MAX_PLUGIN_TASK_LIST_DOCUMENTS = 5_000;
export const MAX_PLUGIN_TASK_LIST_SOURCE_BYTES = 256 * 1024;
export const MAX_PLUGIN_TASK_LIST_INDEX_BYTES = 512 * 1024;
export const MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS = 256;
export const MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS = 512;
export const MAX_PLUGIN_TASK_LIST_TOTAL_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_TASK_LIST_TASKS = 1_000;
export const MAX_PLUGIN_TASK_LIST_TAGS = 256;
export const MAX_PLUGIN_TASK_LIST_TAGS_PER_TASK = 32;
export const MAX_PLUGIN_TASK_LIST_HEADING_DEPTH = 12;
export const MAX_PLUGIN_TASK_LIST_SOURCE_LINE_BYTES = 8 * 1024;

const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export function isPluginTaskListRegistration(
  value: unknown,
): value is { id: string; title: string } {
  return (
    isRecord(value) &&
    safeSingleLine(value.id, 160) &&
    safeSingleLine(value.title, 160)
  );
}

export function isPluginTaskListIndexRequest(
  value: unknown,
): value is PluginTaskListIndexRequest {
  if (
    !isRecord(value) ||
    (value.mode !== "replace" && value.mode !== "update") ||
    !Array.isArray(value.documents) ||
    value.documents.length > MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS ||
    !Array.isArray(value.removedPaths) ||
    value.removedPaths.length > MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS ||
    !nonNegativeInteger(value.skippedCount) ||
    typeof value.truncated !== "boolean"
  ) {
    return false;
  }
  const documentPaths = new Set<string>();
  let sourceBytes = 0;
  for (const document of value.documents) {
    if (
      !isPluginTaskListDocument(document) ||
      documentPaths.has(document.path)
    ) {
      return false;
    }
    documentPaths.add(document.path);
    sourceBytes += stringBytes(document.source);
    if (sourceBytes > MAX_PLUGIN_TASK_LIST_INDEX_BYTES) {
      return false;
    }
  }
  const removedPaths = new Set<string>();
  for (const path of value.removedPaths) {
    if (
      !safePath(path) ||
      documentPaths.has(path) ||
      removedPaths.has(path)
    ) {
      return false;
    }
    removedPaths.add(path);
  }
  return value.mode !== "replace" || removedPaths.size === 0;
}

export function isPluginTaskListQuery(
  value: unknown,
): value is PluginTaskListQuery {
  return (
    isRecord(value) &&
    ["all", "open", "completed"].includes(String(value.status)) &&
    (value.tag === null || safeSingleLine(value.tag, 80)) &&
    typeof value.path === "string" &&
    value.path.length <= 512 &&
    SAFE_TEXT.test(value.path) &&
    ["all", "overdue", "today", "upcoming", "undated"].includes(
      String(value.due),
    ) &&
    isTaskListDate(value.today) &&
    isTimeZone(value.timeZone)
  );
}

export function isPluginTaskListModel(
  value: unknown,
): value is PluginTaskListModel {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > MAX_PLUGIN_TASK_LIST_TASKS ||
    !nonNegativeInteger(value.totalTasks) ||
    !nonNegativeInteger(value.matchingTasks) ||
    value.totalTasks < value.matchingTasks ||
    value.matchingTasks < value.tasks.length ||
    !Array.isArray(value.availableTags) ||
    value.availableTags.length > MAX_PLUGIN_TASK_LIST_TAGS ||
    !value.availableTags.every((tag) => safeSingleLine(tag, 80)) ||
    new Set(value.availableTags).size !== value.availableTags.length ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.notices) ||
    value.notices.length > 16 ||
    !value.notices.every((notice) => safeDisplayText(notice, 512))
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value.tasks.every((task) => {
    if (!isPluginTaskListItem(task) || ids.has(task.id)) {
      return false;
    }
    ids.add(task.id);
    return true;
  });
}

export function isPluginTaskListToggleRequest(
  value: unknown,
): value is PluginTaskListToggleRequest {
  return (
    isRecord(value) &&
    safePath(value.path) &&
    typeof value.source === "string" &&
    stringBytes(value.source) <= MAX_PLUGIN_TASK_LIST_SOURCE_BYTES &&
    isPluginTaskListLocator(value.locator) &&
    value.locator.path === value.path &&
    typeof value.checked === "boolean"
  );
}

export function isPluginTaskListToggleResult(
  value: unknown,
): value is PluginTaskListToggleResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === "applied") {
    return (
      typeof value.source === "string" &&
      stringBytes(value.source) <= MAX_PLUGIN_TASK_LIST_SOURCE_BYTES
    );
  }
  return (
    value.status === "conflict" &&
    ["missing", "ambiguous", "changed"].includes(String(value.reason))
  );
}

export function isTaskListDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function isPluginTaskListDocument(
  value: unknown,
): value is PluginTaskListDocument {
  return (
    isRecord(value) &&
    safePath(value.path) &&
    safeSingleLine(value.title, 200) &&
    typeof value.source === "string" &&
    stringBytes(value.source) <= MAX_PLUGIN_TASK_LIST_SOURCE_BYTES
  );
}

function isPluginTaskListItem(value: unknown): value is PluginTaskListItem {
  return (
    isRecord(value) &&
    safeSingleLine(value.id, 4096) &&
    safePath(value.path) &&
    safeSingleLine(value.noteTitle, 200) &&
    positiveInteger(value.line) &&
    safeDisplayText(value.text, 4096) &&
    value.text.trim().length > 0 &&
    typeof value.checked === "boolean" &&
    isHeadingPath(value.headingPath) &&
    Array.isArray(value.tags) &&
    value.tags.length <= MAX_PLUGIN_TASK_LIST_TAGS_PER_TASK &&
    value.tags.every((tag) => safeSingleLine(tag, 80)) &&
    new Set(value.tags).size === value.tags.length &&
    (value.dueDate === null || isTaskListDate(value.dueDate)) &&
    isPluginTaskListLocator(value.locator) &&
    value.locator.path === value.path &&
    value.locator.checked === value.checked
  );
}

function isPluginTaskListLocator(
  value: unknown,
): value is PluginTaskListLocator {
  return (
    isRecord(value) &&
    safePath(value.path) &&
    typeof value.sourceLine === "string" &&
    value.sourceLine.length > 0 &&
    stringBytes(value.sourceLine) <= MAX_PLUGIN_TASK_LIST_SOURCE_LINE_BYTES &&
    SAFE_TEXT.test(value.sourceLine) &&
    isHeadingPath(value.headingPath) &&
    positiveInteger(value.occurrence) &&
    positiveInteger(value.matchCount) &&
    value.occurrence <= value.matchCount &&
    typeof value.checked === "boolean"
  );
}

function isHeadingPath(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PLUGIN_TASK_LIST_HEADING_DEPTH &&
    value.every((heading) => safeSingleLine(heading, 200))
  );
}

function isTimeZone(value: unknown): value is string {
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

function safePath(value: unknown): value is string {
  if (
    !safeDisplayText(value, 4096) ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\")
  ) {
    return false;
  }
  return !value
    .split("/")
    .some((segment) => !segment || segment === "." || segment === "..");
}

function safeSingleLine(value: unknown, maxLength: number): value is string {
  return (
    safeDisplayText(value, maxLength) &&
    value.trim().length > 0 &&
    !/[\r\n]/.test(value)
  );
}

function safeDisplayText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    SAFE_TEXT.test(value)
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
