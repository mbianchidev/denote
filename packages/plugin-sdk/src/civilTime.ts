import type { PluginReminderRecurrence, PluginReminderSchedule } from "./contracts";
import { isReminderLocalDateTime, isReminderTimeZone } from "./reminders";

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function resolveReminderSchedule(schedule: PluginReminderSchedule): number {
  return schedule.kind === "instant" ? schedule.dueAt : resolveWallClock(schedule.localDateTime, schedule.timeZone);
}

export function resolveWallClock(localDateTime: string, timeZone: string): number {
  if (!isReminderLocalDateTime(localDateTime) || !isReminderTimeZone(timeZone)) {
    throw new Error("The date, time, or time zone is invalid.");
  }
  const [date, time] = localDateTime.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const instant = naive + hours * 3_600_000;
    offsets.add(partsAsUtc(zonedParts(instant, timeZone)) - instant);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => {
    const actual = zonedParts(instant, timeZone);
    return actual.year === year && actual.month === month && actual.day === day &&
      actual.hour === hour && actual.minute === minute && actual.second === 0;
  }).sort((a, b) => a - b);
  if (candidates[0] === undefined) {
    throw new Error(`The local time ${localDateTime} does not exist in ${timeZone} because of a daylight-saving transition.`);
  }
  return candidates[0];
}

export function nextRecurringSchedule(
  schedule: PluginReminderSchedule, recurrence: PluginReminderRecurrence, after: number,
): PluginReminderSchedule {
  if (recurrence.unit === "minute" || recurrence.unit === "hour") {
    const base = resolveReminderSchedule(schedule);
    const interval = recurrence.interval * (recurrence.unit === "minute" ? 60_000 : 3_600_000);
    const steps = Math.floor(Math.max(0, after - base) / interval) + 1;
    return { kind: "instant", dueAt: base + steps * interval, timeZone: schedule.timeZone };
  }
  let localDateTime = schedule.kind === "wall-clock" ? schedule.localDateTime
    : civilDateTimeAt(schedule.dueAt, schedule.timeZone);
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    localDateTime = addRecurrence(localDateTime, recurrence);
    const next: PluginReminderSchedule = { kind: "wall-clock", localDateTime, timeZone: schedule.timeZone };
    try {
      if (resolveReminderSchedule(next) > after) return next;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("does not exist")) throw error;
    }
  }
  throw new Error("The recurring schedule could not reach a future date.");
}

export function addRecurrence(localDateTime: string, recurrence: PluginReminderRecurrence): string {
  if (!isReminderLocalDateTime(localDateTime) || !Number.isInteger(recurrence.interval) ||
    recurrence.interval < 1 || recurrence.interval > 999) throw new Error("The recurring date or interval is invalid.");
  const [datePart, timePart] = localDateTime.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  switch (recurrence.unit) {
    case "minute": date.setUTCMinutes(minute + recurrence.interval); break;
    case "hour": date.setUTCHours(hour + recurrence.interval); break;
    case "day": date.setUTCDate(day + recurrence.interval); break;
    case "week": date.setUTCDate(day + recurrence.interval * 7); break;
    case "month": {
      date.setUTCDate(1);
      date.setUTCMonth(month - 1 + recurrence.interval);
      date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)));
      break;
    }
    case "year":
      date.setUTCDate(1);
      date.setUTCFullYear(year + recurrence.interval);
      date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), month)));
      break;
  }
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}T${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

export function civilDateTimeAt(instant: number, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedParts(instant: number, timeZone: string) {
  let format = FORMATTERS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric",
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hourCycle: "h23",
    });
    if (FORMATTERS.size >= 64) {
      const oldest = FORMATTERS.keys().next().value;
      if (oldest !== undefined) FORMATTERS.delete(oldest);
    }
    FORMATTERS.set(timeZone, format);
  }
  const parts = new Map(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.get("year")), month: Number(parts.get("month")), day: Number(parts.get("day")),
    hour: Number(parts.get("hour")), minute: Number(parts.get("minute")), second: Number(parts.get("second")),
  };
}

function partsAsUtc(parts: ReturnType<typeof zonedParts>): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}
