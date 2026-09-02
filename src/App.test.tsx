import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import type {
  PluginAutomaticLocalCommitContribution,
  PluginSourceControlContribution,
} from "./plugins/workerRuntime";
import type { FileNode, WorkspaceSnapshot } from "./types";

const mockApi = vi.hoisted(() => ({
  getLastVault: vi.fn(),
  listSearchDocuments: vi.fn(),
  markProjectRoot: vi.fn(),
  refreshVault: vi.fn(),
  refreshGitignoreStatus: vi.fn(),
  readNote: vi.fn(),
  recordEdit: vi.fn(),
  saveNote: vi.fn(),
  saveTabSession: vi.fn(),
  createEntry: vi.fn(),
  trashEntry: vi.fn(),
  restoreTrashItem: vi.fn(),
  pluginAutomaticCommit: vi.fn(),
}));

const mockPluginController = vi.hoisted(() => ({
  plugins: [],
  bundles: [],
  commands: [],
  sidebarViews: [],
  statusItems: [],
  decorations: [],
  sourceControlProviders: [] as PluginSourceControlContribution[],
  automaticLocalCommits: [] as PluginAutomaticLocalCommitContribution[],
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
  runSourceControlAction: vi.fn().mockResolvedValue(undefined),
  emitNoteEvent: vi.fn(),
  invalidateActionLeases: vi.fn(),
  shutdown: vi.fn(),
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
  usePlugins: () => mockPluginController,
}));
vi.mock("./components/PlainTextEditor", () => ({
  PlainTextEditor: ({
    ariaLabel,
    value,
    readOnly,
    spellCheck,
    languageOverride,
    projectMode,
    onViewportChange,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    readOnly: boolean;
    spellCheck: boolean;
    languageOverride?: string | null;
    projectMode?: boolean;
    onViewportChange?: (viewport: unknown) => void;
    onChange: (value: string) => void;
  }) => (
    <>
      <output data-testid="plain-editor-language">
        {languageOverride ?? "auto"}:{String(spellCheck)}:
        {projectMode ? "project" : "standard"}:
        {onViewportChange ? "tracked" : "untracked"}
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
    mockApi.refreshVault.mockResolvedValue(workspaceSnapshot([]));
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
    mockPluginController.sourceControlProviders = [];
    mockPluginController.automaticLocalCommits = [];
    mockPluginController.runSourceControlAction.mockResolvedValue(undefined);
    mockApi.pluginAutomaticCommit.mockResolvedValue({
      status: "committed",
      message: "Committed the tracked changes.",
      commitId: "1111111111111111111111111111111111111111",
    });
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

  it.each(["project", "workspace"] as const)(
    "uses the expanded source view and outline in a vault %s context",
    async (context) => {
      const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
      if (context === "project") {
        snapshot.projectRoots = [
          {
            id: "vault-project",
            rootPath: "",
            available: true,
            explicit: true,
            workspaceId: null,
          },
        ];
      } else {
        snapshot.projectWorkspaces = [
          {
            id: "vault-workspace",
            rootPath: "",
            available: true,
          },
        ];
      }
      mockApi.getLastVault.mockResolvedValue(snapshot);

      render(<App />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Open sample.py" }),
      );

      expect(
        await screen.findByRole("button", { name: "Hide outline" }),
      ).toBeEnabled();
      expect(screen.getByLabelText("Source outline")).toBeInTheDocument();
      expect(screen.getByTestId("plain-editor-language")).toHaveTextContent(
        "auto:false:project:tracked",
      );
      fireEvent.keyDown(
        screen.getByRole("separator", {
          name: "Resize document outline",
        }),
        { key: "ArrowLeft" },
      );
      expect(localStorage.getItem("denote-outline-width")).toBe("292");
      fireEvent.click(screen.getByRole("button", { name: "Hide outline" }));
      expect(
        screen.queryByRole("separator", {
          name: "Resize document outline",
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("plain-editor-language")).toHaveTextContent(
        "auto:false:project:untracked",
      );
    },
  );

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

  it("runs source control actions, keeps provider models live, and cleans up removed providers", async () => {
    const user = userEvent.setup();
    const contribution: PluginSourceControlContribution = {
      pluginId: "denote.synthetic",
      id: "git",
      title: "Synthetic Git",
      model: appSourceControlModel("Synthetic repository"),
    };
    mockPluginController.sourceControlProviders = [contribution];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    const { rerender } = render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Synthetic repository" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
      "denote.synthetic",
      "git",
      { id: "refresh" },
      "/synthetic-vault",
    );

    mockPluginController.sourceControlProviders = [
      {
        ...contribution,
        model: appSourceControlModel("Updated repository"),
      },
    ];
    rerender(<App />);
    expect(
      screen.getByRole("heading", { name: "Updated repository" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByRole("button", { name: "Search" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("heading", { name: "Updated repository" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );
    mockPluginController.sourceControlProviders = [];
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByTestId("file-tree-expanded")).toBeInTheDocument();
  });

  it("reports source control action failures through the app error surface", async () => {
    const user = userEvent.setup();
    mockPluginController.sourceControlProviders = [
      {
        pluginId: "denote.synthetic",
        id: "git",
        title: "Synthetic Git",
        model: appSourceControlModel("Synthetic repository"),
      },
    ];
    mockPluginController.runSourceControlAction.mockRejectedValueOnce(
      new Error("Synthetic source control failure"),
    );
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      await screen.findByText("Synthetic source control failure"),
    ).toBeInTheDocument();
  });

  it("flushes pending edits before a source control mutation", async () => {
    const user = userEvent.setup();
    const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
    const model = appSourceControlModel("Synthetic repository");
    model.resourceGroups = [
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "sample.py",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ];
    mockPluginController.sourceControlProviders = [
      {
        pluginId: "denote.synthetic",
        id: "git",
        title: "Synthetic Git",
        model,
      },
    ];
    mockApi.getLastVault.mockResolvedValue(snapshot);
    mockApi.refreshVault.mockResolvedValue(snapshot);
    mockApi.readNote.mockResolvedValue({
      path: "sample.py",
      content: "print('synthetic')",
      contentHash: "sample-hash",
      encoding: "utf8",
      lineEnding: "lf",
      stats: noteStats(),
    });
    mockApi.saveNote.mockResolvedValue({
      path: "sample.py",
      changed: true,
      savedAt: "2026-01-01T00:00:00Z",
      contentHash: "saved-sample-hash",
      historyCount: 1,
      stats: noteStats(),
    });

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Open sample.py" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Change Edit sample.py" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Stage sample.py" }));

    await waitFor(() => {
      expect(mockApi.saveNote).toHaveBeenCalledWith(
        "sample.py",
        "print('synthetic') changed",
        "utf8",
        "lf",
        "flush",
        "sample-hash",
      );
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "stage", values: { path: "sample.py" } },
        "/synthetic-vault",
      );
      expect(mockApi.refreshVault).toHaveBeenCalled();
    });
    expect(
      mockApi.saveNote.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockPluginController.runSourceControlAction.mock.invocationCallOrder[0],
    );
  });

  it("saves open notes before an automatic commit and refreshes after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
      mockPluginController.automaticLocalCommits = [automaticCommitSchedule()];
      mockApi.getLastVault.mockResolvedValue(snapshot);
      mockApi.refreshVault.mockResolvedValue(snapshot);
      mockApi.readNote.mockResolvedValue({
        path: "sample.py",
        content: "print('synthetic')",
        contentHash: "sample-hash",
        encoding: "utf8",
        lineEnding: "lf",
        stats: noteStats(),
      });
      mockApi.saveNote.mockResolvedValue({
        path: "sample.py",
        changed: true,
        savedAt: "2026-01-01T00:00:00Z",
        contentHash: "saved-sample-hash",
        historyCount: 1,
        stats: noteStats(),
      });

      render(<App />);
      await user.click(
        await screen.findByRole("button", { name: "Open sample.py" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Change Edit sample.py" }),
      );
      // Nothing runs before the configured interval elapses.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockApi.pluginAutomaticCommit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      await waitFor(() => {
        expect(mockApi.pluginAutomaticCommit).toHaveBeenCalledWith(
          "denote.synthetic",
          {
            scheduleId: "denote.synthetic.nightly",
            message: "Synthetic automatic commit",
            includePatterns: [],
            excludePatterns: [],
            authorName: null,
            authorEmail: null,
          },
          "/synthetic-vault",
          null,
          expect.any(String),
        );
      });
      expect(mockApi.saveNote).toHaveBeenCalledWith(
        "sample.py",
        "print('synthetic') changed",
        "utf8",
        "lf",
        expect.any(String),
        "sample-hash",
      );
      expect(mockApi.saveNote.mock.invocationCallOrder[0]).toBeLessThan(
        mockApi.pluginAutomaticCommit.mock.invocationCallOrder[0],
      );
      await waitFor(() => {
        expect(mockApi.refreshVault).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(
          screen.getAllByText("Automatic commit 1111111").length,
        ).toBeGreaterThan(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an automatic commit that was skipped and reindexes nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockPluginController.automaticLocalCommits = [automaticCommitSchedule()];
      mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));
      mockApi.pluginAutomaticCommit.mockResolvedValue({
        status: "skipped",
        message: "Changes are already staged, so Denote left this commit to you.",
        commitId: null,
      });

      render(<App />);
      await screen.findByTestId("file-tree-expanded");
      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() => {
        expect(
          screen.getAllByText(
            "Automatic commit skipped: Changes are already staged, so Denote left this commit to you.",
          ).length,
        ).toBeGreaterThan(0);
      });
      expect(mockApi.refreshVault).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds no automatic commit timer while the vault is locked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const locked = workspaceSnapshot([]);
      locked.encryption = {
        enabled: true,
        unlocked: false,
        phase: "encrypted",
        remainingRecoveryCodes: 5,
      };
      mockPluginController.automaticLocalCommits = [automaticCommitSchedule()];
      mockApi.getLastVault.mockResolvedValue(locked);

      render(<App />);
      await screen.findByText("Synthetic vault is locked");
      await vi.advanceTimersByTimeAsync(300_000);

      expect(mockApi.pluginAutomaticCommit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

function automaticCommitSchedule(): PluginAutomaticLocalCommitContribution {
  return {
    pluginId: "denote.synthetic",
    id: "denote.synthetic.nightly",
    intervalMinutes: 1,
    message: "Synthetic automatic commit",
    includePatterns: [],
    excludePatterns: [],
    authorName: null,
    authorEmail: null,
  };
}

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

function appSourceControlModel(
  label: string,
): PluginSourceControlViewModel {
  return {
    selectedTab: "changes",
    selectedView: { kind: "repository" },
    repository: {
      repositoryId: "synthetic-repository",
      label,
      initialized: true,
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      latestCommit: null,
      busy: false,
    },
    resourceGroups: [],
    branches: [
      {
        name: "main",
        current: true,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ],
    remotes: [],
    history: [],
    diffFiles: [],
    conflicts: [],
    recovery: { state: "idle" },
  };
}
