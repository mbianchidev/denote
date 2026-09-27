import { describe, expect, it, vi } from "vitest";
import { MAX_WORD_COUNT_CHARACTERS, wordCountLabel } from "./documentStatistics";

describe("document statistics", () => {
  it.each([
    ["", "0 words"],
    [" \t\n", "0 words"],
    ["one two three", "3 words"],
    ["hello café 日本語", "3 words"],
    ["one 😀 two", "2 words"],
  ])("counts words in %j", (source, expected) => {
    expect(wordCountLabel(source)).toBe(expected);
  });

  it("consumes each segment before advancing instead of retaining all segment objects", () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment").mockReturnValue({
      containing: () => undefined,
      *[Symbol.iterator]() {
        for (let index = 0; index < 1000; index += 1) {
          let consumed = false;
          yield {
            segment: "word",
            input: "synthetic document",
            index,
            get isWordLike() {
              consumed = true;
              return index % 2 === 0;
            },
          };
          if (!consumed) {
            throw new Error("Word counting retained an unconsumed segment");
          }
        }
        return undefined;
      },
    });
    try {
      expect(wordCountLabel("synthetic document")).toBe("500 words");
    } finally {
      segment.mockRestore();
    }
  });

  it("does not segment documents above the existing size limit", () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      expect(wordCountLabel("x".repeat(MAX_WORD_COUNT_CHARACTERS + 1)))
        .toBe("word count paused");
      expect(segment).not.toHaveBeenCalled();
    } finally {
      segment.mockRestore();
    }
  });

  it("counts whitespace-separated words when Intl.Segmenter is unavailable", () => {
    vi.stubGlobal("Intl", {});
    try {
      expect(wordCountLabel(" one\t two\nthree ")).toBe("3 words");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
