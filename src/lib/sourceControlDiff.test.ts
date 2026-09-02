import { describe, expect, it } from "vitest";
import type { PluginSourceControlDiffFile } from "@denote/plugin-sdk";
import { sourceControlPatch, sourceControlDiffTitle } from "./sourceControlDiff";

describe("sourceControlDiff", () => {
  it("serializes a structured Git diff as one temporary .diff document", () => {
    const files: PluginSourceControlDiffFile[] = [
      {
        path: "notes/example.md",
        previousPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
        binary: false,
        hunks: [
          {
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              {
                kind: "deletion",
                oldLineNumber: 1,
                newLineNumber: null,
                content: "old",
              },
              {
                kind: "addition",
                oldLineNumber: null,
                newLineNumber: 1,
                content: "new",
              },
            ],
          },
        ],
      },
    ];

    expect(sourceControlDiffTitle("notes/example.md", "index")).toBe(
      "example.staged.diff",
    );
    expect(sourceControlPatch(files)).toBe(
      [
        "diff --git a/notes/example.md b/notes/example.md",
        "--- a/notes/example.md",
        "+++ b/notes/example.md",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    );
  });
});
