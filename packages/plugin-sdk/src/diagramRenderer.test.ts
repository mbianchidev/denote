import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE,
  MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
  MAX_PLUGIN_DIAGRAM_SVG_BYTES,
  isPluginDiagramRenderResult,
  isPluginDiagramRendererRegistration,
} from "./diagramRenderer";
import { validatePluginManifest } from "./validation";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "denote.synthetic-diagrams",
    name: "Synthetic diagrams",
    version: "1.0.0",
    description: "Synthetic diagram renderer",
    publisher: { name: "Denote" },
    license: "MIT",
    repository: "https://github.com/mbianchidev/denote",
    icon: "icon.svg",
    category: "diagrams-visualization",
    compatibility: { apiVersion: 1, minimumDenoteVersion: "0.3.0" },
    permissions: [{ capability: "diagram-renderer" }],
    entrypoint: "dist/index.js",
    diagramRenderer: { entrypoint: "dist/renderer.js" },
    documentation: "guide.md",
    ...overrides,
  };
}

describe("diagram renderer contract", () => {
  it("accepts one bounded declarative Mermaid registration", () => {
    expect(
      isPluginDiagramRendererRegistration({
        id: "denote.synthetic-diagrams.mermaid",
        title: "Mermaid diagrams",
        languages: ["mermaid"],
      }),
    ).toBe(true);
    expect(
      isPluginDiagramRendererRegistration({
        id: "denote.synthetic-diagrams.mermaid",
        title: "Mermaid diagrams",
        languages: ["mermaid", "MERMAID"],
      }),
    ).toBe(false);
  });

  it("requires the permission and separately declared renderer entrypoint together", () => {
    expect(validatePluginManifest(manifest()).valid).toBe(true);
    expect(
      validatePluginManifest(
        manifest({ permissions: [], diagramRenderer: undefined }),
      ).valid,
    ).toBe(true);
    expect(
      validatePluginManifest(manifest({ permissions: [] })).errors,
    ).toContain(
      "diagramRenderer requires the diagram-renderer permission.",
    );
    expect(
      validatePluginManifest(
        manifest({ diagramRenderer: undefined }),
      ).errors,
    ).toContain(
      "diagram-renderer permission requires diagramRenderer.",
    );
    expect(
      validatePluginManifest(
        manifest({
          diagramRenderer: { entrypoint: "dist/index.js" },
        }),
      ).errors,
    ).toContain(
      "diagramRenderer.entrypoint must differ from entrypoint.",
    );
  });

  it("validates bounded success and located error results", () => {
    expect(
      isPluginDiagramRenderResult({
        status: "success",
        svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
        diagramType: "flowchart-v2",
        accessibleName: "Mermaid diagram",
      }),
    ).toBe(true);
    expect(
      isPluginDiagramRenderResult({
        status: "error",
        error: {
          code: "PARSE_ERROR",
          message: "Expected an arrow.",
          line: 2,
          column: 4,
        },
      }),
    ).toBe(true);
    expect(
      isPluginDiagramRenderResult({
        status: "success",
        svg: "x".repeat(MAX_PLUGIN_DIAGRAM_SVG_BYTES + 1),
        diagramType: "flowchart-v2",
        accessibleName: "Mermaid diagram",
      }),
    ).toBe(false);
    expect(
      isPluginDiagramRenderResult({
        status: "error",
        error: {
          code: "PARSE_ERROR",
          message: "x".repeat(MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE + 1),
        },
      }),
    ).toBe(false);
    expect(MAX_PLUGIN_DIAGRAM_SOURCE_BYTES).toBe(32 * 1024);
  });
});
