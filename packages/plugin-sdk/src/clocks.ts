import type { PluginDisposable } from "./contracts";
import { isPluginTimeTrackingClock, type PluginTimeTrackingClock } from "./timeTracking";
import { isReminderLocalDateTime, isReminderTimeZone } from "./reminders";

export const MAX_PLUGIN_COUNTDOWNS = 32;
export const MAX_PLUGIN_ALARMS = 32;
export const MAX_PLUGIN_COUNTDOWN_MS = 7 * 24 * 3_600_000;
export const CLOCKS_STOP_KEY = "host.clocks-stop.v1";
export const CLOCK_CONTENT_CAPABILITIES = [
  "structured-viewer", "kanban-board", "task-list", "note-graph", "calendar", "diagram-renderer", "code-intelligence",
] as const;

export type PluginClockMode = "timer" | "countdowns" | "alarm" | "notes";
export type PluginClockKind = "countdown" | "alarm";

export interface PluginClockDelivery {
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  error: string | null;
}

export interface PluginClockStopwatch {
  status: "idle" | "running" | "paused";
  elapsedMs: number;
  recoveryNotice: string | null;
}

interface ClockRecord {
  id: string;
  title: string;
  sound: boolean;
  occurrence: number;
  createdAt: number;
  updatedAt: number;
  delivery: PluginClockDelivery;
}

export interface PluginCountdown extends ClockRecord {
  durationMs: number;
  remainingMs: number;
  status: "running" | "paused" | "ringing" | "finished" | "cancelled";
  recoveryNotice: string | null;
}

export interface PluginAlarmInput {
  title: string;
  localDateTime: string;
  timeZone: string;
  repeatDaily: boolean;
  sound: boolean;
}

export interface PluginAlarm extends ClockRecord, PluginAlarmInput {
  dueAt: number;
  snoozedUntil: number | null;
  status: "scheduled" | "ringing" | "disabled";
  revision: number;
}

export interface PluginClockModel {
  stopwatch: PluginClockStopwatch;
  countdowns: PluginCountdown[];
  alarms: PluginAlarm[];
  notices: string[];
}

export interface PluginClockTarget {
  kind: PluginClockKind;
  id: string;
  occurrence: number;
}

export type PluginClockMutation =
  | { type: "stopwatch-start" | "stopwatch-pause" | "stopwatch-reset" }
  | { type: "countdown-create"; id: string; title: string; durationMs: number; sound: boolean }
  | { type: "countdown-pause" | "countdown-resume" | "countdown-restart" | "countdown-cancel" | "countdown-dismiss" | "countdown-remove"; id: string; occurrence?: number }
  | ({ type: "alarm-create"; id: string } & PluginAlarmInput)
  | ({ type: "alarm-update"; id: string; expectedRevision: number } & PluginAlarmInput)
  | { type: "alarm-toggle"; id: string; enabled: boolean; occurrence?: number }
  | { type: "alarm-dismiss" | "alarm-snooze" | "alarm-remove"; id: string; occurrence?: number }
  | ({ type: "notification-started" } & PluginClockTarget)
  | ({ type: "notification-succeeded" } & PluginClockTarget)
  | ({ type: "notification-retry" } & PluginClockTarget)
  | ({ type: "notification-failed"; error: string } & PluginClockTarget);

export interface PluginClockRequest {
  clock: PluginTimeTrackingClock;
  mutation?: PluginClockMutation;
}

export interface PluginClockProvider {
  id: string;
  title: string;
  request: (request: PluginClockRequest) => PluginClockModel | Promise<PluginClockModel>;
}

export interface PluginClockCapability {
  register: (provider: PluginClockProvider) => PluginDisposable;
}

export function emptyClockModel(): PluginClockModel {
  return { stopwatch: { status: "idle", elapsedMs: 0, recoveryNotice: null }, countdowns: [], alarms: [], notices: [] };
}

export function pendingClockDelivery(): PluginClockDelivery {
  return { status: "pending", attempts: 0, error: null };
}

export function isPluginClockRegistration(value: unknown): value is Pick<PluginClockProvider, "id" | "title"> {
  return record(value) && line(value.id, 160) && line(value.title, 160);
}

export function isPluginClockRequest(value: unknown): value is PluginClockRequest {
  if (!record(value) || !isPluginTimeTrackingClock(value.clock)) return false;
  const mutation = value.mutation;
  if (mutation === undefined) return true;
  if (!record(mutation)) return false;
  switch (mutation.type) {
    case "stopwatch-start":
    case "stopwatch-pause":
    case "stopwatch-reset":
      return true;
    case "countdown-create":
      return line(mutation.id, 160) && line(mutation.title, 160) && duration(mutation.durationMs) &&
        typeof mutation.sound === "boolean";
    case "countdown-pause":
    case "countdown-resume":
    case "countdown-restart":
    case "countdown-cancel":
    case "countdown-dismiss":
    case "countdown-remove":
    case "alarm-dismiss":
    case "alarm-snooze":
    case "alarm-remove":
      return actionId(mutation);
    case "alarm-create":
      return line(mutation.id, 160) && alarmInput(mutation);
    case "alarm-update":
      return line(mutation.id, 160) && integer(mutation.expectedRevision) && alarmInput(mutation);
    case "alarm-toggle":
      return actionId(mutation) && typeof mutation.enabled === "boolean";
    case "notification-started":
    case "notification-succeeded":
    case "notification-retry":
      return target(mutation);
    case "notification-failed":
      return target(mutation) && displayText(mutation.error, 2_048);
    default:
      return false;
  }
}

