import { describe, expect, it, vi } from "vitest";
import {
  MAX_PLUGIN_NOTE_GRAPH_EDGES,
  MAX_PLUGIN_NOTE_GRAPH_NODES,
  type PluginNoteGraphDocument,
  type PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import {
  MAX_RAW_LINKS_PER_NOTE,
  MAX_RESOLVED_LINKS,
  NoteGraphIndex,
  parseNoteGraphDocument,
  type NoteGraphParseDiagnostics,
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
          "[Outer [Inner](Nested Target.md)]",
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
      document("Nested Target.md"),
    ]);

    const model = index.query(globalQuery);

    expect(model.totalNotes).toBe(6);
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

  it("prepares definitions only outside protected Markdown ranges", () => {
    const source = [
      "---",
      "[front]: Front Matter.md",
      "---",
      "`code",
      "[inline]: Inline Note.md",
      "`",
      "```md",
      "[fence]: Fence Note.md",
      "```",
      "    [indented]: Indented Note.md",
      "<div>",
      "[html]: Html Note.md",
      "</div>",
      "",
      "[visible]: Visible Note.md",
      "",
      "[Visible][visible]",
    ].join("\n");
    const diagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };

    const parsed = parseNoteGraphDocument(
      document("Protected definitions.md", source),
      diagnostics,
    );

    expect(parsed.links).toEqual(["Visible Note.md"]);
    expect(diagnostics.definitionEdits).toBe(1);
    expect(diagnostics.definitionScannerCharacters).toBe(source.length);
  });

  it("checks protected and definition ranges with linear work", () => {
    const pairCount = 2_000;
    const halfPairCount = pairCount / 2;
    const protectedSource = (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const suffix = String(index).padStart(4, "0");
        return [
          `\`[protected ${suffix}](Target Note.md)\``,
          `[ref-${suffix}]: [definition ${suffix}](Target Note.md)`,
        ].join("\n");
      }).join("\n");
    const source = protectedSource(pairCount);
    const halfSource = protectedSource(halfPairCount);
    const diagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const halfDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    const halfSourceBytes = new TextEncoder().encode(halfSource).byteLength;

    const parsed = parseNoteGraphDocument(
      document("Protected.md", source),
      diagnostics,
    );
    const halfParsed = parseNoteGraphDocument(
      document("Half protected.md", halfSource),
      halfDiagnostics,
    );

    expect(parsed.links).toEqual([]);
    expect(halfParsed.links).toEqual([]);
    expect(sourceBytes).toBeLessThanOrEqual(256 * 1024);
    expect(halfSourceBytes).toBeLessThanOrEqual(256 * 1024);
    expect(sourceBytes + halfSourceBytes).toBeLessThanOrEqual(512 * 1024);
    expect(diagnostics.rangeComparisons).toBe(pairCount * 7 - 3);
    expect(halfDiagnostics.rangeComparisons).toBe(
      halfPairCount * 7 - 3,
    );
    expect(diagnostics.rangeComparisons).toBe(
      halfDiagnostics.rangeComparisons * 2 + 3,
    );
  });

  it("scans unmatched bracket fallback candidates in linear work", () => {
    const adversarialSource = (size: number) => {
      const tail = "] not a link\n[Valid](Target Note.md)\n";
      return `${"[".repeat(size - tail.length)}${tail}`;
    };
    const source = adversarialSource(192 * 1024);
    const comparisonSource = adversarialSource(16 * 1024);
    const diagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const comparisonDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };

    const parsed = parseNoteGraphDocument(
      document("Adversarial.md", source),
      diagnostics,
    );
    const comparisonParsed = parseNoteGraphDocument(
      document("Comparison adversarial.md", comparisonSource),
      comparisonDiagnostics,
    );

    expect(parsed.links).toEqual(["Target Note.md"]);
    expect(comparisonParsed.links).toEqual(["Target Note.md"]);
    expect(new TextEncoder().encode(source)).toHaveLength(192 * 1024);
    expect(new TextEncoder().encode(comparisonSource)).toHaveLength(
      16 * 1024,
    );
    expect(source.length + comparisonSource.length).toBeLessThanOrEqual(
      512 * 1024,
    );
    expect(diagnostics.inlineScannerCharacters).toBe(source.length + 2);
    expect(comparisonDiagnostics.inlineScannerCharacters).toBe(
      comparisonSource.length + 2,
    );
    expect(diagnostics.inlineScannerCharacters - 2).toBe(
      (comparisonDiagnostics.inlineScannerCharacters - 2) * 12,
    );
  });

  it("normalizes two exact-bound definition documents before parsing", () => {
    const size = 256 * 1024;
    const count = 2_048;
    const definitions = Array.from(
      { length: count },
      (_, index) => `[${index}]:a b\n`,
    ).join("");
    const fixture = {
      count,
      source: `${definitions}${"x".repeat(size - definitions.length)}`,
    };
    const firstDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const secondDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };

    const first = parseNoteGraphDocument(
      document("Dense one.md", fixture.source),
      firstDiagnostics,
    );
    const second = parseNoteGraphDocument(
      document("Dense two.md", fixture.source),
      secondDiagnostics,
    );

    expect(new TextEncoder().encode(fixture.source)).toHaveLength(
      256 * 1024,
    );
    expect(fixture.source.length * 2).toBe(512 * 1024);
    expect(first.links).toEqual([]);
    expect(second.links).toEqual([]);
    expect(firstDiagnostics.definitionScannerCharacters).toBe(
      fixture.source.length,
    );
    expect(secondDiagnostics.definitionScannerCharacters).toBe(
      fixture.source.length,
    );
    expect(firstDiagnostics.definitionEdits).toBe(fixture.count);
    expect(secondDiagnostics.definitionEdits).toBe(fixture.count);
  });

  it("joins dense AST-fallback edit chunks once", () => {
    const editCount = 512;
    const line = "[x](a b)\n";
    const source = `paragraph\n<span>\n${line.repeat(
      editCount,
    )}</span>\n`;
    const diagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const originalJoin = Array.prototype.join;
    let matchingJoins = 0;
    const joinSpy = vi
      .spyOn(Array.prototype, "join")
      .mockImplementation(function (
        this: unknown[],
        separator?: string,
      ) {
        if (separator === "" && this.length === editCount * 2 + 1) {
          matchingJoins += 1;
        }
        return originalJoin.call(this, separator);
      });

    let parsed;
    try {
      parsed = parseNoteGraphDocument(
        document("Dense fallback.md", source),
        diagnostics,
      );
    } finally {
      joinSpy.mockRestore();
    }

    expect(parsed.links).toHaveLength(MAX_RAW_LINKS_PER_NOTE);
    expect(parsed.omittedLinks).toBe(
      editCount - MAX_RAW_LINKS_PER_NOTE,
    );
    expect(matchingJoins).toBe(1);
  });

  it("applies dense inline-link normalization at the exact request bound", () => {
    const line = "[x](a b)\n";
    const size = 256 * 1024;
    const linkCount = 2_048;
    const source = `${line.repeat(linkCount)}${"x".repeat(
      size - linkCount * line.length,
    )}`;
    const firstDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };
    const secondDiagnostics: NoteGraphParseDiagnostics = {
      definitionEdits: 0,
      definitionScannerCharacters: 0,
      inlineScannerCharacters: 0,
      rangeComparisons: 0,
    };

    const first = parseNoteGraphDocument(
      document("Dense inline one.md", source),
      firstDiagnostics,
    );
    const second = parseNoteGraphDocument(
      document("Dense inline two.md", source),
      secondDiagnostics,
    );

    expect(new TextEncoder().encode(source)).toHaveLength(size);
    expect(source.length * 2).toBe(512 * 1024);
    expect(first.links).toHaveLength(MAX_RAW_LINKS_PER_NOTE);
    expect(second.links).toHaveLength(MAX_RAW_LINKS_PER_NOTE);
    expect(new Set(first.links)).toEqual(new Set(["a b"]));
    expect(new Set(second.links)).toEqual(new Set(["a b"]));
    expect(first.omittedLinks).toBe(
      linkCount - MAX_RAW_LINKS_PER_NOTE,
    );
    expect(second.omittedLinks).toBe(
      linkCount - MAX_RAW_LINKS_PER_NOTE,
    );
    expect(firstDiagnostics.inlineScannerCharacters).toBe(
      source.length + linkCount * 2,
    );
    expect(secondDiagnostics.inlineScannerCharacters).toBe(
      source.length + linkCount * 2,
    );
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

  it("describes shared scan omissions as skipped vault files", () => {
    const index = new NoteGraphIndex();
    index.index({
      mode: "replace",
      documents: [document("Available.md")],
      removedPaths: [],
      skippedCount: 2,
      truncated: true,
    });

    expect(index.query(globalQuery).notices).toContain(
      "Denote skipped 2 vault files while preparing the bounded graph input.",
    );
  });

  it("reuses the resolved graph cache until indexed content changes", () => {
    const index = connectedIndex();
    expect(index.resolvedGraphBuildCount).toBe(0);

    index.query(globalQuery);
    index.query({ ...globalQuery, folder: "folder", tag: "team" });
    const local = index.query({
      ...globalQuery,
      scope: "local",
      activePath: "A.md",
      orphanFilter: "connected",
      depth: 3,
    });
    expect(local.nodes.some((node) => node.path === "deep/D.md")).toBe(
      true,
    );
    expect(index.resolvedGraphBuildCount).toBe(1);

    index.index({
      mode: "update",
      documents: [],
      removedPaths: [],
      skippedCount: 1,
      truncated: true,
    });
    index.query(globalQuery);
    expect(index.resolvedGraphBuildCount).toBe(1);

    index.index({
      mode: "update",
      documents: [document("orphan.md", "[A](A.md)", ["Alpha"])],
      removedPaths: [],
      skippedCount: 0,
      truncated: false,
    });
    index.query(globalQuery);
    expect(index.resolvedGraphBuildCount).toBe(2);

    index.index({
      mode: "update",
      documents: [],
      removedPaths: ["missing.md"],
      skippedCount: 0,
      truncated: false,
    });
    index.query(globalQuery);
    expect(index.resolvedGraphBuildCount).toBe(2);

    index.index({
      mode: "update",
      documents: [],
      removedPaths: ["other/F.md"],
      skippedCount: 0,
      truncated: false,
    });
    index.query(globalQuery);
    expect(index.resolvedGraphBuildCount).toBe(3);
  });

  it("caps deterministic vault-wide link analysis at 100,000 occurrences", () => {
    const sourceCount = Math.ceil((MAX_RESOLVED_LINKS + 1) / 128);
    const parser = vi.fn((value: PluginNoteGraphDocument) => ({
      links:
        value.path === "Target.md"
          ? []
          : Array.from({ length: 128 }, () => "Target.md"),
      omittedLinks: 0,
      parseError: false,
    }));
    const index = new NoteGraphIndex(parser);
    replace(index, [
      ...Array.from({ length: sourceCount }, (_, sourceIndex) =>
        document(
          `sources/source-${String(sourceIndex).padStart(4, "0")}.md`,
        ),
      ),
      document("Target.md"),
    ]);

    const first = index.query(globalQuery);
    const second = index.query({ ...globalQuery, folder: "sources" });

    expect(first.totalEdges).toBe(sourceCount);
    expect(first.truncated).toBe(true);
    expect(first.notices).toContain(
      "The graph omitted 96 local link occurrences after the deterministic 100,000-link analysis budget.",
    );
    expect(second.totalEdges).toBe(sourceCount);
    expect(index.resolvedGraphBuildCount).toBe(1);
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
