import {
  isPluginTimeTrackingClock,
  isPluginTimeTrackingModel,
  isPluginTimeTrackingRequest,
  MAX_TIME_TRACKING_HISTORY,
  MAX_TIME_TRACKING_SEGMENTS,
  MAX_TIME_TRACKING_SESSIONS,
  TIME_TRACKING_STOP_KEY,
  type PluginStorage,
  type PluginTimeTrackingClock,
  type PluginTimeTrackingModel,
  type PluginTimeTrackingRequest,
  type PluginTimeTrackingSession,
  type PluginTimeTrackingValues,
} from "@denote/plugin-sdk";

const STORAGE_KEY = "sessions.v1";

interface StoredState {
  version: 1;
  entries: Array<{ workspaceId: string; session: PluginTimeTrackingSession }>;
  active: { workspaceId: string; id: string; clock: PluginTimeTrackingClock | null } | null;
  disabledAt: PluginTimeTrackingClock | null;
}

export class TimeTrackingStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: PluginStorage) {}

  query(request: PluginTimeTrackingRequest): Promise<PluginTimeTrackingModel> {
    return this.run({ ...request, mutation: undefined });
  }

  mutate(request: PluginTimeTrackingRequest): Promise<PluginTimeTrackingModel> {
    return this.run(request);
  }

  private run(request: PluginTimeTrackingRequest): Promise<PluginTimeTrackingModel> {
    const operation = this.tail.catch(() => undefined).then(() => this.apply(request));
    this.tail = operation;
    return operation;
  }

  private async apply(request: PluginTimeTrackingRequest): Promise<PluginTimeTrackingModel> {
    if (!isPluginTimeTrackingRequest(request)) throw new Error("Invalid time-tracking request.");
    const loaded = await this.storage.get<StoredState>(STORAGE_KEY);
    const state: StoredState = loaded === null ? { version: 1, entries: [], active: null, disabledAt: null } : loaded;
    validateState(state);
    const cutoff = await this.storage.get<PluginTimeTrackingClock>(TIME_TRACKING_STOP_KEY);
    if (cutoff !== null) {
      if (!isPluginTimeTrackingClock(cutoff)) throw new Error("The saved timer stop checkpoint is invalid.");
      settle(state, cutoff);
      if (state.active) {
        const session = activeSession(state);
        session.status = "stopped";
        session.endedAt = cutoff.wallTimeMs;
        state.active = null;
      }
      state.disabledAt = cutoff;
      await this.persist(state);
      await this.storage.delete(TIME_TRACKING_STOP_KEY);
    }
    settle(state, request.clock);
    const mutation = request.mutation;
    if (mutation) {
      if (state.disabledAt?.bootId === request.clock.bootId &&
        request.clock.monotonicMs <= state.disabledAt.monotonicMs) {
        throw new Error("The timer was disabled after this action was queued. Refresh time tracking before trying again.");
      }
      if (request.workspaceId === null) throw new Error("Open a vault before changing time tracking.");
      if (mutation.type === "start") {
        if (state.active) throw new Error("A timer is already active. Stop it before starting another.");
        if (state.entries.length >= MAX_TIME_TRACKING_SESSIONS) {
          throw new Error("Time tracking has reached 500 sessions. Export them, then clear plugin data to start a new history.");
        }
        if (state.entries.some(({ session }) => session.id === mutation.id)) throw new Error("The session already exists.");
        const session: PluginTimeTrackingSession = {
          id: mutation.id, ...structuredClone(mutation.target), description: mutation.description,
          startedAt: request.clock.wallTimeMs, endedAt: null, elapsedMs: 0,
          status: "running", segments: [{ startedAt: request.clock.wallTimeMs, elapsedMs: 0 }],
          revision: 0, history: [], recoveryNotice: null,
        };
        state.entries.push({ workspaceId: request.workspaceId, session });
        state.active = { workspaceId: request.workspaceId, id: session.id, clock: request.clock };
      } else {
        const session = state.entries.find((entry) =>
          entry.workspaceId === request.workspaceId && entry.session.id === mutation.id)?.session;
        if (!session) throw new Error("This time-tracking session is unavailable in the current vault.");
        if (mutation.type === "correct") {
          if (session.status !== "stopped") throw new Error("Stop the timer before correcting its session.");
          if (mutation.expectedRevision !== session.revision) throw new Error("The session changed. Refresh it before saving a correction.");
          if (session.history.length >= MAX_TIME_TRACKING_HISTORY) throw new Error("This session has reached its correction-history limit.");
          const before = snapshot(session);
          Object.assign(session, structuredClone(mutation.values), {
            segments: [{ startedAt: mutation.values.startedAt, elapsedMs: mutation.values.elapsedMs }],
            recoveryNotice: null,
          });
          session.history.push({
            at: request.clock.wallTimeMs, reason: mutation.reason.trim(), before, after: snapshot(session),
          });
          session.revision += 1;
        } else {
          if (state.active?.id !== session.id) throw new Error("This timer is no longer active.");
          if (mutation.type === "pause") {
            if (session.status !== "running") throw new Error("Only a running timer can be paused.");
            session.status = "paused";
            state.active.clock = null;
          } else if (mutation.type === "resume") {
            if (session.status !== "paused") throw new Error("Only a paused timer can be resumed.");
            if (session.segments.length >= MAX_TIME_TRACKING_SEGMENTS) throw new Error("This session has reached its pause limit. Stop it and start another.");
            session.status = "running";
            session.segments.push({ startedAt: request.clock.wallTimeMs, elapsedMs: 0 });
            state.active.clock = request.clock;
          } else {
            session.status = "stopped";
            session.endedAt = request.clock.wallTimeMs;
            state.active = null;
          }
        }
      }
    }
    if (loaded !== null || mutation || cutoff !== null) {
      await this.persist(state, mutation?.type === "start" || mutation?.type === "resume" || mutation?.type === "correct");
    }
    return modelFor(state, request.workspaceId);
  }

  private async persist(state: StoredState, reserveCheckpointSpace = false): Promise<void> {
    validateState(state);
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength > (reserveCheckpointSpace ? 240 : 256) * 1024) {
      throw new Error("Time-tracking storage is full. Export the history, then clear plugin data before adding sessions or corrections.");
    }
    await this.storage.set(STORAGE_KEY, state);
  }
}

