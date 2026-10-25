import type { PluginDisposable, PluginProjectContext } from "./contracts";

export const MAX_TIME_TRACKING_SESSIONS = 500;
export const MAX_TIME_TRACKING_HISTORY = 32;
export const MAX_TIME_TRACKING_SEGMENTS = 512;
export const TIME_TRACKING_STOP_KEY = "host.time-tracking-stop.v1";

export interface PluginTimeTrackingClock {
  bootId: string;
  wallTimeMs: number;
  monotonicMs: number;
}

export interface PluginTimeTrackingTarget {
  path: string;
  tags: string[];
  project: PluginProjectContext | null;
}

export interface PluginTimeTrackingSegment {
  startedAt: number;
  elapsedMs: number;
}

export interface PluginTimeTrackingValues {
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number;
  description: string;
  tags: string[];
  segments: PluginTimeTrackingSegment[];
}

export interface PluginTimeTrackingSession extends PluginTimeTrackingValues {
  id: string;
  path: string;
  project: PluginProjectContext | null;
  status: "running" | "paused" | "stopped";
  revision: number;
  history: Array<{
    at: number;
    reason: string;
    before: PluginTimeTrackingValues;
    after: PluginTimeTrackingValues;
  }>;
  recoveryNotice: string | null;
}

export type PluginTimeTrackingMutation =
  | { type: "start"; id: string; target: PluginTimeTrackingTarget; description: string }
  | { type: "pause" | "resume" | "stop"; id: string }
  | {
      type: "correct";
      id: string;
      expectedRevision: number;
      reason: string;
      values: Omit<PluginTimeTrackingValues, "segments" | "endedAt"> & { endedAt: number };
    };

export interface PluginTimeTrackingRequest {
  workspaceId: string | null;
  clock: PluginTimeTrackingClock;
  mutation?: PluginTimeTrackingMutation;
}

export interface PluginTimeTrackingModel {
  sessions: PluginTimeTrackingSession[];
  activeSessionId: string | null;
  activeElsewhere: boolean;
  notices: string[];
}

export interface PluginTimeTrackingProvider {
  id: string;
  title: string;
  request: (
    request: PluginTimeTrackingRequest,
  ) => PluginTimeTrackingModel | Promise<PluginTimeTrackingModel>;
}

export interface PluginTimeTrackingCapability {
  register: (provider: PluginTimeTrackingProvider) => PluginDisposable;
}

export function timeTrackingSessionElapsed(
  session: PluginTimeTrackingSession, from: number, to: number,
): number {
  return session.segments.reduce((total, segment) => total +
    Math.max(0, Math.min(to, segment.startedAt + segment.elapsedMs) - Math.max(from, segment.startedAt)), 0);
}

export function timeTrackingTotals(
  sessions: PluginTimeTrackingSession[],
  from: number,
  to: number,
  group: "note" | "project" | "tag",
): Array<{ id: string; label: string; elapsedMs: number }> {
  const totals = new Map<string, { id: string; label: string; elapsedMs: number }>();
  for (const session of sessions) {
    const elapsed = timeTrackingSessionElapsed(session, from, to);
    if (elapsed === 0) continue;
    const groups = group === "note" ? [{ id: session.path, label: session.path }]
      : group === "project" ? [{
        id: session.project?.projectId ?? "",
        label: session.project ? session.project.rootPath || "Vault root" : "No project",
      }]
      : (session.tags.length ? session.tags : [""]).map((tag) => ({ id: tag, label: tag || "No tags" }));
    for (const { id, label } of groups) {
      const previous = totals.get(id);
      totals.set(id, { id, label, elapsedMs: (previous?.elapsedMs ?? 0) + elapsed });
    }
  }
  return [...totals.values()].sort((a, b) => b.elapsedMs - a.elapsedMs || a.label.localeCompare(b.label));
}

