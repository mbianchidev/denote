import {
  CLOCKS_STOP_KEY,
  MAX_PLUGIN_ALARMS,
  MAX_PLUGIN_COUNTDOWNS,
  emptyClockModel,
  isPluginClockModel,
  isPluginClockRequest,
  isPluginTimeTrackingClock,
  nextRecurringSchedule,
  pendingClockDelivery,
  resolveWallClock,
  truncateUtf8,
  type PluginAlarm,
  type PluginClockModel,
  type PluginClockMutation,
  type PluginClockRequest,
  type PluginClockTarget,
  type PluginCountdown,
  type PluginStorage,
  type PluginTimeTrackingClock,
} from "@denote/plugin-sdk";

const KEY = "clocks.v1";
interface State {
  version: 1;
  model: PluginClockModel;
  stopwatchClock: PluginTimeTrackingClock | null;
  countdownClocks: Array<{ id: string; clock: PluginTimeTrackingClock }>;
  disabledAt: PluginTimeTrackingClock | null;
}

export class ClockStore {
  private tail: Promise<unknown> = Promise.resolve();
  private restored = false;
  constructor(private readonly storage: PluginStorage) {}

  request(request: PluginClockRequest): Promise<PluginClockModel> {
    const operation = this.tail.catch(() => undefined).then(() => this.apply(request));
    this.tail = operation;
    return operation;
  }

  private async apply(request: PluginClockRequest): Promise<PluginClockModel> {
    if (!isPluginClockRequest(request)) throw new Error("Invalid clock request.");
    const loaded = await this.storage.get<State>(KEY);
    const state: State = loaded === null ? {
      version: 1, model: emptyClockModel(), stopwatchClock: null, countdownClocks: [], disabledAt: null,
    } : loaded;
    validate(state);
    const cutoff = await this.storage.get<PluginTimeTrackingClock>(CLOCKS_STOP_KEY);
    if (cutoff !== null) {
      if (!isPluginTimeTrackingClock(cutoff)) throw new Error("The saved clock stop checkpoint is invalid.");
      settle(state, cutoff);
      if (state.model.stopwatch.status === "running") state.model.stopwatch.status = "paused";
      state.stopwatchClock = null;
      for (const row of state.model.countdowns) {
        if (row.status === "running" || row.status === "paused" || row.status === "ringing") row.status = "cancelled";
      }
      for (const row of state.model.alarms) row.status = "disabled";
      state.countdownClocks = [];
      state.disabledAt = cutoff;
      await this.save(state);
      await this.storage.delete(CLOCKS_STOP_KEY);
    }
    if (!this.restored) {
      for (const row of [...state.model.countdowns, ...state.model.alarms]) {
        if (row.delivery.status === "sending") {
          row.delivery = { ...row.delivery, status: "failed", error: "Notification dispatch was interrupted. It may already have appeared; retry only if needed." };
        }
      }
    }
    settle(state, request.clock);
    if (request.mutation) {
      if (state.disabledAt?.bootId === request.clock.bootId &&
        request.clock.monotonicMs <= state.disabledAt.monotonicMs) {
        throw new Error("Clocks were disabled after this action was queued. Refresh before trying again.");
      }
      mutate(state, request.mutation, request.clock);
    }
    validate(state);
    if (loaded !== null || request.mutation || cutoff !== null) await this.save(state);
    this.restored = true;
    return structuredClone(state.model);
  }

  private async save(state: State): Promise<void> {
    validate(state);
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 240 * 1024) {
      throw new Error("Clock storage is full. Remove unused countdowns or alarms before adding more.");
    }
    await this.storage.set(KEY, state);
  }
}

