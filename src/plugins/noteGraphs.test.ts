import { describe, expect, it } from "vitest";
import type { DocumentBatch, SearchDocument } from "../types";
import {
  createNoteGraphSnapshot,
  noteGraphFolders,
  noteGraphIndexRequest,
  noteGraphTags,
} from "./noteGraphs";

describe("note graph host snapshots", () => {
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
    const snapshot = createNoteGraphSnapshot(
      "vault-one",
      batch,
      "notes/Beta.md",
    );

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
      "Alpha.md",
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
      "Alpha.md",
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(noteGraphIndexRequest(null, first!)).toMatchObject({
      mode: "replace",
      documents: expect.arrayContaining([
        expect.objectContaining({ path: "Alpha.md" }),
        expect.objectContaining({ path: "Beta.md" }),
      ]),
    });
    expect(noteGraphIndexRequest(first, second!)).toEqual({
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
    });
    expect(noteGraphIndexRequest(second, second!)).toBeNull();
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