export function exportTimeTrackingSessions(
  sessions: PluginTimeTrackingSession[], format: "csv" | "json", exportedAt: number,
): string {
  if (!timestamp(exportedAt) || (format !== "csv" && format !== "json") || !isPluginTimeTrackingModel({
    sessions,
    activeSessionId: sessions.find((session) => session.status !== "stopped")?.id ?? null,
    activeElsewhere: false,
    notices: [],
  })) throw new Error("Invalid time-tracking export.");
  if (format === "json") return JSON.stringify({
    schemaVersion: 1, exportedAt: new Date(exportedAt).toISOString(), sessions,
  }, null, 2);
  const rows: Array<Array<string | number>> = [[
    "session_id", "note_path", "project_id", "project_root", "tags_json",
    "started_at", "ended_at", "elapsed_ms", "status", "description",
    "revision", "segments_json", "history_json", "recovery_notice",
  ]];
  for (const session of sessions) {
    rows.push([
      session.id, session.path, session.project?.projectId ?? "", session.project?.rootPath ?? "",
      JSON.stringify(session.tags), new Date(session.startedAt).toISOString(),
      session.endedAt === null ? "" : new Date(session.endedAt).toISOString(),
      session.elapsedMs, session.status, session.description, session.revision,
      JSON.stringify(session.segments), JSON.stringify(session.history), session.recoveryNotice ?? "",
    ]);
  }
  return rows.map((row) => row.map((value) => {
    let cell = String(value);
    if (/^\s*[=+@-]|^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/gu, '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}

const SAFE_TEXT = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export function isPluginTimeTrackingClock(value: unknown): value is PluginTimeTrackingClock {
  return record(value) && text(value.bootId, 128, true) &&
    timestamp(value.wallTimeMs) && integer(value.monotonicMs);
}

export function isPluginTimeTrackingRegistration(
  value: unknown,
): value is Pick<PluginTimeTrackingProvider, "id" | "title"> {
  return record(value) && text(value.id, 160, true) && text(value.title, 160, true);
}

export function isPluginTimeTrackingTarget(value: unknown): value is PluginTimeTrackingTarget {
  return record(value) && path(value.path) && tags(value.tags) && project(value.project);
}

export function isPluginTimeTrackingRequest(value: unknown): value is PluginTimeTrackingRequest {
  if (!record(value) || !isPluginTimeTrackingClock(value.clock) ||
    (value.workspaceId !== null && !text(value.workspaceId, 160, true))) return false;
  if (value.mutation === undefined) return true;
  if (value.workspaceId === null) return false;
  const mutation = value.mutation;
  if (!record(mutation) || !text(mutation.id, 160, true)) return false;
  switch (mutation.type) {
    case "start":
      return isPluginTimeTrackingTarget(mutation.target) && text(mutation.description, 2_000);
    case "pause":
    case "resume":
    case "stop":
      return true;
    case "correct": {
      const values = mutation.values;
      return integer(mutation.expectedRevision) && text(mutation.reason, 1_000, true) &&
        record(values) && timestamp(values.startedAt) && timestamp(values.endedAt) &&
        integer(values.elapsedMs) && values.endedAt >= values.startedAt &&
        values.elapsedMs <= values.endedAt - values.startedAt &&
        text(values.description, 2_000) && tags(values.tags);
    }
    default:
      return false;
  }
}

export function isPluginTimeTrackingSession(value: unknown): value is PluginTimeTrackingSession {
  if (!record(value) || !values(value) || !text(value.id, 160, true) ||
    !path(value.path) || !project(value.project) ||
    !["running", "paused", "stopped"].includes(String(value.status)) ||
    (value.status === "stopped") !== (value.endedAt !== null) ||
    !integer(value.revision) || !Array.isArray(value.history) ||
    value.history.length > MAX_TIME_TRACKING_HISTORY ||
    value.revision !== value.history.length ||
    (value.recoveryNotice !== null && !text(value.recoveryNotice, 1_000, true))) return false;
  return value.history.every((entry) => record(entry) && timestamp(entry.at) &&
    text(entry.reason, 1_000, true) && values(entry.before) && values(entry.after));
}

export function isPluginTimeTrackingModel(value: unknown): value is PluginTimeTrackingModel {
  if (!record(value) || !Array.isArray(value.sessions) ||
    value.sessions.length > MAX_TIME_TRACKING_SESSIONS ||
    typeof value.activeElsewhere !== "boolean" ||
    !Array.isArray(value.notices) || value.notices.length > 16 ||
    !value.notices.every((notice) => text(notice, 1_000, true))) return false;
  const ids = new Set<string>();
  let active: string | null = null;
  for (const session of value.sessions) {
    if (!isPluginTimeTrackingSession(session) || ids.has(session.id)) return false;
    ids.add(session.id);
    if (session.status !== "stopped") {
      if (active !== null) return false;
      active = session.id;
    }
  }
  if (value.activeSessionId !== active || active !== null && value.activeElsewhere) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512 * 1024;
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return false;
    throw error;
  }
}

function values(value: unknown): value is PluginTimeTrackingValues {
  if (!record(value) || !timestamp(value.startedAt) ||
    (value.endedAt !== null && !timestamp(value.endedAt)) || !integer(value.elapsedMs) ||
    !text(value.description, 2_000) || !tags(value.tags) ||
    !Array.isArray(value.segments) || value.segments.length === 0 ||
    value.segments.length > MAX_TIME_TRACKING_SEGMENTS) return false;
  let total = 0;
  for (const segment of value.segments) {
    if (!record(segment) || !timestamp(segment.startedAt) || !integer(segment.elapsedMs) ||
      !timestamp(segment.startedAt + segment.elapsedMs)) return false;
    total += segment.elapsedMs;
  }
  return Number.isSafeInteger(total) && total === value.elapsedMs;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is number {
  return integer(value) && value <= 253_402_300_799_999;
}

function text(value: unknown, maximum: number, required = false): value is string {
  return typeof value === "string" && value.length <= maximum && SAFE_TEXT.test(value) &&
    (!required || value.trim().length > 0);
}

function tags(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 &&
    value.every((tag) => text(tag, 128, true) && !/[\r\n]/u.test(tag)) &&
    new Set(value).size === value.length;
}

function path(value: unknown, allowRoot = false): value is string {
  return text(value, 2_048, !allowRoot) && !/[\r\n\\:]/u.test(value) &&
    !value.startsWith("/") && !value.endsWith("/") &&
    (allowRoot && value === "" || value.split("/").every((part) =>
      part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".denote"));
}

function project(value: unknown): value is PluginProjectContext | null {
  return value === null || record(value) && text(value.projectId, 160, true) && path(value.rootPath, true);
}
