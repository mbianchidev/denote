import type { PluginDisposable } from "./contracts";
import { type PluginTimeTrackingClock } from "./timeTracking";
export declare const MAX_PLUGIN_COUNTDOWNS = 32;
export declare const MAX_PLUGIN_ALARMS = 32;
export declare const MAX_PLUGIN_COUNTDOWN_MS: number;
export declare const CLOCKS_STOP_KEY = "host.clocks-stop.v1";
export declare const CLOCK_CONTENT_CAPABILITIES: readonly ["structured-viewer", "kanban-board", "task-list", "note-graph", "calendar", "diagram-renderer", "code-intelligence", "text-styling", "note-comments", "presentation", "tooling", "terminal"];
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
export type PluginClockMutation = {
    type: "stopwatch-start" | "stopwatch-pause" | "stopwatch-reset";
} | {
    type: "countdown-create";
    id: string;
    title: string;
    durationMs: number;
    sound: boolean;
} | {
    type: "countdown-pause" | "countdown-resume" | "countdown-restart" | "countdown-cancel" | "countdown-dismiss" | "countdown-remove";
    id: string;
    occurrence?: number;
} | ({
    type: "alarm-create";
    id: string;
} & PluginAlarmInput) | ({
    type: "alarm-update";
    id: string;
    expectedRevision: number;
} & PluginAlarmInput) | {
    type: "alarm-toggle";
    id: string;
    enabled: boolean;
    occurrence?: number;
} | {
    type: "alarm-dismiss" | "alarm-snooze" | "alarm-remove";
    id: string;
    occurrence?: number;
} | ({
    type: "notification-started";
} & PluginClockTarget) | ({
    type: "notification-succeeded";
} & PluginClockTarget) | ({
    type: "notification-retry";
} & PluginClockTarget) | ({
    type: "notification-failed";
    error: string;
} & PluginClockTarget);
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
export declare function emptyClockModel(): PluginClockModel;
export declare function pendingClockDelivery(): PluginClockDelivery;
export declare function isPluginClockRegistration(value: unknown): value is Pick<PluginClockProvider, "id" | "title">;
export declare function isPluginClockRequest(value: unknown): value is PluginClockRequest;
export declare function isPluginClockModel(value: unknown): value is PluginClockModel;
export declare function ringingClocks(model: PluginClockModel): Array<PluginClockTarget & {
    title: string;
    sound: boolean;
    delivery: PluginClockDelivery;
}>;
export {};
