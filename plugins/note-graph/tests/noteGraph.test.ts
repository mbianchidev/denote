import { describe, expect, it, vi } from "vitest";
import {
  MAX_PLUGIN_NOTE_GRAPH_EDGES,
  MAX_PLUGIN_NOTE_GRAPH_NODES,
  type PluginNoteGraphDocument,
  type PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import {
  MAX_RAW_LINKS_PER_NOTE,
  NoteGraphIndex,
  parseNoteGraphDocument,
} from "../src/noteGraph";

const globalQuery: PluginNoteGraphQuery = {
  scope: "global",
  activePath: null,
  folder: null,
  tag: null,
  orphanFilter: "all",
  depth: 2,
};

function document(
  path: string,
  source = "",
  tags: string[] = [],
): PluginNoteGraphDocument {
  return {
    path,
    title: path.split("/").pop()?.replace(/\.(?:md|markdown)$/i, "") ?? path,
    source,
    tags,
  };
}

function replace(
  index: NoteGraphIndex,
  documents: PluginNoteGraphDocument[],
): void {
  index.index({
    mode: "replace",
    documents,
    removedPaths: [],
    skippedCount: 0,
    truncated: false,
  });
}

function edgePaths(index: NoteGraphIndex): string[] {
  return index
    .query(globalQuery)
    .edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    .sort();
}

describe("Note graph indexing", () => {
  it("resolves relative, root, percent-encoded, legacy, and reference links", () => {
    const index = new NoteGraphIndex();
    replace(index, [
      document(
        "docs/Start.md",
        [
          "[Relative](../Target.md)",
          "[Root](/Root.markdown)",
          "[Encoded](../Encoded%20%23%20Note.md)",
          "[Legacy](Legacy Note)",
          "[Case fold](../case target)",
          "[Full][guide]",
          "[Collapsed][]",
          "[Shortcut]",
          "[Legacy reference][spaced]",
          "[Again](../Target.md)",
          "",
          "[guide]: ../Reference.md",
          "[guide]: ../Ignored.md",
          "[Collapsed]: ../Collapsed.markdown",
          "[Shortcut]: ../Shortcut.md",
          "[spaced]: ../Reference Note.md",
        ].join("\n"),
      ),
      document("Target.md"),
      document("Root.markdown"),
      document("Encoded # Note.md"),
      document("docs/Legacy Note.md"),
      document("Case Target.markdown"),
      document("Reference.md"),
      document("Reference Note.md"),
      document("Collapsed.markdown"),
      document("Shortcut.md"),
      document("Ignored.md"),
    ]);

    expect(edgePaths(index)).toEqual([
      "docs/Start.md->Case Target.markdown",
      "docs/Start.md->Collapsed.markdown",
      "docs/Start.md->Encoded # Note.md",
      "docs/Start.md->Reference Note.md",
      "docs/Start.md->Reference.md",
      "docs/Start.md->Root.markdown",
      "docs/Start.md->Shortcut.md",
      "docs/Start.md->Target.md",
      "docs/Start.md->docs/Legacy Note.md",
    ]);
  });

  it("ignores ambiguous, external, self, image, protected, and malformed targets", () => {
    const index = new NoteGraphIndex();
    replace(index, [
      document(
        "Start.md",
        [
          "---",
          "related: [Frontmatter](Safe.md)",
          "---",
          "[Exact](Foo.md)",
          "[Ambiguous](FOO.md)",
          "[Self](Start)",
          "[External](https://example.test/Safe.md)",
          "[Mail](mailto:person@example.test)",
          "[Protocol relative](//example.test/Safe.md)",
          "[Fragment](#section)",
          "[Malformed](Bad%ZZ.md)",
          "[Escape](../Outside.md)",
          "![Image](Safe.md)",
          "`[Inline code](Safe Note.md)`",
          "<!-- [HTML](Safe Note.md) -->",
          "```md",
          "[Code block](Safe Note.md)",
          "```",
          "[Unfinished](Safe.md",
          "[Safe](Safe.md)",
        ].join("\n"),
      ),
      document("Foo.md"),
      document("foo.md"),
      document("Safe.md"),
      document("Safe Note.md"),
    ]);

    const model = index.query(globalQuery);

    expect(model.totalNotes).toBe(5);
    expect(edgePaths(index)).toEqual([
      "Start.md->Foo.md",
      "Start.md->Safe.md",
    ]);
    expect(model.notices).toEqual([]);
  });

  it("keeps malformed parser failures bounded and indexes note metadata", () => {
    const parser = vi.fn((value: PluginNoteGraphDocument) => {
      if (value.path === "Broken.md") {
        throw new Error("synthetic parser failure");
      }
      return parseNoteGraphDocument(value);
    });
    const index = new NoteGraphIndex(parser);
    replace(index, [
      document("Broken.md", "[broken"),
      document("Good.md", "[Broken](Broken.md)"),
    ]);

    const model = index.query(globalQuery);

    expect(model.nodes.map((node) => node.path).sort()).toEqual([
      "Broken.md",
      "Good.md",
    ]);
    expect(model.totalEdges).toBe(1);
    expect(model.notices).toEqual([
      "Broken.md could not be parsed; its note metadata remains indexed without links.",
    ]);
  });

  it("re-resolves unchanged notes after incremental additions and removals", () => {
    const parser = vi.fn(parseNoteGraphDocument);
    const index = new NoteGraphIndex(parser);
    replace(index, [
      document("Start.md", "[Future](Future.md)\n[Stable](Stable.md)"),
      document("Stable.md"),
    ]);
    expect(parser).toHaveBeenCalledTimes(2);
    expect(edgePaths(index)).toEqual(["Start.md->Stable.md"]);

    index.index({
      mode: "update",
      documents: [document("Future.md")],
      removedPaths: [],
      skippedCount: 0,
      truncated: false,
    });

    expect(parser).toHaveBeenCalledTimes(3);
    expect(parser.mock.calls.map(([value]) => value.path)).toEqual([
      "Start.md",
      "Stable.md",
      "Future.md",
    ]);
    expect(edgePaths(index)).toEqual([
      "Start.md->Future.md",
      "Start.md->Stable.md",
    ]);

    index.index({
      mode: "update",
      documents: [],
      removedPaths: ["Future.md"],
      skippedCount: 0,
      truncated: false,
    });

    expect(parser).toHaveBeenCalledTimes(3);
    expect(edgePaths(index)).toEqual(["Start.md->Stable.md"]);
  });
});

describe("Note graph queries", () => {
  function connectedIndex(): NoteGraphIndex {
    const index = new NoteGraphIndex();
    replace(index, [
      document("A.md", "[B](folder/B.md)", ["Alpha"]),
      document("folder/B.md", "[C](C.md)", ["Team"]),
      document("folder/C.md", "[D](/deep/D.md)", ["team"]),
      document("deep/D.md", "", ["Deep"]),
      document("orphan.md", "", ["Alpha"]),
      document("other/F.md", "[B](../folder/B.md)", ["Other"]),
    ]);
    return index;
  }

  it("computes full-graph degrees, global ranking, folders, tags, and orphans", () => {
    const index = connectedIndex();

    const global = index.query(globalQuery);
    const folder = index.query({ ...globalQuery, folder: "folder" });
    const root = index.query({ ...globalQuery, folder: "" });
    const tag = index.query({ ...globalQuery, tag: "#TEAM" });
    const orphans = index.query({
      ...globalQuery,
      orphanFilter: "only",
    });

    expect(global.nodes[0]).toMatchObject({
      path: "folder/B.md",
      incoming: 2,
      outgoing: 1,
      orphan: false,
      distance: null,
    });
    expect(folder.nodes.map((node) => node.path)).toEqual([
      "folder/B.md",
      "folder/C.md",
    ]);
    expect(root.nodes.map((node) => node.path).sort()).toEqual([
      "A.md",
      "orphan.md",
    ]);
    expect(tag.nodes.map((node) => node.path)).toEqual([
      "folder/B.md",
      "folder/C.md",
    ]);
    expect(orphans.nodes.map((node) => node.path)).toEqual([
      "orphan.md",
    ]);
  });

  it("uses undirected local breadth-first distance before applying filters", () => {
    const index = connectedIndex();
    const depthOne = index.query({
      ...globalQuery,
      scope: "local",
      activePath: "A.md",
      depth: 1,
    });
    const depthTwo = index.query({
      ...globalQuery,
      scope: "local",
      activePath: "A.md",
      depth: 2,
    });
    const depthThreeFolder = index.query({
      ...globalQuery,
      scope: "local",
      activePath: "A.md",
      folder: "deep",
      depth: 3,
    });

    expect(
      depthOne.nodes.map((node) => [node.path, node.distance]),
    ).toEqual([
      ["A.md", 0],
      ["folder/B.md", 1],
    ]);
    expect(
      depthTwo.nodes.map((node) => [node.path, node.distance]),
    ).toEqual([
      ["A.md", 0],
      ["folder/B.md", 1],
      ["folder/C.md", 2],
      ["other/F.md", 2],
    ]);
    expect(
      depthThreeFolder.nodes.map((node) => [node.path, node.distance]),
    ).toEqual([["deep/D.md", 3]]);
    expect(depthThreeFolder.activeNodeId).toBeNull();
  });

  it("bounds raw links, rendered nodes, and rendered edges with notices", () => {
    const rawIndex = new NoteGraphIndex();
    const rawTargets = Array.from(
      { length: MAX_RAW_LINKS_PER_NOTE + 1 },
      (_, index) => document(`target-${index}.md`),
    );
    replace(rawIndex, [
      document(
        "source.md",
        rawTargets
          .map((target) => `[${target.title}](${target.path})`)
          .join("\n"),
      ),
      ...rawTargets,
    ]);
    const rawModel = rawIndex.query(globalQuery);
    expect(rawModel.totalEdges).toBe(MAX_RAW_LINKS_PER_NOTE);
    expect(rawModel.truncated).toBe(true);
    expect(rawModel.notices).toContain(
      `source.md omitted 1 link after the ${MAX_RAW_LINKS_PER_NOTE}-link per-note bound.`,
    );

    const nodeIndex = new NoteGraphIndex();
    replace(
      nodeIndex,
      Array.from(
        { length: MAX_PLUGIN_NOTE_GRAPH_NODES + 1 },
        (_, index) => document(`note-${String(index).padStart(3, "0")}.md`),
      ),
    );
    const nodeModel = nodeIndex.query(globalQuery);
    expect(nodeModel.matchingNotes).toBe(MAX_PLUGIN_NOTE_GRAPH_NODES + 1);
    expect(nodeModel.nodes).toHaveLength(MAX_PLUGIN_NOTE_GRAPH_NODES);
    expect(nodeModel.truncated).toBe(true);

    const edgeIndex = new NoteGraphIndex();
    const targets = Array.from({ length: 50 }, (_, index) =>
      document(`targets/target-${index}.md`),
    );
    const sources = Array.from({ length: 50 }, (_, sourceIndex) =>
      document(
        `sources/source-${sourceIndex}.md`,
        targets
          .map(
            (target, targetIndex) =>
              `[Target ${targetIndex}](../${target.path})`,
          )
          .join("\n"),
      ),
    );
    replace(edgeIndex, [...sources, ...targets]);
    const edgeModel = edgeIndex.query(globalQuery);
    expect(edgeModel.totalEdges).toBe(2_500);
    expect(edgeModel.edges).toHaveLength(MAX_PLUGIN_NOTE_GRAPH_EDGES);
    expect(edgeModel.truncated).toBe(true);
    expect(edgeModel.notices).toContain(
      `Only the first ${MAX_PLUGIN_NOTE_GRAPH_EDGES} connections between shown notes are rendered.`,
    );
  });
});
