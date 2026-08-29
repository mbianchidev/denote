import { describe, expect, it } from "vitest";
import { locateMarkdownError } from "./markdownErrors";

describe("Markdown error locations", () => {
  it("recovers the MDX parser line and column hidden by MDXEditor", () => {
    expect(
      locateMarkdownError(
        "# Heading\n\n<1bad>",
        "Error parsing markdown: Unexpected character `1` (U+0031) before name, expected a character that can start a name, such as a letter, `$`, or `_`",
      ),
    ).toEqual({ line: 3, column: 2 });
  });

  it("uses explicit locations from parser messages", () => {
    expect(
      locateMarkdownError("text", "Unexpected token on line 4, column 7"),
    ).toEqual({ line: 4, column: 7 });
  });

  it("returns null when the message cannot be placed safely", () => {
    expect(locateMarkdownError("ordinary text", "Unknown editor failure")).toBe(
      null,
    );
  });
});
