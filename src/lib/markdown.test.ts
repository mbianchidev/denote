import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(
      resolveInternalLink("docs/Guide.md", "../assets/orbit.svg", [
        "docs/Guide.md",
        "assets/orbit.svg",
      ]),
    ).toEqual({ path: "assets/orbit.svg", anchor: null });
    expect(
      resolveInternalLink("docs/Guide.md", "Optional plugins.md", [
        "docs/Guide.md",
        "docs/Optional plugins.md",
      ]),
    ).toEqual({ path: "docs/Optional plugins.md", anchor: null });
    expect(
      resolveInternalLink("docs/Guide.md", "../reference/a%23b.md", [
        "docs/Guide.md",
        "reference/a#b.md",
      ]),
    ).toEqual({ path: "reference/a#b.md", anchor: null });
    expect(
      resolveInternalLink("Guide.md", "foo.md", [
        "Guide.md",
        "Foo.md",
        "foo.md",
      ]),
    ).toEqual({ path: "foo.md", anchor: null });
    expect(
      resolveInternalLink("Guide.md", "FOO.md", [
        "Guide.md",
        "Foo.md",
        "foo.md",
      ]),
    ).toBeNull();
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
    expect(
      recoverMarkdownLinkTarget(
        "[App](my-app://open/item)",
        "App",
        "about:blank",
      ),
    ).toBe("my-app://open/item");
    expect(
      recoverMarkdownLinkTarget(
        "[File](file:///tmp/note.md)",
        "File",
        "about:blank",
      ),
    ).toBe("file:///tmp/note.md");
    expect(
      recoverMarkdownLinkTarget(
        "[Open](file:///tmp/one.md) [Open](file:///tmp/two.md)",
        "Open",
        "about:blank",
      ),
    ).toBeNull();
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

  it("keeps valid angle-bracket link destinations in rich mode", () => {
    expect(
      hasUnsupportedRichMarkdown(
        "[Getting started](<docs/Getting started.md>)\n\n[outer [inner]](<docs/My file.md>)",
      ),
    ).toBe(false);
    expect(hasUnsupportedRichMarkdown("Use <kbd>Ctrl</kbd> here.")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<https://example.com>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<user@example.com>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<123@example.com>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<!DOCTYPE html>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<input disabled")).toBe(true);
    expect(hasUnsupportedRichMarkdown(`${"<a".repeat(1_000)}>`)).toBe(true);
    expect(hasUnsupportedRichMarkdown("\\[x](<input disabled>)")).toBe(true);
    expect(hasUnsupportedRichMarkdown("[x\\](<input disabled>)")).toBe(true);
    expect(
      hasUnsupportedRichMarkdown("[outer [inner](url)](<input disabled>)"),
    ).toBe(true);
    expect(hasUnsupportedRichMarkdown("[x\n\n](<input disabled>)")).toBe(true);
    expect(hasUnsupportedRichMarkdown("[x](<input\n disabled>)")).toBe(true);
    expect(hasUnsupportedRichMarkdown("[x](<foo<bar>)")).toBe(true);
    expect(hasUnsupportedRichMarkdown("![<kbd>Ctrl</kbd>](key.png)")).toBe(
      true,
    );
    expect(
      hasUnsupportedRichMarkdown("![<https://example.com>](key.png)"),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "![Diagram with [source](<docs/My source.md>)](diagram.png)",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "![foo `]( ` <kbd>bar</kbd>](image.png)",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown("![foo ` <kbd>bar</kbd>](image.png)"),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown('![<span data-x="[">x</span>](img.png)'),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown("[![alt](image.png)](<docs/My file.md>)"),
    ).toBe(false);
    expect(
      hasUnsupportedRichMarkdown(
        "[![alt](<unsafe image path>)](safe.md)",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown("[`foo ](<kbd>)`](safe.md)"),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown('[x](safe.md "title ](<kbd>)")'),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "[![`]](<u>)`][ref\\]]](u)\n\n[ref\\]]: image.png",
      ),
    ).toBe(true);
    expect(hasUnsupportedRichMarkdown('[x](url "title ]( text")')).toBe(false);
    expect(
      hasUnsupportedRichMarkdown('---\npattern: "]("\n---\n\nBody'),
    ).toBe(false);
    expect(hasUnsupportedRichMarkdown("`literal <input disabled>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("paragraph\n    <input disabled>")).toBe(
      true,
    );
  });

  it("keeps every embedded guide page compatible with rich mode", () => {
    const root = join(process.cwd(), "src-tauri/resources/default-vault");
    for (const path of markdownFiles(root)) {
      expect(hasUnsupportedRichMarkdown(readFileSync(path, "utf8")), path).toBe(
        false,
      );
    }
  });

  it("restores Markdown boundary whitespace removed by the editor", () => {
    const boundary = captureMarkdownBoundaryWhitespace("\n# Title\r\n\r\n");
    expect(restoreMarkdownBoundaryWhitespace("# Changed", boundary)).toBe(
      "\n# Changed\r\n\r\n",
    );
  });

  function markdownFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    });
  }
});
