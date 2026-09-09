import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import type { DiagramEditorBinding } from "../plugins/diagramRenderers";
import { MarkdownEditor } from "./MarkdownEditor";

const source =
  "Before\n\n```mermaid\nflowchart LR\n  Draft --> Done\n```\n\nAfter";

function binding(
  renderDiagram: DiagramEditorBinding["renderDiagram"],
  exportSvg: DiagramEditorBinding["exportSvg"] = vi.fn(async () => true),
): DiagramEditorBinding {
  return {
    scopeId: "pane-a:diagram.md",
    renderers: [
      {
        pluginId: "denote.mermaid",
        id: "denote.mermaid.renderer",
        title: "Mermaid diagrams",
        languages: ["mermaid"],
      },
    ],
    renderDiagram,
    releaseScope: vi.fn(),
    exportSvg,
  };
}

function editor(
  diagrams: DiagramEditorBinding | undefined,
  onChange = vi.fn(),
) {
  return (
    <MarkdownEditor
      notePath="diagram.md"
      markdown={source}
      lineEnding="lf"
      displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
      diagrams={diagrams}
      preferredViewMode="rich-text"
      readOnly={false}
      onChange={onChange}
      onError={vi.fn()}
      onLinkOpen={vi.fn()}
      onViewModeChange={vi.fn()}
      onImageUpload={vi.fn()}
    />
  );
}

describe("Mermaid rich Markdown blocks", () => {
  it("renders one diagram without changing fenced source and keeps source reachable", async () => {
    const onChange = vi.fn();
    const renderDiagram = vi.fn(async () => ({
      status: "success" as const,
      svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>',
      accessibleName: "Mermaid diagram",
      diagramType: "flowchart-v2",
    }));
    render(editor(binding(renderDiagram), onChange));

    expect(await screen.findByRole("figure", { name: "Mermaid diagram" }))
      .toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show diagram source" }));
    expect(await screen.findByLabelText("Edit code block")).toHaveTextContent(
      "flowchart LR",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("isolates a located parse error and leaves the rest of the note usable", async () => {
    const renderDiagram = vi.fn(async () => ({
      status: "error" as const,
      error: {
        code: "PARSE_ERROR" as const,
        message: "Expected an arrow.",
        line: 2,
        column: 8,
      },
    }));
    render(editor(binding(renderDiagram)));

    expect(await screen.findByText("Expected an arrow.")).toBeInTheDocument();
    expect(screen.getByText("Line 2, column 8")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit code block")).toHaveTextContent(
      "Draft --> Done",
    );
  });

  it("restores ordinary fenced-code rendering when the contribution disappears", async () => {
    const renderDiagram = vi.fn(async () => ({
      status: "success" as const,
      svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>',
      accessibleName: "Mermaid diagram",
      diagramType: "flowchart-v2",
    }));
    const { rerender } = render(editor(binding(renderDiagram)));
    expect(await screen.findByRole("figure", { name: "Mermaid diagram" }))
      .toBeInTheDocument();

    rerender(editor(undefined));

    await waitFor(() =>
      expect(
        screen.queryByRole("figure", { name: "Mermaid diagram" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Edit code block")).toHaveTextContent(
      "flowchart LR",
    );
  });

  it("copies and exports only the sanitized host result", async () => {
    const copy = vi.spyOn(api, "copyFileContent").mockResolvedValue();
    const exportSvg = vi.fn(async () => true);
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>';
    const renderDiagram = vi.fn(async () => ({
      status: "success" as const,
      svg,
      accessibleName: "Mermaid diagram",
      diagramType: "flowchart-v2",
    }));
    render(editor(binding(renderDiagram, exportSvg)));
    await screen.findByRole("figure", { name: "Mermaid diagram" });

    fireEvent.click(screen.getByRole("button", { name: "Copy diagram SVG" }));
    fireEvent.click(screen.getByRole("button", { name: "Export diagram SVG" }));

    await waitFor(() => expect(copy).toHaveBeenCalledWith(svg));
    expect(exportSvg).toHaveBeenCalledWith("mermaid-diagram.svg", svg);
    copy.mockRestore();
  });
});
