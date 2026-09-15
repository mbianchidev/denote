import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    await screen.findByRole("status");

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
