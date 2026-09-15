import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES,
  isPluginNoteGraphIndexRequest,
  isPluginNoteGraphModel,
  isPluginNoteGraphQuery,
  isPluginNoteGraphRegistration,
} from "./noteGraph";

describe("note graph contract", () => {
  it("accepts a bounded registration and index delta", () => {
    expect(
      isPluginNoteGraphRegistration({
        id: "denote.note-graph.graph",
        title: "Note graph",
      }),
    ).toBe(true);
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "update",
        documents: [
          {
            path: "notes/Alpha.md",
            title: "Alpha",
            source: "[Beta](Beta.md)",
            tags: ["planning"],
          },
        ],
        removedPaths: ["notes/Removed.md"],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(true);
  });

  it("rejects duplicate paths, traversal, and oversized source", () => {
    const document = {
      path: "Alpha.md",
      title: "Alpha",
      source: "",
      tags: [],
    };
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "replace",
        documents: [document, document],
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "replace",
        documents: [{ ...document, path: "../Alpha.md" }],
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "replace",
        documents: [
          {
            ...document,
            source: "x".repeat(MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES + 1),
          },
        ],
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "update",
        documents: Array.from({ length: 257 }, (_, index) => ({
          ...document,
          path: `${index}.md`,
        })),
        removedPaths: [],
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
    expect(
      isPluginNoteGraphIndexRequest({
        mode: "update",
        documents: [],
        removedPaths: Array.from(
          { length: 513 },
          (_, index) => `${index}.md`,
        ),
        skippedCount: 0,
        truncated: false,
      }),
    ).toBe(false);
  });

  it("accepts only the closed graph query choices", () => {
    const query = {
      scope: "local",
      activePath: "Alpha.md",
      folder: null,
      tag: "planning",
      orphanFilter: "connected",
      depth: 2,
    };
    expect(isPluginNoteGraphQuery(query)).toBe(true);
    expect(isPluginNoteGraphQuery({ ...query, depth: "2" })).toBe(false);
    expect(
      isPluginNoteGraphQuery({ ...query, activePath: "/Alpha.md" }),
    ).toBe(false);
  });

  it("requires internally consistent nodes and edges", () => {
    const model = {
      nodes: [
        {
          id: "Alpha.md",
          path: "Alpha.md",
          title: "Alpha",
          tags: [],
          incoming: 0,
          outgoing: 1,
          orphan: false,
          distance: 0,
        },
        {
          id: "Beta.md",
          path: "Beta.md",
          title: "Beta",
          tags: ["planning"],
          incoming: 1,
          outgoing: 0,
          orphan: false,
          distance: 1,
        },
      ],
      edges: [{ sourceId: "Alpha.md", targetId: "Beta.md" }],
      totalNotes: 2,
      matchingNotes: 2,
      totalEdges: 1,
      activeNodeId: "Alpha.md",
      truncated: false,
      notices: [],
    };
    expect(isPluginNoteGraphModel(model)).toBe(true);
    expect(
      isPluginNoteGraphModel({
        ...model,
        edges: [{ sourceId: "Alpha.md", targetId: "Missing.md" }],
      }),
    ).toBe(false);
    expect(
      isPluginNoteGraphModel({
        ...model,
        nodes: [{ ...model.nodes[0], orphan: true }, model.nodes[1]],
      }),
    ).toBe(false);
  });
});
