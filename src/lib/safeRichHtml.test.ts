import { describe, expect, it } from "vitest";
import {
  isSafeRichHtmlImageSrc,
  isSafeRichHtmlLinkHref,
  maskSafeRichHtml,
  parseSafeRichHtml,
  safeRichHtmlRanges,
} from "./safeRichHtml";

describe("safe rich HTML", () => {
  it("accepts a standalone screenshot image block", () => {
    const raw =
      '<img src="https://images.example.test/workspace.png" alt="Example workspace" width="1200" height="760" />';

    expect(parseSafeRichHtml(raw)).toEqual({
      type: "image",
      image: {
        type: "image",
        src: "https://images.example.test/workspace.png",
        alt: "Example workspace",
        width: 1200,
        height: 760,
        remote: true,
      },
    });
  });

  it("parses the supported README-style structure", () => {
    const raw =
      '<p align="center">\n  <a href="guides/intro.md">Open <strong>the guide</strong></a>\n  <img src="assets/mark.svg" alt="Project mark" width="64" height="64" />\n  <img src="https://badges.example.test/build.svg" alt="Build status" title="Passing" />\n</p>';

    expect(parseSafeRichHtml(raw)).toEqual({
      type: "block",
      tag: "p",
      align: "center",
      children: [
        { type: "text", value: "\n  " },
        {
          type: "link",
          href: "guides/intro.md",
          children: [
            { type: "text", value: "Open " },
            {
              type: "strong",
              children: [{ type: "text", value: "the guide" }],
            },
          ],
        },
        { type: "text", value: "\n  " },
        {
          type: "image",
          src: "assets/mark.svg",
          alt: "Project mark",
          width: 64,
          height: 64,
          remote: false,
        },
        { type: "text", value: "\n  " },
        {
          type: "image",
          src: "https://badges.example.test/build.svg",
          alt: "Build status",
          title: "Passing",
          remote: true,
        },
        { type: "text", value: "\n" },
      ],
    });
    expect(
      parseSafeRichHtml(
        '<h3 align="right">Release <strong>notes</strong></h3>',
      ),
    ).not.toBeNull();
  });

  it("accepts Denote-safe links and only relative or HTTP(S) images", () => {
    for (const href of [
      "notes/next.md#part",
      "#part",
      "https://example.test",
      "mailto:hello@example.test",
      "tel:+12025550123",
      "sample-app://open/item",
      "file:///Users/example/note.md",
    ]) {
      expect(isSafeRichHtmlLinkHref(href), href).toBe(true);
    }
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "vbscript:unsafe",
      "blob:https://example.test/id",
      "about:blank",
      "file://server/share/note.md",
      " javascript:alert(1)",
    ]) {
      expect(isSafeRichHtmlLinkHref(href), href).toBe(false);
    }
    expect(isSafeRichHtmlImageSrc("../assets/mark.svg")).toBe(true);
    expect(isSafeRichHtmlImageSrc("https://images.example.test/mark.svg")).toBe(
      true,
    );
    for (const src of [
      "data:image/svg+xml;base64,PHN2Zy8+",
      "javascript:alert(1)",
      "file:///Users/example/mark.svg",
      "sample-app://mark",
      "//images.example.test/mark.svg",
      "/absolute/mark.svg",
    ]) {
      expect(isSafeRichHtmlImageSrc(src), src).toBe(false);
    }
  });

  it("rejects unsafe attributes, tags, expressions, and nesting", () => {
    for (const raw of [
      '<p style="text-align:center">Text</p>',
      '<p class="hero">Text</p>',
      '<p id="hero">Text</p>',
      '<p onclick="run()">Text</p>',
      '<p><img src="assets/mark.svg" alt="Mark" srcset="other.svg 2x" /></p>',
      '<p>{window.location}</p>',
      '<p><a href={target}>Open</a></p>',
      '<p><a {...props}>Open</a></p>',
      '<p><!-- hidden --><strong>Text</strong></p>',
      "<div>Text</div>",
      "<p><h2>Nested block</h2></p>",
      "<p><a href=\"next.md\"><a href=\"other.md\">Nested</a></a></p>",
      "<p><strong>Broken</p></strong>",
      '<p><img src="assets/mark.svg" alt="Mark" width="0" /></p>',
      '<p><img src="assets/mark.svg" alt="Mark" height="5000" /></p>',
      '<p><img src="data:image/png;base64,AA==" alt="Mark" /></p>',
      "<p>Missing close",
    ]) {
      expect(parseSafeRichHtml(raw), raw).toBeNull();
    }
  });

  it("finds and masks only complete validated HTML blocks", () => {
    const safe = '<h2 align="left">Overview</h2>';
    const unsafe = '<p style="color:red">Unsafe</p>';
    const markdown = `${safe}\n\nText\n\n${unsafe}`;
    expect(safeRichHtmlRanges(markdown)).toEqual([
      expect.objectContaining({ start: 0, end: safe.length, raw: safe }),
    ]);
    const masked = maskSafeRichHtml(markdown);
    expect(masked.slice(0, safe.length)).toBe(" ".repeat(safe.length));
    expect(masked).toContain(unsafe);
  });
});
