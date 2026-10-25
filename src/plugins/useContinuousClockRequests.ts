import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginTimeTrackingClock } from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";

export interface ClockProviderIdentity {
  pluginId: string;
  id: string;
}

export interface ClockRequestState<Model> {
  model: Model | null;
  loading: boolean;
  error: string | null;
  sampledAt: number;
  sample: PluginTimeTrackingClock | null;
  attemptedAt: number;
}

export const clockProviderKey = (provider: ClockProviderIdentity) => `${provider.pluginId}\u0000${provider.id}`;

interface Options<Model, Mutation> {
  providers: ClockProviderIdentity[];
  scopeKey: string | null;
  clock: (pluginId: string) => Promise<PluginTimeTrackingClock>;
  request: (pluginId: string, providerId: string, scope: string, clock: PluginTimeTrackingClock, mutation?: Mutation) => Promise<Model>;
  reportError: (error: unknown) => void;
  changedMessage: string;
  intervalMs?: number;
  whileHidden?: boolean;
  shouldPoll?: (state: ClockRequestState<Model>) => boolean;
}

export function useContinuousClockRequests<Model, Mutation>({
  providers, scopeKey, clock, request, reportError, changedMessage,
  intervalMs = 30_000, whileHidden = false, shouldPoll,
}: Options<Model, Mutation>) {
  const empty = useMemo<ClockRequestState<Model>>(
    () => ({ model: null, loading: false, error: null, sampledAt: 0, sample: null, attemptedAt: 0 }), [],
  );
  const signature = providers.map(clockProviderKey).join("\u0001");
  const scope = useRef({ scopeKey, signature });
  scope.current = { scopeKey, signature };
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const reportRef = useRef(reportError);
  reportRef.current = reportError;
  const pollRef = useRef(shouldPoll);
  pollRef.current = shouldPoll;
  const generation = useRef(0);
  const tails = useRef(new Map<string, Promise<unknown>>());
  const queries = useRef(new Map<string, Promise<Model>>());
  const [states, setStates] = useState<Record<string, ClockRequestState<Model> & {
    scopeKey: string; signature: string; generation: number;
  }>>({});
  const statesRef = useRef(states);
  statesRef.current = states;

  const token = useCallback((provider: ClockProviderIdentity) =>
    `${scope.current.scopeKey}\u0000${scope.current.signature}\u0000${generation.current}\u0000${clockProviderKey(provider)}`, []);
  const isCurrent = useCallback((provider: ClockProviderIdentity, expected: string) =>
    scope.current.scopeKey !== null && token(provider) === expected &&
    providersRef.current.some((candidate) => clockProviderKey(candidate) === clockProviderKey(provider)), [token]);
  const stateFor = useCallback((provider: ClockProviderIdentity): ClockRequestState<Model> => {
    const state = statesRef.current[clockProviderKey(provider)];
    return state?.scopeKey === scope.current.scopeKey && state.signature === scope.current.signature &&
      state.generation === generation.current ? state : empty;
  }, [empty]);

  const perform = useCallback((provider: ClockProviderIdentity, mutation?: Mutation): Promise<Model> => {
    const expected = { ...scope.current, generation: generation.current, token: token(provider) };
    const key = clockProviderKey(provider);
    const current = () => isCurrent(provider, expected.token);
    const operation = (tails.current.get(provider.pluginId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (!current() || expected.scopeKey === null) throw new Error(changedMessage);
      const capturedScope = expected.scopeKey;
      const update = (value: Partial<ClockRequestState<Model>>) => {
        if (!current()) return;
        setStates((previous) => ({
          ...previous,
          [key]: {
            ...(previous[key]?.scopeKey === capturedScope && previous[key]?.signature === expected.signature &&
              previous[key]?.generation === expected.generation ? previous[key] : empty),
            scopeKey: capturedScope, signature: expected.signature, generation: expected.generation, ...value,
          },
        }));
      };
      update({ loading: true, error: null, attemptedAt: performance.now() });
      try {
        const sample = await clock(provider.pluginId);
        const sampledAt = performance.now();
        if (!current()) throw new Error(changedMessage);
        const model = await request(provider.pluginId, provider.id, capturedScope, sample, mutation);
        if (!current()) throw new Error(changedMessage);
        update({ model, sampledAt, sample, loading: false });
        return model;
      } catch (error) {
        update({ error: errorMessage(error), loading: false });
        throw error;
      }
    });
    tails.current.set(provider.pluginId, operation);
    const cleanup = () => { if (tails.current.get(provider.pluginId) === operation) tails.current.delete(provider.pluginId); };
    void operation.then(cleanup, cleanup);
    return operation;
  }, [changedMessage, clock, empty, isCurrent, request, token]);

  const refresh = useCallback((provider: ClockProviderIdentity) => {
    const key = token(provider);
    const pending = queries.current.get(key);
    if (pending) return pending;
    const operation = perform(provider);
    queries.current.set(key, operation);
    const cleanup = () => { if (queries.current.get(key) === operation) queries.current.delete(key); };
    void operation.then(cleanup, cleanup);
    return operation;
  }, [perform, token]);

  useEffect(() => {
    const expected = ++generation.current;
    const recheck = (force: boolean) => {
      if (scopeKey === null || !whileHidden && document.visibilityState === "hidden") return;
      for (const provider of providersRef.current) {
        if (!force && pollRef.current && !pollRef.current(stateFor(provider))) continue;
        void refresh(provider).catch((error) => {
          if (generation.current === expected) reportRef.current(error);
        });
      }
    };
    recheck(true);
    const active = scopeKey !== null && providersRef.current.length > 0;
    const interval = active ? window.setInterval(() => recheck(false), intervalMs) : null;
    const focus = () => recheck(true);
    if (active) {
      window.addEventListener("focus", focus);
      document.addEventListener("visibilitychange", focus);
    }
    return () => {
      generation.current += 1;
      if (interval !== null) window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [intervalMs, refresh, scopeKey, signature, stateFor, whileHidden]);

  return { stateFor, refresh, mutate: perform, token, isCurrent, requestStates: states };
}
