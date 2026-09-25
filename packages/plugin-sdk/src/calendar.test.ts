import { describe, expect, it } from "vitest";
import {
  calendarDates,
  isCalendarDate,
  isCalendarNotePath,
  isPluginCalendarModel,
  isPluginCalendarRequest,
  isPluginCalendarRegistration,
} from "./calendar";

describe("calendar date identities", () => {
  it("validates activity views and filesystem timestamps without breaking dated-only providers", () => {
    const registration = {
      id: "denote.calendar.main", title: "Calendar", views: ["dated", "created", "updated"],
    };
    const request = {
      startDate: "2026-09-01", endDate: "2026-09-01", view: "created" as const, timeZone: "Europe/Rome",
      documents: [{
        path: "Alpha.md", title: "Alpha", frontmatter: "", metadataAvailable: true,
        createdAt: 1788213600000, modifiedAt: 1788300000000,
      }],
      skippedCount: 0, truncated: false,
    };
    const model = {
      view: "created",
      days: [{ date: "2026-09-01", dailyNotePath: "Daily/2026-09-01.md", notes: [] }],
      notices: [], truncated: false,
    };
    expect(isPluginCalendarRegistration(registration)).toBe(true);
    expect(isPluginCalendarRegistration({ ...registration, views: ["dated", "invented"] })).toBe(false);
    expect(isPluginCalendarRequest(request)).toBe(true);
    expect(isPluginCalendarRequest({ ...request, view: "invented" })).toBe(false);
    expect(isPluginCalendarRequest({ ...request, timeZone: "Unknown/Zone" })).toBe(false);
    expect(isPluginCalendarRequest({
      ...request, documents: [{ ...request.documents[0], createdAt: Number.NaN }],
    })).toBe(false);
    expect(isPluginCalendarModel(model, request)).toBe(true);
    expect(isPluginCalendarModel({ ...model, view: "updated" }, request)).toBe(false);
    expect(isPluginCalendarModel({ ...model, view: undefined }, request)).toBe(false);
  });

  it("uses strict Gregorian date-only keys across leap days and year boundaries", () => {
    expect(calendarDates("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(calendarDates("2025-12-31", "2026-01-01")).toEqual([
      "2025-12-31",
      "2026-01-01",
    ]);
    for (const date of ["2025-02-29", "2026-04-31", "2026-9-01", "2026-09-01T00:00:00Z"]) {
      expect(isCalendarDate(date)).toBe(false);
    }
    expect(calendarDates("2026-01-02", "2026-01-01")).toEqual([]);
    expect(calendarDates("2026-01-01", "2026-03-01")).toEqual([]);
  });

  it("bounds calendar data and ties returned dates and notes to the request", () => {
    const request = {
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      documents: [{ path: "notes/Alpha.md", title: "Alpha", frontmatter: "---\ndate: 2026-09-01\n---" }],
      skippedCount: 0,
      truncated: false,
    };
    const model = {
      days: [{
        date: request.startDate,
        dailyNotePath: "daily/2026-09-01.md",
        notes: [{ path: "notes/Alpha.md", title: "Alpha" }],
      }],
      notices: [],
      truncated: false,
    };
    expect(isPluginCalendarRegistration({ id: "denote.calendar.main", title: "Calendar" })).toBe(true);
    expect(isPluginCalendarRequest(request)).toBe(true);
    expect(isPluginCalendarModel(model, request)).toBe(true);
    expect(isPluginCalendarRequest({ ...request, documents: [request.documents[0], request.documents[0]] })).toBe(false);
    expect(isPluginCalendarRequest({
      ...request,
      documents: [{ ...request.documents[0], frontmatter: "x".repeat(8193) }],
    })).toBe(false);
    expect(isPluginCalendarRequest({ ...request, endDate: "2026-12-01" })).toBe(false);
    expect(isPluginCalendarModel({ ...model, days: [{ ...model.days[0], date: "2026-09-02" }] }, request)).toBe(false);
    expect(isPluginCalendarModel({
      ...model,
      days: [{ ...model.days[0], notes: [{ path: "Missing.md", title: "Missing" }] }],
    }, request)).toBe(false);
    for (const path of ["../note.md", "/note.md", "C:/note.md", ".denote/note.md", ".git/note.md", "daily/CON.md", "daily/aux/note.md", "daily /note.md", "daily\\note.md", "note.html"]) {
      expect(isCalendarNotePath(path)).toBe(false);
    }
  });
});
