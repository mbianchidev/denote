import { describe, expect, it } from "vitest";
import {
  locateMarkdownError,
  markdownErrorSourceIdentity,
} from "./markdownErrors";
import { markdownEditorSource } from "./markdown";

describe("Markdown error locations", () => {
  it("recovers the MDX parser line and column hidden by MDXEditor", () => {
    expect(
      locateMarkdownError(
        "# Heading\n\n<1bad>",
        "Error parsing markdown: Unexpected character `1` (U+0031) before name, expected a character that can start a name, such as a letter, `$`, or `_`",
      ),
    ).toEqual({ line: 3, column: 2 });
  });

  it("locates invalid MDX names after a generated TOC and thematic break", () => {
    const source =
      "<!-- toc -->\n  - [One](#one)\n<!-- /toc -->\n\n---\n\n# One\n\nTime: <1 minute";
    expect(
      locateMarkdownError(
        source,
        "Error parsing markdown: Unexpected character `1` (U+0031) before name, expected a character that can start a name, such as a letter, `$`, or `_`",
      ),
    ).toEqual({ line: 9, column: 8 });
  });

  it("maps errors using the transformed source displayed by the editor", () => {
    const original = ">![info]\n> Body\n\n<1bad>";
    expect(
      locateMarkdownError(
        markdownEditorSource(original),
        "Error parsing markdown: Unexpected character `1` (U+0031) before name",
      ),
    ).toEqual({ line: 5, column: 2 });
  });

  it("ignores valid angle destinations before the parser error", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n[x](<1 target>)\n\nTime: <1 minute";
    expect(
      locateMarkdownError(
        source,
        "Error parsing markdown: Unexpected character `1` (U+0031) before name",
      ),
    ).toEqual({ line: 7, column: 8 });
  });

  it("ignores invalid-name text inside a valid link title", () => {
    const source =
      '<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n[x](foo "<1 title ]( rest")\n\nTime: <1 minute';
    expect(
      locateMarkdownError(
        source,
        "Error parsing markdown: Unexpected character `1` (U+0031) before name",
      ),
    ).toEqual({ line: 7, column: 8 });
  });

  it("locates attribute errors after accepted HTML comments", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n.sales summary <account-slug or link to proxima like acme.ghe.com>";
    expect(
      locateMarkdownError(
        source,
        "Error parsing markdown: Unexpected character `.` (U+002E) in attribute name, expected an attribute name character such as letters, digits, `$`, or `_`; `=` to initialize a value; whitespace before attributes; or the end of the tag",
      ),
    ).toEqual({ line: 5, column: 58 });
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
    expect(
      locateMarkdownError(
        "`<1inline>`\n\n```\n<1fenced>\n```\n\n\\<1escaped>",
        "Error parsing markdown: Unexpected character `1` (U+0031) before name",
      ),
    ).toBeNull();
  });
});
