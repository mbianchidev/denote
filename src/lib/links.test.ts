import { describe, expect, it } from "vitest";
import {
  externalLinkTarget,
  hasUriScheme,
  isExternalLink,
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
    expect(hasUriScheme("javascript:alert(1)")).toBe(true);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
  });

  it("opens external links on an ordinary click", () => {
    expect(shouldOpenLinkOnClick("https://example.com", false)).toBe(true);
    expect(shouldOpenLinkOnClick("file:///tmp/note.pdf", false)).toBe(true);
    expect(shouldOpenLinkOnClick("notes/plan.md", false)).toBe(false);
    expect(shouldOpenLinkOnClick("notes/plan.md", true)).toBe(true);
  });
});
