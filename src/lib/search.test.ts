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

  it("returns one result for each content occurrence", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild([
      {
        ...documents[0],
        path: "occurrences.md",
        title: "Occurrences",
        content: "needle one\nmiddle needle two\nlast needle",
      },
    ]);

    const results = await index.query("needle");

    expect(results.map((result) => result.document.path)).toEqual([
      "occurrences.md",
      "occurrences.md",
      "occurrences.md",
    ]);
    expect(results.map((result) => result.match)).toEqual([
      { from: 0, to: 6 },
      { from: 18, to: 24 },
      { from: 34, to: 40 },
    ]);
    expect(results.map((result) => result.occurrence)).toEqual([1, 2, 3]);
  });

  it("uses original offsets and the earliest matching search term", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild([
      {
        ...documents[0],
        path: "offsets.md",
        title: "Offsets",
        content: "İx bar first, foo later",
      },
    ]);

    expect((await index.query("i"))[0]?.match).toEqual({ from: 0, to: 1 });
    expect((await index.query("x"))[0]?.match).toEqual({ from: 1, to: 2 });
    expect((await index.query("foo bar"))[0]?.match).toEqual({
      from: 3,
      to: 6,
    });
  });

  it("does not duplicate phrase occurrences with their component terms", async () => {
    const index = new VaultSearchIndex();
    await index.rebuild([
      {
        ...documents[0],
        path: "phrases.md",
        title: "Phrases",
        content: "foo bar then foo bar",
      },
    ]);

    const results = await index.query("foo bar");

    expect(results.map((result) => result.match)).toEqual([
      { from: 0, to: 7 },
      { from: 13, to: 20 },
    ]);
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
