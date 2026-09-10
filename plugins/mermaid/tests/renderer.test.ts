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
        /<script|<a\b|<image\b|foreignObject|https?:|javascript:/i,
      );
    },
  );

  it.each([
    ["Gantt", "gantt\ntitle Launch\nsection Build\nRelease :done, 2026-01-01, 1d"],
    ["pie", 'pie title Pets\n"Dogs" : 4\n"Cats" : 3'],
    ["class", "classDiagram\nclass Note"],
    ["flowchart", "flowchart LR\nA-->B"],
    ["sequence", "sequenceDiagram\nAlice->>Bob: Hello"],
    ["ER", "erDiagram\nUSER ||--o{ NOTE : writes"],
    ["state", "stateDiagram-v2\n[*] --> Ready"],
    ["mindmap", "mindmap\n  root((Notes))\n    Drafts"],
    ["architecture", "architecture-beta\nservice api(server)[API]"],
    [
      "Cynefin",
      'cynefin-beta\ntitle Example\ncomplex "Investigate"\ncomplicated "Analyze"\nclear "Procedure"\nchaotic "Respond"\nconfusion "Unknown"',
    ],
    ["quadrant", "quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nA: [0.3, 0.6]"],
    ["packet", 'packet\n0-7: "Header"\n8-15: "Payload"'],
    ["Sankey", "sankey-beta\nA,B,10"],
    ["Venn", "venn-beta\nset A\nset B"],
    ["timeline", "timeline\n2026 : Launch"],
    ["journey", "journey\ntitle Note flow\nsection Write\nDraft: 5: User"],
    ["Git graph", "gitGraph\ncommit"],
    ["requirement", "requirementDiagram\nrequirement test_req {\nid: 1\ntext: Hello\nrisk: low\nverifymethod: test\n}"],
    ["XY chart", "xychart-beta\nx-axis [A, B]\ny-axis 0 --> 10\nbar [3, 7]"],
    ["block", "block-beta\ncolumns 1\nA"],
    ["radar", "radar-beta\naxis A, B\ncurve X { 1, 2 }"],
    ["swimlane", "swimlane-beta\nA: Hello"],
    ["tree view", "treeView-beta\nroot\n  child"],
    ["event modeling", "eventmodeling\nservice Service"],
    ["Ishikawa", "ishikawa-beta\nProblem\n  Cause"],
    ["treemap", "treemap\nRoot\n  Child: 1"],
    ["Wardley", "wardley-beta\nmap Example\nanchor User [0.95, 0.5]"],
    ["railroad", "railroad-beta\nA ::= B"],
    ["C4", "C4Context\ntitle Context\nPerson(user, User)"],
    ["Kanban", "kanban\n  todo[Todo]\n    task[Write]"],
  ])("accepts the %s detector family", async (_name, source) => {
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
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        gantt: expect.objectContaining({ displayMode: "compact" }),
      }),
    );
  });

  it.each([
    "---\nconfig:\n  htmlLabels: true\n---\nflowchart LR\nA-->B",
    "---\ntitle: Safe\nunknown: value\n---\nflowchart LR\nA-->B",
    "---\ntitle: &name Unsafe\n---\nflowchart LR\nA-->B",
    "---\ntitle: !tag Unsafe\n---\nflowchart LR\nA-->B",
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
});
