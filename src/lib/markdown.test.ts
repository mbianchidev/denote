import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyTocMarkerViewChange,
  calloutsToDirectives,
  captureTocMarkers,
  captureThematicBreaks,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  extractHeadings,
  extractTags,
  findMarkdownHeadingLine,
  findMarkdownTagMatch,
  hasUnsupportedRichMarkdown,
  markdownEditorSource,
  recoverMarkdownLinkTarget,
  restoreRichTextTagSyntax,
  restoreMarkdownBoundaryWhitespace,
  restoreTocMarkers,
  restoreThematicBreaks,
  resolveInternalLink,
  nextHeadingSlug,
  normalizeBareSpaceLinkDestinations,
  slugifyHeading,
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

  it("prepares the exact source parsed by the rich editor", () => {
    expect(
      markdownEditorSource(
        ">![info]\n> Open [the next page](Optional plugins.md).",
      ),
    ).toBe(
      ":::info\nOpen [the next page](<Optional plugins.md>).\n:::",
    );
  });

  it("preserves standalone thematic-break syntax without treating frontmatter as a break", () => {
    expect(
      restoreThematicBreaks(
        "Before\n\n***\n\nAfter",
        captureThematicBreaks("Before\n\n---\n\nAfter"),
      ),
    ).toBe("Before\n\n---\n\nAfter");
    expect(captureThematicBreaks("---\ntitle: Note\n---\n\nBody")).toEqual({
      delimiters: [],
    });
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

  it("creates stable duplicate anchors and finds their source lines", () => {
    expect(extractHeadings("# Same\n\n## Same")).toEqual([
      { depth: 1, text: "Same", slug: "same" },
      { depth: 2, text: "Same", slug: "same-1" },
    ]);
    expect(findMarkdownHeadingLine("# Same\n\n## Same", "same-1")).toBe(3);
    expect(
      findMarkdownHeadingLine("> # Quoted\n\n# Normal", "normal"),
    ).toBe(3);
    expect(
      findMarkdownHeadingLine(":::note\nbody\n:::\n# Target", "target"),
    ).toBe(4);
    expect(
      extractHeadings("# Foo\n\n## Foo\n\n### Foo-1").map(
        (heading) => heading.slug,
      ),
    ).toEqual(["foo", "foo-1", "foo-1-1"]);
    expect(extractHeadings("# [Guide](guide.md)")[0]).toMatchObject({
      text: "Guide",
      slug: "guide",
    });
    expect(extractHeadings("> # Same\n\n# Same\n\nSetext\n---")).toEqual([
      { depth: 1, text: "Same", slug: "same" },
      { depth: 1, text: "Same", slug: "same-1" },
      { depth: 2, text: "Setext", slug: "setext" },
    ]);
  });

  it("allocates globally unique heading slugs", () => {
    const used = new Set<string>();
    expect(nextHeadingSlug("Foo", used)).toBe("foo");
    expect(nextHeadingSlug("Foo", used)).toBe("foo-1");
    expect(nextHeadingSlug("Foo-1", used)).toBe("foo-1-1");
  });

  it("resolves relative internal links and anchors", () => {
    expect(
      resolveInternalLink(
        "Start.md",
        "welcome.md#what-is-denote",
        ["Start.md", "Welcome.md"],
      ),
    ).toEqual({ path: "Welcome.md", anchor: "what-is-denote" });
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
    expect(
      findMarkdownHeadingLine(
        "# Welcome\n\n## What is Denote",
        "what-is-denote",
      ),
    ).toBe(3);
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
        "[Next: Optional plugins](<Optional plugins.md>)",
        "Next: Optional plugins",
        "https://Optional plugins.md",
      ),
    ).toBe("Optional plugins.md");
    expect(
      recoverMarkdownLinkTarget(
        "[Next: Optional plugins](<Optional plugins.md>)",
        "Next: Optional plugins",
        "https://Optional%20plugins.md/",
      ),
    ).toBe("Optional plugins.md");
    expect(
      recoverMarkdownLinkTarget(
        "[Open](example.com/foo%2Fbar) [Open](https://example.com/foo/bar)",
        "Open",
        "https://example.com/foo/bar",
      ),
    ).toBe("https://example.com/foo/bar");
    expect(
      recoverMarkdownLinkTarget(
        "[Open](example.com/foo%2Fbar) [Open](example.com/foo/bar)",
        "Open",
        "https://example.com/foo/bar",
      ),
    ).toBe("example.com/foo/bar");
    expect(
      recoverMarkdownLinkTarget(
        "[Next](<Optional plugins.md>) [Next](<Optional plugins.md>)",
        "Next",
        "https://Optional plugins.md",
      ),
    ).toBe("Optional plugins.md");
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

  it("normalizes legacy internal links with bare spaces outside code", () => {
    expect(
      normalizeBareSpaceLinkDestinations(
        "---\ntemplate: \"[Meta](Optional plugins.md)\"\n---\n[Next](Optional plugins.md)\n\\[Escaped](Optional plugins.md)\n\\\\[Actual](Optional plugins.md)\n`[Code](Optional plugins.md)`\n```md\n[Code](Optional plugins.md)\n```\n- item\n\n    [Nested](Optional plugins.md)\n[Title](path.md \"Title\")\n[Web](https://example.com/a b)",
      ),
    ).toBe(
      "---\ntemplate: \"[Meta](Optional plugins.md)\"\n---\n[Next](<Optional plugins.md>)\n\\[Escaped](Optional plugins.md)\n\\\\[Actual](<Optional plugins.md>)\n`[Code](Optional plugins.md)`\n```md\n[Code](Optional plugins.md)\n```\n- item\n\n    [Nested](<Optional plugins.md>)\n[Title](path.md \"Title\")\n[Web](https://example.com/a b)",
    );
  });

  it("routes syntax unsupported by the rich editor to source mode", () => {
    expect(hasUnsupportedRichMarkdown("Text[^1]\n\n[^1]: Footnote")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<!-- keep this comment -->")).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<!-- toc -->\n- [Guide](#guide)\n<!-- /toc -->",
      ),
    ).toBe(false);
    expect(hasUnsupportedRichMarkdown("<!-- toc -->")).toBe(true);
    expect(hasUnsupportedRichMarkdown("  <!-- keep -->")).toBe(true);
    expect(hasUnsupportedRichMarkdown("prefix <!-- toc --> suffix")).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<!-- TOC -->\n- [Guide](#guide)\n<!-- /TOC -->",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<!-- toc -->\n- plain text\n<!-- /toc -->",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<!-- toc -->\n- [Guide](#guide)\n- plain text\n<!-- /toc -->",
      ),
    ).toBe(true);
    expect(hasUnsupportedRichMarkdown("<!-- toc extra -->")).toBe(true);
    expect(hasUnsupportedRichMarkdown("`<!-- toc -->`")).toBe(false);
    expect(
      hasUnsupportedRichMarkdown("```md\n<!-- toc -->\n```"),
    ).toBe(false);
    expect(hasUnsupportedRichMarkdown("Use <kbd>Ctrl</kbd> here.")).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>More information</summary>\n\nHidden **Markdown**.\n\n</details>",
      ),
    ).toBe(false);
    expect(
      hasUnsupportedRichMarkdown(
        '<details onclick="alert(1)">\n<summary>Unsafe</summary>\n\nHidden.\n\n</details>',
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>Missing close</summary>\n\nHidden.",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>First</summary>\n\n<summary>Second</summary>\n\nHidden.\n\n</details>",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>Example</summary>\n\n    const hidden = true;\n\n</details>",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>Example</summary>\n\n```html\n</details>\n```\n\nHidden.\n\n</details>",
      ),
    ).toBe(false);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n<summary>Example</summary>\n\n<https://example.com>\n\n</details>",
      ),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<details>\n  <summary>\n    More information\n  </summary>\n\n  Hidden **Markdown**.\n</details>",
      ),
    ).toBe(false);
    expect(
      markdownEditorSource(
        "```html\n<details>\n<summary>Example</summary>\n</details>\n```",
      ),
    ).toContain("<summary>Example</summary>");
    expect(
      hasUnsupportedRichMarkdown(
        "Mock threshold <42 units\n\nMarker <7\n\nUse <mock-key>\n\nMode <mode alpha/beta>",
      ),
    ).toBe(false);
    expect(
      hasUnsupportedRichMarkdown("<mock-key>\ncontinued explanation"),
    ).toBe(true);
    expect(
      hasUnsupportedRichMarkdown('<custom-element data-x="1">'),
    ).toBe(true);
    expect(hasUnsupportedRichMarkdown("<mock [key]>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<1[key]>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<é[key]>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("\\<42")).toBe(true);
    expect(hasUnsupportedRichMarkdown("\\\\<42")).toBe(true);
    expect(hasUnsupportedRichMarkdown("[guide]: ./guide.md")).toBe(true);
    expect(hasUnsupportedRichMarkdown("It costs $5 and then $10 total.")).toBe(
      false,
    );
    expect(hasUnsupportedRichMarkdown("# Supported\n\n**Markdown**")).toBe(false);
  });

  it("normalizes generated emoji heading fragments", () => {
    expect(slugifyHeading("⚡ Mock overview")).toBe("mock-overview");
    expect(slugifyHeading("-mock-overview")).toBe("mock-overview");
  });

  it("restores TOC markers around normalized rich-editor lists", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n  - [Two](#two)\n<!-- /toc -->\n\n# One\n\n## Two";
    const snapshot = captureTocMarkers(source);
    const restored = restoreTocMarkers(
      "* [One](#one)\n  * [Two](#two)\n\n# One\n\n## Two",
      snapshot,
    );

    expect(restored).toContain(
      "<!-- toc -->\n* [One](#one)\n  * [Two](#two)\n<!-- /toc -->",
    );
  });

  it("restores duplicate TOC lists by verified position and context", () => {
    const source =
      "- [Same](#same)\n\nContext\n\n<!-- toc -->\n- [Same](#same)\n<!-- /toc -->\n\n# After";
    const restored = restoreTocMarkers(
      "* [Same](#same)\n\nContext\n\n* [Same](#same)\n\n# After",
      captureTocMarkers(source),
    );

    expect(restored).toMatch(
      /^\* \[Same\]\(#same\)\n\nContext\n\n<!-- toc -->/,
    );
  });

  it("does not wrap an unrelated list after the TOC is deleted", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# After\n\n- [Other](#other)";
    const edited = "# After\n\n* [Other](#other)";

    expect(restoreTocMarkers(edited, captureTocMarkers(source))).toBe(edited);
  });

  it("does not restore markers removed explicitly in source mode", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# One";
    const edited = "* [One](#one)\n\n# One";

    const sourceUpdate = applyTocMarkerViewChange(
      edited,
      captureTocMarkers(source),
      "source",
    );
    expect(sourceUpdate.markdown).toBe(edited);
    expect(sourceUpdate.snapshot.blocks).toHaveLength(0);
    expect(
      applyTocMarkerViewChange(
        edited,
        sourceUpdate.snapshot,
        "rich-text",
      ).markdown,
    ).toBe(edited);
  });

  it("preserves an unchanged TOC when adjacent content changes", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# Original";
    const edited = "* [One](#one)\n\n# Renamed";

    expect(restoreTocMarkers(edited, captureTocMarkers(source))).toContain(
      "<!-- toc -->\n* [One](#one)\n<!-- /toc -->",
    );
  });

  it("refreshes rich snapshots after TOC and context edits", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# Original";
    const linkEdit = applyTocMarkerViewChange(
      "* [One](#two)\n\n# Original",
      captureTocMarkers(source),
      "rich-text",
    );
    const contextEdit = applyTocMarkerViewChange(
      "* [One](#two)\n\n# Renamed",
      linkEdit.snapshot,
      "rich-text",
    );

    expect(linkEdit.markdown).toContain("<!-- toc -->");
    expect(contextEdit.markdown).toContain("<!-- toc -->");
    expect(contextEdit.markdown).toContain("<!-- /toc -->");
  });

  it("preserves edited links in a TOC-only document", () => {
    const source = "<!-- toc -->\n- [One](#one)\n<!-- /toc -->";

    expect(
      restoreTocMarkers("* [Two](#two)", captureTocMarkers(source)),
    ).toBe("<!-- toc -->\n* [Two](#two)\n<!-- /toc -->");
  });

  it("restores a TOC that merges with an adjacent list", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n- ordinary";

    expect(
      restoreTocMarkers(
        "* [One](#one)\n\n* ordinary",
        captureTocMarkers(source),
      ),
    ).toBe("<!-- toc -->\n* [One](#one)\n<!-- /toc -->\n\n* ordinary");
  });

  it("restores multiple TOCs merged into one list", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n<!-- toc -->\n- [Two](#two)\n<!-- /toc -->";

    expect(
      restoreTocMarkers(
        "* [One](#one)\n\n* [Two](#two)",
        captureTocMarkers(source),
      ),
    ).toBe(
      "<!-- toc -->\n* [One](#one)\n<!-- /toc -->\n\n<!-- toc -->\n* [Two](#two)\n<!-- /toc -->",
    );
  });

  it("restores identical merged TOCs in their original order", () => {
    const source =
      "<!-- toc -->\n- [Same](#same)\n<!-- /toc -->\n\n<!-- toc -->\n- [Same](#same)\n<!-- /toc -->";

    expect(
      restoreTocMarkers(
        "* [Same](#same)\n\n* [Same](#same)",
        captureTocMarkers(source),
      ).match(/<!-- toc -->/g),
    ).toHaveLength(2);
  });

  it("does not migrate a deleted TOC onto identical ordinary content", () => {
    const source =
      "- [Same](#same)\n\n<!-- toc -->\n- [Same](#same)\n<!-- /toc -->";
    const edited = "* [Same](#same)";

    expect(restoreTocMarkers(edited, captureTocMarkers(source))).toBe(edited);
  });

  it("ignores comment-like text while restoring structural markers", () => {
    const source =
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# One";
    const restored = restoreTocMarkers(
      "* [One](#one)\n\n`<!--`\n\n# One",
      captureTocMarkers(source),
    );

    expect(restored).toContain("<!-- toc -->");
    expect(restored).toContain("`<!--`");
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
    expect(hasUnsupportedRichMarkdown("<![CDATA[value]]>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<slot>fallback</slot>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<font>legacy</font>")).toBe(true);
    expect(hasUnsupportedRichMarkdown("<marquee>legacy</marquee>")).toBe(true);
    expect(
      hasUnsupportedRichMarkdown(
        "<custom-element>content</custom-element>",
      ),
    ).toBe(true);
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
    ).toBe(false);
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
    const root = join(process.cwd(), "docs/user-guide");
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
