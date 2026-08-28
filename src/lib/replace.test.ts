import { describe, expect, it } from "vitest";
import { previewReplacements, type ReplaceRequest } from "./replace";

const baseRequest: ReplaceRequest = {
  find: "note",
  replacement: "document",
  matchCase: false,
  wholeWord: false,
  scope: "vault",
};

describe("replace previews", () => {
  it("previews all literal replacements without mutating source content", () => {
    const source = {
      path: "one.md",
      content: "Note one. Another note.",
      contentHash: "hash",
    };

    const [preview] = previewReplacements([source], baseRequest);

    expect(preview.occurrences).toBe(2);
    expect(preview.replacedContent).toBe("document one. Another document.");
    expect(source.content).toBe("Note one. Another note.");
    expect(preview.contentHash).toBe("hash");
  });

  it("supports Unicode whole-word matching", () => {
    const previews = previewReplacements(
      [
        {
          path: "unicode.md",
          content: "кот котик 日本 日本語",
        },
      ],
      {
        ...baseRequest,
        find: "日本",
        replacement: "Japan",
        matchCase: true,
        wholeWord: true,
      },
    );

    expect(previews[0].occurrences).toBe(1);
    expect(previews[0].replacedContent).toBe("кот котик Japan 日本語");
  });

  it("returns only files containing matches", () => {
    const previews = previewReplacements(
      [
        { path: "one.md", content: "a note" },
        { path: "two.md", content: "nothing here" },
      ],
      baseRequest,
    );

    expect(previews.map((preview) => preview.path)).toEqual(["one.md"]);
  });

  it("does not replace inside Unicode grapheme clusters", () => {
    const previews = previewReplacements(
      [{ path: "hindi.md", content: "कि क" }],
      {
        ...baseRequest,
        find: "क",
        replacement: "X",
        matchCase: true,
        wholeWord: true,
      },
    );

    expect(previews[0].replacedContent).toBe("कि X");
  });

  it("does not split emoji sequences in whole-word mode", () => {
    expect(
      previewReplacements(
        [{ path: "emoji.md", content: "👨‍👩‍👧‍👦 👨 👍🏽 👍" }],
        {
          ...baseRequest,
          find: "👨",
          replacement: "X",
          matchCase: true,
          wholeWord: true,
        },
      )[0].replacedContent,
    ).toBe("👨‍👩‍👧‍👦 X 👍🏽 👍");

    expect(
      previewReplacements(
        [{ path: "emoji.md", content: "👍🏽 👍" }],
        {
          ...baseRequest,
          find: "👍",
          replacement: "Y",
          matchCase: true,
          wholeWord: true,
        },
      )[0].replacedContent,
    ).toBe("👍🏽 Y");
  });
});
