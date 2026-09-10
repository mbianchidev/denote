import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";

const requestedSamples = [
  [
    "Gantt",
    "gantt\ntitle Product Launch Plan\ndateFormat YYYY-MM-DD\nsection Planning\nMarket research :done, research, 2024-03-01, 10d\nDefine requirements :done, reqs, after research, 7d\nsection Build\nDesign prototype :active, proto, after reqs, 14d\nUser testing :testing, after proto, 7d\nsection Launch\nMarketing campaign :marketing, after proto, 14d\nRelease day :milestone, after testing, 0d",
  ],
  ["pie", 'pie title Pets\n"Dogs" : 4\n"Cats" : 3'],
  ["class diagram", "classDiagram\nclass Note"],
  ["flowchart", "flowchart LR\nA-->B"],
  ["sequence diagram", "sequenceDiagram\nAlice->>Bob: Hello"],
  ["ER diagram", "erDiagram\nUSER ||--o{ NOTE : writes"],
  ["state diagram", "stateDiagram-v2\n[*] --> Ready"],
  ["mindmap", "mindmap\n  root((Notes))\n    Drafts"],
  ["architecture", "architecture-beta\nservice api(server)[API]"],
  [
    "Cynefin",
    'cynefin-beta\ntitle Example\ncomplex "Investigate"\ncomplicated "Analyze"\nclear "Procedure"\nchaotic "Respond"\nconfusion "Unknown"',
  ],
  [
    "quadrant chart",
    "quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nA: [0.3, 0.6]",
  ],
  ["packet", 'packet\n0-7: "Header"\n8-15: "Payload"'],
  ["Sankey", "sankey-beta\nA,B,10"],
  ["Venn", "venn-beta\nset A\nset B"],
  ["timeline", "timeline\n2026 : Launch"],
] as const;

describe("Mermaid 11.17 detector compatibility", () => {
  beforeAll(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      suppressErrorRendering: true,
    });
  });

  it.each(requestedSamples)("parses %s source locally", async (_name, source) => {
    await expect(mermaid.parse(source)).resolves.toEqual(
      expect.objectContaining({
        diagramType: expect.any(String),
      }),
    );
  });
});
