import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_PLUGIN_REMINDER_NOTIFICATION_BODY_BYTES,
  MAX_PLUGIN_REMINDER_NOTIFICATION_TITLE_BYTES,
  truncateUtf8,
  type PluginReminderModel,
  type PluginReminderMutation,
  type PluginReminderMutationRequest,
  type PluginReminderQuery,
  type PluginReminderRecord,
} from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { PluginReminderContribution } from "./workerRuntime";

const RECHECK_INTERVAL_MS = 30_000;
const MAX_INDIVIDUAL_NOTIFICATIONS = 5;

export interface ReminderProviderState {
  model: PluginReminderModel | null;
  loading: boolean;
  error: string | null;
}

export interface ReminderBump {
  id: string;
  provider: PluginReminderContribution;
  reminder: PluginReminderRecord;
}

interface ReminderSchedulerOptions {
  providers: PluginReminderContribution[];
  workspaceId: string | null;
  queryReminders: (
    pluginId: string,
    providerId: string,
    request: PluginReminderQuery,
  ) => Promise<PluginReminderModel>;
  mutateReminders: (
    pluginId: string,
    providerId: string,
    request: PluginReminderMutationRequest,
  ) => Promise<PluginReminderModel>;
  reportError: (error: unknown) => void;
  notify?: (pluginId: string, title: string, body?: string) => Promise<void>;
  now?: () => number;
}

export interface ReminderSchedulerController {
  bumps: ReminderBump[];
  stateFor: (provider: PluginReminderContribution) => ReminderProviderState;
  dueCountFor: (provider: PluginReminderContribution) => number;
  mutate: (
    provider: PluginReminderContribution,
    mutation: PluginReminderMutation,
  ) => Promise<PluginReminderModel>;
  retry: (
    provider: PluginReminderContribution,
    reminder: PluginReminderRecord,
  ) => Promise<void>;
  refresh: (provider?: PluginReminderContribution) => Promise<void>;
  dismissBump: (id: string) => void;
  clearBumpsFor: (provider: PluginReminderContribution) => void;
}

const EMPTY_STATE: ReminderProviderState = {
  model: null,
  loading: false,
  error: null,
};

