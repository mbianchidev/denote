import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import type { NoteGraphSnapshot } from "../plugins/noteGraphs";
import { NoteGraphPanel } from "./NoteGraphPanel";

const provider = {
  pluginId: "denote.note-graph",
  id: "denote.note-graph.graph",
  title: "Note graph",
};

const model: PluginNoteGraphModel = {
  nodes: [
    {
      id: "notes/Alpha.md",
      path: "notes/Alpha.md",
      title: "Alpha",
      tags: ["planning"],
      incoming: 0,
      outgoing: 1,
      orphan: false,
      distance: 0,
    },
    {
      id: "notes/Beta.md",
      path: "notes/Beta.md",
      title: "Beta",
      tags: ["planning"],
      incoming: 1,
      outgoing: 0,
      orphan: false,
      distance: 1,
    },
  ],
  edges: [
    {
      sourceId: "notes/Alpha.md",
      targetId: "notes/Beta.md",
    },
  ],
  totalNotes: 2,
  matchingNotes: 2,
  totalEdges: 1,
  activeNodeId: "notes/Alpha.md",
  truncated: false,
  notices: [],
};

describe("NoteGraphPanel", () => {
  it("indexes locally, exposes an equivalent keyboard list, and opens notes", async () => {
    const user = userEvent.setup();
    const indexNoteGraph = vi.fn(async () => {});
    const queryNoteGraph = vi.fn(async () => model);
    const onOpenFile = vi.fn();
    render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={queryNoteGraph}
        onOpenFile={onOpenFile}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledOnce());
    expect(indexNoteGraph).toHaveBeenCalledWith(
      provider.pluginId,
      provider.id,
      expect.objectContaining({ mode: "replace" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 indexed notes",
    );

    await user.click(
      screen.getByRole("button", { name: "Show keyboard note list" }),
    );
    const alpha = screen.getByRole("button", {
      name: /Alpha, notes\/Alpha\.md, 0 backlinks, 1 outgoing link/,
    });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    const beta = screen.getByRole("button", {
      name: /Beta, notes\/Beta\.md, 1 backlink, 0 outgoing links/,
    });
    expect(beta).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpenFile).toHaveBeenCalledWith("notes/Beta.md");
  });

  it("sends local depth and folder, tag, and orphan filters", async () => {
    const user = userEvent.setup();
    const queryNoteGraph = vi.fn(
      async (_pluginId: string, _providerId: string, _query: PluginNoteGraphQuery) =>
        model,
    );
    render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={vi.fn(async () => {})}
        queryNoteGraph={queryNoteGraph}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await screen.findByText("2 indexed notes.");

    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.selectOptions(screen.getByLabelText("Folder"), "notes");
    await user.selectOptions(screen.getByLabelText("Tag"), "planning");
    await user.selectOptions(screen.getByLabelText("Connections"), "connected");
    await user.selectOptions(screen.getByLabelText("Depth"), "3");

    await waitFor(() =>
      expect(queryNoteGraph).toHaveBeenLastCalledWith(
        provider.pluginId,
        provider.id,
        {
          scope: "local",
          activePath: "notes/Alpha.md",
          folder: "notes",
          tag: "planning",
          orphanFilter: "connected",
          depth: 3,
        },
      ),
    );
  });

  it("indexes only changed and removed notes after the initial snapshot", async () => {
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {},
    );
    const rendered = render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(1));

    rendered.rerender(
      <NoteGraphPanel
        provider={provider}
        snapshot={{
          ...snapshot(),
          documents: [
            {
              path: "notes/Alpha.md",
              title: "Alpha revised",
              source: "# Alpha revised",
              tags: [],
            },
          ],
        }}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(2));
    expect(indexNoteGraph.mock.calls[1]?.[2]).toEqual({
      mode: "update",
      documents: [
        {
          path: "notes/Alpha.md",
          title: "Alpha revised",
          source: "# Alpha revised",
          tags: [],
        },
      ],
      removedPaths: ["notes/Beta.md"],
      skippedCount: 0,
      truncated: false,
    });
  });

  it("retries an uncertain failed index from a full replacement", async () => {
    const indexNoteGraph = vi
      .fn()
      .mockRejectedValueOnce(new Error("Synthetic index timeout"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={onError}
      />,
    );

    await waitFor(
      () => expect(indexNoteGraph).toHaveBeenCalledTimes(2),
      { timeout: 2_000 },
    );
    expect(indexNoteGraph.mock.calls[0]?.[2]).toMatchObject({
      mode: "replace",
    });
    expect(indexNoteGraph.mock.calls[1]?.[2]).toMatchObject({
      mode: "replace",
    });
    expect(onError).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 indexed notes",
    );
  });

  it("restarts a partially applied batch sequence with replace", async () => {
    const source = "x".repeat(200_000);
    const batchedSnapshot: NoteGraphSnapshot = {
      workspaceKey: "synthetic-vault",
      documents: ["Alpha", "Beta", "Gamma"].map((title) => ({
        path: `${title}.md`,
        title,
        source,
        tags: [],
      })),
      skippedCount: 0,
      truncated: false,
    };
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {
        if (indexNoteGraph.mock.calls.length === 2) {
          throw new Error("Synthetic second batch timeout");
        }
      },
    );
    render(
      <NoteGraphPanel
        provider={provider}
        snapshot={batchedSnapshot}
        activePath="Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(
      () => expect(indexNoteGraph).toHaveBeenCalledTimes(4),
      { timeout: 2_000 },
    );
    expect(
      indexNoteGraph.mock.calls.map((call) => call[2].mode),
    ).toEqual(["replace", "update", "replace", "update"]);
  });

  it("keeps focus in the list search while filtering removes a selected row", async () => {
    const user = userEvent.setup();
    const narrowingModel: PluginNoteGraphModel = {
      ...model,
      nodes: [
        model.nodes[0],
        {
          ...model.nodes[1],
          id: "notes/Abx.md",
          path: "notes/Abx.md",
          title: "Abx",
        },
        {
          ...model.nodes[1],
          id: "notes/Aby.md",
          path: "notes/Aby.md",
          title: "Aby",
        },
      ],
      edges: [],
      totalNotes: 3,
      matchingNotes: 3,
      totalEdges: 0,
    };
    render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={vi.fn(async () => {})}
        queryNoteGraph={vi.fn(async () => narrowingModel)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Show keyboard note list",
      }),
    );
    screen
      .getByRole("button", {
        name: /Alpha, notes\/Alpha\.md/,
      })
      .focus();
    const search = screen.getByRole("searchbox", {
      name: "Filter graph notes",
    });
    await user.click(search);
    await user.type(search, "b");

    expect(search).toHaveFocus();
    expect(
      screen.getByRole("button", {
        name: /Abx, notes\/Abx\.md/,
      }),
    ).toBeInTheDocument();
    await user.type(search, "y");
    expect(search).toHaveFocus();
    expect(
      screen.getByRole("button", {
        name: /Aby, notes\/Aby\.md/,
      }),
    ).toBeInTheDocument();
  });

  it("clears the previous vault model before a replacement finishes", async () => {
    const indexNoteGraph = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>(() => {}));
    const rendered = render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(await screen.findByText("notes/Alpha.md")).toBeInTheDocument();

    rendered.rerender(
      <NoteGraphPanel
        provider={provider}
        snapshot={{
          workspaceKey: "synthetic-vault-two",
          documents: [
            {
              path: "Gamma.md",
              title: "Gamma",
              source: "# Gamma",
              tags: [],
            },
          ],
          skippedCount: 0,
          truncated: false,
        }}
        activePath="Gamma.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText("notes/Alpha.md")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Building the local note graph…")).toBeInTheDocument();
  });

  it("drops queued stale updates after the panel unmounts", async () => {
    let finishFirst: (() => void) | undefined;
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {
        if (indexNoteGraph.mock.calls.length === 1) {
          await new Promise<void>((resolve) => {
            finishFirst = resolve;
          });
        }
      },
    );
    const first = render(
      <NoteGraphPanel
        provider={provider}
        snapshot={snapshot()}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(1));
    first.rerender(
      <NoteGraphPanel
        provider={provider}
        snapshot={{
          ...snapshot(),
          documents: [
            ...snapshot().documents,
            {
              path: "notes/Queued.md",
              title: "Queued",
              source: "# Queued",
              tags: [],
            },
          ],
        }}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    first.unmount();

    const second = render(
      <NoteGraphPanel
        provider={provider}
        snapshot={{
          workspaceKey: "synthetic-vault-two",
          documents: [
            {
              path: "Gamma.md",
              title: "Gamma",
              source: "# Gamma",
              tags: [],
            },
          ],
          skippedCount: 0,
          truncated: false,
        }}
        activePath="Gamma.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => ({
          ...model,
          nodes: [],
          edges: [],
          totalNotes: 0,
          matchingNotes: 0,
          totalEdges: 0,
          activeNodeId: null,
        }))}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(2));
    expect(indexNoteGraph.mock.calls[1]?.[2]).toMatchObject({
      mode: "replace",
      documents: [expect.objectContaining({ path: "Gamma.md" })],
    });

    await act(async () => {
      finishFirst?.();
      await Promise.resolve();
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(indexNoteGraph).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it("replaces after a generation interrupts a partially applied batch", async () => {
    let finishPartial: (() => void) | undefined;
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {
        if (indexNoteGraph.mock.calls.length === 2) {
          await new Promise<void>((resolve) => {
            finishPartial = resolve;
          });
        }
      },
    );
    const baseSnapshot = snapshot();
    const rendered = render(
      <NoteGraphPanel
        provider={provider}
        snapshot={baseSnapshot}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(1));

    const expandedSnapshot: NoteGraphSnapshot = {
      ...baseSnapshot,
      documents: [
        ...baseSnapshot.documents,
        ...Array.from({ length: 257 }, (_, index) => ({
          path: `notes/Added-${index}.md`,
          title: `Added ${index}`,
          source: "",
          tags: [],
        })),
      ],
    };
    rendered.rerender(
      <NoteGraphPanel
        provider={provider}
        snapshot={expandedSnapshot}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(2));

    rendered.rerender(
      <NoteGraphPanel
        provider={provider}
        snapshot={baseSnapshot}
        activePath="notes/Alpha.md"
        indexNoteGraph={indexNoteGraph}
        queryNoteGraph={vi.fn(async () => model)}
        onOpenFile={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await act(async () => {
      finishPartial?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(3));
    expect(indexNoteGraph.mock.calls[2]?.[2]).toMatchObject({
      mode: "replace",
      documents: expect.arrayContaining([
        expect.objectContaining({ path: "notes/Alpha.md" }),
        expect.objectContaining({ path: "notes/Beta.md" }),
      ]),
    });
  });
});

function snapshot(): NoteGraphSnapshot {
  return {
    workspaceKey: "synthetic-vault",
    documents: [
      {
        path: "notes/Alpha.md",
        title: "Alpha",
        source: "# Alpha\n[Beta](Beta.md)",
        tags: ["planning"],
      },
      {
        path: "notes/Beta.md",
        title: "Beta",
        source: "# Beta",
        tags: ["planning"],
      },
    ],
    skippedCount: 0,
    truncated: false,
  };
}
