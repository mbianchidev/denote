import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "../types";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  let elementFromPointDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    elementFromPointDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
  });

  afterEach(() => {
    if (elementFromPointDescriptor) {
      Object.defineProperty(document, "elementFromPoint", elementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it("hides dot entries without changing their stored expansion", () => {
    const hiddenFolder: FileNode = {
      path: ".config",
      name: ".config",
      kind: "folder",
      children: [
        {
          path: ".config/settings.json",
          name: "settings.json",
          kind: "text",
          children: [],
          size: 1,
          modifiedAt: null,
          bookmarked: false,
          pinned: false,
        },
      ],
      size: 0,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const props = {
      nodes: [hiddenFolder],
      selectedPath: null,
      expandedPaths: new Set([".config"]),
      onSelect: vi.fn(),
      onToggleFolder: vi.fn(),
      onCreate: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onRequestMove: vi.fn(),
    };
    const { rerender } = render(<FileTree {...props} showDotfiles={false} />);

    expect(screen.queryByRole("button", { name: ".config" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Vault files")).toHaveAttribute("tabindex", "0");

    rerender(<FileTree {...props} showDotfiles />);
    expect(screen.getByRole("button", { name: ".config" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "settings.json" }),
    ).toBeInTheDocument();
  });

  it("marks ignored rows accessibly while preserving pointer and keyboard actions", async () => {
    const user = userEvent.setup();
    const ignoredNode = fileNodes(1)[0];
    const onSelect = vi.fn();
    render(
      <FileTree
        nodes={[ignoredNode]}
        selectedPath={null}
        expandedPaths={new Set()}
        ignoredPaths={new Set([ignoredNode.path])}
        onSelect={onSelect}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", {
      name: /file-0\.md, ignored by \.gitignore/i,
    });
    expect(row).toHaveAttribute("data-ignored", "true");
    await user.click(row);
    row.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("exposes ignored, pinned, and bookmarked row state together", () => {
    const node = {
      ...fileNodes(1)[0],
      pinned: true,
      bookmarked: true,
    };
    render(
      <FileTree
        nodes={[node]}
        selectedPath={null}
        expandedPaths={new Set()}
        ignoredPaths={new Set([node.path])}
        onSelect={vi.fn()}
        onToggleFolder={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", {
      name: "file-0.md, Ignored by .gitignore, Pinned, Bookmarked",
    });
    expect(row).toHaveAttribute("data-ignored", "true");
    expect(row).toHaveTextContent("file-0.md");
  });

  it("keeps ignored styling when a hidden ignored entry is shown again", () => {
    const ignoredNode = {
      ...fileNodes(1)[0],
      path: ".env",
      name: ".env",
    };
    const props = {
      nodes: [ignoredNode],
      selectedPath: null,
      expandedPaths: new Set<string>(),
      ignoredPaths: new Set([".env"]),
      onSelect: vi.fn(),
      onToggleFolder: vi.fn(),
      onCreate: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onRequestMove: vi.fn(),
    };
    const { rerender } = render(<FileTree {...props} showDotfiles={false} />);

    expect(screen.queryByText(".env")).not.toBeInTheDocument();
    rerender(<FileTree {...props} showDotfiles />);
    expect(screen.getByRole("button", { name: /\.env, ignored/i })).toHaveAttribute(
      "data-ignored",
      "true",
    );
  });

  it("allows excluded folders to be opened directly", async () => {
    const user = userEvent.setup();
    const folder: FileNode = {
      path: ".git",
      name: ".git",
      kind: "folder",
      children: [],
      size: 0,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const onSelect = vi.fn();
    const onToggleFolder = vi.fn();
    render(
      <FileTree
        nodes={[folder]}
        selectedPath={null}
        expandedPaths={new Set()}
        onSelect={onSelect}
        onToggleFolder={onToggleFolder}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: ".git" }));

    expect(onSelect).toHaveBeenCalledWith(folder);
    expect(onToggleFolder).toHaveBeenCalledWith(".git");
  });

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

    expect(
      screen.getByRole("button", { name: "projects, Pinned" }),
    ).toBeInTheDocument();
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

  it("opens search scoped to a folder from its context menu", async () => {
    const user = userEvent.setup();
    const onFindInFolder = vi.fn();
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
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRequestMove={vi.fn()}
        onFindInFolder={onFindInFolder}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /projects/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Find in folder" }),
    );

    expect(onFindInFolder).toHaveBeenCalledWith("projects");
  });

  it("expands and collapses one folder from its context menu", async () => {
    const user = userEvent.setup();
    const onToggleFolder = vi.fn();
    const node = {
      path: "projects",
      name: "projects",
      kind: "folder" as const,
      children: [],
      size: 0,
      modifiedAt: null,
      bookmarked: false,
      pinned: false,
    };
    const props = {
      nodes: [node],
      selectedPath: null,
      onSelect: vi.fn(),
      onToggleFolder,
      onCreate: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      onRequestMove: vi.fn(),
    };
    const { rerender } = render(
      <FileTree {...props} expandedPaths={new Set()} />,
    );
    const row = screen.getByRole("button", { name: /projects/i });

    fireEvent.contextMenu(row);
    await user.click(
      await screen.findByRole("menuitem", { name: "Expand folder" }),
    );
    expect(onToggleFolder).toHaveBeenLastCalledWith("projects");
    expect(row).toHaveFocus();

    rerender(
      <FileTree {...props} expandedPaths={new Set(["projects"])} />,
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: /projects/i }),
      { key: "ContextMenu" },
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Collapse folder" }),
    );
    expect(onToggleFolder).toHaveBeenLastCalledWith("projects");
    expect(onToggleFolder).toHaveBeenCalledTimes(2);
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
    mockTreeViewport(screen.getByLabelText("Vault files"));
    mockPointerHit(target);

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
  });

  it("does not move a file onto itself or start a drag during touch scrolling", () => {
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
    mockTreeViewport(screen.getByLabelText("Vault files"));
    mockPointerHit(source);

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
  });

  describe("containing-folder drop targets", () => {
    it.each([
      { name: "a sibling file", target: "peer.md", hit: "row", parent: "archive" },
      { name: "a file label", target: "peer.md", hit: "label", parent: "archive" },
      { name: "a file icon", target: "peer.md", hit: "icon", parent: "archive" },
      { name: "a nested file", target: "nested.md", hit: "row", parent: "archive/deep" },
      { name: "a root file", target: "root.md", hit: "row", parent: "" },
      { name: "a folder label", target: "archive", hit: "label", parent: "archive" },
    ])("moves into the containing directory when dropped over $name", ({
      target,
      hit,
      parent,
    }) => {
      const fixture = renderDropTree();
      const targetRow = screen.getByRole("button", { name: target });
      const element = hit === "label"
        ? screen.getByText(target)
        : hit === "icon"
          ? targetRow.querySelector("svg")
          : targetRow;
      expect(element).not.toBeNull();
      mockPointerHit(element);
      const point = rowPointerPoint(targetRow);

      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, { ...point, pointerId: 7 });

      expect(targetRow).toHaveAttribute("data-drop-target", "true");
      expect(fixture.tree).toHaveAttribute("data-drop-target", String(parent === ""));
      if (parent) {
        expect(screen.getByRole("button", {
          name: parent.split("/").slice(-1)[0],
        })).toHaveAttribute("data-drop-target", "true");
      }
      fireEvent.pointerUp(fixture.sourceRow, { ...point, pointerId: 7 });
      fireEvent.click(fixture.sourceRow);

      expect(fixture.onMove).toHaveBeenCalledExactlyOnceWith(fixture.source, parent);
      expect(fixture.onSelect).not.toHaveBeenCalled();
      expect(fixture.onToggleFolder).not.toHaveBeenCalled();
      expect(targetRow).toHaveAttribute("data-drop-target", "false");
      expect(fixture.tree).toHaveAttribute("data-drop-target", "false");
    });

    it.each([
      { name: "a sibling file band", rowIndex: 6, parent: "archive", rowName: "peer.md" },
      { name: "a nested file band", rowIndex: 8, parent: "archive/deep", rowName: "nested.md" },
      { name: "a root file band", rowIndex: 9, parent: "", rowName: "root.md" },
      { name: "a folder band", rowIndex: 5, parent: "archive", rowName: "archive" },
      { name: "empty space above the list", rowIndex: -1, parent: "", rowName: null },
      { name: "empty space below the list", rowIndex: 11, parent: "", rowName: null },
    ])("resolves tree padding aligned with $name", ({ rowIndex, parent, rowName }) => {
      const fixture = renderDropTree();
      mockPointerHit(fixture.tree);
      const point = {
        clientX: 21,
        clientY: rowIndex < 0 ? 42 : 40 + 6 + rowIndex * 29 + 14,
      };

      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, { ...point, pointerId: 7 });

      expect(fixture.tree).toHaveAttribute("data-drop-target", String(parent === ""));
      if (rowName) {
        expect(screen.getByRole("button", { name: rowName })).toHaveAttribute(
          "data-drop-target",
          "true",
        );
      }
      fireEvent.pointerUp(fixture.sourceRow, { ...point, pointerId: 7 });
      expect(fixture.onMove).toHaveBeenCalledExactlyOnceWith(fixture.source, parent);
    });

    it.each([
      { sourceName: "moved.md", targetName: "stay.md" },
      { sourceName: "moved.md", targetName: "moved.md" },
      { sourceName: "drafts", targetName: "drafts" },
      { sourceName: "drafts", targetName: "child.md" },
      { sourceName: "drafts", targetName: "root.md" },
    ])("does not move $sourceName into $targetName's invalid destination", ({
      sourceName,
      targetName,
    }) => {
      const fixture = renderDropTree();
      const sourceRow = screen.getByRole("button", { name: sourceName });
      const targetRow = screen.getByRole("button", { name: targetName });
      mockPointerHit(targetRow);
      const point = { ...rowPointerPoint(targetRow), clientX: 100 };

      startSyntheticDrag(sourceRow);
      fireEvent.pointerMove(sourceRow, { ...point, pointerId: 7 });
      fireEvent.pointerUp(sourceRow, { ...point, pointerId: 7 });

      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(targetRow).toHaveAttribute("data-drop-target", "false");
      expect(fixture.tree).toHaveAttribute("data-drop-target", "false");
    });

    it.each([
      { name: "left of the tree", x: 19, y: 100, clientWidth: 240, clientHeight: 360 },
      { name: "right of the tree", x: 260, y: 100, clientWidth: 240, clientHeight: 360 },
      { name: "above the tree", x: 80, y: 39, clientWidth: 240, clientHeight: 360 },
      { name: "below the tree", x: 80, y: 400, clientWidth: 240, clientHeight: 360 },
      { name: "over a vertical scrollbar", x: 255, y: 100, clientWidth: 230, clientHeight: 360 },
      { name: "over a horizontal scrollbar", x: 80, y: 395, clientWidth: 240, clientHeight: 350 },
    ])("does not treat a pointer $name as a root drop", ({
      x,
      y,
      clientWidth,
      clientHeight,
    }) => {
      const fixture = renderDropTree();
      mockTreeViewport(fixture.tree, {
        left: 20,
        top: 40,
        height: 360,
        clientWidth,
        clientHeight,
      });
      mockPointerHit(fixture.tree);
      const point = { clientX: x, clientY: y, pointerId: 7 };

      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, point);
      fireEvent.pointerUp(fixture.sourceRow, point);

      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(fixture.tree).toHaveAttribute("data-drop-target", "false");
    });

    it("ignores another tree instead of moving to that tree's root", () => {
      const fixture = renderDropTree();
      const otherTree = document.createElement("nav");
      otherTree.className = "file-tree";
      document.body.append(otherTree);
      try {
        mockPointerHit(otherTree);
        const point = { clientX: 80, clientY: 100, pointerId: 7 };
        startSyntheticDrag(fixture.sourceRow);
        fireEvent.pointerMove(fixture.sourceRow, point);
        fireEvent.pointerUp(fixture.sourceRow, point);
        expect(fixture.onMove).not.toHaveBeenCalled();
      } finally {
        otherTree.remove();
      }
    });

    it("clears the destination without moving when a drag is cancelled", () => {
      const fixture = renderDropTree();
      const target = screen.getByRole("button", { name: "peer.md" });
      mockPointerHit(target);
      const point = rowPointerPoint(target);
      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, { ...point, pointerId: 7 });
      expect(target).toHaveAttribute("data-drop-target", "true");

      fireEvent.pointerCancel(fixture.sourceRow, { pointerId: 7 });
      fireEvent.pointerUp(fixture.sourceRow, { ...point, pointerId: 7 });

      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-drop-target", "false");
      expect(fixture.sourceRow).toHaveAttribute("data-dragging", "false");
    });

    it("clears the destination when the pointer leaves the tree", () => {
      const fixture = renderDropTree();
      const target = screen.getByRole("button", { name: "peer.md" });
      mockPointerHit(target);
      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, {
        ...rowPointerPoint(target),
        pointerId: 7,
      });
      expect(target).toHaveAttribute("data-drop-target", "true");

      mockPointerHit(document.body);
      const point = { clientX: 300, clientY: 100, pointerId: 7 };
      fireEvent.pointerMove(fixture.sourceRow, point);
      fireEvent.pointerUp(fixture.sourceRow, point);

      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-drop-target", "false");
      expect(fixture.tree).toHaveAttribute("data-drop-target", "false");
    });

    it("uses the release location instead of a stale hover destination", () => {
      const fixture = renderDropTree();
      const folderPeer = screen.getByRole("button", { name: "peer.md" });
      const rootPeer = screen.getByRole("button", { name: "root.md" });
      mockPointerHit(folderPeer);
      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, {
        ...rowPointerPoint(folderPeer),
        pointerId: 7,
      });
      expect(folderPeer).toHaveAttribute("data-drop-target", "true");

      mockPointerHit(rootPeer);
      fireEvent.pointerUp(fixture.sourceRow, {
        ...rowPointerPoint(rootPeer),
        pointerId: 7,
      });
      expect(fixture.onMove).toHaveBeenCalledExactlyOnceWith(fixture.source, "");
      expect(fixture.tree).toHaveAttribute("data-drop-target", "false");
    });

    it("preserves touch scrolling over a valid destination", () => {
      const fixture = renderDropTree();
      const target = screen.getByRole("button", { name: "peer.md" });
      mockPointerHit(target);
      fireEvent.pointerDown(fixture.sourceRow, {
        ...rowPointerPoint(fixture.sourceRow),
        button: 0,
        pointerId: 7,
        pointerType: "touch",
      });
      const point = {
        ...rowPointerPoint(target),
        pointerId: 7,
        pointerType: "touch",
      };
      fireEvent.pointerMove(fixture.sourceRow, point);
      fireEvent.pointerUp(fixture.sourceRow, point);

      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(fixture.sourceRow).toHaveAttribute("data-dragging", "false");
      expect(target).toHaveAttribute("data-drop-target", "false");
    });

    it("does not let another pointer finish the active drag", () => {
      const fixture = renderDropTree();
      const target = screen.getByRole("button", { name: "peer.md" });
      mockPointerHit(target);
      const point = rowPointerPoint(target);
      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, { ...point, pointerId: 8 });
      fireEvent.pointerUp(fixture.sourceRow, { ...point, pointerId: 8 });
      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-drop-target", "false");

      fireEvent.pointerMove(fixture.sourceRow, { ...point, pointerId: 7 });
      fireEvent.pointerUp(fixture.sourceRow, { ...point, pointerId: 7 });
      expect(fixture.onMove).toHaveBeenCalledExactlyOnceWith(fixture.source, "archive");
    });

    it.each([5, 6])("starts dragging only at the 6px threshold: %ipx", (distance) => {
      const fixture = renderDropTree();
      mockPointerHit(fixture.sourceRow);
      const start = rowPointerPoint(fixture.sourceRow);
      startSyntheticDrag(fixture.sourceRow);
      fireEvent.pointerMove(fixture.sourceRow, {
        ...start,
        clientX: start.clientX + distance,
        pointerId: 7,
      });
      expect(fixture.sourceRow).toHaveAttribute("data-dragging", String(distance >= 6));
      fireEvent.pointerCancel(fixture.sourceRow, { pointerId: 7 });
      expect(fixture.onMove).not.toHaveBeenCalled();
    });
  });

  describe("virtualization", () => {
    let clientHeightDescriptor: PropertyDescriptor | undefined;
    let frameCallbacks: FrameRequestCallback[];

    beforeEach(() => {
      clientHeightDescriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "clientHeight",
      );
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.classList.contains("file-tree") ? 87 : 0;
        },
      });
      frameCallbacks = [];
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn((callback: FrameRequestCallback) => {
          frameCallbacks.push(callback);
          return frameCallbacks.length;
        }),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
    });

    afterEach(() => {
      if (clientHeightDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientHeightDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      }
      vi.unstubAllGlobals();
    });

    it("bounds the initial large-tree DOM before a viewport is measured", () => {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return 0;
        },
      });

      render(
        <FileTree
          nodes={fileNodes(100)}
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

      expect(screen.queryByRole("button", { name: "file-99.md" })).toBeNull();
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(18);
    });

    it("renders a bounded slice and updates it after scrolling", async () => {
      render(
        <FileTree
          nodes={fileNodes(100)}
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

      await waitFor(() => {
        expect(screen.getAllByRole("button")).toHaveLength(9);
      });
      const tree = screen.getByLabelText("Vault files");
      fireEvent.scroll(tree, { target: { scrollTop: 50 * 29 } });
      act(() => {
        for (const callback of frameCallbacks.splice(0)) {
          callback(performance.now());
        }
      });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "file-50.md" }),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: "file-0.md" }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(16);
    });

    it("moves focus to offscreen logical rows with arrows and Home/End", async () => {
      render(
        <FileTree
          nodes={fileNodes(100)}
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
      const tree = screen.getByLabelText("Vault files");
      const lastInitiallyRenderedRow = await screen.findByRole("button", {
        name: "file-8.md",
      });
      lastInitiallyRenderedRow.focus();

      fireEvent.keyDown(lastInitiallyRenderedRow, { key: "ArrowDown" });

      const nextRow = await screen.findByRole("button", { name: "file-9.md" });
      await waitFor(() => expect(nextRow).toHaveFocus());
      expect(nextRow).toHaveAttribute("data-tree-row-index", "9");
      expect(tree.scrollTop).toBeGreaterThan(0);

      fireEvent.keyDown(nextRow, { key: "ArrowUp" });
      await waitFor(() => expect(lastInitiallyRenderedRow).toHaveFocus());

      fireEvent.keyDown(lastInitiallyRenderedRow, { key: "End" });

      const finalRow = await screen.findByRole("button", { name: "file-99.md" });
      await waitFor(() => expect(finalRow).toHaveFocus());
      expect(finalRow).toHaveAttribute("data-tree-row-path", "file-99.md");
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);

      fireEvent.keyDown(finalRow, { key: "Home" });

      const firstRow = await screen.findByRole("button", { name: "file-0.md" });
      await waitFor(() => expect(firstRow).toHaveFocus());
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
    });

    it("tabs across a virtualized boundary and back without trapping focus", async () => {
      const user = userEvent.setup();
      render(
        <>
          <FileTree
            nodes={fileNodes(100)}
            selectedPath={null}
            expandedPaths={new Set()}
            onSelect={vi.fn()}
            onToggleFolder={vi.fn()}
            onCreate={vi.fn()}
            onRename={vi.fn()}
            onDelete={vi.fn()}
            onMove={vi.fn()}
            onRequestMove={vi.fn()}
          />
          <button type="button">After tree</button>
        </>,
      );
      const boundaryRow = await screen.findByRole("button", {
        name: "file-8.md",
      });
      boundaryRow.focus();

      await user.tab();

      const offscreenRow = await screen.findByRole("button", {
        name: "file-9.md",
      });
      await waitFor(() => expect(offscreenRow).toHaveFocus());
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(18);

      await user.tab({ shift: true });
      expect(boundaryRow).toHaveFocus();

      fireEvent.keyDown(boundaryRow, { key: "Home" });
      const firstRow = await screen.findByRole("button", { name: "file-0.md" });
      await waitFor(() => expect(firstRow).toHaveFocus());
      await user.tab({ shift: true });
      expect(firstRow).not.toHaveFocus();

      fireEvent.keyDown(
        screen.getByRole("button", { name: "file-0.md" }),
        { key: "End" },
      );
      const finalRow = await screen.findByRole("button", { name: "file-99.md" });
      await waitFor(() => expect(finalRow).toHaveFocus());
      await user.tab();
      expect(screen.getByRole("button", { name: "After tree" })).toHaveFocus();
    });

    it("keeps a focused row mounted and focused outside the viewport", async () => {
      render(
        <FileTree
          nodes={fileNodes(100)}
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
      const focusedRow = await screen.findByRole("button", {
        name: "file-0.md",
      });
      focusedRow.focus();
      const tree = screen.getByLabelText("Vault files");

      fireEvent.scroll(tree, { target: { scrollTop: 50 * 29 } });
      act(() => {
        for (const callback of frameCallbacks.splice(0)) {
          callback(performance.now());
        }
      });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "file-50.md" }),
        ).toBeInTheDocument();
      });
      expect(focusedRow).toBeInTheDocument();
      expect(focusedRow).toHaveFocus();
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
    });

    it("restores focus to a retained keyboard context-menu opener", async () => {
      const user = userEvent.setup();
      render(
        <FileTree
          nodes={fileNodes(100)}
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
      const opener = await screen.findByRole("button", { name: "file-0.md" });
      opener.focus();
      fireEvent.keyDown(opener, { key: "ContextMenu" });
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      const tree = screen.getByLabelText("Vault files");

      fireEvent.scroll(tree, { target: { scrollTop: 50 * 29 } });
      act(() => {
        for (const callback of frameCallbacks.splice(0)) {
          callback(performance.now());
        }
      });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "file-50.md" }),
        ).toBeInTheDocument();
      });
      expect(opener).toBeInTheDocument();
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
    });

    it("keeps an active pointer-drag row mounted outside the viewport", async () => {
      render(
        <FileTree
          nodes={fileNodes(100)}
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
      const draggedRow = await screen.findByRole("button", {
        name: "file-0.md",
      });
      mockTreeViewport(screen.getByLabelText("Vault files"));
      mockPointerHit(draggedRow);
      fireEvent.pointerDown(draggedRow, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 5,
      });
      fireEvent.pointerMove(draggedRow, {
        clientX: 30,
        clientY: 30,
        pointerId: 5,
      });
      const tree = screen.getByLabelText("Vault files");

      fireEvent.scroll(tree, { target: { scrollTop: 50 * 29 } });
      act(() => {
        for (const callback of frameCallbacks.splice(0)) {
          callback(performance.now());
        }
      });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "file-50.md" }),
        ).toBeInTheDocument();
      });
      expect(draggedRow).toBeInTheDocument();
      expect(draggedRow).toHaveAttribute("data-dragging", "true");
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
      fireEvent.pointerCancel(draggedRow, { pointerId: 5 });
    });

    it.each([false, true])(
      "resolves a logical drop destination with the scroll frame applied: %s",
      async (applyFrame) => {
        const source = syntheticTreeFile("drafts/moved.md");
        const onMove = vi.fn();
        render(
          <FileTree
            nodes={[
              syntheticTreeFolder("drafts", [source]),
              syntheticTreeFolder("archive", fileNodes(100).map((node) => ({
                ...node,
                path: `archive/${node.path}`,
              }))),
            ]}
            selectedPath={null}
            expandedPaths={new Set(["drafts", "archive"])}
            onSelect={vi.fn()}
            onToggleFolder={vi.fn()}
            onCreate={vi.fn()}
            onRename={vi.fn()}
            onDelete={vi.fn()}
            onMove={onMove}
            onRequestMove={vi.fn()}
          />,
        );
        const sourceRow = screen.getByRole("button", { name: "moved.md" });
        const tree = screen.getByLabelText("Vault files");
        mockTreeViewport(tree, { left: 20, top: 40, height: 87 });
        mockPointerHit(sourceRow);
        startSyntheticDrag(sourceRow);
        fireEvent.pointerMove(sourceRow, {
          ...rowPointerPoint(sourceRow),
          clientX: 100,
          pointerId: 7,
        });

        fireEvent.scroll(tree, { target: { scrollTop: 50 * 29 } });
        if (applyFrame) {
          act(() => {
            for (const callback of frameCallbacks.splice(0)) {
              callback(performance.now());
            }
          });
        }
        mockPointerHit(tree);
        const point = { clientX: 21, clientY: 60, pointerId: 7 };
        fireEvent.pointerMove(sourceRow, point);

        const target = await screen.findByRole("button", { name: "file-47.md" });
        expect(target).toHaveAttribute("data-drop-target", "true");
        expect(tree).toHaveAttribute("data-drop-target", "false");
        expect(sourceRow).toBeInTheDocument();
        expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
        fireEvent.pointerUp(sourceRow, point);
        expect(onMove).toHaveBeenCalledExactlyOnceWith(source, "archive");
      },
    );

    it("retargets a stationary drag when scrolling reveals another folder", () => {
      const source = syntheticTreeFile("drafts/moved.md");
      const onMove = vi.fn();
      render(
        <FileTree
          nodes={[
            syntheticTreeFolder("drafts", [source]),
            ...["archive", "storage"].map((path) =>
              syntheticTreeFolder(path, fileNodes(100).map((node) => ({
                ...node,
                path: `${path}/${node.path}`,
              }))),
            ),
          ]}
          selectedPath={null}
          expandedPaths={new Set(["drafts", "archive", "storage"])}
          onSelect={vi.fn()}
          onToggleFolder={vi.fn()}
          onCreate={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onMove={onMove}
          onRequestMove={vi.fn()}
        />,
      );
      const sourceRow = screen.getByRole("button", { name: "moved.md" });
      const archiveRow = screen.getByRole("button", { name: "archive" });
      const tree = screen.getByLabelText("Vault files");
      mockTreeViewport(tree, { left: 20, top: 40, height: 87 });
      mockPointerHit(archiveRow);
      const point = { ...rowPointerPoint(archiveRow), pointerId: 7 };
      startSyntheticDrag(sourceRow);
      fireEvent.pointerMove(sourceRow, point);
      expect(archiveRow).toHaveAttribute("data-drop-target", "true");

      mockPointerHit(tree);
      fireEvent.scroll(tree, { target: { scrollTop: 110 * 29 } });
      act(() => {
        for (const callback of frameCallbacks.splice(0)) {
          callback(performance.now());
        }
      });

      const target = screen.getByRole("button", { name: "file-8.md" });
      expect(target).toHaveAttribute("data-drop-target", "true");
      expect(screen.getByRole("button", { name: "storage" })).toHaveAttribute(
        "data-drop-target",
        "true",
      );
      expect(archiveRow).not.toBeInTheDocument();
      expect(tree).toHaveAttribute("data-drop-target", "false");
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
      fireEvent.pointerUp(sourceRow, point);
      expect(onMove).toHaveBeenCalledExactlyOnceWith(source, "storage");
    });

    it("scrolls an externally selected visible row into the viewport", async () => {
      const nodes = fileNodes(100);
      const props = {
        nodes,
        expandedPaths: new Set<string>(),
        onSelect: vi.fn(),
        onToggleFolder: vi.fn(),
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onMove: vi.fn(),
        onRequestMove: vi.fn(),
      };
      const { rerender } = render(
        <FileTree {...props} selectedPath="file-0.md" />,
      );
      const tree = screen.getByLabelText("Vault files");

      rerender(<FileTree {...props} selectedPath="file-80.md" />);

      await waitFor(() => {
        expect(tree.scrollTop).toBeGreaterThan(0);
        expect(
          screen.getByRole("button", { name: "file-80.md" }),
        ).toHaveAttribute("aria-current", "true");
      });
    });

    it("virtualizes ignored rows without losing their accessible status", async () => {
      render(
        <FileTree
          nodes={fileNodes(100)}
          selectedPath="file-80.md"
          expandedPaths={new Set()}
          ignoredPaths={new Set(["file-80.md"])}
          onSelect={vi.fn()}
          onToggleFolder={vi.fn()}
          onCreate={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onRequestMove={vi.fn()}
        />,
      );

      const row = await screen.findByRole("button", {
        name: /file-80\.md, ignored by \.gitignore/i,
      });
      expect(row).toHaveAttribute("data-ignored", "true");
      expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(17);
    });

    it("does not expand ancestors to reveal an external selection", async () => {
      const onToggleFolder = vi.fn();
      render(
        <FileTree
          nodes={[
            {
              path: "closed",
              name: "closed",
              kind: "folder",
              children: [
                { ...fileNodes(1)[0], path: "closed/file-0.md" },
              ],
              size: 0,
              modifiedAt: null,
              bookmarked: false,
              pinned: false,
            },
          ]}
          selectedPath="closed/file-0.md"
          expandedPaths={new Set()}
          onSelect={vi.fn()}
          onToggleFolder={onToggleFolder}
          onCreate={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onRequestMove={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "file-0.md" }),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByLabelText("Vault files").scrollTop).toBe(0);
      expect(onToggleFolder).not.toHaveBeenCalled();
    });
  });
});

