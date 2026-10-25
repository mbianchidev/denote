import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginTimeTrackingClock,
  PluginTimeTrackingModel,
  PluginTimeTrackingMutation,
  PluginTimeTrackingRequest,
} from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { PluginTimeTrackingContribution } from "./workerRuntime";

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

const EMPTY: TimeTrackingState = { model: null, loading: false, error: null, sampledAt: 0 };
const providerKey = (provider: PluginTimeTrackingContribution) => `${provider.pluginId}\u0000${provider.id}`;

export function useTimeTracking({
  providers, workspaceId, request, reportError, clock = api.pluginTimeTrackingClock,
}: Options): TimeTrackingController {
  const signature = providers.map(providerKey).join("\u0001");
  const scope = useRef({ workspaceId, signature });
  scope.current = { workspaceId, signature };
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const reportRef = useRef(reportError);
  reportRef.current = reportError;
  const generation = useRef(0);
  const tails = useRef(new Map<string, Promise<unknown>>());
  const queries = useRef(new Map<string, Promise<PluginTimeTrackingModel>>());
  const [states, setStates] = useState<Record<string, TimeTrackingState & {
    workspaceId: string; signature: string; generation: number;
  }>>({});

  const perform = useCallback((
    provider: PluginTimeTrackingContribution, mutation?: PluginTimeTrackingMutation,
  ): Promise<PluginTimeTrackingModel> => {
    const expected = { ...scope.current, generation: generation.current };
    const key = providerKey(provider);
    const current = () => expected.workspaceId !== null &&
      scope.current.workspaceId === expected.workspaceId &&
      scope.current.signature === expected.signature &&
      generation.current === expected.generation &&
      providersRef.current.some((candidate) => providerKey(candidate) === key);
    const operation = (tails.current.get(provider.pluginId) ?? Promise.resolve())
      .catch(() => undefined).then(async () => {
        if (!current() || expected.workspaceId === null) throw new Error("The time-tracking vault changed.");
        const workspaceId = expected.workspaceId;
        const update = (value: Partial<TimeTrackingState>) => {
          if (!current()) return;
          setStates((previous) => ({
            ...previous,
            [key]: {
              ...(previous[key]?.workspaceId === expected.workspaceId &&
                previous[key]?.signature === expected.signature &&
                previous[key]?.generation === expected.generation ? previous[key] : EMPTY),
              workspaceId,
              signature: expected.signature,
              generation: expected.generation,
              ...value,
            },
          }));
        };
        update({ loading: true, error: null });
        try {
          const sample = await clock(provider.pluginId);
          const sampledAt = performance.now();
          if (!current()) throw new Error("The time-tracking vault changed.");
          const model = await request(provider.pluginId, provider.id, {
            workspaceId, clock: sample, ...(mutation ? { mutation } : {}),
          });
          if (!current()) throw new Error("The time-tracking vault changed.");
          update({ model, sampledAt, loading: false });
          return model;
        } catch (error) {
          update({ error: errorMessage(error), loading: false });
          throw error;
        }
      });
    tails.current.set(provider.pluginId, operation);
    const cleanup = () => {
      if (tails.current.get(provider.pluginId) === operation) tails.current.delete(provider.pluginId);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }, [clock, request]);

  const refresh = useCallback((provider: PluginTimeTrackingContribution) => {
    const key = `${scope.current.workspaceId}\u0000${generation.current}\u0000${providerKey(provider)}`;
    const pending = queries.current.get(key);
    if (pending) return pending;
    const operation = perform(provider);
    queries.current.set(key, operation);
    const cleanup = () => { if (queries.current.get(key) === operation) queries.current.delete(key); };
    void operation.then(cleanup, cleanup);
    return operation;
  }, [perform]);

  useEffect(() => {
    const expected = ++generation.current;
    const recheck = () => {
      if (!workspaceId || document.visibilityState === "hidden") return;
      for (const provider of providersRef.current) {
        void refresh(provider).catch((error) => {
          if (generation.current === expected) reportRef.current(error);
        });
      }
    };
    recheck();
    if (!workspaceId || providersRef.current.length === 0) return;
    const interval = window.setInterval(recheck, 30_000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      generation.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh, signature, workspaceId]);

  return {
    stateFor(provider) {
      const state = states[providerKey(provider)];
      return state?.workspaceId === workspaceId && state.signature === signature &&
        state.generation === generation.current ? state : EMPTY;
    },
    refresh,
    mutate: perform,
  };
}
