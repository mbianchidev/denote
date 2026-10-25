import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ringingClocks, truncateUtf8,
  type PluginClockModel, type PluginClockMutation, type PluginClockRequest,
  type PluginClockTarget, type PluginTimeTrackingClock,
} from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import { ClockSound, type ClockSoundPlayer } from "../lib/clockSound";
import type { PluginClockContribution } from "./workerRuntime";
import { clockProviderKey, useContinuousClockRequests, type ClockRequestState } from "./useContinuousClockRequests";

export interface ClockAlert extends PluginClockTarget {
  provider: PluginClockContribution;
  title: string;
  sound: boolean;
  error: string | null;
}

export interface ClockController {
  stateFor: (provider: PluginClockContribution) => ClockRequestState<PluginClockModel>;
  refresh: (provider: PluginClockContribution) => Promise<PluginClockModel>;
  mutate: (provider: PluginClockContribution, mutation: PluginClockMutation) => Promise<PluginClockModel>;
  alerts: ClockAlert[];
  soundReady: boolean;
  soundError: string | null;
  enableSound: () => Promise<boolean>;
  silence: () => void;
}

interface Options {
  providers: PluginClockContribution[];
  request: (pluginId: string, providerId: string, request: PluginClockRequest) => Promise<PluginClockModel>;
  reportError: (error: unknown) => void;
  clock?: (pluginId: string) => Promise<PluginTimeTrackingClock>;
  notify?: (pluginId: string, title: string, body?: string, sound?: boolean) => Promise<void>;
  audio?: ClockSoundPlayer;
}

