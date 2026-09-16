import { describe, expect, it, vi } from "vitest";
import type {
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import { NoteGraphCoordinator } from "./noteGraphCoordinator";
import type { NoteGraphSnapshot } from "./noteGraphs";

const provider = {
  pluginId: "denote.note-graph",
  id: "denote.note-graph.graph",
  title: "Note graph",
};
const query: PluginNoteGraphQuery = {
  scope: "global",
  activePath: null,
  folder: null,
  tag: null,
  orphanFilter: "all",
  depth: 2,
};
const model: PluginNoteGraphModel = {
  nodes: [],
  edges: [],
  totalNotes: 0,
  matchingNotes: 0,
  totalEdges: 0,
  activeNodeId: null,
  truncated: false,
  notices: [],
};

describe("NoteGraphCoordinator", () => {
  it("shares one completed index across concurrent panel mounts", async () => {
    const coordinator = new NoteGraphCoordinator();
    let finishIndex: (() => void) | undefined;
    const indexNoteGraph = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishIndex = resolve;
        }),
    );
    const queryNoteGraph = vi.fn(async () => model);
    const snapshot = graphSnapshot("Alpha");

    const first = coordinator.run(
      provider,
      snapshot,
      query,
      indexNoteGraph,
      queryNoteGraph,
    );
    const second = coordinator.run(
      provider,
      snapshot,
      query,
      indexNoteGraph,
      queryNoteGraph,
    );
    await vi.waitFor(() => expect(indexNoteGraph).toHaveBeenCalledOnce());
    finishIndex?.();

    await expect(first).resolves.toMatchObject({ indexMode: "replace" });
    await expect(second).resolves.toMatchObject({ indexMode: null });
    expect(indexNoteGraph).toHaveBeenCalledOnce();
    expect(queryNoteGraph).toHaveBeenCalledTimes(2);
  });

  it("serializes later snapshots as incremental updates", async () => {
    const coordinator = new NoteGraphCoordinator();
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {},
    );
    const queryNoteGraph = vi.fn(async () => model);
    await coordinator.run(
      provider,
      graphSnapshot("Alpha"),
      query,
      indexNoteGraph,
      queryNoteGraph,
    );
    await coordinator.run(
      provider,
      graphSnapshot("Beta"),
      query,
      indexNoteGraph,
      queryNoteGraph,
    );

    expect(
      indexNoteGraph.mock.calls.map((call) => call[2].mode),
    ).toEqual(["replace", "update"]);
  });

  it("recovers an uncertain partial index with a full replacement", async () => {
    const coordinator = new NoteGraphCoordinator();
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {},
    );
    indexNoteGraph
      .mockRejectedValueOnce(new Error("Synthetic timeout"))
      .mockResolvedValue(undefined);

    await expect(
      coordinator.run(
        provider,
        graphSnapshot("Alpha"),
        query,
        indexNoteGraph,
        vi.fn(async () => model),
      ),
    ).resolves.toMatchObject({ indexMode: "replace" });
    expect(
      indexNoteGraph.mock.calls.map((call) => call[2].mode),
    ).toEqual(["replace", "replace"]);
  });

  it("invalidates retained snapshots when a provider disappears", async () => {
    const coordinator = new NoteGraphCoordinator();
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {},
    );
    await coordinator.run(
      provider,
      graphSnapshot("Alpha"),
      query,
      indexNoteGraph,
      vi.fn(async () => model),
    );
    coordinator.retainProviders(new Set());
    await coordinator.run(
      provider,
      graphSnapshot("Alpha"),
      query,
      indexNoteGraph,
      vi.fn(async () => model),
    );

    expect(
      indexNoteGraph.mock.calls.map((call) => call[2].mode),
    ).toEqual(["replace", "replace"]);
  });

  it("serializes workspace generations on one provider queue", async () => {
    const coordinator = new NoteGraphCoordinator();
    let finishOldRequest: (() => void) | undefined;
    const indexNoteGraph = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        _request: PluginNoteGraphIndexRequest,
      ) => {
        if (indexNoteGraph.mock.calls.length === 1) {
          await new Promise<void>((resolve) => {
            finishOldRequest = resolve;
          });
        }
      },
    );
    const oldRun = coordinator.run(
      provider,
      largeGraphSnapshot("vault-generation-1"),
      query,
      indexNoteGraph,
      vi.fn(async () => model),
    );
    await vi.waitFor(() => expect(indexNoteGraph).toHaveBeenCalledTimes(1));
    const newRun = coordinator.run(
      provider,
      largeGraphSnapshot("vault-generation-2"),
      query,
      indexNoteGraph,
      vi.fn(async () => model),
    );
    finishOldRequest?.();

    await expect(oldRun).rejects.toThrow(/changed while indexing/i);
    await expect(newRun).resolves.toMatchObject({ indexMode: "replace" });
    expect(
      indexNoteGraph.mock.calls.map((call) => call[2].mode),
    ).toEqual(["replace", "replace", "update"]);
  });
});

function graphSnapshot(title: string): NoteGraphSnapshot {
  return {
    workspaceKey: "synthetic-vault",
    documents: [
      {
        path: "Alpha.md",
        title,
        source: `# ${title}`,
        tags: [],
      },
    ],
    skippedCount: 0,
    truncated: false,
  };
}

function largeGraphSnapshot(workspaceKey: string): NoteGraphSnapshot {
  return {
    workspaceKey,
    documents: Array.from({ length: 257 }, (_, index) => ({
      path: `${index}.md`,
      title: `Note ${index}`,
      source: "",
      tags: [],
    })),
    skippedCount: 0,
    truncated: false,
  };
}