export function useReminderScheduler({
  providers,
  workspaceId,
  queryReminders,
  mutateReminders,
  reportError,
  notify = api.pluginShowNotification,
  now = Date.now,
}: ReminderSchedulerOptions): ReminderSchedulerController {
  const [states, setStates] = useState<Record<string, ReminderProviderState>>(
    {},
  );
  const [bumps, setBumps] = useState<ReminderBump[]>([]);
  const generation = useRef(0);
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;
  const tails = useRef(new Map<string, Promise<unknown>>());
  const delivering = useRef(new Set<string>());
  const reportedErrors = useRef(new Map<string, string>());
  const seenBumps = useRef(new Set<string>());
  const providerKeys = useMemo(
    () => new Set(providers.map(reminderProviderKey)),
    [providers],
  );
  const providerSignature = providers
    .map(
      (provider) =>
        `${reminderProviderKey(provider)}\u0000${provider.title}\u0000${provider.defaultSnoozeMinutes}`,
    )
    .join("\u0001");
  const providerKeysRef = useRef(providerKeys);
  providerKeysRef.current = providerKeys;

  const current = useCallback(
    (expectedGeneration: number, scope: string, providerKey: string) =>
      generation.current === expectedGeneration &&
      workspaceRef.current === scope &&
      providerKeysRef.current.has(providerKey),
    [],
  );

  const setProviderState = useCallback(
    (
      providerKey: string,
      update: (
        previous: ReminderProviderState,
      ) => ReminderProviderState,
    ) => {
      setStates((previous) => ({
        ...previous,
        [providerKey]: update(previous[providerKey] ?? EMPTY_STATE),
      }));
    },
    [],
  );

  const forgetReminderBumps = useCallback(
    (provider: PluginReminderContribution, reminderId: string) => {
      const scope = workspaceRef.current;
      if (!scope) {
        return;
      }
      const prefix = `${scope}\u0000${reminderProviderKey(provider)}\u0000${reminderId}\u0000`;
      for (const key of seenBumps.current) {
        if (key.startsWith(prefix)) {
          seenBumps.current.delete(key);
        }
      }
      setBumps((current) =>
        current.filter(
          (bump) =>
            bump.provider.pluginId !== provider.pluginId ||
            bump.provider.id !== provider.id ||
            bump.reminder.id !== reminderId,
        ),
      );
    },
    [],
  );

  const showBump = useCallback(
    (
      provider: PluginReminderContribution,
      reminder: PluginReminderRecord,
    ) => {
      const scope = workspaceRef.current;
      if (!scope) {
        return;
      }
      const id = `${scope}\u0000${reminderProviderKey(provider)}\u0000${reminder.id}\u0000${reminder.dueAt}`;
      if (seenBumps.current.has(id)) {
        return;
      }
      seenBumps.current.add(id);
      setBumps((current) => [
        ...current,
        {
          id,
          provider,
          reminder: {
            ...reminder,
            target: { ...reminder.target },
            schedule: { ...reminder.schedule },
            recurrence: reminder.recurrence
              ? { ...reminder.recurrence }
              : null,
          },
        },
      ]);
    },
    [],
  );

  const enqueue = useCallback(
    <T,>(queueKey: string, operation: () => Promise<T>): Promise<T> => {
      const previous = tails.current.get(queueKey) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(operation);
      tails.current.set(queueKey, next);
      void next.finally(() => {
        if (tails.current.get(queueKey) === next) {
          tails.current.delete(queueKey);
        }
      });
      return next;
    },
    [],
  );

  const mutate = useCallback(
    (
      provider: PluginReminderContribution,
      mutation: PluginReminderMutation,
    ): Promise<PluginReminderModel> => {
      const scope = workspaceRef.current;
      if (!scope) {
        throw new Error("No vault is available for reminders.");
      }
      const expectedGeneration = generation.current;
      const key = reminderProviderKey(provider);
      const queueKey = `${scope}\u0000${key}`;
      return enqueue(queueKey, async () => {
        if (!current(expectedGeneration, scope, key)) {
          throw new Error("The reminders workspace changed.");
        }
        const model = await mutateReminders(
          provider.pluginId,
          provider.id,
          {
            workspaceId: scope,
            now: now(),
            mutation,
          },
        );
        if (!current(expectedGeneration, scope, key)) {
          throw new Error("The reminders workspace changed.");
        }
        setProviderState(key, () => ({
          model,
          loading: false,
          error: null,
        }));
        if (
          [
            "update",
            "snooze",
            "dismiss",
            "complete",
            "restore",
            "advance",
            "remove",
          ].includes(mutation.type)
        ) {
          forgetReminderBumps(provider, mutation.id);
        }
        return model;
      });
    },
    [
      current,
      enqueue,
      mutateReminders,
      now,
      forgetReminderBumps,
      setProviderState,
    ],
  );

  const finishDelivery = useCallback(
    async (
      provider: PluginReminderContribution,
      reminderId: string,
      succeeded: boolean,
      failure?: unknown,
    ) => {
      const timestamp = now();
      await mutate(provider, succeeded
        ? {
            type: "delivery-succeeded",
            id: reminderId,
            completedAt: timestamp,
          }
        : {
            type: "delivery-failed",
            id: reminderId,
            failedAt: timestamp,
            error: errorMessage(failure),
          });
    },
    [mutate, now],
  );

  const beginDelivery = useCallback(
    async (
      provider: PluginReminderContribution,
      reminder: PluginReminderRecord,
    ): Promise<PluginReminderRecord | null> => {
      const model = await mutate(provider, {
        type: "delivery-started",
        id: reminder.id,
        startedAt: now(),
      });
      return (
        model.reminders.find(
          (candidate) =>
            candidate.id === reminder.id &&
            candidate.status === "delivering",
        ) ?? null
      );
    },
    [mutate, now],
  );

  const deliverOne = useCallback(
    async (
      provider: PluginReminderContribution,
      reminder: PluginReminderRecord,
    ) => {
      const scope = workspaceRef.current;
      if (!scope) {
        return;
      }
      const key = `${scope}\u0000${reminderProviderKey(provider)}\u0000${reminder.id}`;
      if (delivering.current.has(key)) {
        return;
      }
      delivering.current.add(key);
      try {
        const started = await beginDelivery(provider, reminder);
        if (!started) {
          return;
        }
        try {
          await notify(
            provider.pluginId,
            truncateUtf8(
              started.title,
              MAX_PLUGIN_REMINDER_NOTIFICATION_TITLE_BYTES,
            ),
            truncateUtf8(
              reminderNotificationBody(started),
              MAX_PLUGIN_REMINDER_NOTIFICATION_BODY_BYTES,
            ),
          );
          await finishDelivery(provider, started.id, true);
        } catch (error) {
          await finishDelivery(provider, started.id, false, error);
        }
      } catch (error) {
        if (!/workspace changed/u.test(errorMessage(error))) {
          reportError(error);
        }
      } finally {
        delivering.current.delete(key);
      }
    },
    [beginDelivery, finishDelivery, notify, reportError],
  );

  const deliverDue = useCallback(
    async (
      provider: PluginReminderContribution,
      model: PluginReminderModel,
    ) => {
      const timestamp = now();
      const due = model.reminders.filter(
        (reminder) =>
          reminder.status === "scheduled" && reminder.dueAt <= timestamp,
      );
      if (due.length === 0) {
        return;
      }
      for (const reminder of due) {
        showBump(provider, reminder);
      }
      if (due.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
        for (const reminder of due) {
          await deliverOne(provider, reminder);
        }
        return;
      }

      const started: PluginReminderRecord[] = [];
      for (const reminder of due) {
        try {
          const currentReminder = await beginDelivery(provider, reminder);
          if (currentReminder) {
            started.push(currentReminder);
          }
        } catch (error) {
          reportError(error);
          return;
        }
      }
      if (started.length === 0) {
        return;
      }
      try {
        await notify(
          provider.pluginId,
          `${started.length} reminders need attention`,
          "Open Denote and choose Reminders to review, snooze, dismiss, or open their notes.",
        );
        for (const reminder of started) {
          await finishDelivery(provider, reminder.id, true);
        }
      } catch (error) {
        for (const reminder of started) {
          try {
            await finishDelivery(provider, reminder.id, false, error);
          } catch (mutationError) {
            reportError(mutationError);
          }
        }
      }
    },
    [
      beginDelivery,
      deliverOne,
      finishDelivery,
      notify,
      now,
      reportError,
      showBump,
    ],
  );

  const refreshProvider = useCallback(
    async (provider: PluginReminderContribution) => {
      const scope = workspaceRef.current;
      if (!scope) {
        return;
      }
      const expectedGeneration = generation.current;
      const key = reminderProviderKey(provider);
      const queueKey = `${scope}\u0000${key}`;
      setProviderState(key, (previous) => ({
        ...previous,
        loading: true,
        error: null,
      }));
      try {
        const model = await enqueue(queueKey, async () => {
          if (!current(expectedGeneration, scope, key)) {
            throw new Error("The reminders workspace changed.");
          }
          return queryReminders(provider.pluginId, provider.id, {
            workspaceId: scope,
            now: now(),
          });
        });
        if (!current(expectedGeneration, scope, key)) {
          return;
        }
        reportedErrors.current.delete(key);
        setProviderState(key, () => ({
          model,
          loading: false,
          error: null,
        }));
        for (const reminder of model.reminders) {
          if (reminder.status === "notified" || reminder.status === "failed") {
            showBump(provider, reminder);
          }
        }
        await deliverDue(provider, model);
      } catch (error) {
        if (!current(expectedGeneration, scope, key)) {
          return;
        }
        const message = errorMessage(error);
        setProviderState(key, (previous) => ({
          ...previous,
          loading: false,
          error: message,
        }));
        if (reportedErrors.current.get(key) !== message) {
          reportedErrors.current.set(key, message);
          reportError(error);
        }
      }
    },
    [
      current,
      deliverDue,
      enqueue,
      now,
      queryReminders,
      reportError,
      showBump,
      setProviderState,
    ],
  );

  const refresh = useCallback(
    async (provider?: PluginReminderContribution) => {
      if (provider) {
        await refreshProvider(provider);
        return;
      }
      await Promise.all(providersRef.current.map(refreshProvider));
    },
    [refreshProvider],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    generation.current += 1;
    seenBumps.current.clear();
    setBumps([]);
    const activeProviders = providersRef.current;
    const activeKeys = new Set(activeProviders.map(reminderProviderKey));
    setStates((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => activeKeys.has(key)),
      ),
    );
    if (!workspaceId || activeProviders.length === 0) {
      return;
    }
    let active = true;
    const run = () => {
      if (active) {
        void refreshRef.current();
      }
    };
    run();
    const interval = window.setInterval(run, RECHECK_INTERVAL_MS);
    const onFocus = () => run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      generation.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [providerSignature, workspaceId]);

  const stateFor = useCallback(
    (provider: PluginReminderContribution) =>
      states[reminderProviderKey(provider)] ?? EMPTY_STATE,
    [states],
  );

  const dueCountFor = useCallback(
    (provider: PluginReminderContribution) => {
      const timestamp = now();
      return (
        states[reminderProviderKey(provider)]?.model?.reminders.filter(
          (reminder) => reminderNeedsAttention(reminder, timestamp),
        ).length ?? 0
      );
    },
    [now, states],
  );

  const retry = useCallback(
    async (
      provider: PluginReminderContribution,
      reminder: PluginReminderRecord,
    ) => {
      if (reminder.status !== "failed") {
        throw new Error("Only failed notification attempts can be retried.");
      }
      await deliverOne(provider, reminder);
    },
    [deliverOne],
  );

  const dismissBump = useCallback((id: string) => {
    setBumps((current) => current.filter((bump) => bump.id !== id));
  }, []);

  const clearBumpsFor = useCallback(
    (provider: PluginReminderContribution) => {
      setBumps((current) =>
        current.filter(
          (bump) =>
            bump.provider.pluginId !== provider.pluginId ||
            bump.provider.id !== provider.id,
        ),
      );
    },
    [],
  );

  return {
    bumps,
    stateFor,
    dueCountFor,
    mutate,
    retry,
    refresh,
    dismissBump,
    clearBumpsFor,
  };
}

export function reminderProviderKey(
  provider: Pick<PluginReminderContribution, "pluginId" | "id">,
): string {
  return `${provider.pluginId}\u0000${provider.id}`;
}

function reminderNotificationBody(reminder: PluginReminderRecord): string {
  if (reminder.target.kind === "standalone") {
    return "Open Denote for snooze, dismiss, and edit actions.";
  }
  const target =
    reminder.target.kind === "note"
      ? reminder.target.noteTitle ?? reminder.target.path ?? "linked note"
      : `${reminder.target.noteTitle ?? reminder.target.path ?? "linked note"}, ${
          reminder.target.kind === "heading" ? "heading" : "task"
        } at line ${reminder.target.line}`;
  return `Reminder for ${target}. Open Denote for snooze, dismiss, and open-note actions.`;
}

function reminderNeedsAttention(
  reminder: PluginReminderRecord,
  now: number,
): boolean {
  return (
    reminder.status === "delivering" ||
    reminder.status === "notified" ||
    reminder.status === "failed" ||
    (reminder.status === "scheduled" && reminder.dueAt <= now)
  );
}
