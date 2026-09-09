import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MERMAID_RENDERER_LIMITS,
  renderDiagram,
} from "../src/renderer";

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes("-- broken")) {
      throw new Error("Parse error on line 2: Expected an arrow.");
    }
    return {
      svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
      diagramType: source.trimStart().startsWith("sequenceDiagram")
        ? "sequence"
        : "flowchart-v2",
    };
  }),
}));

vi.mock("mermaid", () => ({
  default: { initialize, render },
}));

beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: () => "",
      }) as CSSStyleDeclaration,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Mermaid renderer", () => {
  it.each(["light", "dark", "high-contrast"] as const)(
    "renders a small local flowchart in the %s theme",
    async (theme) => {
      const result = await renderDiagram({
        source:
          "%% denote:title: Build flow\nflowchart LR\n  Draft --> Review\n  Review --> Done",
        theme,
      });

      expect(result.status, JSON.stringify(result)).toBe("success");
      if (result.status !== "success") {
        return;
      }
      expect(result.accessibleName).toBe("Build flow");
      expect(result.diagramType).toMatch(/flowchart/);
      expect(result.svg).toContain("<svg");
      expect(result.svg).not.toMatch(
        /<script|<a\b|<image\b|foreignObject|https?:|javascript:/i,
      );
    },
  );

  it.each([
    "---\nconfig:\n  htmlLabels: true\n---\nflowchart LR\nA-->B",
    "%%{init: { securityLevel: 'loose' }}%%\nflowchart LR\nA-->B",
    "flowchart LR\nA-->B\nclick A href \"https://example.test\"",
    "flowchart LR\nA[<b>Hello</b>]-->B",
    "flowchart LR\nA@{ img: \"https://example.test/a.png\" }",
    "flowchart LR\nA-->B\nclassDef unsafe fill:url(https://example.test/a.svg)",
  ])("rejects risky source before Mermaid sees it", async (source) => {
    const result = await renderDiagram({ source, theme: "light" });
    expect(result).toMatchObject({
      status: "error",
      error: { code: "UNSAFE_SOURCE" },
    });
  });

  it("returns an isolated located parse error", async () => {
    const result = await renderDiagram({
      source: "flowchart LR\n  A -- broken",
      theme: "dark",
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      return;
    }
    expect(result.error.code).toBe("PARSE_ERROR");
    expect(result.error.line).toBeGreaterThanOrEqual(1);
    expect(result.error.message.length).toBeLessThanOrEqual(1024);
  });

  it("rejects unsupported and oversized diagrams without retrying", async () => {
    await expect(
      renderDiagram({
        source: "mindmap\n  root((Hello))",
        theme: "light",
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { code: "UNSUPPORTED_DIAGRAM" },
    });
    await expect(
      renderDiagram({
        source: `flowchart LR\nA[${"x".repeat(
          MERMAID_RENDERER_LIMITS.maxSourceBytes,
        )}]`,
        theme: "light",
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { code: "SOURCE_LIMIT" },
    });
  });
});
