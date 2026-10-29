import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeleError, type RenderOptions } from "pele";
import {
  MERMAID_RENDERER_LIMITS,
  renderDiagram,
} from "../src/renderer";
import { MERMAID_COMPATIBILITY_FIXTURES } from "./fixtures";

const { render } = vi.hoisted(() => ({
  render: vi.fn((source: string, _options: RenderOptions) => {
    if (source.includes("-- broken")) {
      throw new PeleError("Expected an arrow.", "syntax", { line: 2, column: 8 });
    }
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
      mermaidType: source.trimStart().startsWith("sequenceDiagram")
        ? "sequence"
        : "flowchart-v2",
    };
  }),
}));

vi.mock("pele", async (importOriginal) => ({
  ...await importOriginal<typeof import("pele")>(),
  render,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => document.createElement("div").style,
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
        /<script|<a\b|<image\b|foreignObject|(?:href|src)="(?:https?|javascript):/i,
      );
    },
  );

  it("disables links and images and preserves the source direction and host limits", async () => {
    await renderDiagram({ source: "flowchart LR\nA-->B", theme: "light" });

    expect(render).toHaveBeenCalledWith(
      "flowchart LR\nA-->B",
      expect.objectContaining({
        links: false,
        images: false,
        autoDirection: false,
        limit: 32 * 1024,
        outputLimit: 2 * 1024 * 1024,
        maxEdges: 300,
        fontFamily: "system-ui, sans-serif",
      }),
    );
  });

  it.each(MERMAID_COMPATIBILITY_FIXTURES)("accepts the %s detector family", async (_name, source) => {
    await expect(
      renderDiagram({ source, theme: "light" }),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("renders the reported product-launch Gantt source", async () => {
    const source = `gantt
title Product Launch Plan
dateFormat YYYY-MM-DD
section Planning
Market research :done, research, 2024-03-01, 10d
Define requirements :done, reqs, after research, 7d
section Build
Design prototype :active, proto, after reqs, 14d
User testing :testing, after proto, 7d
section Launch
Marketing campaign :marketing, after proto, 14d
Release day :milestone, after testing, 0d`;

    await expect(
      renderDiagram({ source, theme: "dark" }),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("accepts safe YAML frontmatter for title and compact Gantt display", async () => {
    const result = await renderDiagram({
      source:
        "---\ntitle: Product launch\ndisplayMode: compact\n---\ngantt\ndateFormat YYYY-MM-DD\nRelease :milestone, 2026-01-01, 0d",
      theme: "light",
    });

    expect(result).toMatchObject({
      status: "success",
      accessibleName: "Product launch",
    });
    expect(render).toHaveBeenCalledWith(
      expect.stringMatching(/^gantt/),
      expect.objectContaining({
        config: { gantt: { displayMode: "compact" } },
      }),
    );
  });

  it.each([
    "---\nconfig:\n  htmlLabels: true\n---\nflowchart LR\nA-->B",
    "---\ntitle: Safe\nunknown: value\n---\nflowchart LR\nA-->B",
    "---\ntitle: &name Unsafe\n---\nflowchart LR\nA-->B",
    "---\ntitle: !tag Unsafe\n---\nflowchart LR\nA-->B",
    "%%{init: { securityLevel: 'loose' }}%%\nflowchart LR\nA-->B",
    "%%{  init: { darkMode: true } }%%\nflowchart LR\nA-->B",
    "flowchart LR\nA-->B\nclick A href \"https://example.test\"",
    "flowchart LR\nA[<b>Hello</b>]-->B",
    "flowchart LR\nA@{ img: \"https://example.test/a.png\" }",
    "flowchart LR\nA-->B\nclassDef unsafe fill:url(https://example.test/a.svg)",
  ])("rejects risky source before Pele sees it", async (source) => {
    const result = await renderDiagram({ source, theme: "light" });
    expect(result).toMatchObject({
      status: "error",
      error: { code: "UNSAFE_SOURCE" },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("flattens gradient colors and normalizes only local paint references", async () => {
    render.mockReturnValueOnce({
      svg: '<svg viewBox="0 0 10 10"><defs><linearGradient id="gradient"><stop stop-color="var(--pele-series-1,#123456)"/></linearGradient></defs><rect width="10" height="10"/></svg>',
      mermaidType: "sankey",
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      const style = document.createElement("div").style;
      style.setProperty("fill", 'url("#gradient") rgb(18, 52, 86)');
      style.setProperty("stop-color", "rgb(18, 52, 86)");
      return style;
    });

    const result = await renderDiagram({ source: "sankey-beta\nA,B,10", theme: "dark" });

    expect(result).toMatchObject({ status: "success" });
    if (result.status !== "success") return;
    expect(result.svg).toContain('fill="url(#gradient)"');
    expect(result.svg).toContain('stop-color="rgb(18, 52, 86)"');
    expect(result.svg).not.toContain("var(");
  });

  it("returns original fence locations after safe metadata is removed", async () => {
    const result = await renderDiagram({
      source: "---\ntitle: Build flow\n---\nflowchart LR\nA -- broken",
      theme: "light",
    });
    expect(result).toMatchObject({
      status: "error",
      error: { code: "PARSE_ERROR", line: 5, column: 8 },
    });
  });

  it("reports unexpected renderer failures instead of calling them syntax errors", async () => {
    render.mockImplementationOnce(() => { throw new Error("Renderer unavailable."); });
    await expect(renderDiagram({ source: "flowchart LR\nA-->B", theme: "light" }))
      .resolves.toMatchObject({
        status: "error",
        error: { code: "RENDER_ERROR", message: "Renderer unavailable." },
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
        source: "unknownDiagram\nA-->B",
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

  it("enforces the relationship limit for Sankey diagrams", async () => {
    const source = [
      "sankey-beta",
      ...Array.from(
        { length: MERMAID_RENDERER_LIMITS.maxEdges + 1 },
        (_, index) => `Source${index},Target${index},1`,
      ),
    ].join("\n");

    await expect(
      renderDiagram({ source, theme: "light" }),
    ).resolves.toMatchObject({
      status: "error",
      error: {
        code: "SOURCE_LIMIT",
        message: "Diagram source exceeds the 300-relationship limit.",
      },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    ["source bytes", `flowchart LR\n${`%%${"x".repeat(4094)}\n`.repeat(8)}`.slice(0, 32 * 1024), "x"],
    ["line bytes", `flowchart LR\nA[${"x".repeat(4093)}]`, "x"],
    ["lines", `flowchart LR${"\n%%".repeat(999)}`, "\n%%"],
    ["statements", `flowchart LR${"\nA".repeat(499)}`, "\nA"],
    ["relationships", `flowchart LR${"\nA-->B".repeat(300)}`, "\nA-->B"],
  ])("accepts the exact %s limit and rejects one more", async (_name, source, extra) => {
    await expect(renderDiagram({ source, theme: "light" }))
      .resolves.toMatchObject({ status: "success" });
    render.mockClear();
    await expect(renderDiagram({ source: source + extra, theme: "light" }))
      .resolves.toMatchObject({
        status: "error",
        error: { code: "SOURCE_LIMIT" },
      });
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps new upstream families and internal diagrams outside the allowlist", async () => {
    for (const source of ["agentflow-beta\nA", "usecase-beta\nactor A", "info", "error"]) {
      await expect(renderDiagram({ source, theme: "light" }))
        .resolves.toMatchObject({
          status: "error",
          error: { code: "UNSUPPORTED_DIAGRAM" },
        });
    }
    expect(render).not.toHaveBeenCalled();
  });

  it("cleans up the temporary SVG when style resolution fails", async () => {
    const children = [...document.body.children];
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      throw new Error("Style resolution failed.");
    });
    await expect(renderDiagram({ source: "flowchart LR\nA-->B", theme: "dark" }))
      .resolves.toMatchObject({
        status: "error",
        error: { code: "RENDER_ERROR", message: "Style resolution failed." },
      });
    expect([...document.body.children]).toEqual(children);
  });

  it("bounds final SVG by UTF-8 bytes after style flattening", async () => {
    render.mockReturnValueOnce({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${"字".repeat(700_000)}</text></svg>`,
      mermaidType: "flowchart-v2",
    });
    await expect(renderDiagram({ source: "flowchart LR\nA-->B", theme: "light" }))
      .resolves.toMatchObject({
        status: "error",
        error: { code: "RENDER_ERROR", message: "Diagram SVG exceeds the 2 MiB limit." },
      });
    expect(document.body.children).toHaveLength(0);
  });
});
