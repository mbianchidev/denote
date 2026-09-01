import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode, WorkspaceSnapshot } from "./types";

const mockApi = vi.hoisted(() => ({
  getLastVault: vi.fn(),
  listSearchDocuments: vi.fn(),
  markProjectRoot: vi.fn(),
  refreshGitignoreStatus: vi.fn(),
  readNote: vi.fn(),
  recordEdit: vi.fn(),
  saveNote: vi.fn(),
  saveTabSession: vi.fn(),
  createEntry: vi.fn(),
  trashEntry: vi.fn(),
  restoreTrashItem: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: mockApi,
  errorMessage: (value: unknown) =>
    value instanceof Error ? value.message : String(value),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("./plugins/usePlugins", () => ({
  usePlugins: () => ({
    plugins: [],
    bundles: [],
    commands: [],
    sidebarViews: [],
    statusItems: [],
    decorations: [],
    loading: false,
    busyPluginIds: new Set<string>(),
    refresh: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    disableAll: vi.fn(),
    clearData: vi.fn(),
    clearCredentials: vi.fn(),
    updateSettings: vi.fn(),
    importSettings: vi.fn(),
    runCommand: vi.fn(),
    emitNoteEvent: vi.fn(),
    invalidateActionLeases: vi.fn(),
    shutdown: vi.fn(),
  }),
}));
vi.mock("./components/PlainTextEditor", () => ({
  PlainTextEditor: ({
    ariaLabel,
    value,
    readOnly,
    spellCheck,
    languageOverride,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    readOnly: boolean;
    spellCheck: boolean;
    languageOverride?: string | null;
    onChange: (value: string) => void;
  }) => (
    <>
      <output data-testid="plain-editor-language">
        {languageOverride ?? "auto"}:{String(spellCheck)}
      </output>
      <button
        type="button"
        aria-label={`Change ${ariaLabel}`}
        disabled={readOnly}
        onClick={() => onChange(`${value} changed`)}
      >
        Change content
      </button>
    </>
  ),
}));
vi.mock("./components/FileTree", () => ({
  FileTree: ({
    expandedPaths,
    showDotfiles,
    onMarkProject,
    nodes,
    onSelect,
    onDelete,
  }: {
    nodes: FileNode[];
    expandedPaths: Set<string>;
    showDotfiles: boolean;
    onMarkProject?: (path: string) => void;
    onSelect?: (node: FileNode) => void;
    onDelete?: (node: FileNode) => void;
  }) => (
    <>
      <output data-testid="file-tree-expanded">
        {[...expandedPaths].join(",")}
      </output>
      <output data-testid="file-tree-dotfiles">
        {String(showDotfiles)}
      </output>
      {onMarkProject ? (
        <button type="button" onClick={() => onMarkProject("code")}>
          Mark synthetic project
        </button>
      ) : null}
      {onSelect && nodes[0] ? (
        <button type="button" onClick={() => onSelect(nodes[0])}>
          Select synthetic entry
        </button>
      ) : null}
      {onSelect
        ? nodes.map((node) => (
            <button
              key={node.path}
              type="button"
              aria-label={`Open ${node.name}`}
              onClick={() => onSelect(node)}
            >
              Open synthetic file
            </button>
          ))
        : null}
      {onDelete && nodes[0] ? (
        <button type="button" onClick={() => onDelete(nodes[0])}>
          Delete synthetic entry
        </button>
      ) : null}
    </>
  ),
}));

import App from "./App";

describe("App initial file-tree expansion", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockApi.listSearchDocuments.mockResolvedValue({
      documents: [],
      skippedCount: 0,
      truncated: false,
    });
    mockApi.markProjectRoot.mockResolvedValue({
      projectRoots: [],
      projectWorkspaces: [],
      suggestGitProject: false,
    });
    mockApi.refreshGitignoreStatus.mockResolvedValue({
      scopePaths: [],
      ignoredPaths: [],
      complete: true,
    });
    mockApi.readNote.mockImplementation(async (path: string) => ({
      path,
      content: `${path} content`,
      contentHash: `${path}-hash`,
      encoding: "utf8",
      lineEnding: "lf",
      stats: noteStats(),
    }));
    mockApi.recordEdit.mockResolvedValue(noteStats());
    mockApi.saveNote.mockResolvedValue({
      path: "synthetic.txt",
      changed: true,
      savedAt: "2026-01-01T00:00:00Z",
      contentHash: "saved-hash",
      historyCount: 1,
      stats: noteStats(),
    });
    mockApi.saveTabSession.mockResolvedValue(undefined);
    mockApi.createEntry.mockResolvedValue(fileNode(".gitignore"));
    mockApi.trashEntry.mockResolvedValue({
      id: 7,
      originalPath: ".gitignore",
      deletedAt: "2026-01-01T00:00:00Z",
      isDirectory: false,
    });
    mockApi.restoreTrashItem.mockResolvedValue(fileNode(".gitignore"));
  });

  it("opens only the first eight eligible top-level folders", async () => {
    const folders = Array.from({ length: 10 }, (_, index) =>
      fileNode(`folder-${index}`, "folder"),
    );
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        fileNode("root.md"),
        fileNode(".GIT", "folder"),
        folders[0],
        fileNode("Node_Modules", "folder"),
        ...folders.slice(1),
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("file-tree-expanded")).toHaveTextContent(
        folders
          .slice(0, 8)
          .map(({ path }) => path)
          .join(","),
      );
    });
    expect(screen.getByTestId("file-tree-expanded")).not.toHaveTextContent(
      /\.GIT|Node_Modules/,
    );
    expect(screen.getByTestId("file-tree-dotfiles")).toHaveTextContent("true");
  });

  it("loads and persists the dotfile preference without reloading the vault", async () => {
    localStorage.setItem("denote-show-dotfiles", "false");
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        fileNode(".settings", "folder"),
        fileNode("notes", "folder"),
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("file-tree-dotfiles")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("file-tree-expanded")).toHaveTextContent("notes");
    expect(screen.getByTestId("file-tree-expanded")).not.toHaveTextContent(
      ".settings",
    );
    expect(mockApi.getLastVault).toHaveBeenCalledTimes(1);
    const searchLoadCount = mockApi.listSearchDocuments.mock.calls.length;

    const toggle = screen.getByRole("button", {
      name: "Show dotfiles and folders",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    toggle.click();

    await waitFor(() => {
      expect(screen.getByTestId("file-tree-dotfiles")).toHaveTextContent("true");
    });
    expect(localStorage.getItem("denote-show-dotfiles")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Show dotfiles and folders" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mockApi.getLastVault).toHaveBeenCalledTimes(1);
    expect(mockApi.listSearchDocuments).toHaveBeenCalledTimes(searchLoadCount);
  });

  it("clears a selection that becomes hidden with dotfiles", async () => {
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([fileNode(".settings", "folder")]),
    );

    render(<App />);

    await screen.findByRole("button", { name: "Select synthetic entry" });
    fireEvent.click(
      screen.getByRole("button", { name: "Select synthetic entry" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Rename selected item" }),
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Show dotfiles and folders" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Rename selected item" }),
      ).toBeDisabled();
    });
  });

  it("opens another file without saving a dirty tab", async () => {
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        fileNode("alpha.txt", "text"),
        fileNode("beta.txt", "text"),
      ]),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open alpha.txt" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Change Edit alpha.txt" }),
    );
    await waitFor(() => {
      expect(mockApi.recordEdit).toHaveBeenCalledWith("alpha.txt");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open beta.txt" }));
    await waitFor(() => {
      expect(mockApi.readNote).toHaveBeenCalledWith("beta.txt");
    });
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(
      screen.getByRole("tab", { name: /alpha\.txt.*unsaved changes/i }),
    ).toBeInTheDocument();
  });

  it("applies a tab-local source language override without editing or saving", async () => {
    const user = userEvent.setup();
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        fileNode("sample.ts", "text"),
        fileNode("other.py", "text"),
      ]),
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open sample.ts" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Source language: TypeScript (Automatic)",
      }),
    );
    await user.type(
      screen.getByRole("combobox", { name: "Search source language" }),
      "plain text",
    );
    await user.click(screen.getByRole("option", { name: "Plain text" }));

    expect(
      screen.getByRole("button", {
        name: "Source language: Plain text (Override)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("plain-editor-language")).toHaveTextContent(
      "text:true",
    );
    expect(mockApi.recordEdit).not.toHaveBeenCalledWith("sample.ts");
    expect(mockApi.saveNote).not.toHaveBeenCalledWith(
      "sample.ts",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: "Open other.py" }));
    expect(
      await screen.findByRole("button", {
        name: "Source language: Python (Automatic)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("plain-editor-language")).toHaveTextContent(
      "auto:false",
    );
    expect(mockApi.recordEdit).not.toHaveBeenCalledWith("other.py");
    expect(mockApi.saveNote).not.toHaveBeenCalledWith(
      "other.py",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("refreshes the full ignored set after a project change", async () => {
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark synthetic project" })).toBeInTheDocument();
    });
    screen.getByRole("button", { name: "Mark synthetic project" }).click();

    await waitFor(() => {
      expect(mockApi.markProjectRoot).toHaveBeenCalledWith(
        "/synthetic-vault",
        "code",
      );
      expect(mockApi.refreshGitignoreStatus).toHaveBeenCalledWith(
        "/synthetic-vault",
        [],
      );
    });
  });

  it("refreshes the parent scope after creating a root .gitignore", async () => {
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New file" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Create file" }), {
      target: { value: ".gitignore" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockApi.createEntry).toHaveBeenCalledWith("", ".gitignore", false);
      expect(mockApi.refreshGitignoreStatus).toHaveBeenCalledWith(
        "/synthetic-vault",
        [""],
      );
    });
  });

  it("refreshes the parent scope after trashing a root .gitignore", async () => {
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([fileNode(".gitignore")]),
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete synthetic entry" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Move to trash" }),
    );

    await waitFor(() => {
      expect(mockApi.trashEntry).toHaveBeenCalledWith(".gitignore");
      expect(mockApi.refreshGitignoreStatus).toHaveBeenCalledWith(
        "/synthetic-vault",
        [""],
      );
    });
  });

  it("refreshes the parent scope after restoring a root .gitignore", async () => {
    const snapshot = workspaceSnapshot([]);
    snapshot.trash = [
      {
        id: 7,
        originalPath: ".gitignore",
        deletedAt: "2026-01-01T00:00:00Z",
        isDirectory: false,
      },
    ];
    mockApi.getLastVault.mockResolvedValue(snapshot);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Trash" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore .gitignore" }),
    );

    await waitFor(() => {
      expect(mockApi.restoreTrashItem).toHaveBeenCalledWith(7);
      expect(mockApi.refreshGitignoreStatus).toHaveBeenCalledWith(
        "/synthetic-vault",
        [""],
      );
    });
  });
});

function fileNode(
  path: string,
  kind: FileNode["kind"] = "markdown",
): FileNode {
  return {
    path,
    name: path,
    kind,
    children: [],
    size: 0,
    modifiedAt: null,
    bookmarked: false,
    pinned: false,
  };
}

function workspaceSnapshot(tree: FileNode[]): WorkspaceSnapshot {
  return {
    vaultPath: "/synthetic-vault",
    vaultName: "Synthetic vault",
    default: false,
    tree,
    bookmarks: [],
    recent: [],
    trash: [],
    tagColors: [],
    markdownViewMode: "rich-text",
    restoreTabs: false,
    tabSession: null,
    welcomePage: { customPath: null, effectivePath: null },
    projectRoots: [],
    projectWorkspaces: [],
    suggestGitProject: false,
    ignoredPaths: [],
    fromCache: false,
    encryption: {
      enabled: false,
      unlocked: true,
      phase: null,
      remainingRecoveryCodes: 0,
    },
  };
}

function noteStats() {
  return {
    openCount: 1,
    editCount: 0,
    saveCount: 0,
    lastOpenedAt: null,
    lastEditedAt: null,
    lastSavedAt: null,
    bookmarked: false,
  };
}
