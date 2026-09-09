import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginStructuredViewModel,
  PluginStructuredViewerParseRequest,
} from "@denote/plugin-sdk";
import {
  MAX_EXPAND_ALL_CONTAINERS,
  StructuredDataViewer,
} from "./StructuredDataViewer";

const model: PluginStructuredViewModel = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      parentId: null,
      label: "Root",
      type: "object",
      depth: 0,
      childCount: 2,
    },
    {
      id: "root/project",
      parentId: "root",
      label: "project",
      type: "object",
      depth: 1,
      childCount: 1,
    },
    {
      id: "root/project/name",
      parentId: "root/project",
      label: "name",
      type: "string",
      value: "Denote",
      depth: 2,
      childCount: 0,
    },
    {
      id: "root/ready",
      parentId: "root",
      label: "ready",
      type: "boolean",
      value: "true",
      depth: 1,
      childCount: 0,
    },
  ],
  error: null,
  notices: [],
  truncated: false,
};

function renderViewer(
  parse = vi.fn(async (_request: PluginStructuredViewerParseRequest) => model),
  options: {
    source?: string;
    expandedNodeIds?: string[];
    onExpandedNodeIdsChange?: (ids: string[]) => void;
  } = {},
) {
  return render(
    <StructuredDataViewer
      title="JSON and YAML viewer"
      path="fixtures/data.json"
      format="json"
      source={options.source ?? '{"project":{"name":"Denote"},"ready":true}'}
      parse={parse}
      expandedNodeIds={options.expandedNodeIds}
      onExpandedNodeIdsChange={
        options.onExpandedNodeIdsChange ?? vi.fn()
      }
    />,
  );
}

describe("StructuredDataViewer", () => {
  it("shows the root and first-level entries by default with non-color type labels", async () => {
    renderViewer();

    expect(await screen.findByRole("tree", { name: "JSON and YAML viewer" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", {
        name: "Root, object, expanded",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Root, expanded" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(
      screen.getAllByText("object", {
        selector: ".structured-data-viewer__type",
      }),
    ).toHaveLength(2);
    expect(screen.getByText("boolean")).toBeInTheDocument();
    expect(screen.queryByText("Denote")).not.toBeInTheDocument();
  });

  it("expands and collapses each non-empty container with an accessible disclosure button", async () => {
    const user = userEvent.setup();
    renderViewer();
    const project = await screen.findByRole("treeitem", {
      name: "project, object, collapsed",
    });

    await user.click(project);
    expect(project).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Denote")).toBeInTheDocument();
    await user.click(project);
    expect(project).toHaveAttribute("aria-expanded", "false");
  });

  it("implements Collapse all while keeping the root and first level visible", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderViewer(undefined, {
      expandedNodeIds: ["root", "root/project"],
      onExpandedNodeIdsChange: onChange,
    });

    await screen.findByText("Denote");
    await user.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(onChange).toHaveBeenLastCalledWith(["root"]);
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.queryByText("Denote")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Collapsed nested containers",
    );
  });

  it("bounds Expand all and announces incomplete expansion", async () => {
    const nodes: PluginStructuredViewModel["nodes"] = [
      {
        id: "root",
        parentId: null,
        label: "Root",
        type: "array",
        depth: 0,
        childCount: MAX_EXPAND_ALL_CONTAINERS + 1,
      },
    ];
    for (let index = 0; index <= MAX_EXPAND_ALL_CONTAINERS; index += 1) {
      nodes.push({
        id: `root/${index}`,
        parentId: "root",
        label: `[${index}]`,
        type: "array",
        depth: 1,
        childCount: 1,
      });
      nodes.push({
        id: `root/${index}/value`,
        parentId: `root/${index}`,
        label: "[0]",
        type: "null",
        value: "null",
        depth: 2,
        childCount: 0,
      });
    }
    const largeModel: PluginStructuredViewModel = {
      ...model,
      nodes,
      rootId: "root",
    };
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderViewer(vi.fn(async () => largeModel), {
      onExpandedNodeIdsChange: onChange,
    });

    await screen.findByRole("tree");
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toHaveLength(
      MAX_EXPAND_ALL_CONTAINERS,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /expansion limit/i,
    );
  });

  it("supports Arrow, Home, and End tree navigation with focus restoration", async () => {
    renderViewer();
    const root = await screen.findByRole("treeitem", {
      name: "Root, object, expanded",
    });
    root.focus();

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(
      screen.getByRole("treeitem", {
        name: "project, object, collapsed",
      }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(screen.getByRole("treeitem", { name: "name, string, Denote" }))
      .toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: /project, object/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(screen.getByRole("treeitem", { name: "ready, boolean, true" }))
      .toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(root).toHaveFocus();
  });

  it("virtualizes large visible trees while keeping keyboard endpoints reachable", async () => {
    const nodes: PluginStructuredViewModel["nodes"] = [
      {
        id: "root",
        parentId: null,
        label: "Root",
        type: "array",
        depth: 0,
        childCount: 250,
      },
      ...Array.from({ length: 250 }, (_, index) => ({
        id: `root/${index}`,
        parentId: "root",
        label: `[${index}]`,
        type: "number" as const,
        value: String(index),
        depth: 1,
        childCount: 0,
      })),
    ];
    renderViewer(vi.fn(async () => ({ ...model, nodes })));

    const root = await screen.findByRole("treeitem", {
      name: "Root, array, expanded",
    });
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(251);
    root.focus();
    fireEvent.keyDown(root, { key: "End" });
    await waitFor(() =>
      expect(
        screen.getByRole("treeitem", { name: "[249], number, 249" }),
      ).toHaveFocus(),
    );
  });

  it("reports located parse errors and ignores stale worker results", async () => {
    let resolveFirst: ((model: PluginStructuredViewModel) => void) | null = null;
    let resolveSecond: ((model: PluginStructuredViewModel) => void) | null = null;
    const parse = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PluginStructuredViewModel>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PluginStructuredViewModel>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const rendered = renderViewer(parse, { source: "first" });
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    rendered.rerender(
      <StructuredDataViewer
        title="JSON and YAML viewer"
        path="fixtures/data.json"
        format="json"
        source="second"
        parse={parse}
        onExpandedNodeIdsChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(2));
    const errorModel: PluginStructuredViewModel = {
      rootId: null,
      nodes: [],
      error: {
        message: "Unexpected token",
        line: 4,
        column: 2,
        code: "PARSE_ERROR",
      },
      notices: [],
      truncated: false,
    };

    await act(async () => resolveSecond?.(errorModel));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unexpected token",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Line 4, column 2");
    await act(async () => resolveFirst?.(model));
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unexpected token");
  });
});