function mockPointerHit(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
}

function mockTreeViewport(
  tree: HTMLElement,
  options: {
    left?: number;
    top?: number;
    height?: number;
    clientWidth?: number;
    clientHeight?: number;
  } = {},
) {
  const height = options.height ?? (tree.clientHeight || 348);
  Object.defineProperties(tree, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(options.left ?? 0, options.top ?? 0, 240, height),
    },
    clientWidth: { configurable: true, value: options.clientWidth ?? 240 },
    clientHeight: { configurable: true, value: options.clientHeight ?? height },
    clientLeft: { configurable: true, value: 0 },
    clientTop: { configurable: true, value: 0 },
  });
}

function rowPointerPoint(row: HTMLElement) {
  const tree = screen.getByLabelText("Vault files");
  const bounds = tree.getBoundingClientRect();
  return {
    clientX: bounds.left + 30,
    clientY: bounds.top + 6 + Number(row.dataset.treeRowIndex) * 29 - tree.scrollTop + 14,
  };
}

function startSyntheticDrag(row: HTMLElement) {
  fireEvent.pointerDown(row, {
    ...rowPointerPoint(row),
    button: 0,
    pointerId: 7,
    pointerType: "mouse",
  });
}

function syntheticTreeFile(path: string): FileNode {
  return { ...fileNodes(1)[0], path, name: path.split("/").slice(-1)[0] ?? path };
}

