import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isCalendarDate, type PluginCalendarDay, type PluginCalendarModel, type PluginCalendarRequest, type PluginCalendarView } from "@denote/plugin-sdk";
import {
  calendarDateValue,
  calendarMonthDates,
  calendarToday,
  calendarWeekStart,
  formatCalendarDate,
  moveCalendarDate,
  moveCalendarMonth,
} from "../lib/calendar";
import { errorMessage } from "../lib/api";
import type { CalendarSnapshot } from "../plugins/calendars";
import type { PluginCalendarContribution } from "../plugins/workerRuntime";

interface CalendarPanelProps {
  provider: PluginCalendarContribution;
  snapshot: CalendarSnapshot;
  queryCalendar: (pluginId: string, providerId: string, request: PluginCalendarRequest) => Promise<PluginCalendarModel>;
  onOpenDailyNote: (day: PluginCalendarDay) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
  disabled?: boolean;
  locale?: string;
}

const DATE_VIEWS: Record<PluginCalendarView, string> = {
  dated: "Daily and dated",
  created: "Created",
  updated: "Last updated",
};
const LEGACY_VIEWS: PluginCalendarView[] = ["dated"];

function activityCount(count: number, view: PluginCalendarView): string {
  const suffix = view === "created" ? " created" : view === "updated" ? " last updated" : "";
  return `${count} note${count === 1 ? "" : "s"}${suffix}`;
}

