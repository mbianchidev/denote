import { describe, expect, it } from "vitest";
import {
  calloutsToDirectives,
  directivesToCallouts,
  extractHeadings,
  extractTags,
  hasUnsupportedRichMarkdown,
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

  it("routes syntax unsupported by the rich editor to source mode", () => {
    expect(hasUnsupportedRichMarkdown("Text[^1]\n\n[^1]: Footnote")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<!-- keep this comment -->")).toBe(true);
    expect(hasUnsupportedRichMarkdown("# Supported\n\n**Markdown**")).toBe(false);
  });
});
