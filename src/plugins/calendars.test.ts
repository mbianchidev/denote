import { describe, expect, it } from "vitest";
import { isPluginCalendarRequest, MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES } from "@denote/plugin-sdk";
import type { SearchDocument } from "../types";
import { createCalendarSnapshot } from "./calendars";

function files(...paths: string[]) {
  return paths.map((path) => ({ path, modifiedAt: null }));
}

describe("calendar snapshot", () => {
  it("shares only bounded frontmatter and keeps daily filenames when metadata is unavailable", () => {
    const document: SearchDocument = {
      path: "notes/Alpha.md", title: "Alpha", kind: "markdown",
      content: "---\ndate: 2026-09-01\n---\nSynthetic body that must not cross the boundary.",
      contentHash: "synthetic", tags: [], encoding: "utf8", lineEnding: "lf",
      bookmarked: false, lastOpenedAt: null,
      createdAt: 1_700_000_000_000, modifiedAt: 1_710_000_000_000,
    };
    const snapshot = createCalendarSnapshot(
      files(document.path, "Daily/2026-09-02.md", ".git/hidden.md", "Source.ts"),
      { documents: [document], skippedCount: 0, truncated: false },
    );
    expect(snapshot.documents).toEqual([
      { path: "Daily/2026-09-02.md", title: "2026-09-02", frontmatter: "", metadataAvailable: false, createdAt: null, modifiedAt: null },
      { path: document.path, title: "Alpha", frontmatter: "---\ndate: 2026-09-01\n---\n", metadataAvailable: true, createdAt: 1_700_000_000_000, modifiedAt: 1_710_000_000_000 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("Synthetic body");
    expect(snapshot.skippedCount).toBeGreaterThan(0);
  });

  it("never sends an unterminated frontmatter prefix as if it were metadata", () => {
    const document: SearchDocument = {
      path: "Example.md", title: "Example", kind: "markdown",
      content: "---\nSynthetic body without a closing frontmatter marker.",
      contentHash: "synthetic", tags: [], encoding: "utf8", lineEnding: "lf",
      bookmarked: false, lastOpenedAt: null,
    };
    const snapshot = createCalendarSnapshot(files(document.path), {
      documents: [document], skippedCount: 0, truncated: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("Synthetic body");
    const oversized = createCalendarSnapshot(files(document.path), {
      documents: [{ ...document, content: `---\ntitle: ${"\u{1F600}".repeat(MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES)}\n---\nBody` }],
      skippedCount: 0, truncated: false,
    });
    expect(oversized.truncated).toBe(true);
    expect(isPluginCalendarRequest({ ...oversized, startDate: "2026-09-01", endDate: "2026-09-01" })).toBe(true);
  });

  it("prefers freshly indexed filesystem dates over stale tree dates and never invents a missing birth time", () => {
    const document: SearchDocument = {
      path: "Alpha.md", title: "Alpha", content: "# Alpha", contentHash: "synthetic",
      kind: "markdown", encoding: "utf8", lineEnding: "lf", tags: [], bookmarked: false,
      lastOpenedAt: "2026-09-09T12:00:00Z",
      createdAt: null, modifiedAt: 1_790_000_000_000,
    };
    const snapshot = createCalendarSnapshot(
      [{ path: document.path, createdAt: 1_700_000_000_000, modifiedAt: 1_710_000_000_000 }],
      { documents: [document], skippedCount: 0, truncated: false },
    );
    expect(snapshot.documents[0]).toMatchObject({
      createdAt: null, modifiedAt: 1_790_000_000_000, metadataAvailable: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("lastOpenedAt");
  });
});