function syntheticTreeFolder(path: string, children: FileNode[]): FileNode {
  return { ...syntheticTreeFile(path), kind: "folder", children };
}

function renderDropTree() {
  const source = syntheticTreeFile("drafts/moved.md");
  const onMove = vi.fn();
  const onSelect = vi.fn();
  const onToggleFolder = vi.fn();
  render(
    <FileTree
      nodes={[
        syntheticTreeFolder("drafts", [
          source,
          syntheticTreeFile("drafts/stay.md"),
          syntheticTreeFolder("drafts/inside", [syntheticTreeFile("drafts/inside/child.md")]),
        ]),
        syntheticTreeFolder("archive", [
          syntheticTreeFile("archive/peer.md"),
          syntheticTreeFolder("archive/deep", [syntheticTreeFile("archive/deep/nested.md")]),
        ]),
        syntheticTreeFile("root.md"),
      ]}
      selectedPath={null}
      expandedPaths={new Set(["drafts", "drafts/inside", "archive", "archive/deep"])}
      onSelect={onSelect}
      onToggleFolder={onToggleFolder}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onMove={onMove}
      onRequestMove={vi.fn()}
    />,
  );
  const tree = screen.getByLabelText("Vault files");
  mockTreeViewport(tree, { left: 20, top: 40, height: 360 });
  return {
    source,
    sourceRow: screen.getByRole("button", { name: "moved.md" }),
    tree,
    onMove,
    onSelect,
    onToggleFolder,
  };
}

function fileNodes(count: number): FileNode[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `file-${index}.md`,
    name: `file-${index}.md`,
    kind: "markdown",
    children: [],
    size: index,
    modifiedAt: null,
    bookmarked: false,
    pinned: false,
  }));
}
