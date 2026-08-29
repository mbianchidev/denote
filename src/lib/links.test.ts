import { describe, expect, it } from "vitest";
import {
  externalLinkTarget,
  extractWebLinks,
  hasUriScheme,
  isBlockedExternalScheme,
  isExternalLink,
  isLocalFileUrl,
  isWebLink,
  shouldOpenLinkOnClick,
} from "./links";

describe("external link routing", () => {
  it("recognizes links handled by the operating system", () => {
    expect(isExternalLink("https://example.com")).toBe(true);
    expect(isExternalLink("HTTP://example.com")).toBe(true);
    expect(isExternalLink("mailto:hello@example.com")).toBe(true);
    expect(isExternalLink("tel:+15551234567")).toBe(true);
    expect(isExternalLink("//example.com/path")).toBe(true);
    expect(isExternalLink("notes/plan.md")).toBe(false);
  });

  it("normalizes protocol-relative links without allowing arbitrary schemes", () => {
    expect(externalLinkTarget("//example.com")).toBe("https://example.com");
    expect(externalLinkTarget("Https://Google.com/Path")).toBe(
      "https://Google.com/Path",
    );
    expect(hasUriScheme("javascript:alert(1)")).toBe(true);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("HTTPS://example.com")).toBe(true);
    expect(isBlockedExternalScheme("JavaScript:alert(1)")).toBe(true);
    expect(isLocalFileUrl("file:///tmp/note.pdf")).toBe(true);
    expect(isLocalFileUrl("file://attacker.example/share/note.pdf")).toBe(
      false,
    );
  });

  it("opens every non-empty link on an ordinary click", () => {
    expect(shouldOpenLinkOnClick("https://example.com", false)).toBe(true);
    expect(shouldOpenLinkOnClick("file:///tmp/note.pdf", false)).toBe(true);
    expect(shouldOpenLinkOnClick("notes/plan.md", false)).toBe(true);
    expect(shouldOpenLinkOnClick("notes/plan.md", true)).toBe(true);
  });

  it("extracts unique browser links from Markdown", () => {
    expect(
      extractWebLinks(
        "[One](Https://example.com/a) [Again](https://example.com/a) [Two](http://example.org) [Reference][docs] [Local](note.md)\n\n[docs]: HTTPS://docs.example.com/start",
      ),
    ).toEqual([
      "https://example.com/a",
      "http://example.org",
      "https://docs.example.com/start",
    ]);
  });

  it("uses the first matching reference definition", () => {
    expect(
      extractWebLinks(
        "[Docs][docs]\n\n[docs]: https://first.example/path\n[docs]: https://ignored.example/path",
      ),
    ).toEqual(["https://first.example/path"]);
  });

  it("keeps inline and reference links in document order", () => {
    expect(
      extractWebLinks(
        "[First][first] [Second](https://second.example)\n\n[first]: https://first.example",
      ),
    ).toEqual(["https://first.example", "https://second.example"]);
  });
});
