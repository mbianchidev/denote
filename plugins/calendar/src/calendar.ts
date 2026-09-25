import {
  calendarDates,
  isCalendarDate,
  isCalendarFolder,
  isCalendarNotePath,
  isPluginCalendarRequest,
  MAX_PLUGIN_CALENDAR_NOTES,
  MAX_PLUGIN_CALENDAR_NOTES_PER_DAY,
  type PluginCalendarDay,
  type PluginCalendarModel,
  type PluginCalendarRequest,
} from "@denote/plugin-sdk";
import { isMap, isScalar, parseDocument } from "yaml";

type DateToken = "YYYY" | "MM" | "DD";

interface FormatPart {
  token: DateToken | null;
  text: string;
}

export interface CalendarSettings {
  dailyFolder: string;
  parts: FormatPart[];
  filenamePattern: RegExp;
  dateMetadata: boolean;
}

export function readCalendarSettings(values: Record<string, unknown>): CalendarSettings {
  const dailyFolder = values.dailyFolder ?? "Daily";
  const filenameFormat = values.filenameFormat ?? "YYYY-MM-DD";
  const dateMetadata = values.dateMetadata ?? true;
  if (!isCalendarFolder(dailyFolder)) {
    throw new Error("Daily-note folder must be a portable vault-relative folder, without traversal or internal directories.");
  }
  if (typeof filenameFormat !== "string" || filenameFormat.length > 160) {
    throw new Error("Daily-note filename format must be at most 160 characters.");
  }
  if (typeof dateMetadata !== "boolean") {
    throw new Error("Date metadata must be enabled or disabled.");
  }
  const parts: FormatPart[] = [];
  const tokens = new Set<string>();
  let position = 0;
  for (const match of filenameFormat.matchAll(/YYYY|MM|DD|\[[^[\]\r\n]+\]|[-_. ]+/g)) {
    if (match.index !== position) {
      throw new Error("Filename format supports YYYY, MM, DD, separators, and [literal text]; omit the extension.");
    }
    position += match[0].length;
    const text = match[0];
    const token = text === "YYYY" || text === "MM" || text === "DD" ? text : null;
    if (token && tokens.has(token)) {
      throw new Error("Filename format must contain YYYY, MM, and DD exactly once.");
    }
    if (token) tokens.add(token);
    parts.push({ token, text: text.startsWith("[") ? text.slice(1, -1) : text });
  }
  if (position !== filenameFormat.length || tokens.size !== 3) {
    throw new Error("Filename format must contain YYYY, MM, and DD exactly once, with optional [literal text].");
  }
  const pattern = parts.map(({ token, text }) =>
    token ? `(?<${token}>\\d{${token === "YYYY" ? 4 : 2}})` : escapeRegex(text),
  ).join("");
  const settings = {
    dailyFolder,
    parts,
    filenamePattern: new RegExp(`^${escapeRegex(dailyFolder ? `${dailyFolder}/` : "")}${pattern}\\.md$`, "i"),
    dateMetadata,
  };
  if (!isCalendarNotePath(dailyPath("2026-09-05", settings))) {
    throw new Error("Daily-note folder or filename format produces an unsafe or non-portable Markdown path.");
  }
  return settings;
}

export function calendarQuery(
  request: PluginCalendarRequest,
  settings: CalendarSettings,
): PluginCalendarModel {
  if (!isPluginCalendarRequest(request)) {
    throw new Error("Calendar request exceeds its date, path, or metadata limits.");
  }
  const days = new Map<string, PluginCalendarDay>(
    calendarDates(request.startDate, request.endDate).map((date) => [
      date,
      { date, dailyNotePath: dailyPath(date, settings), notes: [] },
    ]),
  );
  let invalidMetadata = 0;
  let notes = 0;
  let truncated = request.truncated;
  const dailyMatches = new Set<string>();
  for (const document of [...request.documents].sort((a, b) => compare(a.path, b.path))) {
    const dailyDate = dateFromPath(document.path, settings);
    const metadata = !dailyDate && settings.dateMetadata
      ? dateFromMetadata(document.frontmatter)
      : null;
    if (metadata === "invalid") invalidMetadata += 1;
    const date = dailyDate ?? (metadata === "invalid" ? null : metadata);
    const day = date ? days.get(date) : undefined;
    if (!day) continue;
    if (dailyDate && (
      !dailyMatches.has(dailyDate) ||
      document.path === dailyPath(day.date, settings)
    )) {
      day.dailyNotePath = document.path;
      dailyMatches.add(dailyDate);
    }
    if (day.notes.length >= MAX_PLUGIN_CALENDAR_NOTES_PER_DAY || notes >= MAX_PLUGIN_CALENDAR_NOTES) {
      truncated = true;
      continue;
    }
    day.notes.push({ path: document.path, title: document.title });
    notes += 1;
  }
  for (const day of days.values()) {
    day.notes.sort((a, b) =>
      Number(b.path === day.dailyNotePath) - Number(a.path === day.dailyNotePath) ||
      compare(a.path, b.path),
    );
  }
  const notices: string[] = [];
  if (invalidMetadata) {
    notices.push(`${invalidMetadata} note${invalidMetadata === 1 ? " has" : "s have"} invalid date metadata. Use a top-level date: YYYY-MM-DD scalar.`);
  }
  if (request.skippedCount) {
    notices.push(`${request.skippedCount} note${request.skippedCount === 1 ? " was" : "s were"} skipped or had unavailable date metadata. Daily filenames remain discoverable within the input limit.`);
  }
  if (truncated) {
    notices.push("Calendar limits were reached; some notes are not shown. Existing daily notes are still opened without replacement.");
  }
  return { days: [...days.values()], notices, truncated };
}

function dailyPath(date: string, settings: CalendarSettings): string {
  const values = { YYYY: date.slice(0, 4), MM: date.slice(5, 7), DD: date.slice(8, 10) };
  const filename = settings.parts.map(({ token, text }) => token ? values[token] : text).join("");
  return `${settings.dailyFolder ? `${settings.dailyFolder}/` : ""}${filename}.md`;
}

function dateFromPath(path: string, settings: CalendarSettings): string | null {
  const groups = settings.filenamePattern.exec(path)?.groups;
  if (!groups) return null;
  const date = `${groups.YYYY}-${groups.MM}-${groups.DD}`;
  return isCalendarDate(date) ? date : null;
}

function dateFromMetadata(frontmatter: string): string | null {
  if (!frontmatter) return null;
  const lines = frontmatter.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
  if (lines[0] !== "---" || end < 0) return "invalid";
  const document = parseDocument(lines.slice(1, end).join("\n"), {
    version: "1.2",
    schema: "core",
    customTags: [],
    merge: false,
    resolveKnownTags: false,
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
  });
  if (document.errors.length || document.warnings.length) return "invalid";
  if (!isMap(document.contents)) return document.contents === null ? null : "invalid";
  const pair = document.contents.items.find(({ key }) => isScalar(key) && key.value === "date");
  if (!pair) return null;
  return isScalar(pair.value) && isCalendarDate(pair.value.value) ? pair.value.value : "invalid";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
