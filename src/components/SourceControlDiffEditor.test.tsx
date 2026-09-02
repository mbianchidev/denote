import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EditorTab } from "../types";
import { SourceControlDiffEditor } from "./SourceControlDiffEditor";

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => (
    <div data-testid="pierre-diff">{patch}</div>
  ),
}));

describe("SourceControlDiffEditor", () => {
  it("renders the temporary patch with Pierre and preserves hunk actions", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const tab: EditorTab = {
      path: "denote-diff:vault:index:example.staged.diff",
      title: "example.staged.diff",
      kind: "text",
      content: "diff --git a/example.md b/example.md\n",
      savedContent: "diff --git a/example.md b/example.md\n",
      encoding: "utf8",
      lineEnding: "lf",
      placeholder: false,
      groupId: null,
      rawEditing: false,
      readOnly: true,
      editorRevision: 0,
      editRecorded: false,
      saveState: "saved",
      transient: "diff",
      sourceControlDiff: {
        pluginId: "denote.git",
        providerId: "denote.git.repository",
        repositoryId: "vault",
        repositoryLabel: "Synthetic vault",
        repositoryPath: "example.md",
        source: { kind: "index" },
        files: [
          {
            path: "example.md",
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
        ],
      },
    };

    render(
      <SourceControlDiffEditor
        tab={tab}
        theme="dark"
        actionsAvailable
        onAction={onAction}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pierre-diff")).toHaveTextContent("diff --git");
    expect(screen.getByText("Temporary .diff · read-only")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Unstage hunk @@ -1,1 +1,1 @@ in example.md",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "unstage-hunk",
      values: { path: "example.md", hunk: 0 },
    });
  });
});
