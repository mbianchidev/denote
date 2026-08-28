import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  it("identifies pinned entries", () => {
    render(
      <FileTree
        nodes={[
          {
            path: "projects",
            name: "projects",
            kind: "folder",
            children: [],
            size: 0,
            modifiedAt: null,
            bookmarked: false,
            pinned: true,
          },
        ]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });
});
