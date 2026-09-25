import { describe, expect, it } from "vitest";
import { isPluginCalendarModel, MAX_PLUGIN_CALENDAR_NOTES_PER_DAY } from "@denote/plugin-sdk";
import { calendarQuery, readCalendarSettings } from "../src/calendar";

describe("Calendar and daily notes", () => {
  it("separates creation and latest modification dates while excluding marked and legacy daily notes", () => {
    const documents = [
      { path: "Alpha.md", title: "Alpha", frontmatter: "---\ndate: 2026-12-01\n---", createdAt: Date.parse("2026-08-31T22:30:00Z"), modifiedAt: Date.parse("2026-09-03T09:00:00Z") },
      { path: "Beta.md", title: "Beta", frontmatter: "", createdAt: Date.parse("2026-09-02T09:00:00Z"), modifiedAt: Date.parse("2026-09-04T09:00:00Z") },
      { path: "Archive/Entry.md", title: "Moved daily", frontmatter: "---\ntype: daily\ndate: 2026-09-01\n---", createdAt: Date.parse("2026-09-01T09:00:00Z"), modifiedAt: Date.parse("2026-09-03T09:00:00Z") },
      { path: "Daily/2026-09-01.md", title: "Legacy daily", frontmatter: "", createdAt: Date.parse("2026-09-01T09:00:00Z"), modifiedAt: Date.parse("2026-09-03T09:00:00Z") },
      { path: "Unknown.md", title: "Unknown birth", frontmatter: "", createdAt: null, modifiedAt: Date.parse("2026-09-02T09:00:00Z") },
      { path: "Unindexed.md", title: "Unindexed", frontmatter: "", metadataAvailable: false, createdAt: Date.parse("2026-09-01T09:00:00Z"), modifiedAt: Date.parse("2026-09-03T09:00:00Z") },
    ];
    const request = {
      startDate: "2026-09-01", endDate: "2026-09-04",
      documents, skippedCount: 0, truncated: false, timeZone: "Europe/Rome",
    };
    const settings = readCalendarSettings({});
    const created = calendarQuery({ ...request, view: "created" }, settings);
    expect(created.view).toBe("created");
    expect(created.days.map((day) => day.notes.map((note) => note.path))).toEqual([
      ["Alpha.md"], ["Beta.md"], [], [],
    ]);
    expect(created.notices.join(" ")).toMatch(/creation time.*unavailable/i);
    const updated = calendarQuery({ ...request, view: "updated" }, settings);
    expect(updated.days.map((day) => day.notes.map((note) => note.path))).toEqual([
      [], ["Unknown.md"], ["Alpha.md"], ["Beta.md"],
    ]);
    const losAngeles = calendarQuery({ ...request, view: "created", timeZone: "America/Los_Angeles" }, settings);
    expect(losAngeles.days[0].notes).toEqual([]);
    const movedDaily = calendarQuery({ ...request, view: "dated" }, readCalendarSettings({ dateMetadata: false }));
    expect(movedDaily.days[0].notes.map((note) => note.path)).toContain("Archive/Entry.md");
  });

  it("does not classify merged metadata as ordinary or silently omit a daily note with no date", () => {
    const request = {
      startDate: "2026-09-01", endDate: "2026-09-01", timeZone: "UTC",
      documents: [
        { path: "Merged.md", title: "Merged", frontmatter: "---\nbase: &base {type: daily}\n<<: *base\n---", createdAt: Date.parse("2026-09-01T12:00:00Z") },
        { path: "Missing-date.md", title: "Missing date", frontmatter: "---\ntype: daily\n---", createdAt: Date.parse("2026-09-01T12:00:00Z") },
      ],
      skippedCount: 0, truncated: false,
    };
    const created = calendarQuery({ ...request, view: "created" }, readCalendarSettings({}));
    expect(created.days[0].notes).toEqual([]);
    const dated = calendarQuery({ ...request, view: "dated" }, readCalendarSettings({}));
    expect(dated.notices.join(" ")).toMatch(/2 notes have invalid date metadata/);
  });

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
