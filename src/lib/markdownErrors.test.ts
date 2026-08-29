import { describe, expect, it } from "vitest";
import {
  locateMarkdownError,
  markdownErrorSourceIdentity,
} from "./markdownErrors";

describe("Markdown error locations", () => {
  it("recovers the MDX parser line and column hidden by MDXEditor", () => {
    expect(
      locateMarkdownError(
        "# Heading\n\n<1bad>",
        "Error parsing markdown: Unexpected character `1` (U+0031) before name, expected a character that can start a name, such as a letter, `$`, or `_`",
      ),
    ).toEqual({ line: 3, column: 2 });
  });

  it("locates an error in the original document including boundary whitespace", () => {
    expect(
      locateMarkdownError(
        "\n# Heading\n\n<1bad>\n",
        "Error parsing markdown: Unexpected character `1` (U+0031) before name",
      ),
    ).toEqual({ line: 4, column: 2 });
  });

  it("matches diagnostics independently of preserved boundary whitespace", () => {
    expect(markdownErrorSourceIdentity("\n# Heading\n")).toBe("# Heading");
  });

  it("uses explicit locations from parser messages", () => {
    expect(
      locateMarkdownError("text", "Unexpected token on line 4, column 7"),
    ).toEqual({ line: 4, column: 7 });
    expect(
      locateMarkdownError("text", "Unexpected token at 8:3"),
    ).toEqual({ line: 8, column: 3 });
  });

  it("uses the start of a reported line when a column is unavailable", () => {
    expect(locateMarkdownError("text", "Unexpected token on line 5")).toEqual({
      line: 5,
      column: 1,
    });
  });

  it("returns null when the message cannot be placed safely", () => {
    expect(locateMarkdownError("ordinary text", "Unknown editor failure")).toBe(
      null,
    );
  });
});
