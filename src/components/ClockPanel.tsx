import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  civilDateTimeAt, MAX_PLUGIN_COUNTDOWN_MS,
  type PluginAlarm, type PluginAlarmInput, type PluginClockMode, type PluginClockMutation,
} from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import { formatClockDuration } from "../lib/clockFormat";
import type { PluginClockContribution } from "../plugins/workerRuntime";
import type { ClockController } from "../plugins/useClocks";

interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
  dangerous: boolean;
}

interface Props {
  provider: PluginClockContribution;
  controller: ClockController;
  mode?: PluginClockMode;
  onModeChange?: (mode: PluginClockMode) => void;
  noteTracking?: ReactNode;
  disabled?: boolean;
  confirmAction: (options: Confirmation) => Promise<boolean>;
  onError: (error: unknown) => void;
}

interface AlarmDraft extends Omit<PluginAlarmInput, "localDateTime"> {
  date: string;
  time: string;
}

export function ClockPanel({
  provider, controller, mode, onModeChange, noteTracking, disabled = false, confirmAction, onError,
}: Props) {
  const [localMode, setLocalMode] = useState<PluginClockMode>("timer");
  const selected = mode ?? localMode;
  const changeMode = (value: PluginClockMode) => { setLocalMode(value); onModeChange?.(value); };
  const state = controller.stateFor(provider);
  const model = state.model;
  const [tick, setTick] = useState(() => performance.now());
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState({ title: "Countdown", hours: "0", minutes: "5", seconds: "0", sound: true });
  const [alarm, setAlarm] = useState(initialAlarm);
  const [editing, setEditing] = useState<PluginAlarm | null>(null);
  const alarmName = useRef<HTMLInputElement>(null);
  const countdownName = useRef<HTMLInputElement>(null);
  const timerButton = useRef<HTMLButtonElement>(null);
  const nextFocus = useRef<"timer" | "countdown" | "alarm" | null>(null);
  const busy = disabled || working || !model;
  const animate = selected === "timer" && model?.stopwatch.status === "running" ||
    selected === "countdowns" && model?.countdowns.some((row) => row.status === "running");
  useEffect(() => {
    if (!animate) return;
    const interval = window.setInterval(() => setTick(performance.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [animate]);
  useEffect(() => { if (editing) alarmName.current?.focus(); }, [editing]);
  useEffect(() => {
    if (working || !nextFocus.current) return;
    const target = nextFocus.current === "timer" ? timerButton.current
      : nextFocus.current === "countdown" ? countdownName.current : alarmName.current;
    target?.focus();
    nextFocus.current = null;
  }, [working]);
  const delta = Math.max(0, tick - state.sampledAt);

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
  const change = (mutation: PluginClockMutation, message: string) => run(async () => {
    await controller.mutate(provider, mutation);
    setStatus(message);
  });

  const createCountdown = async () => {
    const fields = [countdown.hours, countdown.minutes, countdown.seconds];
    const [hours, minutes, seconds] = fields.map(Number);
    const durationMs = (hours * 3_600 + minutes * 60 + seconds) * 1_000;
    if (fields.some((value) => !value.trim()) || ![hours, minutes, seconds].every(Number.isInteger) ||
      hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 ||
      durationMs < 1_000 || durationMs > MAX_PLUGIN_COUNTDOWN_MS) {
      throw new Error("Set a countdown between 1 second and 7 days.");
    }
    if (countdown.sound) await controller.enableSound();
    await controller.mutate(provider, {
      type: "countdown-create", id: crypto.randomUUID(), title: countdown.title.trim(), durationMs, sound: countdown.sound,
    });
    setStatus("Countdown started.");
  };

  const saveAlarm = async () => {
    if (alarm.sound) await controller.enableSound();
    const values: PluginAlarmInput = {
      title: alarm.title.trim(), localDateTime: `${alarm.date}T${alarm.time}`,
      timeZone: alarm.timeZone, repeatDaily: alarm.repeatDaily, sound: alarm.sound,
    };
    await controller.mutate(provider, editing
      ? { type: "alarm-update", id: editing.id, expectedRevision: editing.revision, ...values }
      : { type: "alarm-create", id: crypto.randomUUID(), ...values });
    setStatus(editing ? "Alarm updated." : "Alarm set.");
    setEditing(null);
    setAlarm(initialAlarm());
    nextFocus.current = "alarm";
  };

  return (
    <section className="clock-panel" aria-label={provider.title}>
      <div className="sidebar-view__title">
        <h2>{provider.title}</h2>
        {selected !== "notes" ? <button className="secondary-button" type="button"
          disabled={disabled || working || state.loading} onClick={() => void run(async () => {
            await controller.refresh(provider); setStatus("Clocks refreshed.");
          })}>Refresh</button> : null}
      </div>
      <nav className="clock-panel__modes" aria-label="Clock modes">
        {(["timer", "countdowns", "alarm", ...(noteTracking ? ["notes" as const] : [])] as const).map((value) => (
          <button className="secondary-button" type="button" key={value} aria-pressed={selected === value} disabled={disabled || working}
            onClick={() => changeMode(value)}>{value === "timer" ? "Timer" : value === "countdowns" ? "Countdowns" : value === "alarm" ? "Alarm" : "Notes"}</button>
        ))}
      </nav>
      {selected === "notes" ? noteTracking ?? <p>Open an unlocked vault to use note tracking.</p> : (
        <>
          {error || state.error ? <p className="clock-panel__error" role="alert">{error || state.error}</p> : null}
          <p className="clock-panel__status" role="status">{working ? "Saving…" : status || (model ? "Clocks ready." : "Loading clocks…")}</p>
          {model?.notices.map((notice) => <p className="clock-panel__notice" key={notice}>{notice}</p>)}
          {selected === "timer" ? (
            <section className="clock-panel__stopwatch" aria-label="Standalone timer">
              <output className="clock-panel__readout" role="timer" aria-live="off" aria-label="Timer elapsed">
                {model ? formatClockDuration(model.stopwatch.elapsedMs + (model.stopwatch.status === "running" ? delta : 0)) : "--:--:--"}
              </output>
              <p>{model ? model.stopwatch.status === "running" ? "Timer running" : model.stopwatch.status === "paused" ? "Timer paused" : "Ready to start" : "Waiting for the timer."}</p>
              <div className="clock-panel__actions">
                <button ref={timerButton} className="primary-button" type="button" disabled={busy}
                  onClick={() => void change({ type: model?.stopwatch.status === "running" ? "stopwatch-pause" : "stopwatch-start" },
                    model?.stopwatch.status === "running" ? "Timer paused." : "Timer started.")}>
                  {model?.stopwatch.status === "running" ? "Pause timer" : model?.stopwatch.status === "paused" ? "Resume timer" : "Start timer"}
                </button>
                <button className="secondary-button" type="button" disabled={busy || model?.stopwatch.status === "idle"}
                  onClick={() => void run(async () => {
                    if (await confirmAction({ title: "Reset timer?", message: "The standalone timer will stop and return to zero. Note sessions are not changed.", confirmLabel: "Reset timer", dangerous: false })) {
                      await controller.mutate(provider, { type: "stopwatch-reset" }); setStatus("Timer reset.");
                      nextFocus.current = "timer";
                    }
                  })}>Reset timer</button>
              </div>
              {model?.stopwatch.recoveryNotice ? <p className="clock-panel__notice">{model.stopwatch.recoveryNotice}</p> : null}
              <p>Works without an open note. Use Notes for linked sessions and history.</p>
            </section>
          ) : selected === "countdowns" ? (
            <>
              <form onSubmit={(event) => { event.preventDefault(); void run(createCountdown); }}>
                <h3>New countdown</h3>
                <label>Countdown name<input ref={countdownName} required maxLength={160} value={countdown.title} disabled={busy}
                  onChange={(event) => setCountdown({ ...countdown, title: event.currentTarget.value })} /></label>
                <div className="clock-panel__duration">
                  {(["hours", "minutes", "seconds"] as const).map((field) => (
                    <label key={field}>{field === "hours" ? "Hours" : field === "minutes" ? "Minutes" : "Seconds"}
                      <input type="number" required min="0" max={field === "hours" ? 168 : 59} step="1" value={countdown[field]} disabled={busy}
                        onChange={(event) => setCountdown({ ...countdown, [field]: event.currentTarget.value })} />
                    </label>
                  ))}
                </div>
                <label className="clock-panel__check"><input type="checkbox" checked={countdown.sound} disabled={busy}
                  onChange={(event) => setCountdown({ ...countdown, sound: event.currentTarget.checked })} />Repeat alarm sound</label>
                <button className="primary-button" type="submit" disabled={busy || !countdown.title.trim()}>Start countdown</button>
              </form>
              {model?.countdowns.length === 0 ? <p>No countdowns yet.</p> : null}
              <ul className="clock-panel__records" aria-label="Countdowns">
                {model?.countdowns.map((row) => (
                  <li key={row.id}>
                    <h3>{row.title}</h3>
                    <output className="clock-panel__readout clock-panel__readout--small" role="timer" aria-live="off"
                      aria-label={`Remaining time for ${row.title}`}>
                      {formatClockDuration(Math.max(0, row.remainingMs - (row.status === "running" ? delta : 0)), true)}
                    </output>
                    <p>{row.status === "running" ? "Running" : row.status === "paused" ? "Paused" : row.status === "ringing" ? "Finished · needs attention" : row.status === "finished" ? "Finished" : "Cancelled"}</p>
                    {row.recoveryNotice ? <p className="clock-panel__notice">{row.recoveryNotice}</p> : null}
                    {row.delivery.error ? <p className="clock-panel__error">{row.delivery.error}</p> : null}
                    <div className="clock-panel__actions">
                      {row.status === "running" || row.status === "paused" ? <button className="secondary-button" type="button" disabled={busy}
                        aria-label={`${row.status === "running" ? "Pause" : "Resume"} countdown ${row.title}`}
                        onClick={() => void change({ type: row.status === "running" ? "countdown-pause" : "countdown-resume", id: row.id, occurrence: row.occurrence }, "Countdown updated.")}>
                        {row.status === "running" ? "Pause" : "Resume"}</button> : null}
                      {row.status === "ringing" ? <button className="secondary-button" type="button" disabled={busy}
                        aria-label={`Dismiss countdown ${row.title}`}
                        onClick={() => void change({ type: "countdown-dismiss", id: row.id, occurrence: row.occurrence }, "Countdown dismissed.")}>Dismiss</button> : null}
                      <button className="secondary-button" type="button" disabled={busy} aria-label={`Restart countdown ${row.title}`}
                        onClick={() => void change({ type: "countdown-restart", id: row.id, occurrence: row.occurrence }, "Countdown restarted.")}>Restart</button>
                      {row.status === "running" || row.status === "paused" ? <button className="secondary-button" type="button" disabled={busy}
                        aria-label={`Cancel countdown ${row.title}`}
                        onClick={() => void change({ type: "countdown-cancel", id: row.id, occurrence: row.occurrence }, "Countdown cancelled.")}>Cancel</button> : null}
                      {row.delivery.status === "failed" && row.status === "ringing" ? <button className="secondary-button" type="button" disabled={busy}
                        onClick={() => void change({ type: "notification-retry", kind: "countdown", id: row.id, occurrence: row.occurrence }, "Notification retry requested.")}>Retry notification</button> : null}
                      <button className="secondary-button" type="button" disabled={busy} aria-label={`Delete countdown ${row.title}`}
                        onClick={() => void run(async () => {
                          if (await confirmAction({ title: "Delete countdown?", message: `${row.title} will be removed and stopped.`, confirmLabel: "Delete countdown", dangerous: true })) {
                            await controller.mutate(provider, { type: "countdown-remove", id: row.id, occurrence: row.occurrence }); setStatus("Countdown deleted.");
                            nextFocus.current = "countdown";
                          }
                        })}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <form onSubmit={(event) => { event.preventDefault(); void run(saveAlarm); }}>
                <h3>{editing ? "Edit alarm" : "New alarm"}</h3>
                <label>Alarm name<input ref={alarmName} required maxLength={160} disabled={busy} value={alarm.title}
                  onChange={(event) => setAlarm({ ...alarm, title: event.currentTarget.value })} /></label>
                <label>Alarm date<input type="date" required min="1970-01-01" disabled={busy} value={alarm.date}
                  onChange={(event) => setAlarm({ ...alarm, date: event.currentTarget.value })} /></label>
                <label>Alarm time<input type="time" required step="60" disabled={busy} value={alarm.time}
                  onChange={(event) => setAlarm({ ...alarm, time: event.currentTarget.value })} /></label>
                <p>Time zone: {alarm.timeZone}</p>
                <label className="clock-panel__check"><input type="checkbox" disabled={busy} checked={alarm.repeatDaily}
                  onChange={(event) => setAlarm({ ...alarm, repeatDaily: event.currentTarget.checked })} />Repeat daily</label>
                <label className="clock-panel__check"><input type="checkbox" disabled={busy} checked={alarm.sound}
                  onChange={(event) => setAlarm({ ...alarm, sound: event.currentTarget.checked })} />Repeat alarm sound</label>
                <div className="clock-panel__actions">
                  <button className="primary-button" type="submit" disabled={busy || !alarm.title.trim()}>{editing ? "Save alarm" : "Set alarm"}</button>
                  {editing ? <button className="secondary-button" type="button" disabled={working}
                    onClick={() => { setEditing(null); setAlarm(initialAlarm()); alarmName.current?.focus(); }}>Cancel edit</button> : null}
                </div>
              </form>
              {model?.alarms.length === 0 ? <p>No alarms yet.</p> : null}
              <ul className="clock-panel__records" aria-label="Alarms">
                {model?.alarms.map((row) => (
                  <li key={row.id}>
                    <h3>{row.title}</h3>
                    <p><time dateTime={new Date(row.dueAt).toISOString()}>{new Date(row.dueAt).toLocaleString(undefined, { timeZone: row.timeZone })}</time></p>
                    <p>{row.timeZone} · {row.repeatDaily ? "Daily" : "Once"} · {row.status === "scheduled" ? row.snoozedUntil ? "Snoozed" : "Scheduled" : row.status === "ringing" ? "Ringing" : "Disabled"}</p>
                    {row.delivery.error ? <p className="clock-panel__error">{row.delivery.error}</p> : null}
                    <div className="clock-panel__actions">
                      {row.status === "ringing" ? <>
                        <button className="secondary-button" type="button" disabled={busy} aria-label={`Dismiss alarm ${row.title}`}
                          onClick={() => void change({ type: "alarm-dismiss", id: row.id, occurrence: row.occurrence }, "Alarm dismissed.")}>Dismiss</button>
                        <button className="secondary-button" type="button" disabled={busy} aria-label={`Snooze alarm ${row.title}`}
                          onClick={() => void change({ type: "alarm-snooze", id: row.id, occurrence: row.occurrence }, "Alarm snoozed for 5 minutes.")}>Snooze 5 min</button>
                      </> : <button className="secondary-button" type="button" disabled={busy}
                        aria-label={`${row.status === "disabled" ? "Enable" : "Disable"} alarm ${row.title}`}
                        onClick={() => void change({ type: "alarm-toggle", id: row.id, occurrence: row.occurrence, enabled: row.status === "disabled" }, "Alarm updated.")}>
                        {row.status === "disabled" ? "Enable" : "Disable"}</button>}
                      <button className="secondary-button" type="button" disabled={busy} aria-label={`Edit alarm ${row.title}`} onClick={() => {
                        setEditing(row);
                        setAlarm({ title: row.title, date: row.localDateTime.slice(0, 10), time: row.localDateTime.slice(11), timeZone: row.timeZone, repeatDaily: row.repeatDaily, sound: row.sound });
                      }}>Edit</button>
                      {row.delivery.status === "failed" && row.status === "ringing" ? <button className="secondary-button" type="button" disabled={busy}
                        onClick={() => void change({ type: "notification-retry", kind: "alarm", id: row.id, occurrence: row.occurrence }, "Notification retry requested.")}>Retry notification</button> : null}
                      <button className="secondary-button" type="button" disabled={busy} aria-label={`Delete alarm ${row.title}`}
                        onClick={() => void run(async () => {
                          if (await confirmAction({ title: "Delete alarm?", message: `${row.title} will be removed and stopped.`, confirmLabel: "Delete alarm", dangerous: true })) {
                            await controller.mutate(provider, { type: "alarm-remove", id: row.id, occurrence: row.occurrence }); setStatus("Alarm deleted.");
                            if (editing?.id === row.id) { setEditing(null); setAlarm(initialAlarm()); }
                            nextFocus.current = "alarm";
                          }
                        })}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="clock-panel__sound">
            {!controller.soundReady ? <button className="secondary-button" type="button" onClick={() => void controller.enableSound()}>Enable alarm sound</button> : null}
            {controller.alerts.length ? <button className="secondary-button" type="button" onClick={controller.silence}>Stop sound</button> : null}
            {controller.soundError ? <p className="clock-panel__error">{controller.soundError}</p> : null}
          </div>
          <p className="clock-panel__notice">Clock data is local and outside vault encryption. Keep Denote running for alerts; missed alerts catch up after sleep or restart. System notification sounds follow your system settings.</p>
        </>
      )}
    </section>
  );
}

function initialAlarm(): AlarmDraft {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const value = civilDateTimeAt(Date.now() + 5 * 60_000, timeZone);
  return { title: "Alarm", date: value.slice(0, 10), time: value.slice(11), timeZone, repeatDaily: false, sound: true };
}
