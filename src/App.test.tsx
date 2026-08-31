import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode, WorkspaceSnapshot } from "./types";

const mockApi = vi.hoisted(() => ({
  getLastVault: vi.fn(),
  listSearchDocuments: vi.fn(),
}));

vi.mock("./lib/api", () => ({ api: mockApi }));
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
vi.mock("./components/FileTree", () => ({
  FileTree: ({
    expandedPaths,
  }: {
    nodes: FileNode[];
    expandedPaths: Set<string>;
  }) => (
    <output data-testid="file-tree-expanded">
      {[...expandedPaths].join(",")}
    </output>
  ),
}));

import App from "./App";

describe("App initial file-tree expansion", () => {
  beforeEach(() => {
    mockApi.listSearchDocuments.mockResolvedValue({
      documents: [],
      skippedCount: 0,
      truncated: false,
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
