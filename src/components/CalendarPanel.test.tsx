import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDates, type PluginCalendarModel, type PluginCalendarRequest } from "@denote/plugin-sdk";
import { CalendarPanel } from "./CalendarPanel";

const provider = { pluginId: "denote.calendar", id: "denote.calendar.main", title: "Calendar" };
const snapshot = {
  documents: [{ path: "notes/Alpha.md", title: "Alpha", frontmatter: "---\ndate: 2026-09-01\n---" }],
  skippedCount: 0, truncated: false,
};

function modelFor(request: PluginCalendarRequest): PluginCalendarModel {
  return {
    days: calendarDates(request.startDate, request.endDate).map((date) => ({
      date,
      dailyNotePath: `Daily/${date}.md`,
      notes: date === "2026-09-01" ? [{ path: "notes/Alpha.md", title: "Alpha" }] : [],
    })),
    notices: [], truncated: false,
  };
}

describe("CalendarPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 1, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("navigates a single-tab-stop month grid without writing and opens notes through explicit actions", async () => {
    const user = userEvent.setup();
    const onOpenDailyNote = vi.fn().mockResolvedValue(undefined);
    const onOpenFile = vi.fn().mockResolvedValue(undefined);
    const queryCalendar = vi.fn(async (_plugin: string, _id: string, request: PluginCalendarRequest) => modelFor(request));
    render(<CalendarPanel provider={provider} snapshot={snapshot} locale="en-US"
      queryCalendar={queryCalendar} onOpenDailyNote={onOpenDailyNote}
      onOpenFile={onOpenFile} onError={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Tuesday, September 1, 2026.*1 note/ }));
    expect(onOpenDailyNote).not.toHaveBeenCalled();
    const grid = screen.getByRole("grid");
    expect(within(grid).getAllByRole("button").filter((button) => button.tabIndex === 0)).toHaveLength(1);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: /Wednesday, September 2, 2026/ })).toHaveFocus();
    expect(queryCalendar).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Create daily note" }));
    expect(onOpenDailyNote).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-09-02", dailyNotePath: "Daily/2026-09-02.md",
    }));
    await user.click(screen.getByRole("button", { name: "Agenda" }));
    await user.click(screen.getByRole("button", { name: /Alpha.*notes\/Alpha.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith("notes/Alpha.md");
    expect(onOpenDailyNote).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected civil date across clock changes and supports month, year, and week keys", async () => {
    const user = userEvent.setup();
    const onOpenDailyNote = vi.fn();
    render(<CalendarPanel provider={provider} snapshot={snapshot} locale="en-US"
      queryCalendar={async (_plugin, _id, request) => modelFor(request)}
      onOpenDailyNote={onOpenDailyNote} onOpenFile={vi.fn()} onError={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Tuesday, September 1, 2026.*1 note/ }));
    await user.keyboard("{PageUp}");
    expect(screen.getByRole("button", { name: /Saturday, August 1, 2026/ })).toHaveFocus();
    await user.keyboard("{Shift>}{PageDown}{/Shift}{End}{ArrowDown}");
    expect(screen.getByRole("button", { name: /Saturday, August 14, 2027/ })).toHaveFocus();
    act(() => {
      vi.setSystemTime(new Date(2028, 0, 2, 0, 5));
      fireEvent.focus(window);
    });
    expect(screen.getByLabelText("Selected date")).toHaveValue("2027-08-14");
    expect(onOpenDailyNote).not.toHaveBeenCalled();
  });

  it("ignores late models after navigation and releases pending models on unmount", async () => {
    const pending: Array<(model: PluginCalendarModel) => void> = [];
    const queryCalendar = vi.fn((_plugin: string, _id: string, _request: PluginCalendarRequest) =>
      new Promise<PluginCalendarModel>((resolve) => pending.push(resolve)));
    const onError = vi.fn();
    const rendered = render(<CalendarPanel provider={provider} snapshot={snapshot} locale="en-US"
      queryCalendar={queryCalendar} onOpenDailyNote={vi.fn()} onOpenFile={vi.fn()} onError={onError} />);
    fireEvent.change(screen.getByLabelText("Calendar month"), { target: { value: "2026-10" } });
    await waitFor(() => expect(queryCalendar).toHaveBeenCalledTimes(2));
    await act(async () => pending[1](modelFor(queryCalendar.mock.calls[1][2])));
    expect(screen.getByRole("status")).toHaveTextContent("October 2026. 0 dated notes.");
    await act(async () => pending[0](modelFor(queryCalendar.mock.calls[0][2])));
    expect(screen.getByRole("status")).toHaveTextContent("October 2026. 0 dated notes.");
    fireEvent.change(screen.getByLabelText("Calendar month"), { target: { value: "2026-11" } });
    await waitFor(() => expect(queryCalendar).toHaveBeenCalledTimes(3));
    rendered.unmount();
    await act(async () => pending[2](modelFor(queryCalendar.mock.calls[2][2])));
    expect(onError).not.toHaveBeenCalled();
  });
});
