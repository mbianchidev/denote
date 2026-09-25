import type {
  PluginCalendarDocument,
  PluginCalendarModel,
  PluginCalendarRequest,
  PluginCalendarView,
} from "./contracts";

export const MAX_PLUGIN_CALENDAR_DAYS = 42;
export const MAX_PLUGIN_CALENDAR_DOCUMENTS = 5_000;
export const MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES = 8 * 1024;
export const MAX_PLUGIN_CALENDAR_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_PLUGIN_CALENDAR_NOTES = 1_000;
export const MAX_PLUGIN_CALENDAR_NOTES_PER_DAY = 100;

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function isCalendarDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calendarDates(startDate: string, endDate: string): string[] {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) {
    return [];
  }
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const count = (end.getTime() - start.getTime()) / 86_400_000 + 1;
  if (count > MAX_PLUGIN_CALENDAR_DAYS) {
    return [];
  }
  return Array.from({ length: count }, (_, index) =>
    new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export function isCalendarFolder(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1024 &&
    (value === "" || value.split("/").every(isCalendarPathSegment))
  );
}

export function isCalendarNotePath(value: unknown): value is string {
  return isCalendarFolder(value) && /\.(?:md|markdown)$/i.test(value);
}

function isCalendarPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 255 &&
    value.trim() === value &&
    !value.endsWith(".") &&
    !UNSAFE_TEXT.test(value) &&
    !/[\\:*?"<>|]/.test(value) &&
    ![".", "..", ".denote", ".git"].includes(value.toLowerCase()) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  );
}

export function isPluginCalendarRegistration(
  value: unknown,
): value is { id: string; title: string; views?: PluginCalendarView[] } {
  return isRecord(value) && safeLabel(value.id, 160) && safeLabel(value.title, 160) &&
    (value.views === undefined || (
      Array.isArray(value.views) && value.views.length <= 3 &&
      value.views.includes("dated") && value.views.every(isCalendarView) &&
      new Set(value.views).size === value.views.length
    ));
}

function isCalendarView(value: unknown): value is PluginCalendarView {
  return value === "dated" || value === "created" || value === "updated";
}

function isCalendarTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function isOptionalTimestamp(value: unknown): value is number | null | undefined {
  return value === undefined || value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000);
}

export function calendarDocumentBytes(document: PluginCalendarDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength + 1;
}

export function isPluginCalendarRequest(value: unknown): value is PluginCalendarRequest {
  if (
    !isRecord(value) ||
    (value.view !== undefined && !isCalendarView(value.view)) ||
    (value.timeZone !== undefined && !isCalendarTimeZone(value.timeZone)) ||
    ((value.view === "created" || value.view === "updated") && value.timeZone === undefined) ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string" ||
    calendarDates(value.startDate, value.endDate).length === 0 ||
    !Array.isArray(value.documents) ||
    value.documents.length > MAX_PLUGIN_CALENDAR_DOCUMENTS ||
    !Number.isSafeInteger(value.skippedCount) ||
    Number(value.skippedCount) < 0 ||
    typeof value.truncated !== "boolean"
  ) {
    return false;
  }
  const paths = new Set<string>();
  let bytes = 0;
  for (const document of value.documents) {
    if (
      !isRecord(document) ||
      !isCalendarNotePath(document.path) ||
      paths.has(document.path) ||
      !safeLabel(document.title, 200) ||
      typeof document.frontmatter !== "string" ||
      (document.metadataAvailable !== undefined && typeof document.metadataAvailable !== "boolean") ||
      !isOptionalTimestamp(document.createdAt) ||
      !isOptionalTimestamp(document.modifiedAt) ||
      new TextEncoder().encode(document.frontmatter).byteLength > MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES
    ) {
      return false;
    }
    paths.add(document.path);
    bytes += calendarDocumentBytes({
      path: document.path,
      title: document.title,
      frontmatter: document.frontmatter,
      metadataAvailable: document.metadataAvailable,
      createdAt: document.createdAt,
      modifiedAt: document.modifiedAt,
    });
    if (bytes > MAX_PLUGIN_CALENDAR_INPUT_BYTES) {
      return false;
    }
  }
  return true;
}

export function isPluginCalendarModel(
  value: unknown,
  request?: PluginCalendarRequest,
): value is PluginCalendarModel {
  if (
    !isRecord(value) ||
    (value.view !== undefined && !isCalendarView(value.view)) ||
    (request && (value.view ?? "dated") !== (request.view ?? "dated")) ||
    !Array.isArray(value.days) ||
    value.days.length === 0 ||
    value.days.length > MAX_PLUGIN_CALENDAR_DAYS ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.notices) ||
    value.notices.length > 16 ||
    !value.notices.every((notice) => safeLabel(notice, 512))
  ) {
    return false;
  }
  const first: unknown = value.days[0];
  const last: unknown = value.days[value.days.length - 1];
  if (!isRecord(first) || !isRecord(last) || !isCalendarDate(first.date) || !isCalendarDate(last.date)) {
    return false;
  }
  const dates = calendarDates(first.date, last.date);
  if (
    dates.length !== value.days.length ||
    (request && (first.date !== request.startDate || last.date !== request.endDate))
  ) {
    return false;
  }
  const availablePaths = request ? new Set(request.documents.map(({ path }) => path)) : null;
  const dailyPaths = new Set<string>();
  const notePaths = new Set<string>();
  for (const [index, day] of value.days.entries()) {
    if (
      !isRecord(day) ||
      day.date !== dates[index] ||
      !isCalendarNotePath(day.dailyNotePath) ||
      dailyPaths.has(day.dailyNotePath.toLowerCase()) ||
      !Array.isArray(day.notes) ||
      day.notes.length > MAX_PLUGIN_CALENDAR_NOTES_PER_DAY
    ) {
      return false;
    }
    dailyPaths.add(day.dailyNotePath.toLowerCase());
    for (const note of day.notes) {
      if (
        !isRecord(note) ||
        !isCalendarNotePath(note.path) ||
        !safeLabel(note.title, 200) ||
        notePaths.has(note.path) ||
        (availablePaths && !availablePaths.has(note.path))
      ) {
        return false;
      }
      notePaths.add(note.path);
      if (notePaths.size > MAX_PLUGIN_CALENDAR_NOTES) {
        return false;
      }
    }
  }
  return true;
}

function safeLabel(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !UNSAFE_TEXT.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
