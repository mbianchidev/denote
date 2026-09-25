import { describe, expect, it } from "vitest";
import { isPluginCalendarModel, MAX_PLUGIN_CALENDAR_NOTES_PER_DAY } from "@denote/plugin-sdk";
import { calendarQuery, readCalendarSettings } from "../src/calendar";

describe("Calendar and daily notes", () => {
  it("maps deterministic filenames and optional date metadata without altering notes", () => {
    const documents = [
      { path: "Daily/2024-02-29.md", title: "Daily entry", frontmatter: "" },
      { path: "notes/Alpha.md", title: "Alpha", frontmatter: "---\ndate: '2024-02-29'\n---" },
      { path: "notes/Ordinary.md", title: "Ordinary", frontmatter: "" },
      { path: "notes/Invalid.md", title: "Invalid", frontmatter: "---\ndate: 2024-02-30\n---" },
      { path: "notes/Quoted.md", title: "Quoted", frontmatter: '---\ntext: "a string\n  date: 2024-02-29"\n---' },
    ];
    const original = structuredClone(documents);
    const model = calendarQuery({
      startDate: "2024-02-28",
      endDate: "2024-03-01",
      documents,
      skippedCount: 0,
      truncated: false,
    }, readCalendarSettings({}));
    expect(model.days.map(({ date, dailyNotePath }) => ({ date, dailyNotePath }))).toEqual([
      { date: "2024-02-28", dailyNotePath: "Daily/2024-02-28.md" },
      { date: "2024-02-29", dailyNotePath: "Daily/2024-02-29.md" },
      { date: "2024-03-01", dailyNotePath: "Daily/2024-03-01.md" },
    ]);
    expect(model.days[1].notes.map(({ path }) => path)).toEqual([
      "Daily/2024-02-29.md",
      "notes/Alpha.md",
    ]);
    expect(model.notices.join(" ")).toMatch(/1 note.*invalid date metadata/);
    expect(documents).toEqual(original);
    const custom = calendarQuery({
      startDate: "2026-09-05", endDate: "2026-09-05", documents: [],
      skippedCount: 0, truncated: false,
    }, readCalendarSettings({ dailyFolder: "Journal/Entries", filenameFormat: "[Day-]DD.MM.YYYY" }));
    expect(custom.days[0].dailyNotePath).toBe("Journal/Entries/Day-05.09.2026.md");
    for (const settings of [
      { dailyFolder: "../escape" },
      { dailyFolder: ".git" },
      { filenameFormat: "MM-DD" },
      { filenameFormat: "YYYY/YYYY-MM-DD" },
      { filenameFormat: "YYYY-MM-DD-HH" },
    ]) {
      expect(() => readCalendarSettings(settings)).toThrow(/folder|format/i);
    }
  });

  it("prefers the exact daily path when case variants coexist", () => {
    const model = calendarQuery({
      startDate: "2026-09-01", endDate: "2026-09-01",
      documents: [
        { path: "Daily/2026-09-01.md", title: "Exact", frontmatter: "" },
        { path: "daily/2026-09-01.MD", title: "Variant", frontmatter: "" },
      ],
      skippedCount: 0, truncated: false,
    }, readCalendarSettings({}));
    expect(model.days[0].dailyNotePath).toBe("Daily/2026-09-01.md");
  });

  it("accepts empty frontmatter and reports aliases, timestamps, and duplicate date keys without interpreting them", () => {
    const headers = [
      "---\n---\n",
      "---\nvalue: &day 2026-09-01\ndate: *day\n---",
      "---\ndate: 2026-09-01T23:30:00-12:00\n---",
      "---\ndate: 2026-09-01\ndate: 2026-09-02\n---",
    ];
    const request = {
      startDate: "2026-09-01", endDate: "2026-09-02",
      documents: headers.map((frontmatter, index) => ({
        path: `notes/Example-${index}.md`, title: `Example ${index}`, frontmatter,
      })),
      skippedCount: 0, truncated: false,
    };
    const model = calendarQuery(request, readCalendarSettings({}));
    expect(model.days.every((day) => day.notes.length === 0)).toBe(true);
    expect(model.notices.join(" ")).toMatch(/3 notes have invalid date metadata/);
    expect(calendarQuery(request, readCalendarSettings({ dateMetadata: false })).notices).toEqual([]);
  });

  it("reports output limits at the exact per-date bound", () => {
    const request = {
      startDate: "2026-09-01", endDate: "2026-09-01",
      documents: Array.from({ length: MAX_PLUGIN_CALENDAR_NOTES_PER_DAY + 1 }, (_, index) => ({
        path: `notes/Example-${index}.md`, title: `Example ${index}`, frontmatter: "---\ndate: 2026-09-01\n---",
      })),
      skippedCount: 0, truncated: false,
    };
    const model = calendarQuery(request, readCalendarSettings({}));
    expect(model.days[0].notes).toHaveLength(MAX_PLUGIN_CALENDAR_NOTES_PER_DAY);
    expect(model.truncated).toBe(true);
    expect(model.notices.join(" ")).toMatch(/limits were reached/);
    expect(isPluginCalendarModel(model, request)).toBe(true);
  });
});
