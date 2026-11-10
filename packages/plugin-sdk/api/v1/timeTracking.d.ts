import type { PluginDisposable, PluginProjectContext } from "./contracts";
export declare const MAX_TIME_TRACKING_SESSIONS = 500;
export declare const MAX_TIME_TRACKING_HISTORY = 32;
export declare const MAX_TIME_TRACKING_SEGMENTS = 512;
export declare const TIME_TRACKING_STOP_KEY = "host.time-tracking-stop.v1";
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
export type PluginTimeTrackingMutation = {
    type: "start";
    id: string;
    target: PluginTimeTrackingTarget;
    description: string;
} | {
    type: "pause" | "resume" | "stop";
    id: string;
} | {
    type: "correct";
    id: string;
    expectedRevision: number;
    reason: string;
    values: Omit<PluginTimeTrackingValues, "segments" | "endedAt"> & {
        endedAt: number;
    };
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
    request: (request: PluginTimeTrackingRequest) => PluginTimeTrackingModel | Promise<PluginTimeTrackingModel>;
}
export interface PluginTimeTrackingCapability {
    register: (provider: PluginTimeTrackingProvider) => PluginDisposable;
}
export declare function timeTrackingSessionElapsed(session: PluginTimeTrackingSession, from: number, to: number): number;
export declare function timeTrackingTotals(sessions: PluginTimeTrackingSession[], from: number, to: number, group: "note" | "project" | "tag"): Array<{
    id: string;
    label: string;
    elapsedMs: number;
}>;
export declare function exportTimeTrackingSessions(sessions: PluginTimeTrackingSession[], format: "csv" | "json", exportedAt: number): string;
export declare function isPluginTimeTrackingClock(value: unknown): value is PluginTimeTrackingClock;
export declare function isPluginTimeTrackingRegistration(value: unknown): value is Pick<PluginTimeTrackingProvider, "id" | "title">;
export declare function isPluginTimeTrackingTarget(value: unknown): value is PluginTimeTrackingTarget;
export declare function isPluginTimeTrackingRequest(value: unknown): value is PluginTimeTrackingRequest;
export declare function isPluginTimeTrackingSession(value: unknown): value is PluginTimeTrackingSession;
export declare function isPluginTimeTrackingModel(value: unknown): value is PluginTimeTrackingModel;
