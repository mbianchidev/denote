import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportTimeTrackingSessions,
  timeTrackingTotals,
  type PluginTimeTrackingSession,
  type PluginTimeTrackingTarget,
} from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import type { PluginTimeTrackingContribution } from "../plugins/workerRuntime";
import type { TimeTrackingController } from "../plugins/useTimeTracking";

interface Props {
  provider: PluginTimeTrackingContribution;
  target: PluginTimeTrackingTarget | null;
  controller: TimeTrackingController;
  encrypted: boolean;
  disabled?: boolean;
  onOpenFile: (path: string) => Promise<void>;
  onExport: (format: "csv" | "json", content: string) => Promise<boolean>;
  onError: (error: unknown) => void;
}

const EMPTY_SESSIONS: PluginTimeTrackingSession[] = [];

export function TimeTrackingPanel({
  provider, target, controller, encrypted, disabled = false, onOpenFile, onExport, onError,
}: Props) {
  const state = controller.stateFor(provider);
  const sessions = state.model?.sessions ?? EMPTY_SESSIONS;
  const active = sessions.find((session) => session.id === state.model?.activeSessionId) ?? null;
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => performance.now());
  const [summaryDate, setSummaryDate] = useState(() => localDateTime(Date.now()).slice(0, 10));
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [group, setGroup] = useState<"note" | "project" | "tag">("note");
  const [visibleCount, setVisibleCount] = useState(50);
  const [editing, setEditing] = useState<PluginTimeTrackingSession | null>(null);
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [minutes, setMinutes] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [reason, setReason] = useState("");
  const firstEditInput = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const busy = disabled || working || !state.model;
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const range = useMemo(() => summaryRange(summaryDate, period), [period, summaryDate, timeZone]);
  const totals = useMemo(
    () => range ? timeTrackingTotals(sessions, range.from, range.to, group) : [],
    [group, range, sessions],
  );
  const total = useMemo(
    () => range ? timeTrackingTotals(sessions, range.from, range.to, "note")
      .reduce((sum, row) => sum + row.elapsedMs, 0) : 0,
    [range, sessions],
  );
  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id)),
    [sessions],
  );

  useEffect(() => {
    if (active?.status !== "running") return;
    const interval = window.setInterval(() => setTick(performance.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active?.status]);

  useEffect(() => {
    if (editing) firstEditInput.current?.focus();
    else editTrigger.current?.focus();
  }, [editing]);

  const run = async (action: () => Promise<void>) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
      onError(failure);
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  const correct = async () => {
    if (!editing) throw new Error("Select a session to correct.");
    const elapsedMs = Math.round(Number(minutes) * 60_000);
    const start = parseLocalDateTime(startedAt);
    const end = parseLocalDateTime(endedAt);
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || end < start || elapsedMs > end - start) {
      throw new Error("Elapsed time must fit between the corrected start and end.");
    }
    const tags = [...new Set(editTags.split(",").map((tag) => tag.trim()).filter(Boolean))];
    await controller.mutate(provider, {
      type: "correct", id: editing.id, expectedRevision: editing.revision, reason: reason.trim(),
      values: { startedAt: start, endedAt: end, elapsedMs, description: editDescription, tags },
    });
    setEditing(null);
    setStatus("Correction saved. Previous values remain in the history.");
  };

  const elapsed = active ? active.elapsedMs +
    (active.status === "running" ? Math.max(0, tick - state.sampledAt) : 0) : 0;

  return (
    <section className="time-tracking-panel" aria-label={provider.title}>
      <div className="sidebar-view__title">
        <h2>{provider.title}</h2>
        <button className="secondary-button" type="button" disabled={disabled || working || state.loading}
          onClick={() => void run(async () => {
            await controller.refresh(provider);
            setStatus("Sessions refreshed.");
          })}>Refresh</button>
      </div>
      <div className="time-tracking-panel__timer">
        <output role="timer" aria-live="off" aria-label="Elapsed time">{duration(elapsed)}</output>
        <p>{active ? active.status === "running" ? "Timer running" : "Timer paused" : "No active timer"}</p>
        {active ? (
          <>
            <button className="time-tracking-panel__note" type="button" disabled={disabled || working}
              onClick={() => void run(() => onOpenFile(active.path))}>{active.path}</button>
            {active.description ? <p>{active.description}</p> : null}
            {active.project ? <p>Project: {active.project.rootPath || "Vault root"}</p> : null}
            {active.tags.length ? <p>Tags: {active.tags.join(", ")}</p> : null}
            <div className="time-tracking-panel__actions">
              <button className={editing ? "secondary-button" : "primary-button"} type="button" disabled={busy}
                onClick={() => void run(async () => {
                  const type = active.status === "running" ? "pause" : "resume";
                  await controller.mutate(provider, { type, id: active.id });
                  setStatus(type === "pause" ? "Timer paused." : "Timer resumed.");
                })}>{active.status === "running" ? "Pause timer" : "Resume timer"}</button>
              <button className="secondary-button" type="button" disabled={busy}
                onClick={() => void run(async () => {
                  await controller.mutate(provider, { type: "stop", id: active.id });
                  setStatus("Timer stopped.");
                })}>Stop timer</button>
            </div>
            {active.recoveryNotice ? <p className="time-tracking-panel__notice">{active.recoveryNotice}</p> : null}
          </>
        ) : !editing ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!target) throw new Error("Open a Markdown note before starting a timer.");
              await controller.mutate(provider, {
                type: "start", id: crypto.randomUUID(), target, description: description.trim(),
              });
              setDescription("");
              setStatus("Timer started.");
            });
          }}>
            <p>{target ? target.path : "Open a Markdown note to track its time."}</p>
            <label>Description
              <input value={description} maxLength={2_000} disabled={disabled || working}
                onChange={(event) => setDescription(event.currentTarget.value)} />
            </label>
            <button className="primary-button" type="submit"
              disabled={busy || !target || state.model?.activeElsewhere}>Start timer</button>
          </form>
        ) : null}
        {state.model?.activeElsewhere ? (
          <p className="time-tracking-panel__notice">A timer is active in another vault. Return to that vault to pause or stop it.</p>
        ) : null}
      </div>
      {encrypted ? <p className="time-tracking-panel__notice">
        Session metadata is stored locally outside vault encryption. Exports are unencrypted.
      </p> : null}
      {error || state.error ? <p role="alert" className="time-tracking-panel__error">{error || state.error}</p> : null}
      <p role="status" className="time-tracking-panel__status">
        {working ? "Saving…" : status || (state.model
          ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} stored.` : "Loading sessions…")}
      </p>
      {state.model?.notices.map((notice) => <p className="time-tracking-panel__notice" key={notice}>{notice}</p>)}

      {editing ? (
        <form className="time-tracking-panel__correction" onSubmit={(event) => { event.preventDefault(); void run(correct); }}>
          <h3>Correct session</h3>
          <p>{editing.path}</p>
          <label>Start time<input ref={firstEditInput} type="datetime-local" step="0.001" required
            value={startedAt} disabled={busy} onChange={(event) => setStartedAt(event.currentTarget.value)} /></label>
          <label>End time<input type="datetime-local" step="0.001" required
            value={endedAt} disabled={busy} onChange={(event) => setEndedAt(event.currentTarget.value)} /></label>
          <label>Elapsed minutes<input type="number" min="0" step="any" required
            value={minutes} disabled={busy} onChange={(event) => setMinutes(event.currentTarget.value)} /></label>
          <label>Description<input maxLength={2_000} value={editDescription} disabled={busy}
            onChange={(event) => setEditDescription(event.currentTarget.value)} /></label>
          <label>Tags, comma-separated<input value={editTags} disabled={busy}
            onChange={(event) => setEditTags(event.currentTarget.value)} /></label>
          <label>Reason for correction<input required maxLength={1_000} value={reason} disabled={busy}
            onChange={(event) => setReason(event.currentTarget.value)} /></label>
          <p>Times use your current time zone. A correction replaces the pause breakdown; its duration is counted from the corrected start.</p>
          <div className="time-tracking-panel__actions">
            <button className="primary-button" type="submit" disabled={busy || !reason.trim()}>Save correction</button>
            <button className="secondary-button" type="button" disabled={working}
              onClick={() => setEditing(null)}>Cancel correction</button>
          </div>
        </form>
      ) : null}

      <section className="time-tracking-panel__summary" aria-label="Time summaries">
        <h3>Summary</h3>
        <div className="time-tracking-panel__filters">
          <label>Period<select value={period} onChange={(event) => setPeriod(event.currentTarget.value === "week" ? "week" : "day")}>
            <option value="day">Daily</option><option value="week">Weekly</option>
          </select></label>
          <label>Summary date<input type="date" value={summaryDate} min="1970-01-01"
            onChange={(event) => setSummaryDate(event.currentTarget.value)} /></label>
          <label>Summarize by<select value={group} onChange={(event) => {
            const value = event.currentTarget.value;
            setGroup(value === "tag" || value === "project" ? value : "note");
          }}><option value="note">Note</option><option value="project">Project</option><option value="tag">Tag</option></select></label>
        </div>
        {range ? <p>{period === "week" ? "Week of " : ""}{new Date(range.from).toLocaleDateString()} · {duration(total)}</p>
          : <p>Choose a summary date.</p>}
        {group === "tag" ? <p>Sessions with several tags count toward each tag.</p> : null}
        <dl className="time-tracking-panel__totals">
          {totals.map((row) => <div key={row.id}><dt>{row.label}</dt><dd>{duration(row.elapsedMs)}</dd></div>)}
        </dl>
      </section>

      <section aria-label="Session history">
        <h3>Recent sessions</h3>
        <div className="time-tracking-panel__actions">
          {(["csv", "json"] as const).map((format) => (
            <button className="secondary-button" type="button" key={format} disabled={busy || sessions.length === 0}
              onClick={() => void run(async () => {
                const latest = await controller.refresh(provider);
                const exported = await onExport(format, exportTimeTrackingSessions(latest.sessions, format, Date.now()));
                setStatus(exported ? "Sessions exported." : "Export cancelled.");
              })}>Export {format.toUpperCase()}</button>
          ))}
        </div>
        {sessions.length === 0 ? <p>No sessions yet. Start a timer from an open note.</p> : null}
        <ol className="time-tracking-panel__sessions">
          {recent.slice(0, visibleCount).map((session) => (
            <li key={session.id}>
              <button className="time-tracking-panel__note" type="button" disabled={disabled || working}
                onClick={() => void run(() => onOpenFile(session.path))}>{session.path}</button>
              <p><time dateTime={new Date(session.startedAt).toISOString()}>{new Date(session.startedAt).toLocaleString()}</time>
                {" · "}{duration(session.elapsedMs)}{" · "}{session.status}</p>
              {session.description ? <p>{session.description}</p> : null}
              {session.project ? <p>Project: {session.project.rootPath || "Vault root"}</p> : null}
              {session.tags.length ? <p>Tags: {session.tags.join(", ")}</p> : null}
              {session.recoveryNotice ? <p className="time-tracking-panel__notice">{session.recoveryNotice}</p> : null}
              {session.status === "stopped" ? (
                <button className="secondary-button" type="button" disabled={busy || editing !== null}
                  onClick={(event) => {
                    editTrigger.current = event.currentTarget;
                    setEditing(session);
                    setStartedAt(localDateTime(session.startedAt));
                    setEndedAt(localDateTime(session.endedAt!));
                    setMinutes(String(session.elapsedMs / 60_000));
                    setEditDescription(session.description);
                    setEditTags(session.tags.join(", "));
                    setReason("");
                  }}>Correct session</button>
              ) : null}
              {session.history.length ? (
                <details>
                  <summary>Correction history ({session.history.length})</summary>
                  <ol>{session.history.map((entry, index) => (
                    <li key={index}>
                      <p><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time></p>
                      <p>{entry.reason}</p>
                      <pre>{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre>
                    </li>
                  ))}</ol>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
        {recent.length > visibleCount ? <button className="secondary-button" type="button"
          onClick={() => setVisibleCount((count) => count + 50)}>Show more sessions</button> : null}
      </section>
    </section>
  );
}

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 3_600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

function parseLocalDateTime(value: string): number {
  const timestamp = new Date(value).getTime();
  const normalized = value.length === 16 ? `${value}:00.000` : value.length === 19 ? `${value}.000` : value;
  if (!Number.isFinite(timestamp) || localDateTime(timestamp) !== normalized) {
    throw new Error("Choose an existing local date and time.");
  }
  return timestamp;
}

function summaryRange(value: string, period: "day" | "week"): { from: number; to: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const start = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || localDateTime(start.getTime()).slice(0, 10) !== value) return null;
  if (period === "week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const end = new Date(start);
  end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  return { from: start.getTime(), to: end.getTime() };
}
