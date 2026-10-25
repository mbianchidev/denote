import { useCallback } from "react";
import type {
  PluginTimeTrackingClock,
  PluginTimeTrackingModel,
  PluginTimeTrackingMutation,
  PluginTimeTrackingRequest,
} from "@denote/plugin-sdk";
import { api } from "../lib/api";
import type { PluginTimeTrackingContribution } from "./workerRuntime";
import { useContinuousClockRequests } from "./useContinuousClockRequests";

export interface TimeTrackingState {
  model: PluginTimeTrackingModel | null;
  loading: boolean;
  error: string | null;
  sampledAt: number;
}

export interface TimeTrackingController {
  stateFor: (provider: PluginTimeTrackingContribution) => TimeTrackingState;
  refresh: (provider: PluginTimeTrackingContribution) => Promise<PluginTimeTrackingModel>;
  mutate: (
    provider: PluginTimeTrackingContribution, mutation: PluginTimeTrackingMutation,
  ) => Promise<PluginTimeTrackingModel>;
}

interface Options {
  providers: PluginTimeTrackingContribution[];
  workspaceId: string | null;
  request: (
    pluginId: string, providerId: string, request: PluginTimeTrackingRequest,
  ) => Promise<PluginTimeTrackingModel>;
  reportError: (error: unknown) => void;
  clock?: (pluginId: string) => Promise<PluginTimeTrackingClock>;
}

export function useTimeTracking({
  providers, workspaceId, request, reportError, clock = api.pluginTimeTrackingClock,
}: Options): TimeTrackingController {
  const execute = useCallback(
    (pluginId: string, providerId: string, scope: string, sample: PluginTimeTrackingClock, mutation?: PluginTimeTrackingMutation) =>
      request(pluginId, providerId, { workspaceId: scope, clock: sample, ...(mutation ? { mutation } : {}) }),
    [request],
  );
  return useContinuousClockRequests({
    providers, scopeKey: workspaceId, clock, request: execute, reportError,
    changedMessage: "The time-tracking vault changed.",
  });
}
