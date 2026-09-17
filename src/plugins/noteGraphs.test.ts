import { describe, expect, it } from "vitest";
import type { DocumentBatch, EditorTab, SearchDocument } from "../types";
import {
  createNoteGraphSnapshot,
  noteGraphFolders,
  noteGraphIndexRequests,
  noteGraphTabPath,
  rekeyNoteGraphTab,
  noteGraphTags,
} from "./noteGraphs";

describe("note graph host snapshots", () => {
  it("uses a stable non-vault path for a provider graph tab", () => {
    expect(
      noteGraphTabPath("denote.note-graph", "denote.note-graph.graph"),
    ).toBe(
      "denote-note-graph:denote.note-graph:denote.note-graph.graph",
    );
  });

  it("rekeys only a graph tab's Local note anchor", () => {
    const graphTab: EditorTab = {
      ...tab("denote-note-graph:denote.note-graph:denote.note-graph.graph"),
      title: "Note graph",
      transient: "note-graph",
      noteGraph: {
        pluginId: "denote.note-graph",
        providerId: "denote.note-graph.graph",
        notePath: "projects/Alpha.md",
      },
    };
    const rekeyed = rekeyNoteGraphTab(graphTab, (path) =>
      path.replace(/^projects\//, "archive/"),
    );

    expect(rekeyed).toMatchObject({
      path: graphTab.path,
      title: "Note graph",
      noteGraph: { notePath: "archive/Alpha.md" },
    });
  });

  it("keeps Markdown only and prioritizes the active note", () => {
    const batch: DocumentBatch = {
      documents: [
        document("notes/Alpha.md", "# Alpha"),
        document("notes/Beta.md", "# Beta"),
        document("notes/data.json", '{"value":1}', "text"),
      ],
      skippedCount: 1,
      truncated: false,
    };
    const snapshot = createNoteGraphSnapshot("vault-one", batch, [
      "notes/Beta.md",
      "notes/Alpha.md",
    ]);

    expect(snapshot).toEqual({
      workspaceKey: "vault-one",
      documents: [
        {
          path: "notes/Beta.md",
          title: "Beta",
          source: "# Beta",
          tags: [],
        },
        {
          path: "notes/Alpha.md",
          title: "Alpha",
          source: "# Alpha",
          tags: [],
        },
      ],
      skippedCount: 1,
      truncated: false,
    });
  });

  it("keeps every live graph anchor ahead of the snapshot note limit", () => {
    const documents = Array.from({ length: 5_001 }, (_, index) =>
      document(`${index}.md`, `# Note ${index}`),
    );
    const snapshot = createNoteGraphSnapshot(
      "vault-one",
      {
        documents,
        skippedCount: 0,
        truncated: false,
      },
      ["5000.md", "4999.md"],
    );

    expect(snapshot?.documents).toHaveLength(5_000);
    expect(snapshot?.documents.slice(0, 2).map(({ path }) => path)).toEqual([
      "5000.md",
      "4999.md",
    ]);
    expect(snapshot?.truncated).toBe(true);
  });

  it("produces a replace followed by changed and removed deltas", () => {
    const first = createNoteGraphSnapshot(
      "vault-one",
      {
        documents: [
          document("Alpha.md", "# Alpha"),
          document("Beta.md", "# Beta"),
        ],
        skippedCount: 0,
        truncated: false,
      },
      ["Alpha.md"],
    );
    const second = createNoteGraphSnapshot(
      "vault-one",
      {
        documents: [
          document("Alpha.md", "# Alpha updated"),
          document("Gamma.md", "# Gamma"),
        ],
        skippedCount: 0,
        truncated: false,
      },
      ["Alpha.md"],
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(noteGraphIndexRequests(null, first!)[0]).toMatchObject({
      mode: "replace",
      documents: expect.arrayContaining([
        expect.objectContaining({ path: "Alpha.md" }),
        expect.objectContaining({ path: "Beta.md" }),
      ]),
    });
    expect(noteGraphIndexRequests(first, second!)).toEqual([
      {
        mode: "update",
        documents: [
          {
            path: "Alpha.md",
            title: "Alpha updated",
            source: "# Alpha updated",
            tags: [],
          },
          {
            path: "Gamma.md",
            title: "Gamma",
            source: "# Gamma",
            tags: [],
          },
        ],
        removedPaths: ["Beta.md"],
        skippedCount: 0,
        truncated: false,
      },
    ]);
    expect(noteGraphIndexRequests(second, second!)).toEqual([]);
  });

  it("splits a full snapshot into bounded ordered index requests", () => {
    const source = "x".repeat(200_000);
    const requests = noteGraphIndexRequests(null, {
      workspaceKey: "vault-one",
      documents: ["Alpha", "Beta", "Gamma"].map((title) => ({
        path: `${title}.md`,
        title,
        source,
        tags: [],
      })),
      skippedCount: 0,
      truncated: false,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      mode: "replace",
      documents: [
        expect.objectContaining({ path: "Alpha.md" }),
        expect.objectContaining({ path: "Beta.md" }),
      ],
    });
    expect(requests[1]).toMatchObject({
      mode: "update",
      documents: [expect.objectContaining({ path: "Gamma.md" })],
      removedPaths: [],
    });
  });

  it("splits large removal sets without reparsing documents", () => {
    const previous = {
      workspaceKey: "vault-one",
      documents: Array.from({ length: 600 }, (_, index) => ({
        path: `${index}.md`,
        title: String(index),
        source: "",
        tags: [],
      })),
      skippedCount: 0,
      truncated: false,
    };
    const requests = noteGraphIndexRequests(previous, {
      ...previous,
      documents: [],
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      mode: "update",
      documents: [],
    });
    expect(requests[0].removedPaths).toHaveLength(512);
    expect(requests[1].removedPaths).toHaveLength(88);
  });

  it("builds bounded folder and tag filter choices", () => {
    const documents = [
      {
        path: "Root.md",
        title: "Root",
        source: "",
        tags: ["guide"],
      },
      {
        path: "projects/alpha/Plan.md",
        title: "Plan",
        source: "",
        tags: ["guide", "planning"],
      },
    ];

    expect(noteGraphFolders(documents)).toEqual([
      "",
      "projects",
      "projects/alpha",
    ]);
    expect(noteGraphTags(documents)).toEqual(["guide", "planning"]);
  });
});

function document(
  path: string,
  content: string,
  kind: SearchDocument["kind"] = "markdown",
): SearchDocument {
  return {
    path,
    title:
      content
        .split("\n")
        .find((line) => line.startsWith("# "))
        ?.slice(2) ?? path,
    content,
    contentHash: `hash-${path}-${content.length}`,
    encoding: "utf8",
    lineEnding: "lf",
    tags: [],
    kind,
    bookmarked: false,
    lastOpenedAt: null,
  };
}

function tab(path: string): EditorTab {
  return {
    path,
    title: path,
    kind: "text",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    placeholder: false,
    groupId: null,
    rawEditing: false,
    readOnly: true,
    editorRevision: 0,
    editRecorded: false,
    saveState: "saved",
  };
}
