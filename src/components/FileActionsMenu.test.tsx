import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileNode } from "../types";
import {
  FileActionsDropdown,
  type FileActionHandlers,
} from "./FileActionsMenu";

function file(path: string): FileNode {
  return {
    path,
    name: path.split("/").slice(-1)[0] ?? path,
    kind: "markdown",
    children: [],
    size: 8,
    modifiedAt: null,
    bookmarked: false,
    pinned: false,
  };
}

function handlers(): FileActionHandlers {
  return {
    onDuplicate: vi.fn(),
    onBookmark: vi.fn(),
    onCopyPath: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onReveal: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("FileActionsDropdown", () => {
  it("closes when the focused file changes", async () => {
    const { rerender } = render(
      <FileActionsDropdown
        node={file("first.md")}
        disabled={false}
        handlers={handlers()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More file actions" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    rerender(
      <FileActionsDropdown
        node={file("second.md")}
        disabled={false}
        handlers={handlers()}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("returns focus to its trigger after Escape", async () => {
    render(
      <FileActionsDropdown
        node={file("note.md")}
        disabled={false}
        handlers={handlers()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More file actions" });

    fireEvent.click(trigger);
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
