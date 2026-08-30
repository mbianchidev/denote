import { describe, expect, it } from "vitest";
import {
  oldPathBeforeMove,
  rekeyMovedPath,
  rewriteMarkdownLinksAfterMove,
} from "./linkRewriter";

const paths = [
  "docs/Guide.md",
  "docs/Optional plugins.md",
  "assets/orbit.svg",
];

describe("link rewriting after moves", () => {
  it("updates links targeting a moved file", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[Next](<Optional plugins.md>)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe("[Next](<../reference/Optional plugins.md>)");
  });

  it("preserves UTF-8 BOM offsets", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "\uFEFF[Next](<Optional plugins.md>)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe("\uFEFF[Next](<../reference/Optional plugins.md>)");
  });

  it("updates links inside a moved source file", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "![Orbit](../assets/orbit.svg)",
        "docs/Guide.md",
        "archive/deep/Guide.md",
        "docs/Guide.md",
        "archive/deep/Guide.md",
        paths,
      ),
    ).toBe("![Orbit](../../assets/orbit.svg)");
  });

  it("updates reference definitions and preserves anchors", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[Next][plugin]\n\n[plugin]: <Optional plugins.md#setup>",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe(
      "[Next][plugin]\n\n[plugin]: <../reference/Optional plugins.md#setup>",
    );
  });

  it("handles colons in labels and multiline destinations", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[foo:bar]:\n <Optional plugins.md>",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe("[foo:bar]:\n <../reference/Optional plugins.md>");
    expect(
      rewriteMarkdownLinksAfterMove(
        "[x](\n <Optional plugins.md>)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe(
      "[x](\n <../reference/Optional plugins.md>)",
    );
  });

  it("keeps URL delimiters encoded inside angle destinations", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[x](<a%23b.md>)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/a#b.md",
        "reference/a#b.md",
        [...paths, "docs/a#b.md"],
      ),
    ).toBe("[x](<../reference/a%23b.md>)");
    expect(
      rewriteMarkdownLinksAfterMove(
        "[x](<Optional plugins.md#foo\\>bar>)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe("[x](<../reference/Optional plugins.md#foo\\>bar>)");
  });

  it("encodes parentheses in plain destinations", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[x](a%29b.md)",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/a)b.md",
        "reference/a)b.md",
        [...paths, "docs/a)b.md"],
      ),
    ).toBe("[x](../reference/a%29b.md)");
  });

  it("handles escaped closing brackets in angle destinations", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[x](<a\\>b.md>)\n\n[ref]: <a\\>b.md>",
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/a>b.md",
        "reference/a>b.md",
        [...paths, "docs/a>b.md"],
      ),
    ).toBe(
      "[x](<../reference/a%3Eb.md>)\n\n[ref]: <../reference/a%3Eb.md>",
    );
  });

  it("prefers exact case and avoids ambiguous folded matches", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[upper](Foo.md) [lower](foo.md)",
        "Guide.md",
        "Guide.md",
        "foo.md",
        "archive/foo.md",
        ["Guide.md", "Foo.md", "foo.md"],
      ),
    ).toBe("[upper](Foo.md) [lower](archive/foo.md)");
  });

  it("does not rewrite external protocols", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        "[Web](Https://example.com)",
        "docs/Guide.md",
        "archive/Guide.md",
        "docs/Guide.md",
        "archive/Guide.md",
        paths,
      ),
    ).toBe("[Web](Https://example.com)");
  });

  it("does not rewrite link-shaped YAML frontmatter values", () => {
    expect(
      rewriteMarkdownLinksAfterMove(
        '---\ndescription: "Use [old](Optional plugins.md) literally"\n---\n\n[Next](<Optional plugins.md>)',
        "docs/Guide.md",
        "docs/Guide.md",
        "docs/Optional plugins.md",
        "reference/Optional plugins.md",
        paths,
      ),
    ).toBe(
      '---\ndescription: "Use [old](Optional plugins.md) literally"\n---\n\n[Next](<../reference/Optional plugins.md>)',
    );
  });

  it("maps moved and previous paths", () => {
    expect(rekeyMovedPath("docs/a.md", "docs", "guide")).toBe("guide/a.md");
    expect(oldPathBeforeMove("guide/a.md", "docs", "guide")).toBe("docs/a.md");
  });
});