function settle(state: State, now: PluginTimeTrackingClock): void {
  const stopwatch = state.model.stopwatch;
  if (state.stopwatchClock) {
    const delta = elapsed(state.stopwatchClock, now);
    if (delta === null) {
      stopwatch.status = "paused";
      stopwatch.recoveryNotice = "The system restarted. The timer is paused at its last saved checkpoint.";
      state.stopwatchClock = null;
    } else {
      stopwatch.elapsedMs += delta;
      state.stopwatchClock = now;
    }
  }
  for (const anchor of [...state.countdownClocks]) {
    const countdown = state.model.countdowns.find((row) => row.id === anchor.id);
    if (!countdown) throw new Error("The saved countdown checkpoint is missing its countdown.");
    const delta = elapsed(anchor.clock, now);
    if (delta === null) {
      countdown.status = "paused";
      countdown.recoveryNotice = "The system restarted. The countdown is paused with its last saved remaining time.";
      removeAnchor(state, countdown.id);
    } else {
      countdown.remainingMs = Math.max(0, countdown.remainingMs - delta);
      anchor.clock = now;
      if (countdown.remainingMs === 0) {
        countdown.status = "ringing";
        countdown.updatedAt = now.wallTimeMs;
        removeAnchor(state, countdown.id);
      }
    }
  }
  for (const alarm of state.model.alarms) {
    if (alarm.status === "scheduled" && alarm.dueAt <= now.wallTimeMs) {
      alarm.status = "ringing";
      alarm.revision += 1;
      alarm.updatedAt = now.wallTimeMs;
    }
  }
}

