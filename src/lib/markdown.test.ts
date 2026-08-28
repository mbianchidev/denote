import { describe, expect, it } from "vitest";
import {
  calloutsToDirectives,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  extractHeadings,
  extractTags,
  findMarkdownTagMatch,
  hasUnsupportedRichMarkdown,
  recoverMarkdownLinkTarget,
  restoreRichTextTagSyntax,
  restoreMarkdownBoundaryWhitespace,
  resolveInternalLink,
} from "./markdown";

describe("markdown utilities", () => {
  it("round-trips Denote warning callouts through editor directives", () => {
    const source = ">![warning]\n> Back up the vault.\n>\n> Then continue.";
    const directive = calloutsToDirectives(source);

    expect(directive).toBe(
      ":::caution\nBack up the vault.\n\nThen continue.\n:::",
    );
    expect(directivesToCallouts(directive)).toBe(source);
  });

  it("extracts mixed-language tags without treating headings as tags", () => {
    expect(
      extractTags("# Heading\n#work 日本語 #研究 русский #заметка 😀 #ideas"),
    ).toEqual(["ideas", "work", "заметка", "研究"]);
  });

  it("finds renderable Unicode and path-style tags without matching headings", () => {
    expect(findMarkdownTagMatch("Open #project/日本語-next today")).toEqual({
      start: 5,
      end: 22,
    });
    const hindi = "Read #हिन्दी";
    const hindiMatch = findMarkdownTagMatch(hindi);
    expect(hindi.slice(hindiMatch?.start, hindiMatch?.end)).toBe("#हिन्दी");
    expect(findMarkdownTagMatch("# Heading")).toBeNull();
  });

  it("extracts formatted multilingual tags while ignoring code and escapes", () => {
    expect(
      new Set(
        extractTags(
          "**#guide** `#literal` \\#escaped #हिन्दी #cafe\u0301",
        ),
      ),
    ).toEqual(new Set(["guide", "हिन्दी", "café"]));
  });

  it("restores line-leading rich tags without changing escaped tag notes", () => {
    expect(restoreRichTextTagSyntax("\\#guide\n\nText")).toBe(
      "#guide\n\nText",
    );
    expect(hasUnsupportedRichMarkdown("\\#literal")).toBe(true);
  });

  it("ignores headings inside fenced code blocks", () => {
    expect(
      extractHeadings("# One\n```md\n# Not a heading\n```\n## Two"),
    ).toEqual([
      { depth: 1, text: "One", slug: "one" },
      { depth: 2, text: "Two", slug: "two" },
    ]);
  });

  it("resolves relative internal links and anchors", () => {
    expect(
      resolveInternalLink("projects/plan.md", "../home#Overview", [
        "home.md",
        "projects/plan.md",
      ]),
    ).toEqual({ path: "home.md", anchor: "Overview" });
  });

  it("does not transform callout examples inside fenced code", () => {
    const source = "```markdown\n>![warning]\n> example\n:::info\ntext\n:::\n```";
    expect(calloutsToDirectives(source)).toBe(source);
    expect(directivesToCallouts(source)).toBe(source);
  });

  it("does not transform indented code or close on directives inside fences", () => {
    const indented = "    >![warning]\n    > literal";
    expect(calloutsToDirectives(indented)).toBe(indented);

    const directive =
      ":::info\n```text\n:::\n```\nOutside the fence\n:::";
    expect(directivesToCallouts(directive)).toBe(
      ">![info]\n> ```text\n> :::\n> ```\n> Outside the fence",
    );
  });

  it("preserves callout indentation inside list containers", () => {
    const source = "- item\n\n  >![info]\n  > nested";
    expect(directivesToCallouts(calloutsToDirectives(source))).toBe(source);
  });

  it("recovers bare relative note targets normalized by the rich editor", () => {
    expect(
      recoverMarkdownLinkTarget(
        "Open [Plan](notes/plan.md).",
        "Plan",
        "https://notes/plan.md/",
      ),
    ).toBe("notes/plan.md");
  });

  it("routes syntax unsupported by the rich editor to source mode", () => {
    expect(hasUnsupportedRichMarkdown("Text[^1]\n\n[^1]: Footnote")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<!-- keep this comment -->")).toBe(true);
    expect(hasUnsupportedRichMarkdown("Use <kbd>Ctrl</kbd> here.")).toBe(true);
    expect(hasUnsupportedRichMarkdown("[guide]: ./guide.md")).toBe(true);
    expect(hasUnsupportedRichMarkdown("It costs $5 and then $10 total.")).toBe(
      false,
    );
    expect(hasUnsupportedRichMarkdown("# Supported\n\n**Markdown**")).toBe(false);
  });

  it("restores Markdown boundary whitespace removed by the editor", () => {
    const boundary = captureMarkdownBoundaryWhitespace("\n# Title\r\n\r\n");
    expect(restoreMarkdownBoundaryWhitespace("# Changed", boundary)).toBe(
      "\n# Changed\r\n\r\n",
    );
  });
});
