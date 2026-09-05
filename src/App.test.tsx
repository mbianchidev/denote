import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import type {
  PluginEmojiPickerContribution,
  PluginAutomaticLocalCommitContribution,
  PluginSourceControlContribution,
} from "./plugins/workerRuntime";
import type { FileNode, PluginView, WorkspaceSnapshot } from "./types";
import { $getRoot, $getSelection, $isRangeSelection, KEY_DOWN_COMMAND, type LexicalEditor } from "lexical";
import { syntheticEmojiPicker, syntheticEmojiPluginView } from "./lib/emoji.testFixtures";

const mockApi = vi.hoisted(() => ({
  getLastVault: vi.fn(),
  listKnownVaultFiles: vi.fn(),
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
  plugins: [] as PluginView[],
  bundles: [],
  commands: [],
  sidebarViews: [],
  statusItems: [],
  decorations: [],
  sourceControlProviders: [] as PluginSourceControlContribution[],
  automaticLocalCommits: [] as PluginAutomaticLocalCommitContribution[],
  emojiPickers: [] as PluginEmojiPickerContribution[],
  saveEmojiPreferences: vi.fn().mockResolvedValue(undefined),
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
  openClonedVault: (async () => {}) as (
    snapshot: unknown,
  ) => void | Promise<void>,
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
const mockOpener = vi.hoisted(() => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));
const trackAppRender = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => mockOpener);
vi.mock("./plugins/usePlugins", () => ({
  usePlugins: (
    _reportError: unknown,
    _projectContext: unknown,
    _workspaceIdentity: unknown,
    onVaultCloned: (snapshot: unknown) => void | Promise<void>,
  ) => {
    trackAppRender();
    // The host's clone callback is captured so a test can drive the exact
    // renderer signal a cloned vault produces.
    mockPluginController.openClonedVault = onVaultCloned;
    return mockPluginController;
  },
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
      <output aria-label={`Content of ${ariaLabel}`}>{value}</output>
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
    mockPluginController.emojiPickers = [];
    mockPluginController.plugins = [];
    mockPluginController.busyPluginIds = new Set();
    mockApi.listKnownVaultFiles.mockResolvedValue({ files: [], truncated: false });
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

  it("generates an editor-only emoji command and preserves selection through the command palette", async () => {
      const picker = syntheticEmojiPicker();
      mockPluginController.emojiPickers = [picker];
      mockPluginController.plugins = [syntheticEmojiPluginView()];
      mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([fileNode("synthetic.md")]));
      const { container } = render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Open synthetic.md" }));
      const root = await screen.findByRole("textbox", { name: "editable markdown" });
      const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      await act(async () => {
        root.focus();
        editor.update(() => $getRoot().getAllTextNodes()[0].select(0, 9), { discrete: true });
      });
      fireEvent.keyDown(window, { key: "p", code: "KeyP", ctrlKey: true });
      const dialog = await screen.findByRole("dialog", { name: "Command palette" });
      fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "Emoji picker" } });
      fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
      await screen.findByRole("dialog", { name: "Emoji picker" });
      fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
      await waitFor(() => expect(container.querySelector(".denote-editor-content")).toHaveTextContent("😀.md content"));
      expect(mockPluginController.runCommand).not.toHaveBeenCalled();
      expect(mockPluginController.saveEmojiPreferences).toHaveBeenCalledWith("test.emoji", "picker", {
        recents: ["😀"], favorites: [], tone: 0,
      });
    });

  it("navigates emoji suggestions without rerendering the workspace", async () => {
    const picker = syntheticEmojiPicker();
    picker.entries[1].shortcodes = ["smirk"];
    mockPluginController.emojiPickers = [picker];
    mockPluginController.plugins = [syntheticEmojiPluginView()];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([fileNode("synthetic.md")]));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open synthetic.md" }));
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    await act(async () => {
      root.focus();
      editor.update(() => $getRoot().getAllTextNodes()[0].selectEnd(), { discrete: true });
      editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "m" }));
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(" :sm");
      }, { discrete: true });
    });
    expect(screen.getByLabelText("Emoji suggestions")).toBeVisible();
    trackAppRender.mockClear();
    for (let index = 0; index < 5; index++) {
      fireEvent.keyDown(root, { key: "ArrowDown" });
      fireEvent.keyDown(root, { key: "ArrowUp" });
    }
    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    expect(trackAppRender).not.toHaveBeenCalled();
  });

  it("opens emoji with the host shortcut and removes surfaces when disabled", async () => {
      mockPluginController.emojiPickers = [syntheticEmojiPicker()];
      mockPluginController.plugins = [syntheticEmojiPluginView()];
      mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([fileNode("synthetic.md")]));
      const { rerender } = render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Open synthetic.md" }));
      const root = await screen.findByRole("textbox", { name: "editable markdown" });
      const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      await act(async () => { root.focus(); editor.update(() => $getRoot().getAllTextNodes()[0].selectEnd(), { discrete: true }); });
      fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true });
      expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeInTheDocument();
      mockPluginController.emojiPickers = [];
      rerender(<App />);
      expect(screen.queryByRole("dialog", { name: "Emoji picker" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true });
      expect(screen.queryByRole("dialog", { name: "Emoji picker" })).not.toBeInTheDocument();
    });
  it("reports malformed persisted emoji preferences outside render without crashing", async () => {
    const plugin = syntheticEmojiPluginView();
    plugin.settings.favorite = "{";
    mockPluginController.emojiPickers = [syntheticEmojiPicker()];
    mockPluginController.plugins = [plugin];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([fileNode("synthetic.md")]));
    render(<App />);
    expect(await screen.findByText("Invalid emoji preferences. Reset this plugin's settings.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open synthetic.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
  });

  it("withholds pre-commit emoji contributions and immediately removes busy or disabled pickers", async () => {
    const plugin = syntheticEmojiPluginView();
    mockPluginController.emojiPickers = [syntheticEmojiPicker()];
    mockPluginController.plugins = [{ ...plugin, enabled: false, status: "installing" }];
    mockPluginController.busyPluginIds = new Set(["test.emoji"]);
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([fileNode("synthetic.md")]));
    const { rerender } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open synthetic.md" }));
    await screen.findByRole("textbox", { name: "editable markdown" });
    expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
    mockPluginController.plugins = [{ ...plugin, status: "update-available" }];
    rerender(<App />);
    expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
    mockPluginController.busyPluginIds = new Set();
    rerender(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Emoji picker" }));
    expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeInTheDocument();
    mockPluginController.busyPluginIds = new Set(["test.emoji"]);
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Emoji picker" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
    mockPluginController.busyPluginIds = new Set();
    mockPluginController.plugins = [{ ...plugin, enabled: false, status: "disabled" }];
    rerender(<App />);
    expect(screen.queryByRole("button", { name: "Emoji picker" })).not.toBeInTheDocument();
    expect(mockPluginController.saveEmojiPreferences).not.toHaveBeenCalled();
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

  it("keeps a signing passphrase host-only when committing", async () => {
    const user = userEvent.setup();
    const snapshot = workspaceSnapshot([]);
    const model = appSourceControlModel("Synthetic repository");
    model.resourceGroups = [
      {
        kind: "staged",
        label: "Staged changes",
        resources: [
          {
            path: "notes/signed.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(snapshot);
    mockApi.refreshVault.mockResolvedValue(snapshot);

    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );
    await user.type(screen.getByLabelText("Commit message"), "Signed change");
    await user.type(
      screen.getByLabelText(/Signing passphrase/),
      "synthetic-passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: "Commit" }),
    );

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "commit", values: { message: "Signed change", sign: true } },
        "/synthetic-vault",
        { gitSigningPassphrase: "synthetic-passphrase" },
      );
    });
  });

  it("opens a file a source control row names, in the focused pane", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.resourceGroups = [
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "notes/changed.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    // Two panes, so opening has to reach the focused one rather than either.
    mockApi.getLastVault.mockResolvedValue(
      splitPaneSnapshot([
        fileNode("first.txt", "text"),
        fileNode("second.txt", "text"),
        fileNode("third.txt", "text"),
        folderNode("notes", [fileNode("notes/changed.md")]),
      ]),
    );

    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open file notes/changed.md" }),
    );

    await waitFor(() => {
      expect(mockApi.readNote).toHaveBeenCalledWith("notes/changed.md");
    });
    // The provider named a repository-relative path, and that is the only
    // thing the host ever used: no absolute path was built or opened.
    expect(mockOpener.openPath).not.toHaveBeenCalled();
    expect(mockOpener.revealItemInDir).not.toHaveBeenCalled();
    for (const [path] of mockApi.readNote.mock.calls) {
      expect(path).not.toContain("/synthetic-vault");
    }
    const focusedPane = document.querySelector("[data-pane-id='pane-1']");
    expect(focusedPane).not.toBeNull();
    expect(
      within(focusedPane as HTMLElement).getByRole("button", {
        name: "Close notes/changed.md",
      }),
    ).toBeInTheDocument();
  });

  it("opens a loaded source-control patch as a temporary .diff editor tab", async () => {
    const model = appSourceControlModel("Synthetic repository");
    model.selectedView = { kind: "diff", path: "notes/draft.md" };
    model.diffSource = { kind: "index" };
    model.diffFiles = [
      {
        path: "notes/draft.md",
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
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        folderNode("notes", [fileNode("notes/draft.md", "markdown")]),
      ]),
    );

    render(<App />);

    const close = await screen.findByRole("button", {
      name: "Close draft.staged.diff",
    });
    expect(
      screen.getByRole("region", { name: "Diff draft.staged.diff" }),
    ).toBeInTheDocument();
    await userEvent.setup().click(close);
    expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
      "denote.synthetic",
      "git",
      { id: "close-diff" },
      "/synthetic-vault",
    );
  });

  it("says so when a file a commit names is no longer in the vault", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.selectedTab = "history";
    model.selectedView = { kind: "commit", commitId: "commit-1" };
    const commit = {
      id: "commit-1",
      shortId: "abc1234",
      summary: "Rename and delete synthetic notes",
      authorName: "Example Author",
      authoredAt: "2026-01-01T00:00:00Z",
      parentIds: [],
      refs: [],
    };
    model.history = [commit];
    model.commitDetail = {
      commit,
      limitation: null,
      files: [
        {
          path: "notes/new name.md",
          previousPath: "notes/old name.md",
          status: "renamed",
          additions: 0,
          deletions: 0,
          binary: false,
          hunks: [],
        },
        {
          path: "notes/vanished.md",
          previousPath: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          hunks: [],
        },
      ],
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    // Only the renamed file's current path still exists on disk.
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([
        folderNode("notes", [fileNode("notes/new name.md")]),
      ]),
    );

    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Source control: Synthetic Git",
      }),
    );

    // A rename is navigated by the name the file has now, never the one it
    // had before the commit.
    expect(
      screen.queryByRole("button", { name: "Open file notes/old name.md" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", {
        name: "Open file notes/new name.md",
      })[0],
    );
    await waitFor(() => {
      expect(mockApi.readNote).toHaveBeenCalledWith("notes/new name.md");
    });

    await user.click(
      screen.getByRole("button", { name: "Open file notes/vanished.md" }),
    );
    expect(
      await screen.findByText(
        /Denote could not open notes\/vanished.md because it is no longer in this vault/,
      ),
    ).toBeInTheDocument();
    expect(mockApi.readNote).not.toHaveBeenCalledWith("notes/vanished.md");
  });

  it("resolves a project-scoped path inside the project, and refuses one that leaves the vault", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.resourceGroups = [
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "alpha.txt",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
          {
            path: "../outside.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    const snapshot = workspaceSnapshot([
      folderNode("code", [fileNode("code/alpha.txt", "text")]),
    ]);
    mockApi.getLastVault.mockResolvedValue({
      ...snapshot,
      restoreTabs: true,
      tabSession: {
        tabs: [{ path: "code/alpha.txt", groupId: null }],
        groups: [],
        activePath: "code/alpha.txt",
        panes: [
          {
            id: "pane-1",
            tabs: [{ path: "code/alpha.txt", groupId: null }],
            groups: [],
            activePath: "code/alpha.txt",
          },
        ],
        layout: { kind: "horizontal", sizes: [1] },
        focusedPaneId: "pane-1",
      },
      projectRoots: [
        {
          id: "project-1",
          rootPath: "code",
          available: true,
          explicit: true,
          workspaceId: null,
        },
      ],
    });

    render(<App />);
    await screen.findByLabelText("Content of Edit code/alpha.txt");
    await user.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );
    mockApi.readNote.mockClear();

    await user.click(
      screen.getByRole("button", { name: "Open file alpha.txt" }),
    );
    // The repository is the project, so its paths are resolved inside it.
    expect(
      screen.queryByText(/is not inside this vault/),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open file ../outside.md" }),
    );
    expect(
      await screen.findByText(
        /Denote cannot open ..\/outside.md because it is not inside this vault/,
      ),
    ).toBeInTheDocument();
    for (const [path] of mockApi.readNote.mock.calls) {
      expect(path).not.toContain("..");
    }
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

  it("confirms a push before it runs and names the exact remote and branch", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.remotes = [
      {
        name: "origin",
        fetchUrl: "https://example.invalid/repo.git",
        pushUrl: "https://example.invalid/repo.git",
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Push" }));

    expect(
      await screen.findByText(/Push "main" to "origin"\?/),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    // The dialog has a close icon labelled "Cancel" as well, so the footer
    // button is matched by its visible text.
    await user.click(within(dialog).getByText("Cancel"));
    expect(mockPluginController.runSourceControlAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Push" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Push",
      }),
    );
    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "push", values: { remote: "origin", branch: "main" } },
        "/synthetic-vault",
      );
    });
  });

  it("confirms a rebase as history rewriting before it starts", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.operationPlan = {
      operation: "rebase",
      source: "topic",
      sourceDetail: "Local branch.",
      currentBranch: "main",
      risk: "rewrites-history",
      summary: "Replay the commits of main on top of topic.",
      affectedPaths: [],
      affectedPathsLimitation: null,
      startActionId: "rebase",
      cancelActionId: "cancel-operation-plan",
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Start rebase" }));

    // The confirmation names both the branch that is rewritten and the branch
    // it is replayed onto, from the review the provider published.
    expect(
      await screen.findByText(/Rebase "main" onto "topic"\?/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rewrites the commits on "main"/),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Start rebase" }));

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        {
          id: "rebase",
          values: { ref: "topic", operation: "rebase", from: "main" },
        },
        "/synthetic-vault",
      );
      // A rebase replaces files on disk, so the vault is read again.
      expect(mockApi.refreshVault).toHaveBeenCalled();
    });
  });

  it("names the reviewed branch when confirming a cherry-pick", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.operationPlan = {
      operation: "cherry-pick",
      source: "0000000000000000000000000000000000000001",
      sourceDetail: "0000001 · Record a synthetic note",
      currentBranch: "release",
      risk: "creates-commit",
      summary: "Record that commit again on release.",
      affectedPaths: [],
      affectedPathsLimitation: null,
      startActionId: "cherry-pick",
      cancelActionId: "cancel-operation-plan",
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Start cherry-pick" }));

    // The branch is named exactly, never as "the current branch".
    expect(
      await screen.findByText(/into "release"\?/),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Start cherry-pick" }),
    );

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        {
          id: "cherry-pick",
          values: {
            commitId: "0000000000000000000000000000000000000001",
            operation: "cherry-pick",
            from: "release",
          },
        },
        "/synthetic-vault",
      );
    });
  });

  it("confirms committing before a rebase as the rebase it will run", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.pendingBranchSwitch = {
      operation: "rebase",
      target: "topic",
      localBranch: null,
      fromBranch: "main",
      stagedPaths: ["ready.md"],
      unstagedPaths: [],
      untrackedPaths: [],
      commitAvailable: true,
      stashAvailable: true,
      stashUnavailableReason: null,
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.type(
      screen.getByLabelText("Commit message for the rebase"),
      "Save before rebasing",
    );
    await user.click(
      screen.getByRole("button", { name: "Commit all and rebase" }),
    );

    // The confirmation names the rebase, not a branch switch, and is dangerous.
    expect(
      await screen.findByText(/then rebase "topic"\?/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rewrites the commits on "main"/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Commit and rebase" }),
    );
    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        {
          id: "branch-switch-commit",
          values: {
            message: "Save before rebasing",
            sign: true,
            branch: "topic",
            from: "main",
            operation: "rebase",
          },
        },
        "/synthetic-vault",
      );
    });
  });

  it("confirms skipping and aborting by the operation Git reports", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.operationProgress = {
      operation: "cherry-pick",
      summary: "A cherry-pick is in progress.",
      conflictedPaths: [],
      continueAvailable: true,
      continueUnavailableReason: null,
      skipAvailable: true,
      abortAvailable: true,
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Skip this step of the cherry-pick" }),
    );
    expect(
      await screen.findByText(/Skip this step of the cherry-pick\?/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip the step" }));
    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "skip", values: { sequencer: "cherry-pick" } },
        "/synthetic-vault",
      );
    });

    await user.click(
      screen.getByRole("button", { name: "Abort the cherry-pick" }),
    );
    expect(
      await screen.findByText(/Abort the cherry-pick\?/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abort" }));
    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "abort", values: { sequencer: "cherry-pick" } },
        "/synthetic-vault",
      );
    });
  });

  it("reloads open tabs and closes a file a conflict resolution removed", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.selectedView = { kind: "conflict", path: "notes/alpha.txt" };
    model.conflicts = [
      {
        path: "notes/alpha.txt",
        status: "unmerged",
        oursLabel: "main",
        theirsLabel: "Incoming change",
        baseLabel: "Common ancestor",
      },
    ];
    model.conflictDetail = {
      path: "notes/alpha.txt",
      operation: "merge",
      binary: true,
      encrypted: false,
      base: {
        side: "base",
        label: "Common ancestor",
        present: false,
        text: null,
        byteLength: 0,
      },
      ours: {
        side: "ours",
        label: "main",
        present: true,
        text: null,
        byteLength: 12,
      },
      theirs: {
        side: "theirs",
        label: "Incoming change",
        present: true,
        text: null,
        byteLength: 14,
      },
      chunks: [],
      result: null,
      unsavedResult: false,
      unresolvedChunks: 0,
      wholeSideOnly: true,
      limitation: "Git recorded this file as binary content.",
      status: null,
      error: null,
      loading: false,
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    const before = workspaceSnapshot([
      folderNode("notes", [fileNode("notes/alpha.txt", "text")]),
    ]);
    mockApi.getLastVault.mockResolvedValue({
      ...before,
      restoreTabs: true,
      tabSession: {
        tabs: [{ path: "notes/alpha.txt", groupId: null }],
        groups: [],
        activePath: "notes/alpha.txt",
        panes: [
          {
            id: "pane-1",
            tabs: [{ path: "notes/alpha.txt", groupId: null }],
            groups: [],
            activePath: "notes/alpha.txt",
          },
        ],
        layout: { kind: "horizontal", sizes: [1] },
        focusedPaneId: "pane-1",
      },
    });
    // Resolving the conflict removed the file from the working tree.
    mockApi.refreshVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await screen.findByLabelText("Content of Edit notes/alpha.txt");
    await user.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Resolve notes/alpha.txt with Incoming change",
      }),
    );
    expect(
      await screen.findByText(/exactly as Git recorded it/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use that side" }));

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "resolve-conflict-stage", values: { side: "theirs" } },
        "/synthetic-vault",
      );
    });
    // The tab whose file disappeared is closed and reported, exactly as a
    // checkout that removes a file does.
    expect(
      (await screen.findAllByText(/whose file is not on this branch/)).length,
    ).toBeGreaterThan(0);
  });

  it("confirms removing a remote and deleting an incomplete clone", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.selectedTab = "branches";
    model.selectedView = { kind: "remotes" };
    model.remotes = [
      {
        name: "origin",
        fetchUrl: "https://example.invalid/repo.git",
        pushUrl: "https://example.invalid/repo.git",
      },
    ];
    model.remoteAccess = {
      ...model.remoteAccess,
      cleanup: { token: "synthetic-token", label: "the folder you chose" },
    };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove the origin remote" }),
    );
    expect(
      await screen.findByText(/Remove the "origin" remote\?/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove remote" }));

    await user.click(screen.getByRole("button", { name: "Switch vault" }));
    await user.click(
      await screen.findByRole("button", { name: "Clone repo as vault" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Clean incomplete clone" }),
    );
    expect(
      await screen.findByText(/Permanently delete the folder/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete the folder" }));

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        { id: "clean-failed-clone", values: { token: "synthetic-token" } },
        "/synthetic-vault",
      );
    });
  });

  it("opens a cloned vault from the host signal and never shows the old one", async () => {
    mockApi.getLastVault.mockResolvedValue(
      workspaceSnapshot([fileNode("old-note.md", "markdown")]),
    );
    mockPluginController.sourceControlProviders = [
      {
        pluginId: "denote.synthetic",
        id: "git",
        title: "Synthetic Git",
        model: appSourceControlModel("Synthetic repository"),
      },
    ];

    render(<App />);
    expect(
      await screen.findByRole("button", { name: "Open old-note.md" }),
    ).toBeInTheDocument();

    const cloned: WorkspaceSnapshot = {
      ...workspaceSnapshot([fileNode("cloned-note.md", "markdown")]),
      vaultPath: "/synthetic-clone",
      vaultName: "Cloned vault",
    };
    await act(async () => {
      await mockPluginController.openClonedVault(cloned);
    });

    expect(
      await screen.findByRole("button", { name: "Open cloned-note.md" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open old-note.md" }),
    ).not.toBeInTheDocument();
  });

  it("saves open notes before a clone runs and before the clone opens", async () => {
    const user = userEvent.setup();
    const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
    const model = appSourceControlModel("Synthetic repository");
    model.remoteAccess = { ...model.remoteAccess, cloneAvailable: true };
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
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
    // A clone hands the renderer the new workspace from inside the action, the
    // same way the plugin runtime does.
    mockPluginController.runSourceControlAction.mockImplementation(async () => {
      await mockPluginController.openClonedVault({
        ...workspaceSnapshot([fileNode("cloned-note.md", "markdown")]),
        vaultPath: "/synthetic-clone",
        vaultName: "Cloned vault",
      });
    });

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Open sample.py" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Change Edit sample.py" }),
    );
    await user.click(screen.getByRole("button", { name: "Switch vault" }));
    await user.click(
      await screen.findByRole("button", { name: "Clone repo as vault" }),
    );
    await user.type(
      screen.getByLabelText("Repository URL"),
      "https://example.invalid/repo.git",
    );
    await user.click(
      screen.getByRole("button", { name: "Choose folder and clone" }),
    );
    // The host owns the confirmation, and it names the repository.
    expect(
      await screen.findByText(/Clone https:\/\/example.invalid\/repo.git/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose a folder" }));

    await waitFor(() => {
      expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
        "denote.synthetic",
        "git",
        {
          id: "clone",
          values: { url: "https://example.invalid/repo.git" },
        },
        "/synthetic-vault",
      );
    });
    // The edit was flushed by the workspace transaction the clone action
    // opened, before the clone ran and therefore before the vault was
    // replaced. Nothing typed into the previous vault is lost.
    expect(mockApi.saveNote).toHaveBeenCalledWith(
      "sample.py",
      "print('synthetic') changed",
      "utf8",
      "lf",
      expect.any(String),
      "sample-hash",
    );
    expect(mockApi.saveNote.mock.invocationCallOrder[0]).toBeLessThan(
      mockPluginController.runSourceControlAction.mock.invocationCallOrder[0],
    );
    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(
      await screen.findByRole("button", { name: "Open cloned-note.md" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open sample.py" }),
    ).not.toBeInTheDocument();
    // The vault the clone replaced is not refreshed afterwards, because it is
    // no longer the vault that is open.
    expect(mockApi.refreshVault).not.toHaveBeenCalled();
  });

  it("shows the unlock screen when a cloned vault is encrypted", async () => {
    mockApi.getLastVault.mockResolvedValue(workspaceSnapshot([]));

    render(<App />);
    await screen.findByRole("button", { name: "Files" });

    const locked: WorkspaceSnapshot = {
      ...workspaceSnapshot([fileNode("cloned-note.md", "markdown")]),
      vaultPath: "/synthetic-encrypted-clone",
      vaultName: "Encrypted clone",
      encryption: {
        enabled: true,
        unlocked: false,
        phase: "encrypted",
        remainingRecoveryCodes: 5,
      },
    };
    await act(async () => {
      await mockPluginController.openClonedVault(locked);
    });

    expect(
      await screen.findByRole("heading", { name: /locked/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open cloned-note.md" }),
    ).not.toBeInTheDocument();
  });

  it("saves open notes before an automatic commit and refreshes after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date(2026, 8, 4, 9, 7));
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
            message: "Synthetic automatic commit 2026-09-04 09:08",
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

  it("reloads every open tab from disk after a checkout and closes only what disappeared", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.selectedTab = "branches";
    model.selectedView = { kind: "branches" };
    model.branches = [
      {
        name: "main",
        current: true,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
      {
        name: "topic",
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];

    // Two panes, so the reconciliation has to keep the layout as well as the
    // content.
    const opened = splitPaneSnapshot([
      fileNode("kept.txt", "text"),
      fileNode("changed.txt", "text"),
      fileNode("branch-only.txt", "text"),
    ]);
    const afterCheckout = splitPaneSnapshot([
      fileNode("kept.txt", "text"),
      fileNode("changed.txt", "text"),
    ]);
    mockApi.getLastVault.mockResolvedValue(opened);
    mockApi.refreshVault.mockResolvedValue(afterCheckout);
    const contents = new Map([
      ["kept.txt", "kept before"],
      ["changed.txt", "changed before"],
      ["branch-only.txt", "only on this branch"],
    ]);
    mockApi.readNote.mockImplementation(async (path: string) => {
      const content = contents.get(path);
      if (content === undefined) {
        throw new Error(`Unable to find ${path}`);
      }
      return {
        path,
        content,
        contentHash: `${path}-hash`,
        encoding: "utf8",
        lineEnding: "lf",
        stats: noteStats(),
      };
    });
    mockPluginController.runSourceControlAction.mockImplementation(async () => {
      contents.set("changed.txt", "changed after the checkout");
      contents.delete("branch-only.txt");
    });

    render(<App />);
    expect(
      await screen.findByLabelText("Content of Edit changed.txt"),
    ).toHaveTextContent("changed before");
    expect(
      screen.getByLabelText("Content of Edit branch-only.txt"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Switch branch",
      }),
    );

    await waitFor(
      () => {
        expect(mockPluginController.runSourceControlAction).toHaveBeenCalledWith(
          "denote.synthetic",
          "git",
          { id: "switch-branch", values: { branch: "topic", from: "main" } },
          "/synthetic-vault",
        );
      },
      { timeout: 5000 },
    );
    // The tab that still exists is reloaded with the checked-out content.
    await waitFor(
      () => {
        expect(
          screen.getByLabelText("Content of Edit changed.txt"),
        ).toHaveTextContent("changed after the checkout");
      },
      { timeout: 5000 },
    );
    // The one whose file the checkout removed is closed, and named.
    await waitFor(
      () => {
        expect(
          screen.queryByLabelText("Content of Edit branch-only.txt"),
        ).not.toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(
      screen.getAllByText(/Closed 1 tab whose file is not on this branch/)[0],
    ).toBeInTheDocument();
    // Everything else survives: pane layout, tab order, and the tabs whose
    // files the checkout left alone.
    expect(
      screen.getByRole("button", { name: "Close kept.txt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close changed.txt" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close branch-only.txt" }),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-pane-id]")).toHaveLength(2);
  });

  it("keeps an unsaved placeholder tab through a worktree-changing action", async () => {
    const user = userEvent.setup();
    const model = appSourceControlModel("Synthetic repository");
    model.selectedTab = "branches";
    model.selectedView = { kind: "branches" };
    model.branches = [
      {
        name: "main",
        current: true,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
      {
        name: "topic",
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
    mockApi.getLastVault.mockResolvedValue(snapshot);
    mockApi.refreshVault.mockResolvedValue(snapshot);

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "New tab" }));
    expect(
      await screen.findByRole("button", { name: "Close New tab" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );
    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Switch branch",
      }),
    );

    await waitFor(
      () => {
        expect(mockPluginController.runSourceControlAction).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    // A placeholder has a synthetic path rather than a vault path, so it is
    // neither reloaded nor reported as a file the branch does not have.
    expect(
      screen.getByRole("button", { name: "Close New tab" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/whose file is not on this branch/),
    ).not.toBeInTheDocument();
  });

  it("flushes unsaved editor content before a checkout replaces it", async () => {
    const model = appSourceControlModel("Synthetic repository");
    model.selectedTab = "branches";
    model.selectedView = { kind: "branches" };
    model.branches = [
      {
        name: "main",
        current: true,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
      {
        name: "topic",
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ];
    mockPluginController.sourceControlProviders = [
      { pluginId: "denote.synthetic", id: "git", title: "Synthetic Git", model },
    ];
    const snapshot = workspaceSnapshot([fileNode("sample.py", "text")]);
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Open sample.py" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Change Edit sample.py" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Source control: Synthetic Git" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to topic" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Switch branch",
      }),
    );

    await waitFor(
      () => {
        expect(mockApi.saveNote).toHaveBeenCalledWith(
          "sample.py",
          "print('synthetic') changed",
          "utf8",
          "lf",
          "flush",
          "sample-hash",
        );
      },
      { timeout: 5000 },
    );
    // The save happens before Git runs, so a checkout can never overwrite an
    // edit that was still only in the editor.
    expect(mockApi.saveNote.mock.invocationCallOrder[0]).toBeLessThan(
      mockPluginController.runSourceControlAction.mock.invocationCallOrder[0],
    );
  });

});

function automaticCommitSchedule(): PluginAutomaticLocalCommitContribution {
  return {
    pluginId: "denote.synthetic",
    id: "denote.synthetic.nightly",
    intervalMinutes: 1,
    message: "Synthetic automatic commit {timestamp}",
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

/** One folder with its children, so a test can name a nested path. */
function folderNode(path: string, children: FileNode[]): FileNode {
  return {
    ...fileNode(path, "folder"),
    name: path.split("/").slice(-1)[0] ?? path,
    children,
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

/** Two panes restored from a synthetic tab session, so a test can split. */
function splitPaneSnapshot(tree: FileNode[]): WorkspaceSnapshot {
  const snapshot = workspaceSnapshot(tree);
  const paths = tree.map((node) => node.path);
  return {
    ...snapshot,
    restoreTabs: true,
    tabSession: {
      tabs: paths.map((path) => ({ path, groupId: null })),
      groups: [],
      activePath: paths[1] ?? null,
      panes: [
        {
          id: "pane-1",
          tabs: paths.slice(0, 2).map((path) => ({ path, groupId: null })),
          groups: [],
          activePath: paths[1] ?? null,
        },
        {
          id: "pane-2",
          tabs: paths.slice(2).map((path) => ({ path, groupId: null })),
          groups: [],
          activePath: paths[2] ?? null,
        },
      ],
      layout: { kind: "horizontal", sizes: [0.5, 0.5] },
      focusedPaneId: "pane-1",
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
    historyPage: {
      pageIndex: 0,
      pageSize: 20,
      hasPrevious: false,
      hasNext: false,
      loading: false,
      error: null,
    },
    commitDetail: null,
    diffFiles: [],
    diffSource: null,
    conflicts: [],
    conflictDetail: null,
    operationProgress: null,
    operationPlan: null,
    recovery: { state: "idle" },
    pendingBranchSwitch: null,
    remoteAccess: {
      authMode: "public" as const,
      cloneAvailable: true,
      githubAvailable: false,
      repositories: [],
      cleanup: null,
      review: null,
    },
  };
}
