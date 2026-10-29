// @vitest-environment node

import { render } from "pele";
import { describe, expect, it } from "vitest";
import { MERMAID_COMPATIBILITY_FIXTURES } from "./fixtures";

describe("Pele Mermaid compatibility", () => {
  it.each(MERMAID_COMPATIBILITY_FIXTURES)("renders %s source locally", (_name, source) => {
    const result = render(source, {
      links: false,
      images: false,
      autoDirection: false,
      idPrefix: "denote-fixture",
      limit: 32 * 1024,
      outputLimit: 2 * 1024 * 1024,
      maxEdges: 300,
    });
    expect(result).toEqual(
      expect.objectContaining({
        mermaidType: expect.any(String),
        svg: expect.stringContaining("<svg"),
        links: [],
      }),
    );
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.svg).not.toMatch(/\b(?:NaN|Infinity)\b|<script\b|<foreignObject\b|<image\b|<a\b/i);
  });
});
