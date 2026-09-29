import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PluginReminderLink,
  PluginReminderRecurrence,
  PluginReminderRecurrenceUnit,
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
  const [repeatUnit, setRepeatUnit] = useState<
    PluginReminderRecurrenceUnit | "none"
  >("none");
  const [repeatInterval, setRepeatInterval] = useState("1");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(currentTimeZone);
  const [working, setWorking] = useState<string | null>(null);
  const [status, setStatus] = useState("Waiting for reminders.");
  const providerState = scheduler.stateFor(provider);
  const reminders = providerState.model?.reminders ?? [];
  const editingReminder =
    reminders.find((reminder) => reminder.id === editingId) ?? null;
  const nameInput = useRef<HTMLInputElement>(null);
  const targetOptions = useMemo(() => {
    const available = [...(targets?.targets ?? [])];
    if (
      editingReminder &&
      !available.some((target) =>
        sameReminderLink(target, editingReminder.target)
      )
    ) {
      available.push(targetForStoredLink(editingReminder.target));
    }
    return available;
  }, [editingReminder, targets]);
  const selectedTarget = useMemo(
    () =>
      targetOptions.find((target) => target.id === selectedTargetId) ??
      null,
    [selectedTargetId, targetOptions],
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
    void parseTargets(provider.pluginId, provider.id, { document }).then(
      (model) => {
        if (!active) {
          return;
        }
        setTargets(model);
        setSelectedTargetId((current) =>
          model.targets.some((target) => target.id === current)
            ? current
            : model.targets[0]?.id ?? "",
        );
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
    if (editingId && !editingReminder) {
      resetForm();
    }
  });

  useEffect(() => {
    if (providerState.loading) {
      setStatus("Updating reminders…");
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

  const saveReminder = async () => {
    if (!selectedTarget) {
      throw new Error("Choose a reminder target.");
    }
    const reminderTitle = title.trim();
    if (!reminderTitle) {
      throw new Error("Enter a reminder name.");
    }
    const localDateTime = `${date}T${time}`;
    const recurrence: PluginReminderRecurrence | null =
      repeatUnit === "none"
        ? null
        : { interval: Number(repeatInterval), unit: repeatUnit };
    const timestamp = Date.now();
    await scheduler.mutate(
      provider,
      editingId
        ? {
            type: "update",
            id: editingId,
            title: reminderTitle,
            target: selectedTarget,
            schedule: {
              kind: "wall-clock",
              localDateTime,
              timeZone,
            },
            recurrence,
            updatedAt: timestamp,
          }
        : {
            type: "create",
            id: crypto.randomUUID(),
            title: reminderTitle,
            target: selectedTarget,
            schedule: {
              kind: "wall-clock",
              localDateTime,
              timeZone,
            },
            recurrence,
            createdAt: timestamp,
          },
    );
    setStatus(
      editingId
        ? `Updated ${reminderTitle}.`
        : `Created ${reminderTitle}.`,
    );
    resetForm();
  };

  const snooze = async (reminder: PluginReminderRecord) => {
    const updatedAt = Date.now();
    await scheduler.mutate(provider, {
      type: "snooze",
      id: reminder.id,
      dueAt: updatedAt + provider.defaultSnoozeMinutes * 60_000,
      timeZone: currentTimeZone(),
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
    setStatus(
      reminder.recurrence
        ? `Scheduled the next ${reminder.title} reminder.`
        : `Dismissed ${reminder.title}.`,
    );
  };

  const removeReminder = async (reminder: PluginReminderRecord) => {
    await scheduler.mutate(provider, {
      type: "remove",
      id: reminder.id,
      updatedAt: Date.now(),
    });
    if (editingId === reminder.id) {
      resetForm();
    }
    setStatus(
      reminder.recurrence
        ? `Deleted the ${reminder.title} series.`
        : `Cancelled ${reminder.title}.`,
    );
  };

  const startEditing = (reminder: PluginReminderRecord) => {
    const local = reminderLocalDateTime(reminder);
    const matchingTarget =
      targetOptions.find((target) =>
        sameReminderLink(target, reminder.target)
      ) ?? targetForStoredLink(reminder.target);
    setEditingId(reminder.id);
    setTitle(reminder.title);
    setSelectedTargetId(matchingTarget.id);
    setDate(local.date);
    setTime(local.time);
    setTimeZone(local.timeZone);
    setRepeatUnit(reminder.recurrence?.unit ?? "none");
    setRepeatInterval(String(reminder.recurrence?.interval ?? 1));
    setStatus(`Editing ${reminder.title}.`);
    window.requestAnimationFrame(() => nameInput.current?.focus());
  };

  function resetForm() {
    const next = defaultLocalDateTime();
    setEditingId(null);
    setTitle("");
    setSelectedTargetId(
      targets?.targets.find((target) => target.kind === "standalone")?.id ??
        targets?.targets[0]?.id ??
        "",
    );
    setDate(next.date);
    setTime(next.time);
    setTimeZone(currentTimeZone());
    setRepeatUnit("none");
    setRepeatInterval("1");
  }

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
          void run("save", saveReminder);
        }}
      >
        <h3>{editingId ? "Edit reminder" : "Create reminder"}</h3>
        <label>
          Link to
          <select
            value={selectedTargetId}
            disabled={disabled || working !== null || !targets}
            onChange={(event) =>
              setSelectedTargetId(event.currentTarget.value)
            }
          >
            {targetOptions.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
        {!document ? (
          <small>
            No note is open. Choose No note to create a standalone reminder.
          </small>
        ) : null}
        <label>
          Reminder name
          <input
            ref={nameInput}
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
        <div className="reminder-form__repeat">
          <label>
            Repeat
            <select
              value={repeatUnit}
              disabled={disabled || working !== null}
              onChange={(event) =>
                setRepeatUnit(
                  event.currentTarget.value as
                    | PluginReminderRecurrenceUnit
                    | "none",
                )
              }
            >
              <option value="none">Does not repeat</option>
              <option value="minute">Every N minutes</option>
              <option value="hour">Every N hours</option>
              <option value="day">Every N days</option>
              <option value="week">Every N weeks</option>
              <option value="month">Every N months</option>
              <option value="year">Every N years</option>
            </select>
          </label>
          <label
            className={`reminder-form__interval${
              repeatUnit === "none"
                ? " reminder-form__interval--inactive"
                : ""
            }`}
            aria-hidden={repeatUnit === "none" ? "true" : undefined}
          >
            <span>Every</span>
            <span className="reminder-form__interval-fields">
              <input
                type="number"
                aria-label="Repeat interval"
                min={1}
                max={999}
                step={1}
                value={repeatInterval}
                disabled={
                  disabled || working !== null || repeatUnit === "none"
                }
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next === "" || /^\d{1,3}$/u.test(next)) {
                    setRepeatInterval(next);
                  }
                }}
              />
              <span>
                {repeatUnit === "none"
                  ? "minutes"
                  : `${repeatUnit}${
                      Number(repeatInterval) === 1 ? "" : "s"
                    }`}
              </span>
            </span>
          </label>
        </div>
        <small>
          Time zone: {timeZone}. A skipped daylight-saving time is refused;
          a repeated time uses its earlier occurrence.
        </small>
        {encrypted ? (
          <p className="reminder-panel__privacy">
            Reminder names and note paths are stored outside vault encryption
            and may appear in system notification history.
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
        <div className="reminder-form__actions">
          <button
            type="submit"
            className="primary-button reminder-form__submit"
            disabled={
              disabled ||
              working !== null ||
              !selectedTarget ||
              !title.trim() ||
              !date ||
              !time ||
              (repeatUnit !== "none" &&
                (!repeatInterval ||
                  Number(repeatInterval) < 1 ||
                  Number(repeatInterval) > 999))
            }
          >
            {working === "save"
              ? editingId
                ? "Saving…"
                : "Creating…"
              : editingId
                ? "Save changes"
                : "Create reminder"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="secondary-button"
              disabled={working !== null}
              onClick={resetForm}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
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
                  {reminderTargetDescription(reminder.target)}
                </small>
                {reminder.recurrence ? (
                  <small>{formatRecurrence(reminder.recurrence)}</small>
                ) : null}
                {reminder.lastError ? (
                  <p className="reminder-list__error">
                    Notification failed: {reminder.lastError}
                  </p>
                ) : null}
                <div className="reminder-list__actions">
                  <button
                    type="button"
                    disabled={disabled || working !== null}
                    onClick={() => startEditing(reminder)}
                  >
                    Edit
                  </button>
                  {reminder.target.path ? (
                    <button
                      type="button"
                      disabled={disabled || working !== null}
                      onClick={() =>
                        void run(reminder.id, () =>
                          onOpenFile(reminder.target.path!)
                        )
                      }
                    >
                      Open note
                    </button>
                  ) : null}
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
                  {reminder.status === "scheduled" ? (
                    <button
                      type="button"
                      disabled={disabled || working !== null}
                      onClick={() =>
                        void run(reminder.id, () => removeReminder(reminder))
                      }
                    >
                      {reminder.recurrence ? "Cancel series" : "Cancel"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={disabled || working !== null}
                        onClick={() =>
                          void run(reminder.id, () => dismiss(reminder))
                        }
                      >
                        {reminder.recurrence
                          ? "Next occurrence"
                          : "Dismiss"}
                      </button>
                      {reminder.recurrence ? (
                        <button
                          type="button"
                          disabled={disabled || working !== null}
                          onClick={() =>
                            void run(reminder.id, () =>
                              removeReminder(reminder)
                            )
                          }
                        >
                          Delete series
                        </button>
                      ) : null}
                    </>
                  )}
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
    timeZone: reminder.snoozeTimeZone ?? reminder.schedule.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(reminder.dueAt));
}

function reminderLocalDateTime(reminder: PluginReminderRecord): {
  date: string;
  time: string;
  timeZone: string;
} {
  const timeZone = reminder.snoozeTimeZone ?? reminder.schedule.timeZone;
  if (
    reminder.snoozedUntil === null &&
    reminder.schedule.kind === "wall-clock"
  ) {
    const [date, time] = reminder.schedule.localDateTime.split("T");
    return { date, time, timeZone };
  }
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(reminder.dueAt))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
    time: `${parts.get("hour")}:${parts.get("minute")}`,
    timeZone,
  };
}

function sameReminderLink(
  target: Pick<PluginReminderTarget, "kind" | "path" | "noteTitle" | "line">,
  link: PluginReminderLink,
): boolean {
  return (
    target.kind === link.kind &&
    target.path === link.path &&
    target.noteTitle === link.noteTitle &&
    target.line === link.line
  );
}

function targetForStoredLink(
  link: PluginReminderLink,
): PluginReminderTarget {
  return {
    id: `stored:${link.kind}:${link.path ?? "standalone"}:${link.line ?? 0}`,
    ...link,
    label:
      link.kind === "standalone"
        ? "No note"
        : `Current link: ${reminderTargetDescription(link)}`,
  };
}

function reminderTargetDescription(link: PluginReminderLink): string {
  if (link.kind === "standalone") {
    return "No note";
  }
  const path = link.path ?? "Unknown note";
  return link.line
    ? `${path} · ${link.kind} at line ${link.line}`
    : path;
}

function formatRecurrence(recurrence: PluginReminderRecurrence): string {
  return `Repeats every ${recurrence.interval} ${recurrence.unit}${
    recurrence.interval === 1 ? "" : "s"
  }`;
}

export type { PluginReminderTarget };