export function isPluginClockModel(value: unknown): value is PluginClockModel {
  if (!record(value) || !record(value.stopwatch) ||
    !["idle", "running", "paused"].includes(String(value.stopwatch.status)) ||
    !integer(value.stopwatch.elapsedMs) || !nullableNotice(value.stopwatch.recoveryNotice) ||
    value.stopwatch.status === "idle" && value.stopwatch.elapsedMs !== 0 ||
    !Array.isArray(value.countdowns) || value.countdowns.length > MAX_PLUGIN_COUNTDOWNS ||
    !Array.isArray(value.alarms) || value.alarms.length > MAX_PLUGIN_ALARMS ||
    !Array.isArray(value.notices) || value.notices.length > 16 ||
    !value.notices.every((notice) => displayText(notice, 1_000))) return false;
  const ids = new Set<string>();
  for (const countdown of value.countdowns) {
    if (!clockRecord(countdown) || !record(countdown) || ids.has(countdown.id) ||
      !duration(countdown.durationMs) || !integer(countdown.remainingMs) ||
      countdown.remainingMs > countdown.durationMs ||
      !["running", "paused", "ringing", "finished", "cancelled"].includes(String(countdown.status)) ||
      !nullableNotice(countdown.recoveryNotice) ||
      (countdown.status === "ringing" || countdown.status === "finished") && countdown.remainingMs !== 0 ||
      countdown.status === "running" && countdown.remainingMs === 0) return false;
    ids.add(countdown.id);
  }
  for (const alarm of value.alarms) {
    if (!clockRecord(alarm) || !record(alarm) || ids.has(alarm.id) || !alarmInput(alarm) ||
      !timestamp(alarm.dueAt) || !integer(alarm.revision) ||
      !["scheduled", "ringing", "disabled"].includes(String(alarm.status)) ||
      alarm.snoozedUntil !== null && !timestamp(alarm.snoozedUntil)) return false;
    ids.add(alarm.id);
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 128 * 1024;
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return false;
    throw error;
  }
}

export function ringingClocks(model: PluginClockModel): Array<PluginClockTarget & { title: string; sound: boolean; delivery: PluginClockDelivery }> {
  return [
    ...model.countdowns.filter((row) => row.status === "ringing").map((row) => ({ ...row, kind: "countdown" as const })),
    ...model.alarms.filter((row) => row.status === "ringing").map((row) => ({ ...row, kind: "alarm" as const })),
  ].map(({ kind, id, occurrence, title, sound, delivery }) => ({ kind, id, occurrence, title, sound, delivery }));
}

function alarmInput(value: Record<string, unknown>): boolean {
  return line(value.title, 160) && isReminderLocalDateTime(value.localDateTime) &&
    isReminderTimeZone(value.timeZone) && typeof value.repeatDaily === "boolean" && typeof value.sound === "boolean";
}

function clockRecord(value: unknown): value is ClockRecord {
  if (!record(value) || !line(value.id, 160) || !line(value.title, 160) ||
    typeof value.sound !== "boolean" || !integer(value.occurrence) || value.occurrence < 1 ||
    !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !record(value.delivery) ||
    !integer(value.delivery.attempts) || value.delivery.attempts > 10_000 ||
    !["pending", "sending", "sent", "failed"].includes(String(value.delivery.status))) return false;
  return value.delivery.status === "failed" ? displayText(value.delivery.error, 2_048) : value.delivery.error === null;
}

function target(value: Record<string, unknown>): boolean {
  return (value.kind === "countdown" || value.kind === "alarm") && line(value.id, 160) &&
    integer(value.occurrence) && value.occurrence >= 1;
}

function actionId(value: Record<string, unknown>): boolean {
  return line(value.id, 160) && (value.occurrence === undefined ||
    integer(value.occurrence) && value.occurrence >= 1);
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

function duration(value: unknown): value is number {
  return integer(value) && value >= 1_000 && value <= MAX_PLUGIN_COUNTDOWN_MS;
}

function displayText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum &&
    /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u.test(value);
}

function line(value: unknown, maximum: number): value is string {
  return displayText(value, maximum) && !/[\r\n]/u.test(value);
}

function nullableNotice(value: unknown): boolean {
  return value === null || displayText(value, 1_000);
}
