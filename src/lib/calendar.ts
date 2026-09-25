import { calendarDates, isCalendarDate } from "@denote/plugin-sdk";

const DAY_MS = 86_400_000;

export function calendarToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function calendarDateValue(date: string): Date {
  if (!isCalendarDate(date)) throw new Error("Calendar requires a valid YYYY-MM-DD date.");
  return new Date(`${date}T12:00:00Z`);
}

export function formatCalendarDate(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "full" },
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options, calendar: "gregory", timeZone: "UTC",
  }).format(calendarDateValue(date));
}

export function moveCalendarDate(date: string, days: number): string | null {
  const moved = new Date(calendarDateValue(date).getTime() + days * DAY_MS);
  return dateKey(moved);
}

export function moveCalendarMonth(date: string, months: number): string | null {
  const moved = calendarDateValue(date);
  const day = moved.getUTCDate();
  moved.setUTCDate(1);
  moved.setUTCMonth(moved.getUTCMonth() + months);
  const end = new Date(moved);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  moved.setUTCDate(Math.min(day, end.getUTCDate()));
  return dateKey(moved);
}

export function calendarMonthDates(month: string, weekStart: number): string[] {
  const first = calendarDateValue(`${month}-01`);
  const offset = (first.getUTCDay() - weekStart + 7) % 7;
  const gridStart = first.getTime() - offset * DAY_MS;
  const start = dateKey(new Date(gridStart)) ?? "0001-01-01";
  const end = dateKey(new Date(gridStart + 41 * DAY_MS)) ?? "9999-12-31";
  return calendarDates(start, end);
}

export function calendarWeekStart(locale: string): number {
  const language = new Intl.Locale(locale);
  const info: unknown = "getWeekInfo" in language && typeof language.getWeekInfo === "function"
    ? language.getWeekInfo()
    : "weekInfo" in language ? language.weekInfo : null;
  if (
    typeof info === "object" && info !== null && "firstDay" in info &&
    typeof info.firstDay === "number" && info.firstDay >= 1 && info.firstDay <= 7
  ) {
    return info.firstDay % 7;
  }
  return 1;
}

function dateKey(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  const key = date.toISOString().slice(0, 10);
  return isCalendarDate(key) ? key : null;
}
