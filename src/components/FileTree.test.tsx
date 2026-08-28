import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });

  it("creates files and folders from a folder context menu", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
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
            pinned: false,
          },
        ]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={onCreate}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /projects/i }), {
      clientX: 40,
      clientY: 80,
    });
    await user.click(await screen.findByRole("menuitem", { name: "New file" }));
    expect(onCreate).toHaveBeenCalledWith("projects", false);

    fireEvent.contextMenu(screen.getByRole("button", { name: /projects/i }));
    await user.click(await screen.findByRole("menuitem", { name: "New folder" }));
    expect(onCreate).toHaveBeenCalledWith("projects", true);
  });

  it("returns focus to the tree row when its context menu is dismissed", async () => {
    const user = userEvent.setup();
    render(
      <FileTree
        nodes={[
          {
            path: "notes",
            name: "notes",
            kind: "folder",
            children: [],
            size: 0,
            modifiedAt: null,
            bookmarked: false,
            pinned: false,
          },
        ]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const row = screen.getByRole("button", { name: /notes/i });

    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(row).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the root creation menu from the keyboard in an empty vault", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <FileTree
        nodes={[]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const tree = screen.getByLabelText("Vault files");
    tree.focus();

    fireEvent.keyDown(tree, { key: "F10", shiftKey: true });
    await user.click(await screen.findByRole("menuitem", { name: "New file" }));

    expect(onCreate).toHaveBeenCalledWith("", false);
  });
});
