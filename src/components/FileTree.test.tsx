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
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
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
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
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
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
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
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
      />,
    );
    const tree = screen.getByLabelText("Vault files");
    tree.focus();

    fireEvent.keyDown(tree, { key: "F10", shiftKey: true });
    await user.click(await screen.findByRole("menuitem", { name: "New file" }));

    expect(onCreate).toHaveBeenCalledWith("", false);
  });

  it("offers rename, move, and delete actions for an entry", async () => {
    const user = userEvent.setup();
    const node = {
      path: "note.md",
      name: "note.md",
      kind: "markdown" as const,
      children: [],
      size: 4,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onRequestMove = vi.fn();
    const props = {
      nodes: [node],
      selectedPath: null,
      expandedPaths: new Set<string>(),
      onSelect: vi.fn(),
      onToggleFolder: vi.fn(),
      onCreate: vi.fn(),
      onRename,
      onDelete,
      onMove: vi.fn(),
      onRequestMove,
    };
    const { rerender } = render(<FileTree {...props} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /note\.md/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledWith(node);

    rerender(<FileTree {...props} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /note\.md/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Move to folder…" }),
    );
    expect(onRequestMove).toHaveBeenCalledWith(node);

    rerender(<FileTree {...props} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /note\.md/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete" }),
    );
    expect(onDelete).toHaveBeenCalledWith(node);
  });

  it("moves an entry by dragging it onto a folder", () => {
    const onMove = vi.fn();
    const nodes = [
      {
        path: "note.md",
        name: "note.md",
        kind: "markdown" as const,
        children: [],
        size: 4,
        modifiedAt: null,
        bookmarked: false,
        pinned: false,
      },
      {
        path: "archive",
        name: "archive",
        kind: "folder" as const,
        children: [],
        size: 0,
        modifiedAt: null,
        bookmarked: false,
        pinned: false,
      },
    ];
    render(
      <FileTree
        nodes={nodes}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={onMove}
        onRequestMove={vi.fn()}
      />,
    );
    const source = screen.getByRole("button", { name: /note\.md/i });
    const target = screen.getByRole("button", { name: /archive/i });
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    fireEvent.pointerDown(source, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 2,
    });
    fireEvent.pointerMove(source, {
      clientX: 30,
      clientY: 30,
      pointerId: 2,
    });
    fireEvent.pointerUp(source, {
      clientX: 30,
      clientY: 30,
      pointerId: 2,
    });

    expect(onMove).toHaveBeenCalledWith(nodes[0], "archive");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  it("does not treat a file row or touch scrolling as a root drop target", () => {
    const onMove = vi.fn();
    const node = {
      path: "folder/note.md",
      name: "note.md",
      kind: "markdown" as const,
      children: [],
      size: 4,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    render(
      <FileTree
        nodes={[node]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={onMove}
        onRequestMove={vi.fn()}
      />,
    );
    const source = screen.getByRole("button", { name: /note\.md/i });
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => source),
    });

    fireEvent.pointerDown(source, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 3,
    });
    fireEvent.pointerMove(source, {
      clientX: 30,
      clientY: 30,
      pointerId: 3,
    });
    fireEvent.pointerUp(source, {
      clientX: 30,
      clientY: 30,
      pointerId: 3,
    });
    fireEvent.pointerDown(source, {
      button: 0,
      pointerId: 4,
      pointerType: "touch",
    });
    fireEvent.pointerMove(source, {
      clientX: 40,
      clientY: 40,
      pointerId: 4,
      pointerType: "touch",
    });
    fireEvent.pointerUp(source, {
      clientX: 40,
      clientY: 40,
      pointerId: 4,
      pointerType: "touch",
    });

    expect(onMove).not.toHaveBeenCalled();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });
});
