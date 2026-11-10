import type { PluginReminderRecurrence, PluginReminderSchedule } from "./contracts";
export declare function resolveReminderSchedule(schedule: PluginReminderSchedule): number;
export declare function resolveWallClock(localDateTime: string, timeZone: string): number;
export declare function nextRecurringSchedule(schedule: PluginReminderSchedule, recurrence: PluginReminderRecurrence, after: number): PluginReminderSchedule;
export declare function addRecurrence(localDateTime: string, recurrence: PluginReminderRecurrence): string;
export declare function civilDateTimeAt(instant: number, timeZone: string): string;