function mutate(state: State, mutation: PluginClockMutation, now: PluginTimeTrackingClock): void {
  const model = state.model;
  switch (mutation.type) {
    case "stopwatch-start":
      if (model.stopwatch.status === "running") throw new Error("The timer is already running.");
      model.stopwatch.status = "running";
      state.stopwatchClock = now;
      return;
    case "stopwatch-pause":
      if (model.stopwatch.status !== "running") throw new Error("Only a running timer can be paused.");
      model.stopwatch.status = "paused";
      state.stopwatchClock = null;
      return;
    case "stopwatch-reset":
      model.stopwatch = emptyClockModel().stopwatch;
      state.stopwatchClock = null;
      return;
    case "countdown-create":
      if (model.countdowns.length >= MAX_PLUGIN_COUNTDOWNS) throw new Error("Remove an unused countdown before adding more than 32.");
      requireNewId(model, mutation.id);
      model.countdowns.push({
        id: mutation.id, title: mutation.title.trim(), durationMs: mutation.durationMs,
        remainingMs: mutation.durationMs, sound: mutation.sound, status: "running",
        occurrence: 1, createdAt: now.wallTimeMs, updatedAt: now.wallTimeMs,
        recoveryNotice: null, delivery: pendingClockDelivery(),
      });
      state.countdownClocks.push({ id: mutation.id, clock: now });
      return;
    case "countdown-pause":
    case "countdown-resume":
    case "countdown-restart":
    case "countdown-cancel":
    case "countdown-dismiss":
    case "countdown-remove": {
      const row = requireCountdown(model, mutation.id);
      if (mutation.occurrence !== undefined && mutation.occurrence !== row.occurrence) throw new Error("The countdown changed. Refresh it before trying again.");
      if (mutation.type === "countdown-pause") {
        if (row.status !== "running") throw new Error("Only a running countdown can be paused.");
        row.status = "paused";
        removeAnchor(state, row.id);
      } else if (mutation.type === "countdown-resume") {
        if (row.status !== "paused") throw new Error("Only a paused countdown can be resumed.");
        row.status = "running";
        state.countdownClocks.push({ id: row.id, clock: now });
      } else if (mutation.type === "countdown-restart") {
        removeAnchor(state, row.id);
        row.status = "running";
        row.remainingMs = row.durationMs;
        row.delivery = pendingClockDelivery();
        row.occurrence += 1;
        row.recoveryNotice = null;
        state.countdownClocks.push({ id: row.id, clock: now });
      } else if (mutation.type === "countdown-dismiss") {
        if (row.status !== "ringing") throw new Error("This countdown is no longer ringing.");
        row.status = "finished";
      } else {
        removeAnchor(state, row.id);
        if (mutation.type === "countdown-remove") model.countdowns = model.countdowns.filter((item) => item.id !== row.id);
        else row.status = "cancelled";
      }
      row.updatedAt = now.wallTimeMs;
      return;
    }
    case "alarm-create": {
      if (model.alarms.length >= MAX_PLUGIN_ALARMS) throw new Error("Remove an unused alarm before adding more than 32.");
      requireNewId(model, mutation.id);
      const dueAt = resolveWallClock(mutation.localDateTime, mutation.timeZone);
      if (dueAt <= now.wallTimeMs) throw new Error("Choose a future date and time for the alarm.");
      model.alarms.push({
        id: mutation.id, title: mutation.title.trim(), localDateTime: mutation.localDateTime,
        timeZone: mutation.timeZone, repeatDaily: mutation.repeatDaily, sound: mutation.sound,
        dueAt, snoozedUntil: null, status: "scheduled", occurrence: 1, revision: 0,
        createdAt: now.wallTimeMs, updatedAt: now.wallTimeMs, delivery: pendingClockDelivery(),
      });
      return;
    }
    case "alarm-update": {
      const row = requireAlarm(model, mutation.id);
      if (row.revision !== mutation.expectedRevision) throw new Error("The alarm changed. Refresh it before saving.");
      const dueAt = resolveWallClock(mutation.localDateTime, mutation.timeZone);
      if (dueAt <= now.wallTimeMs) throw new Error("Choose a future date and time for the alarm.");
      Object.assign(row, {
        title: mutation.title.trim(), localDateTime: mutation.localDateTime, timeZone: mutation.timeZone,
        repeatDaily: mutation.repeatDaily, sound: mutation.sound, dueAt, snoozedUntil: null,
        status: "scheduled", occurrence: row.occurrence + 1, revision: row.revision + 1,
        updatedAt: now.wallTimeMs, delivery: pendingClockDelivery(),
      });
      return;
    }
    case "alarm-toggle":
    case "alarm-dismiss":
    case "alarm-snooze":
    case "alarm-remove": {
      const row = requireAlarm(model, mutation.id);
      if (mutation.type === "alarm-remove") {
        if (mutation.occurrence !== undefined && mutation.occurrence !== row.occurrence) throw new Error("The alarm changed. Refresh it before trying again.");
        model.alarms = model.alarms.filter((item) => item.id !== row.id);
        return;
      }
      if (mutation.occurrence !== undefined && mutation.occurrence !== row.occurrence) throw new Error("The alarm changed. Refresh it before trying again.");
      if (mutation.type === "alarm-snooze") {
        if (row.status !== "ringing") throw new Error("Only a ringing alarm can be snoozed.");
        row.snoozedUntil = now.wallTimeMs + 5 * 60_000;
        row.dueAt = row.snoozedUntil;
        row.status = "scheduled";
      } else if (mutation.type === "alarm-toggle" && !mutation.enabled) {
        row.status = "disabled";
      } else if (mutation.type === "alarm-dismiss" && !row.repeatDaily) {
        if (row.status !== "ringing") throw new Error("This alarm is no longer ringing.");
        row.status = "disabled";
      } else {
        if (mutation.type === "alarm-dismiss" && row.status !== "ringing") throw new Error("This alarm is no longer ringing.");
        if (row.dueAt <= now.wallTimeMs || mutation.type === "alarm-dismiss") advanceAlarm(row, now.wallTimeMs);
        row.status = "scheduled";
        row.snoozedUntil = null;
      }
      row.occurrence += 1;
      row.revision += 1;
      row.delivery = pendingClockDelivery();
      row.updatedAt = now.wallTimeMs;
      return;
    }
    default: {
      const row = alertTarget(model, mutation);
      const delivery = row.delivery;
      if (mutation.type === "notification-started") {
        if (delivery.status !== "pending" || delivery.attempts >= 10_000) throw new Error("This clock notification is not ready to send.");
        row.delivery = { status: "sending", attempts: delivery.attempts + 1, error: null };
      } else if (mutation.type === "notification-retry") {
        if (delivery.status !== "failed") throw new Error("Only a failed clock notification can be retried.");
        row.delivery = { ...delivery, status: "pending", error: null };
      } else {
        if (delivery.status !== "sending") throw new Error("This clock notification is no longer being sent.");
        row.delivery = mutation.type === "notification-succeeded"
          ? { ...delivery, status: "sent", error: null }
          : { ...delivery, status: "failed", error: truncateUtf8(mutation.error, 512) };
      }
    }
  }
}