function settle(state: StoredState, clock: PluginTimeTrackingClock): void {
  const previous = state.active?.clock;
  if (!previous || !state.active) return;
  const session = activeSession(state);
  if (previous.bootId !== clock.bootId || clock.monotonicMs < previous.monotonicMs) {
    session.status = "paused";
    session.recoveryNotice = "The system restarted. The timer was paused at its last saved checkpoint; review or correct the session before resuming.";
    state.active.clock = null;
    return;
  }
  const elapsed = clock.monotonicMs - previous.monotonicMs;
  session.elapsedMs += elapsed;
  session.segments[session.segments.length - 1].elapsedMs += elapsed;
  if (Math.abs(clock.wallTimeMs - previous.wallTimeMs - elapsed) > 5_000) {
    session.recoveryNotice = "The system clock changed. Elapsed time is preserved by the continuous clock.";
  }
  state.active.clock = clock;
}

function activeSession(state: StoredState): PluginTimeTrackingSession {
  const session = state.entries.find((entry) => entry.workspaceId === state.active?.workspaceId &&
    entry.session.id === state.active.id)?.session;
  if (!session) throw new Error("The saved active timer is missing. Export the history before clearing plugin data.");
  return session;
}

function snapshot(session: PluginTimeTrackingSession): PluginTimeTrackingValues {
  const { startedAt, endedAt, elapsedMs, description, tags, segments } = session;
  return structuredClone({ startedAt, endedAt, elapsedMs, description, tags, segments });
}

function modelFor(state: StoredState, workspaceId: string | null): PluginTimeTrackingModel {
  return {
    sessions: structuredClone(state.entries.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.session)),
    activeSessionId: state.active?.workspaceId === workspaceId ? state.active.id : null,
    activeElsewhere: state.active !== null && state.active.workspaceId !== workspaceId,
    notices: [],
  };
}

function validateState(value: StoredState): void {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) ||
    value.entries.length > MAX_TIME_TRACKING_SESSIONS ||
    !(value.disabledAt === null || isPluginTimeTrackingClock(value.disabledAt)) ||
    !(value.active === null || typeof value.active === "object" &&
      typeof value.active.workspaceId === "string" && typeof value.active.id === "string" &&
      (value.active.clock === null || isPluginTimeTrackingClock(value.active.clock)))) {
    throw new Error("Saved time-tracking data is invalid. Export or recover the stored data before clearing it.");
  }
  const ids = new Set<string>();
  let activeCount = 0;
  for (const entry of value.entries) {
    if (!entry || typeof entry.workspaceId !== "string" || entry.workspaceId.length === 0 ||
      !isPluginTimeTrackingModel({
        sessions: [entry.session],
        activeSessionId: entry.session?.status === "stopped" ? null : entry.session?.id,
        activeElsewhere: false, notices: [],
      }) || ids.has(entry.session.id)) throw new Error("Saved time-tracking sessions are invalid.");
    ids.add(entry.session.id);
    if (entry.session.status !== "stopped") {
      activeCount += 1;
      if (entry.session.id !== value.active?.id || entry.workspaceId !== value.active.workspaceId ||
        (entry.session.status === "running") !== (value.active.clock !== null)) throw new Error("The saved timer checkpoint is invalid.");
    }
  }
  if (activeCount !== (value.active === null ? 0 : 1)) throw new Error("Saved time tracking contains an inconsistent active timer.");
}
