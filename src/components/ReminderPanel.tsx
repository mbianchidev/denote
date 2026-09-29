import {
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type {
  PluginReminderRecord,
  PluginReminderTarget,
  PluginReminderTargetsModel,
  PluginReminderTargetsRequest,
} from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import type { PluginReminderContribution } from "../plugins/workerRuntime";
import type { ReminderSchedulerController } from "../plugins/useReminderScheduler";

interface ReminderPanelProps {
  provider: PluginReminderContribution;
  document: PluginReminderTargetsRequest["document"] | null;
  parseTargets: (
    pluginId: string,
    providerId: string,
    request: PluginReminderTargetsRequest,
  ) => Promise<PluginReminderTargetsModel>;
  scheduler: ReminderSchedulerController;
  encrypted: boolean;
  disabled?: boolean;
  onOpenFile: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
}

export function ReminderPanel({
  provider,
  document,
  parseTargets,
  scheduler,
  encrypted,
  disabled = false,
  onOpenFile,
  onError,
}: ReminderPanelProps) {
  const headingId = useId();
  const [targets, setTargets] = useState<PluginReminderTargetsModel | null>(
    null,
  );
  const [targetError, setTargetError] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => defaultLocalDateTime().date);
  const [time, setTime] = useState(() => defaultLocalDateTime().time);
  const [timeZone, setTimeZone] = useState(currentTimeZone);
  const [working, setWorking] = useState<string | null>(null);
  const [status, setStatus] = useState("Waiting for reminders.");
  const providerState = scheduler.stateFor(provider);
  const reminders = providerState.model?.reminders ?? [];
  const selectedTarget = useMemo(
    () =>
      targets?.targets.find((target) => target.id === selectedTargetId) ??
      null,
    [selectedTargetId, targets],
  );

  useEffect(() => {
    const updateTimeZone = () => setTimeZone(currentTimeZone());
    window.addEventListener("focus", updateTimeZone);
    return () => window.removeEventListener("focus", updateTimeZone);
  }, []);

  useEffect(() => {
    let active = true;
    setTargets(null);
    setTargetError(null);
    setSelectedTargetId("");
    if (!document) {
      return () => {
        active = false;
      };
    }
    void parseTargets(provider.pluginId, provider.id, { document }).then(
      (model) => {
        if (!active) {
          return;
        }
        setTargets(model);
        setSelectedTargetId(model.targets[0]?.id ?? "");
        setTitle(document.title);
      },
      (error) => {
        if (!active) {
          return;
        }
        const message = errorMessage(error);
        setTargetError(message);
        onError(error);
      },
    );
    return () => {
      active = false;
    };
  }, [document, onError, parseTargets, provider.id, provider.pluginId]);

  useEffect(() => {
    if (providerState.loading) {
      setStatus("Updating reminders...");
    } else if (providerState.error) {
      setStatus("Reminders could not be updated.");
    } else if (providerState.model) {
      const due = providerState.model.reminders.filter(
        (reminder) =>
          reminder.status !== "scheduled" || reminder.dueAt <= Date.now(),
      ).length;
      setStatus(
        `${providerState.model.reminders.length} reminder${
          providerState.model.reminders.length === 1 ? "" : "s"
        }; ${due} need${due === 1 ? "s" : ""} attention.`,
      );
    }
  }, [providerState]);

  const run = async (id: string, action: () => Promise<void>) => {
    if (disabled || working) {
      return;
    }
    setWorking(id);
    try {
      await action();
    } catch (error) {
      setStatus(errorMessage(error));
      onError(error);
    } finally {
      setWorking(null);
    }
  };

  const createReminder = async () => {
    if (!selectedTarget) {
      throw new Error("Choose a note, heading, or task.");
    }
    const reminderTitle = title.trim();
    if (!reminderTitle) {
      throw new Error("Enter a reminder name.");
    }
    const localDateTime = `${date}T${time}`;
    const createdAt = Date.now();
    await scheduler.mutate(provider, {
      type: "create",
      id: crypto.randomUUID(),
      title: reminderTitle,
      target: selectedTarget,
      schedule: {
        kind: "wall-clock",
        localDateTime,
        timeZone,
      },
      createdAt,
    });
    const next = defaultLocalDateTime();
    setDate(next.date);
    setTime(next.time);
    setStatus(`Created ${reminderTitle}.`);
  };

  const snooze = async (reminder: PluginReminderRecord) => {
    const updatedAt = Date.now();
    await scheduler.mutate(provider, {
      type: "snooze",
      id: reminder.id,
      schedule: {
        kind: "instant",
        dueAt:
          updatedAt + provider.defaultSnoozeMinutes * 60_000,
        timeZone: currentTimeZone(),
      },
      updatedAt,
    });
    setStatus(
      `Snoozed ${reminder.title} for ${provider.defaultSnoozeMinutes} minutes.`,
    );
  };

  const dismiss = async (reminder: PluginReminderRecord) => {
    await scheduler.mutate(provider, {
      type: "dismiss",
      id: reminder.id,
      updatedAt: Date.now(),
    });
    setStatus(`Dismissed ${reminder.title}.`);
  };

  return (
    <section
      className="sidebar-view reminder-panel"
      aria-labelledby={headingId}
      aria-busy={providerState.loading}
    >
      <div className="sidebar-view__title">
        <h2 id={headingId}>{provider.title}</h2>
        {providerState.loading ? <span>Updating</span> : null}
      </div>

      <form
        className="reminder-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run("create", createReminder);
        }}
      >
        <h3>Create reminder</h3>
        {document ? (
          <>
            <label>
              Link to
              <select
                value={selectedTargetId}
                disabled={disabled || working !== null || !targets}
                onChange={(event) =>
                  setSelectedTargetId(event.currentTarget.value)
                }
              >
                {targets?.targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reminder name
              <input
                type="text"
                maxLength={160}
                value={title}
                disabled={disabled || working !== null}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
            <div className="reminder-form__schedule">
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  disabled={disabled || working !== null}
                  onChange={(event) => setDate(event.currentTarget.value)}
                />
              </label>
              <label>
                Time
                <input
                  type="time"
                  value={time}
                  disabled={disabled || working !== null}
                  onChange={(event) => setTime(event.currentTarget.value)}
                />
              </label>
            </div>
            <small>
              Time zone: {timeZone}. A skipped daylight-saving time is refused;
              a repeated time uses its earlier occurrence.
            </small>
            {encrypted ? (
              <p className="reminder-panel__privacy">
                Reminder names and note paths are stored outside vault
                encryption and may appear in system notification history.
              </p>
            ) : null}
            {targets?.notices.map((notice) => (
              <p className="reminder-panel__notice" key={notice}>
                {notice}
              </p>
            ))}
            {targetError ? (
              <p className="reminder-panel__error">{targetError}</p>
            ) : null}
            <button
              type="submit"
              className="primary-button reminder-form__submit"
              disabled={
                disabled ||
                working !== null ||
                !selectedTarget ||
                !title.trim() ||
                !date ||
                !time
              }
            >
              {working === "create" ? "Creating…" : "Create reminder"}
            </button>
          </>
        ) : (
          <p className="reminder-panel__empty">
            Open an editable UTF-8 Markdown note to create a reminder.
          </p>
        )}
      </form>

      <p className="reminder-panel__status" role="status" aria-live="polite">
        {status}
      </p>
      {providerState.model?.notices.map((notice) => (
        <p className="reminder-panel__notice" key={notice}>
          {notice}
        </p>
      ))}
      {providerState.error ? (
        <div className="reminder-panel__error">
          <p>{providerState.error}</p>
          <button
            type="button"
            disabled={working !== null}
            onClick={() =>
              void run("refresh", () => scheduler.refresh(provider))
            }
          >
            Retry reminders
          </button>
        </div>
      ) : null}

      {reminders.length > 0 ? (
        <ul className="reminder-list">
          {reminders.map((reminder) => {
            const busy = working === reminder.id;
            return (
              <li key={reminder.id} aria-busy={busy}>
                <div className="reminder-list__heading">
                  <strong>{reminder.title}</strong>
                  <span>{reminderStatus(reminder)}</span>
                </div>
                <time dateTime={new Date(reminder.dueAt).toISOString()}>
                  {formatReminderTime(reminder)}
                </time>
                <small>
                  {reminder.target.path}
                  {reminder.target.line
                    ? ` · ${reminder.target.kind} at line ${reminder.target.line}`
                    : ""}
                </small>
                {reminder.lastError ? (
                  <p className="reminder-list__error">
                    Notification failed: {reminder.lastError}
                  </p>
                ) : null}
                <div className="reminder-list__actions">
                  <button
                    type="button"
                    disabled={disabled || working !== null}
                    onClick={() =>
                      void run(reminder.id, () =>
                        onOpenFile(reminder.target.path)
                      )
                    }
                  >
                    Open note
                  </button>
                  {reminder.status === "notified" ||
                  reminder.status === "failed" ? (
                    <button
                      type="button"
                      disabled={disabled || working !== null}
                      onClick={() =>
                        void run(reminder.id, () => snooze(reminder))
                      }
                    >
                      Snooze {provider.defaultSnoozeMinutes}m
                    </button>
                  ) : null}
                  {reminder.status === "failed" ? (
                    <button
                      type="button"
                      disabled={disabled || working !== null}
                      onClick={() =>
                        void run(reminder.id, () =>
                          scheduler.retry(provider, reminder)
                        )
                      }
                    >
                      Retry notification
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled || working !== null}
                    onClick={() =>
                      void run(reminder.id, () => dismiss(reminder))
                    }
                  >
                    {reminder.status === "scheduled" ? "Cancel" : "Dismiss"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : providerState.model && !providerState.error ? (
        <p className="reminder-panel__empty">No reminders in this vault.</p>
      ) : null}
    </section>
  );
}

function defaultLocalDateTime(): { date: string; time: string } {
  const value = new Date(Date.now() + 60 * 60_000);
  value.setSeconds(0, 0);
  value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5);
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function currentTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function reminderStatus(reminder: PluginReminderRecord): string {
  switch (reminder.status) {
    case "scheduled":
      return reminder.dueAt <= Date.now() ? "Due" : "Scheduled";
    case "delivering":
      return "Requesting notification";
    case "notified":
      return "Notification requested";
    case "failed":
      return "Needs retry";
  }
}

function formatReminderTime(reminder: PluginReminderRecord): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: reminder.schedule.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(reminder.dueAt));
}

export type { PluginReminderTarget };
