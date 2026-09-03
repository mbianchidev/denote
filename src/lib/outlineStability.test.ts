import { describe, expect, it } from "vitest";
import type { HeadingItem } from "../types";
import type { SourceSymbol } from "./sourceOutline";
import {
  analysisHasIncompleteHeading,
  hasIncompleteMarkdownHeading,
  shouldPublishOutline,
  type StableOutlineSnapshot,
} from "./outlineStability";

const introduction: HeadingItem = {
  depth: 1,
  text: "Introduction",
  slug: "introduction",
};

function snapshot(
  headings: HeadingItem[] = [],
  symbols: SourceSymbol[] = [],
): StableOutlineSnapshot {
  return { headings, symbols, minimap: [] };
}

describe("outline stability", () => {
  it("holds a stable Markdown outline through partial typing and publishes one complete addition", () => {
    const stable = snapshot([introduction]);
    const partial = snapshot([]);
    const complete = snapshot([
      introduction,
      { depth: 2, text: "Details", slug: "details" },
    ]);
    const published: StableOutlineSnapshot[] = [];

    expect(hasIncompleteMarkdownHeading("# Introduction\n\n## ")).toBe(true);
    if (
      shouldPublishOutline(stable, partial, {
        incomplete: true,
        settled: false,
      })
    ) {
      published.push(partial);
    }
    if (
      shouldPublishOutline(stable, complete, {
        incomplete: false,
        settled: false,
      })
    ) {
      published.push(complete);
    }

    expect(published).toEqual([complete]);
  });

  it("does not treat marker-only lines inside fenced code as headings", () => {
    expect(
      hasIncompleteMarkdownHeading("# Introduction\n\n```md\n## \n```"),
    ).toBe(false);
  });

  it("never treats source comments as incomplete Markdown headings", () => {
    const source = "# module comment\n#\ndef load():\n    pass";

    expect(analysisHasIncompleteHeading(source, true)).toBe(false);
    expect(analysisHasIncompleteHeading("# Heading\n\n## ", false)).toBe(true);
  });

  it("lets an initially empty marker-only document settle to a true empty state", () => {
    const empty = snapshot();

    expect(
      shouldPublishOutline(null, empty, {
        incomplete: true,
        settled: false,
      }),
    ).toBe(false);
    expect(
      shouldPublishOutline(null, empty, {
        incomplete: true,
        settled: true,
      }),
    ).toBe(true);
  });

  it("holds structural removals until editing settles", () => {
    const stable = snapshot(
      [],
      [{ name: "loadProfile", kind: "function", line: 1, depth: 0 }],
    );
    const empty = snapshot();

    expect(
      shouldPublishOutline(stable, empty, {
        incomplete: false,
        settled: false,
      }),
    ).toBe(false);
    expect(
      shouldPublishOutline(stable, empty, {
        incomplete: false,
        settled: true,
      }),
    ).toBe(true);
  });

  it("holds unchanged structure until settled so the minimap cannot move per keystroke", () => {
    const stable = snapshot([introduction]);
    const same = snapshot([introduction]);

    expect(
      shouldPublishOutline(stable, same, {
        incomplete: false,
        settled: false,
      }),
    ).toBe(false);
    expect(
      shouldPublishOutline(stable, same, {
        incomplete: false,
        settled: true,
      }),
    ).toBe(true);
  });
});