export function useClocks({
  providers, request, reportError, clock = api.pluginClockSample,
  notify = api.pluginShowNotification, audio: suppliedAudio,
}: Options): ClockController {
  const [audio] = useState(() => suppliedAudio ?? new ClockSound());
  const [soundError, setSoundError] = useState<string | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [, updateSound] = useState(0);
  const reportRef = useRef(reportError);
  reportRef.current = reportError;
  const inFlight = useRef(new Set<string>());
  const execute = useCallback((
    pluginId: string, providerId: string, _scope: string, sample: PluginTimeTrackingClock, mutation?: PluginClockMutation,
  ) => request(pluginId, providerId, { clock: sample, ...(mutation ? { mutation } : {}) }), [request]);
  const engine = useContinuousClockRequests({
    providers, scopeKey: "global-clocks", clock, request: execute, reportError,
    changedMessage: "The clock provider changed.", intervalMs: 1_000, whileHidden: true, shouldPoll,
  });
  const alerts = useMemo(() => providers.flatMap((provider) => {
    const model = engine.stateFor(provider).model;
    return model ? ringingClocks(model).map((row) => ({
      provider, kind: row.kind, id: row.id, occurrence: row.occurrence,
      title: row.title, sound: row.sound, error: row.delivery.error,
    })) : [];
  }), [providers, engine.requestStates, engine.stateFor]);
  const alertKey = (alert: ClockAlert) => `${clockProviderKey(alert.provider)}\u0000${alert.kind}\u0000${alert.id}\u0000${alert.occurrence}`;
  const activeKeys = alerts.map(alertKey);
  const activeSignature = activeKeys.join("\u0001");
  useEffect(() => {
    const active = new Set(activeSignature ? activeSignature.split("\u0001") : []);
    setMuted((previous) => previous.every((key) => active.has(key)) ? previous : previous.filter((key) => active.has(key)));
  }, [activeSignature]);
  const ringing = alerts.some((alert) => alert.sound && !muted.includes(alertKey(alert)));
  useEffect(() => { audio.setRinging(ringing); }, [audio, ringing]);
  const signature = providers.map(clockProviderKey).join("\u0001");
  useEffect(() => {
    if (!signature) void audio.dispose().catch((error) => reportRef.current(error));
    return () => audio.setRinging(false);
  }, [audio, signature]);
  useEffect(() => () => {
    void audio.dispose().catch((error) => reportRef.current(error));
  }, [audio]);

  useEffect(() => {
    for (const provider of providers) {
      const state = engine.stateFor(provider);
      if (!state.model || state.loading || state.error) continue;
      const model = state.model;
      const token = engine.token(provider);
      const keyFor = (target: PluginClockTarget) => `${token}\u0000${target.kind}\u0000${target.id}\u0000${target.occurrence}`;
      const due = ringingClocks(model).filter((row) =>
        (row.delivery.status === "pending" || row.delivery.status === "sending") && !inFlight.current.has(keyFor(row)));
      if (due.length === 0) continue;
      due.forEach((row) => inFlight.current.add(keyFor(row)));
      const run = async () => {
        const started: typeof due = [];
        for (const row of due) {
          if (!engine.isCurrent(provider, token)) return;
          try {
            if (row.delivery.status === "sending") {
              await engine.mutate(provider, {
                type: "notification-failed", kind: row.kind, id: row.id, occurrence: row.occurrence,
                error: "Notification status could not be confirmed. It may already have appeared; retry only if needed.",
              });
              continue;
            }
            const next = await engine.mutate(provider, {
              type: "notification-started", kind: row.kind, id: row.id, occurrence: row.occurrence,
            });
            const active = ringingClocks(next).find((item) => sameAlert(item, row) && item.delivery.status === "sending");
            if (active) started.push(active);
          } catch (error) {
            if (!/no longer exists|no longer current/u.test(errorMessage(error))) throw error;
          }
        }
        const groups = started.length > 5 ? [started] : started.map((row) => [row]);
        for (const group of groups) {
          if (!engine.isCurrent(provider, token)) return;
          const title = group.length === 1
            ? `${group[0].kind === "alarm" ? "Alarm" : "Countdown"}: ${group[0].title}`
            : `${group.length} clocks need attention`;
          let failure: unknown;
          let failed = false;
          try {
            await notify(
              provider.pluginId, truncateUtf8(title, 120),
              "Open Denote to dismiss the alert or snooze an alarm.",
              group.some((row) => row.sound),
            );
          } catch (error) {
            failed = true;
            failure = error;
            if (engine.isCurrent(provider, token)) reportRef.current(error);
          }
          for (const row of group) {
            if (!engine.isCurrent(provider, token)) return;
            const latest = await engine.refresh(provider);
            if (!engine.isCurrent(provider, token) ||
              !ringingClocks(latest).some((item) => sameAlert(item, row) && item.delivery.status === "sending")) continue;
            const target = { kind: row.kind, id: row.id, occurrence: row.occurrence };
            await engine.mutate(provider, !failed
              ? { ...target, type: "notification-succeeded" }
              : { ...target, type: "notification-failed", error: truncateUtf8(errorMessage(failure), 512) });
          }
        }
      };
      const cleanup = () => due.forEach((row) => inFlight.current.delete(keyFor(row)));
      void run().catch((error) => {
        if (engine.isCurrent(provider, token)) reportRef.current(error);
      }).then(cleanup, cleanup);
    }
  });

  const enableSound = useCallback(async () => {
    try {
      await audio.enable();
      setSoundError(null);
      updateSound((value) => value + 1);
      return audio.ready;
    } catch (error) {
      setSoundError(errorMessage(error));
      reportRef.current(error);
      return false;
    }
  }, [audio]);
  const silence = () => {
    audio.setRinging(false);
    setMuted(activeKeys);
  };
  return { ...engine, alerts, soundReady: audio.ready, soundError, enableSound, silence };
}

function shouldPoll(state: ClockRequestState<PluginClockModel>): boolean {
  if (state.loading) return false;
  const age = performance.now() - state.attemptedAt;
  if (state.error) return age >= 30_000;
  if (!state.model || !state.sample || age >= 30_000) return true;
  const sample = state.sample;
  const elapsed = Math.max(0, performance.now() - state.sampledAt);
  if (Math.abs(Date.now() - state.sample.wallTimeMs - elapsed) > 1_500) return true;
  return state.model.countdowns.some((row) => row.status === "running" && row.remainingMs <= elapsed + 1_000) ||
    state.model.alarms.some((row) => row.status === "scheduled" && row.dueAt <= sample.wallTimeMs + elapsed + 1_000);
}

function sameAlert(left: PluginClockTarget, right: PluginClockTarget): boolean {
  return left.kind === right.kind && left.id === right.id && left.occurrence === right.occurrence;
}
