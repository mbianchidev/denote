import { describe, expect, it } from "vitest";
import type { SearchDocument } from "../types";
import {
  createEmptySearchFilters,
  matchesSearchLocation,
  parseSearchQuery,
  VaultSearchIndex,
} from "./search";

const documents: SearchDocument[] = [
  {
    path: "projects/alpha.md",
    title: "Alpha plan",
    content: "Launch notes with #work and multilingual 日本語 content.",
    contentHash: "alpha-hash",
    encoding: "utf8",
    lineEnding: "lf",
    tags: ["work"],
    kind: "markdown",
    bookmarked: true,
    lastOpenedAt: new Date().toISOString(),
  },
  {
    path: "journal/today.md",
    title: "Today",
    content: "Personal reflections #journal",
    contentHash: "today-hash",
    encoding: "utf8",
    lineEnding: "lf",
    tags: ["journal"],
    kind: "markdown",
    bookmarked: false,
    lastOpenedAt: null,
  },
  {
    path: "site/index.html",
    title: "Website",
    content: "Launch page #work",
    contentHash: "website-hash",
    encoding: "utf8",
    lineEnding: "lf",
    tags: ["work"],
    kind: "text",
    bookmarked: false,
    lastOpenedAt: null,
  },
];

describe("vault search", () => {
  it("parses advanced filters and quoted values", () => {
    expect(
      parseSearchQuery(
        'design tag:work file:"alpha plan" bookmarked:true recent:7d',
      ),
    ).toMatchObject({
      term: "design",
      tags: ["work"],
      filenames: ["alpha plan"],
      bookmarked: true,
      recentDays: 7,
    });
  });

  it("uses ZBSearch with metadata filters", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild(documents);

    const results = await index.query("launch tag:work bookmarked:true");

    expect(results.map((result) => result.document.path)).toEqual([
      "projects/alpha.md",
    ]);
  });

  it("falls back to Unicode substring matching", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild(documents);

    const results = await index.query("日本語");

    expect(results[0]?.document.path).toBe("projects/alpha.md");
  });

  it("removes trashed paths before the deferred index rebuild", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild(documents);

    index.removePaths((path) => path.startsWith("projects/"));

    expect(await index.query("launch")).toEqual([
      expect.objectContaining({
        document: expect.objectContaining({ path: "site/index.html" }),
      }),
    ]);
  });

  it("limits search to exact files and globbed file types", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild(documents);

    const currentFile = await index.query({
      query: "launch",
      location: "projects/alpha.md",
      filters: createEmptySearchFilters(),
    });
    const htmlFiles = await index.query({
      query: "launch",
      location: "*.html",
      filters: createEmptySearchFilters(),
    });

    expect(currentFile.map((result) => result.document.path)).toEqual([
      "projects/alpha.md",
    ]);
    expect(htmlFiles.map((result) => result.document.path)).toEqual([
      "site/index.html",
    ]);
  });

  it("applies visual filters independently from search text", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild(documents);

    const results = await index.query({
      query: "",
      location: "*",
      filters: {
        ...createEmptySearchFilters(),
        tags: ["work"],
        kinds: ["markdown"],
        bookmarked: true,
        recentDays: 7,
      },
    });

    expect(results.map((result) => result.document.path)).toEqual([
      "projects/alpha.md",
    ]);
  });

  it("matches vault-wide, basename, and nested path patterns", () => {
    expect(matchesSearchLocation("site/index.html", "*")).toBe(true);
    expect(matchesSearchLocation("site/index.html", "*.html")).toBe(true);
    expect(matchesSearchLocation("README.md", "README.md")).toBe(true);
    expect(matchesSearchLocation("docs/README.md", "README.md")).toBe(false);
    expect(matchesSearchLocation("Readme.md", "README.md")).toBe(false);
    expect(matchesSearchLocation("site/index.html", "site/*.html")).toBe(true);
    expect(matchesSearchLocation("site/nested/index.html", "site/*.html")).toBe(
      false,
    );
    expect(
      matchesSearchLocation("site/nested/index.html", "site/**/*.html"),
    ).toBe(true);
    expect(matchesSearchLocation("site/index.html", "site/**/*.html")).toBe(
      true,
    );
  });

  it("indexes large files in bounded chunks without losing content matches", async () => {
    const index = new VaultSearchIndex();
    const marker = "needle-after-half-a-megabyte";
    await index.rebuild([
      {
        ...documents[0],
        path: "large.md",
        title: "large",
        content: `${"x".repeat(700_000)} ${marker}`,
      },
    ]);

    const results = await index.query(marker);

    expect(results[0]?.document.path).toBe("large.md");
  });
});