function advanceAlarm(row: PluginAlarm, now: number): void {
  if (!row.repeatDaily) throw new Error("Choose a future date before enabling this alarm.");
  const next = nextRecurringSchedule(
    { kind: "wall-clock", localDateTime: row.localDateTime, timeZone: row.timeZone },
    { unit: "day", interval: 1 }, now,
  );
  if (next.kind !== "wall-clock") throw new Error("The daily alarm schedule is invalid.");
  row.localDateTime = next.localDateTime;
  row.dueAt = resolveWallClock(next.localDateTime, next.timeZone);
}

function requireCountdown(model: PluginClockModel, id: string): PluginCountdown {
  const row = model.countdowns.find((item) => item.id === id);
  if (!row) throw new Error("The countdown no longer exists.");
  return row;
}

function requireAlarm(model: PluginClockModel, id: string): PluginAlarm {
  const row = model.alarms.find((item) => item.id === id);
  if (!row) throw new Error("The alarm no longer exists.");
  return row;
}

function alertTarget(model: PluginClockModel, target: PluginClockTarget): PluginCountdown | PluginAlarm {
  const row = target.kind === "countdown" ? requireCountdown(model, target.id) : requireAlarm(model, target.id);
  if (row.occurrence !== target.occurrence || row.status !== "ringing") {
    throw new Error("This clock alert is no longer current.");
  }
  return row;
}

function requireNewId(model: PluginClockModel, id: string): void {
  if ([...model.countdowns, ...model.alarms].some((row) => row.id === id)) throw new Error("This clock already exists.");
}

function removeAnchor(state: State, id: string): void {
  state.countdownClocks = state.countdownClocks.filter((row) => row.id !== id);
}

function elapsed(before: PluginTimeTrackingClock, after: PluginTimeTrackingClock): number | null {
  return before.bootId === after.bootId && after.monotonicMs >= before.monotonicMs
    ? after.monotonicMs - before.monotonicMs : null;
}

function validate(state: State): void {
  if (!state || state.version !== 1 || !isPluginClockModel(state.model) ||
    !(state.disabledAt === null || isPluginTimeTrackingClock(state.disabledAt)) ||
    !(state.stopwatchClock === null || isPluginTimeTrackingClock(state.stopwatchClock)) ||
    (state.model.stopwatch.status === "running") !== (state.stopwatchClock !== null) ||
    !Array.isArray(state.countdownClocks) || state.countdownClocks.length > MAX_PLUGIN_COUNTDOWNS) {
    throw new Error("Saved clock data is invalid. It has not been reset or overwritten.");
  }
  const ids = new Set<string>();
  for (const anchor of state.countdownClocks) {
    if (!anchor || typeof anchor.id !== "string" || ids.has(anchor.id) ||
      !isPluginTimeTrackingClock(anchor.clock) ||
      !state.model.countdowns.some((row) => row.id === anchor.id && row.status === "running")) {
      throw new Error("A saved countdown checkpoint is invalid.");
    }
    ids.add(anchor.id);
  }
  if (state.model.countdowns.filter((row) => row.status === "running").length !== ids.size) {
    throw new Error("A running countdown is missing its checkpoint.");
  }
}
