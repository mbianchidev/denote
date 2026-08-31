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

  it("independently toggles project and workspace roots without offering file toggles", async () => {
    const user = userEvent.setup();
    const onMarkProject = vi.fn();
    const onUnmarkProject = vi.fn();
    const onMarkWorkspace = vi.fn();
    const onUnmarkWorkspace = vi.fn();
    const folder = {
      path: "code",
      name: "code",
      kind: "folder" as const,
      children: [],
      size: 0,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const file = {
      path: "note.md",
      name: "note.md",
      kind: "markdown" as const,
      children: [],
      size: 4,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const vaultRoot = {
      id: "vault",
      rootPath: "",
      available: true,
      explicit: true,
      workspaceId: null,
    };
    const vaultWorkspace = {
      id: "vault-workspace",
      rootPath: "",
      available: true,
    };
    const props = {
      nodes: [folder, file],
      selectedPath: null,
      expandedPaths: new Set<string>(),
      onSelect: vi.fn(),
      onToggleFolder: vi.fn(),
      onCreate: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onRequestMove: vi.fn(),
      projectRoots: [vaultRoot],
      projectWorkspaces: [] as {
        id: string;
        rootPath: string;
        available: boolean;
      }[],
      onMarkProject,
      onUnmarkProject,
      onMarkWorkspace,
      onUnmarkWorkspace,
    };
    const { rerender } = render(<FileTree {...props} />);

    const folderRow = screen.getByRole("button", { name: /code/i });
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: "F10", shiftKey: true });
    await user.click(
      await screen.findByRole("menuitem", { name: "Mark as project" }),
    );
    expect(onMarkProject).toHaveBeenCalledWith("code");
    expect(folderRow).toHaveFocus();

    fireEvent.keyDown(folderRow, { key: "ContextMenu" });
    await user.click(
      await screen.findByRole("menuitem", { name: "Mark as workspace" }),
    );
    expect(onMarkWorkspace).toHaveBeenCalledWith("code");
    expect(folderRow).toHaveFocus();

    rerender(
      <FileTree
        {...props}
        projectRoots={[
          vaultRoot,
          {
            id: "code",
            rootPath: "code",
            available: true,
            explicit: false,
            workspaceId: "code-workspace",
          },
        ]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /code/i }));
    expect(
      await screen.findByRole("menuitem", { name: "Mark as project" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    rerender(
      <FileTree
        {...props}
        projectRoots={[
          vaultRoot,
          {
            id: "code",
            rootPath: "code",
            available: true,
            explicit: true,
            workspaceId: null,
          },
        ]}
        projectWorkspaces={[
          {
            id: "code-workspace",
            rootPath: "code",
            available: true,
          },
        ]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /code/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Unmark project" }),
    );
    expect(onUnmarkProject).toHaveBeenCalledWith({
      id: "code",
      rootPath: "code",
      available: true,
      explicit: true,
      workspaceId: null,
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /code/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Unmark workspace" }),
    );
    expect(onUnmarkWorkspace).toHaveBeenCalledWith({
      id: "code-workspace",
      rootPath: "code",
      available: true,
    });

    rerender(
      <FileTree
        {...props}
        projectWorkspaces={[vaultWorkspace]}
      />,
    );
    fireEvent.contextMenu(screen.getByLabelText("Vault files"), {
      clientX: 3,
      clientY: 3,
    });
    await user.click(
      await screen.findByRole("menuitem", { name: "Unmark project" }),
    );
    expect(onUnmarkProject).toHaveBeenCalledWith(vaultRoot);

    fireEvent.contextMenu(screen.getByLabelText("Vault files"), {
      clientX: 3,
      clientY: 3,
    });
    await user.click(
      await screen.findByRole("menuitem", { name: "Unmark workspace" }),
    );
    expect(onUnmarkWorkspace).toHaveBeenCalledWith(vaultWorkspace);

    rerender(<FileTree {...props} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /note\.md/i }));
    expect(
      screen.queryByRole("menuitem", { name: /mark.*project/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /mark.*workspace/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the complete file action menu", async () => {
    const user = userEvent.setup();
    const node = {
      path: "notes/example.md",
      name: "example.md",
      kind: "markdown" as const,
      children: [],
      size: 12,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const fileActions = {
      welcomePage: { customPath: null, effectivePath: null },
      onDuplicate: vi.fn(),
      onBookmark: vi.fn(),
      onCopyPath: vi.fn(),
      onOpenHistory: vi.fn(),
      onOpenInNewTab: vi.fn(),
      onReveal: vi.fn(),
      onSetWelcomePage: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(
      <FileTree
        nodes={[node]}
        selectedPath={node.path}
        expandedPaths={new Set()}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
        fileActions={fileActions}
      />,
    );

    const actions = [
      ["Duplicate", fileActions.onDuplicate],
      ["Add bookmark", fileActions.onBookmark],
      ["Copy path", fileActions.onCopyPath],
      ["Open version history", fileActions.onOpenHistory],
      ["Open in new tab", fileActions.onOpenInNewTab],
      ["Set as welcome page", fileActions.onSetWelcomePage],
      ["Reveal in folder", fileActions.onReveal],
      ["Rename", fileActions.onRename],
      ["Move to folder…", fileActions.onMove],
      ["Delete", fileActions.onDelete],
    ] as const;

    for (const [label, handler] of actions) {
      fireEvent.contextMenu(screen.getByRole("button", { name: /example\.md/i }));
      await user.click(await screen.findByRole("menuitem", { name: label }));
      expect(handler).toHaveBeenCalledWith(node);
      rerender(
        <FileTree
          nodes={[node]}
          selectedPath={node.path}
          expandedPaths={new Set()}
          onSelect={vi.fn()}
          onToggleFolder={vi.fn()}
          onCreate={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onRequestMove={vi.fn()}
          fileActions={fileActions}
        />,
      );
    }
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