export function CalendarPanel({
  provider, snapshot, queryCalendar, onOpenDailyNote, onOpenFile, onError,
  disabled = false, locale = navigator.language,
}: CalendarPanelProps) {
  const headingId = useId();
  const helpId = useId();
  const [selected, setSelected] = useState(calendarToday);
  const [today, setToday] = useState(calendarToday);
  const [presentation, setPresentation] = useState<"month" | "agenda">("month");
  const [requestedView, setRequestedView] = useState<PluginCalendarView>("dated");
  const availableViews = provider.views ?? LEGACY_VIEWS;
  const calendarView = availableViews.includes(requestedView) ? requestedView : "dated";
  const [timeZone, setTimeZone] = useState(() => new Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef(false);
  const [result, setResult] = useState<{
    provider: PluginCalendarContribution;
    request: PluginCalendarRequest;
    model: PluginCalendarModel | null;
    error: string | null;
  } | null>(null);
  const month = selected.slice(0, 7);
  const weekStart = useMemo(() => calendarWeekStart(locale), [locale]);
  const dates = useMemo(() => calendarMonthDates(month, weekStart), [month, weekStart]);
  const request = useMemo<PluginCalendarRequest>(() => ({
    ...snapshot, startDate: dates[0], endDate: dates[dates.length - 1], view: calendarView, timeZone,
  }), [calendarView, dates, snapshot, timeZone]);
  const current = result?.request === request && result.provider === provider ? result : null;
  const model = current?.model ?? null;
  const days = new Map(model?.days.map((day) => [day.date, day]));
  const selectedDay = days.get(selected);
  const monthDays = model?.days.filter((day) => day.date.startsWith(month) && day.notes.length > 0) ?? [];
  const noteCount = monthDays.reduce((count, day) => count + day.notes.length, 0);
  const monthLabel = formatCalendarDate(`${month}-01`, locale, { month: "long", year: "numeric" });
  const previousMonth = moveCalendarMonth(selected, -1);
  const nextMonth = moveCalendarMonth(selected, 1);

  useEffect(() => {
    const update = () => {
      setToday(calendarToday());
      setTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void queryCalendar(provider.pluginId, provider.id, request).then(
      (nextModel) => {
        if (active) setResult({ provider, request, model: nextModel, error: null });
      },
      (error) => {
        if (!active) return;
        setResult({ provider, request, model: null, error: errorMessage(error) });
        onError(error);
      },
    );
    return () => { active = false; };
  }, [onError, provider, queryCalendar, request, retry]);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      dateButtons.current.get(selected)?.focus();
      pendingFocus.current = false;
    }
  }, [selected, presentation]);

  const selectDate = (date: string | null, focus = false) => {
    if (date && isCalendarDate(date)) {
      pendingFocus.current = focus;
      setSelected(date);
    }
  };

  const navigateDate = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    let target: string | null;
    const weekday = (calendarDateValue(date).getUTCDay() - weekStart + 7) % 7;
    switch (event.key) {
      case "ArrowLeft": target = moveCalendarDate(date, -1); break;
      case "ArrowRight": target = moveCalendarDate(date, 1); break;
      case "ArrowUp": target = moveCalendarDate(date, -7); break;
      case "ArrowDown": target = moveCalendarDate(date, 7); break;
      case "Home": target = moveCalendarDate(date, -weekday); break;
      case "End": target = moveCalendarDate(date, 6 - weekday); break;
      case "PageUp": target = moveCalendarMonth(date, event.shiftKey ? -12 : -1); break;
      case "PageDown": target = moveCalendarMonth(date, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    selectDate(target, true);
  };

  const runAction = async (action: () => Promise<void>) => {
    if (disabled || workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try {
      await action();
    } catch (error) {
      onError(error);
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };

  const noteList = (day: PluginCalendarDay) => (
    <ul className="calendar-notes">
      {day.notes.map((note) => (
        <li key={note.path}>
          <button type="button" disabled={disabled || working}
            onClick={() => void runAction(() => onOpenFile(note.path))}>
            <span>{note.title}</span><small>{note.path}</small>
          </button>
        </li>
      ))}
    </ul>
  );
  const offset = (calendarDateValue(dates[0]).getUTCDay() - weekStart + 7) % 7;
  const cells: Array<string | null> = [...Array<string | null>(offset).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);

  return (
    <section className="sidebar-view calendar-panel" aria-labelledby={headingId} aria-busy={!model && !current?.error}>
      <div className="sidebar-view__title"><h2 id={headingId}>{provider.title}</h2></div>
      {availableViews.length > 1 ? (
        <label className="calendar-date-source">Dates
          <select aria-label="Calendar dates" value={calendarView} disabled={disabled || working}
            onChange={(event) => {
              const next = availableViews.find((value) => value === event.currentTarget.value);
              if (next) setRequestedView(next);
            }}>
            {availableViews.map((value) => <option key={value} value={value}>{DATE_VIEWS[value]}</option>)}
          </select>
        </label>
      ) : null}
      <div className="calendar-view-controls" role="group" aria-label="Calendar view">
        <button type="button" aria-pressed={presentation === "month"} onClick={() => setPresentation("month")}>Month</button>
        <button type="button" aria-pressed={presentation === "agenda"} onClick={() => setPresentation("agenda")}>Agenda</button>
      </div>
      {calendarView !== "dated" ? <p className="calendar-help">Daily notes are excluded. Filesystem dates use your current time zone.</p> : null}
      <div className="calendar-navigation">
        <button type="button" className="icon-button" aria-label="Previous month"
          disabled={!previousMonth || disabled} onClick={() => selectDate(previousMonth)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <h3>{monthLabel}</h3>
        <button type="button" className="icon-button" aria-label="Next month"
          disabled={!nextMonth || disabled} onClick={() => selectDate(nextMonth)}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="calendar-jump">
        <label>Month<input type="month" aria-label="Calendar month" value={month}
          min="0001-01" max="9999-12" disabled={disabled}
          onChange={(event) => selectDate(`${event.currentTarget.value}-01`)} /></label>
        <button type="button" disabled={disabled} onClick={() => {
          const date = calendarToday();
          setToday(date);
          selectDate(date);
        }}>Today</button>
      </div>
      {presentation === "month" ? (
        <>
          <table className="calendar-grid" role="grid" aria-label={monthLabel} aria-describedby={helpId}>
            <thead><tr>
              {Array.from({ length: 7 }, (_, index) => {
                const date = moveCalendarDate("2026-02-01", (weekStart + index) % 7)!;
                return <th key={index} scope="col"><abbr title={formatCalendarDate(date, locale, { weekday: "long" })}>
                  {formatCalendarDate(date, locale, { weekday: "short" })}
                </abbr></th>;
              })}
            </tr></thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, row) => (
                <tr key={row}>{cells.slice(row * 7, row * 7 + 7).map((date, column) => {
                  if (!date) return <td key={column} role="gridcell" />;
                  const count = days.get(date)?.notes.length ?? 0;
                  return (
                    <td key={date} role="gridcell" aria-selected={date === selected}>
                      <button type="button" tabIndex={date === selected ? 0 : -1}
                        ref={(element) => { if (element) dateButtons.current.set(date, element); else dateButtons.current.delete(date); }}
                        className={`calendar-day${date.startsWith(month) ? "" : " calendar-day--outside"}`}
                        aria-current={date === today ? "date" : undefined}
                        aria-label={`${formatCalendarDate(date, locale)}; ${activityCount(count, calendarView)}`}
                        disabled={disabled} onClick={() => selectDate(date)}
                        onKeyDown={(event) => navigateDate(event, date)}>
                        <span>{new Intl.NumberFormat(locale).format(calendarDateValue(date).getUTCDate())}</span>
                        <small className="calendar-day__count" aria-hidden="true">{count || "\u00a0"}</small>
                      </button>
                    </td>
                  );
                })}</tr>
              ))}
            </tbody>
          </table>
          <p className="calendar-help" id={helpId}>Arrow keys move by day or week. Home/End move within a week. Page Up/Down change month; hold Shift to change year.</p>
        </>
      ) : (
        <div className="calendar-agenda" aria-label="Monthly agenda">
          {model && monthDays.length === 0 ? <p>{calendarView === "dated"
            ? "No dated notes this month. Choose a date below to create a daily note."
            : `No ordinary notes ${calendarView === "created" ? "created" : "last updated"} this month.`}</p> : null}
          {monthDays.map((day) => <section key={day.date}>
            <h4>{formatCalendarDate(day.date, locale, { weekday: "short", month: "short", day: "numeric" })}</h4>
            {noteList(day)}
          </section>)}
        </div>
      )}
      <div className="calendar-selected">
        <label>Selected date<input type="date" value={selected} min="0001-01-01" max="9999-12-31"
          disabled={disabled} onChange={(event) => selectDate(event.currentTarget.value)} /></label>
        {calendarView === "dated" ? <>
          <button type="button" className="primary-button" disabled={!selectedDay || disabled || working}
            onClick={() => { if (selectedDay) void runAction(() => onOpenDailyNote(selectedDay)); }}>
            {working ? "Opening daily note..." : selectedDay?.notes.some((note) => note.path === selectedDay.dailyNotePath) ? "Open daily note" : "Create daily note"}
          </button>
          {selectedDay ? <code className="calendar-daily-path">{selectedDay.dailyNotePath}</code> : null}
        </> : null}
        {presentation === "month" && selectedDay && selectedDay.notes.length > 0 ? noteList(selectedDay) : null}
        {presentation === "month" && selectedDay && selectedDay.notes.length === 0 && calendarView !== "dated"
          ? <p className="calendar-help">No ordinary notes {calendarView === "created" ? "created" : "last updated"} on this date.</p> : null}
      </div>
      <p role="status" className="calendar-status">
        {current?.error ?? (model ? `${monthLabel}. ${calendarView === "dated"
          ? `${noteCount} dated note${noteCount === 1 ? "" : "s"}`
          : activityCount(noteCount, calendarView)}.` : `Loading ${monthLabel}...`)}
      </p>
      {current?.error ? <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry calendar</button> : null}
      {model?.notices.map((notice) => <p className="calendar-notice" key={notice}>{notice}</p>)}
    </section>
  );
}
