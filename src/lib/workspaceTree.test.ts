import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import {
  applyWorkspaceBulkAction,
  closestAvailableProjectRoot,
  initialWorkspaceFolderPaths,
  insertWorkspaceNode,
  mergeBulkExpandedPaths,
  projectConfigurationFields,
  projectRootAtPath,
  projectRootLabel,
  projectWorkspaceAtPath,
  projectWorkspaceLabel,
  removeProjectConfigurationAtOrBelow,
  removeProjectRootsAtOrBelow,
  removeWorkspacePath,
  visibleWorkspaceRows,
  workspaceAncestorPaths,
  workspaceBulkActionState,
  workspaceBulkExpansion,
  workspaceFolderPaths,
  workspacePathMatches,
  withProjectConfiguration,
} from "./workspaceTree";

function node(
  path: string,
  kind: FileNode["kind"] = "markdown",
  children: FileNode[] = [],
): FileNode {
  const segments = path.split("/");
  return {
    path,
    name: segments[segments.length - 1] ?? path,
    kind,
    children,
    size: 0,
    modifiedAt: null,
    bookmarked: false,
    pinned: false,
  };
}

describe("workspace tree mutations", () => {
  it("removes an entry subtree without changing similarly prefixed paths", () => {
    const tree = [
      node("notes", "folder", [node("notes/a.md")]),
      node("notes-old", "folder", [node("notes-old/b.md")]),
    ];

    expect(removeWorkspacePath(tree, "notes")).toEqual([tree[1]]);
    expect(workspacePathMatches("notes/a.md", "notes")).toBe(true);
    expect(workspacePathMatches("notes-old/b.md", "notes")).toBe(false);
  });

  describe("closestAvailableProjectRoot", () => {
    const projectRoots = [
      {
        id: "vault",
        rootPath: "",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "app",
        rootPath: "code/app",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "nested",
        rootPath: "code/app/packages/ui",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "missing",
        rootPath: "code/app/packages/api",
        available: false,
        explicit: true,
        workspaceId: null,
      },
    ];

    it("returns the closest available nested root", () => {
      expect(
        closestAvailableProjectRoot(
          projectRoots,
          "code/app/packages/ui/button.ts",
        ),
      ).toEqual(projectRoots[2]);
      expect(
        closestAvailableProjectRoot(
          projectRoots,
          "code/app/packages/api/client.ts",
        ),
      ).toEqual(projectRoots[1]);
    });

    it("matches path components and falls back to the whole-vault root", () => {
      expect(
        closestAvailableProjectRoot(projectRoots, "code/application/readme.md"),
      ).toEqual(projectRoots[0]);
      expect(
        closestAvailableProjectRoot(projectRoots, "notes/project.md"),
      ).toEqual(projectRoots[0]);
    });

    it("returns null for null paths or when no available root matches", () => {
      expect(closestAvailableProjectRoot(projectRoots, null)).toBeNull();
      expect(
        closestAvailableProjectRoot(
          projectRoots.filter(({ id }) => id !== "vault"),
          "notes/project.md",
        ),
      ).toBeNull();
    });

    it("uses a deterministic result when duplicate roots are present", () => {
      expect(
        closestAvailableProjectRoot(
          [
            {
              id: "second",
              rootPath: "code",
              available: true,
              explicit: true,
              workspaceId: null,
            },
            {
              id: "first",
              rootPath: "code",
              available: true,
              explicit: true,
              workspaceId: null,
            },
          ],
          "code/main.ts",
        )?.id,
      ).toBe("first");
    });
  });

  it("finds exact project roots and labels them for display", () => {
    const projectRoots = [
      {
        id: "vault",
        rootPath: "",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "nested",
        rootPath: "code/packages/ui",
        available: true,
        explicit: true,
        workspaceId: null,
      },
    ];

    expect(projectRootAtPath(projectRoots, "code")).toBeNull();
    expect(projectRootAtPath(projectRoots, "code/packages/ui")).toEqual(
      projectRoots[1],
    );
    expect(projectRootLabel(projectRoots[0])).toBe("Vault root");
    expect(projectRootLabel(projectRoots[1])).toBe("ui");
  });

  it("finds exact project workspaces and labels them for display", () => {
    const projectWorkspaces = [
      {
        id: "vault-workspace",
        rootPath: "",
        available: true,
      },
      {
        id: "nested-workspace",
        rootPath: "code/packages",
        available: true,
      },
    ];

    expect(projectWorkspaceAtPath(projectWorkspaces, "code")).toBeNull();
    expect(projectWorkspaceAtPath(projectWorkspaces, "code/packages")).toEqual(
      projectWorkspaces[1],
    );
    expect(projectWorkspaceLabel(projectWorkspaces[0])).toBe("Vault root");
    expect(projectWorkspaceLabel(projectWorkspaces[1])).toBe("packages");
  });

  it("preserves every authoritative project configuration field", () => {
    const configuration = {
      projectRoots: [
        {
          id: "project",
          rootPath: "code/app",
          available: true,
          explicit: false,
          workspaceId: "workspace",
        },
      ],
      projectWorkspaces: [
        {
          id: "workspace",
          rootPath: "code",
          available: true,
        },
      ],
      suggestGitProject: true,
    };

    expect(projectConfigurationFields(configuration)).toEqual(configuration);
    expect(
      withProjectConfiguration(
        {
          ...configuration,
          projectRoots: [],
          projectWorkspaces: [],
          suggestGitProject: false,
          treeVersion: 2,
        },
        configuration,
      ),
    ).toEqual({ ...configuration, treeVersion: 2 });
  });

  it("removes project roots at or below a trashed path", () => {
    const projectRoots = [
      {
        id: "vault",
        rootPath: "",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "code",
        rootPath: "code",
        available: true,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "ui",
        rootPath: "code/packages/ui",
        available: false,
        explicit: true,
        workspaceId: null,
      },
      {
        id: "similar",
        rootPath: "code-old",
        available: true,
        explicit: true,
        workspaceId: null,
      },
    ];

    expect(removeProjectRootsAtOrBelow(projectRoots, "code")).toEqual([
      projectRoots[0],
      projectRoots[3],
    ]);
  });

  it("filters project and workspace roots together after trash", () => {
    const configuration = {
      projectRoots: [
        {
          id: "vault",
          rootPath: "",
          available: true,
          explicit: true,
          workspaceId: null,
        },
        {
          id: "child",
          rootPath: "code/app",
          available: true,
          explicit: false,
          workspaceId: "code-workspace",
        },
        {
          id: "similar",
          rootPath: "code-old",
          available: true,
          explicit: true,
          workspaceId: null,
        },
      ],
      projectWorkspaces: [
        {
          id: "code-workspace",
          rootPath: "code",
          available: true,
        },
        {
          id: "similar-workspace",
          rootPath: "code-old",
          available: true,
        },
      ],
      suggestGitProject: false,
    };

    expect(removeProjectConfigurationAtOrBelow(configuration, "code")).toEqual({
      projectRoots: [configuration.projectRoots[0], configuration.projectRoots[2]],
      projectWorkspaces: [configuration.projectWorkspaces[1]],
      suggestGitProject: false,
    });
  });

  it("inserts entries and synthesizes missing parent folders", () => {
    const inserted = insertWorkspaceNode(
      [node("existing.md")],
      node("new/nested/note.md"),
    );

    expect(inserted.map(({ path }) => path)).toEqual(["new", "existing.md"]);
    expect(inserted[0].children[0].path).toBe("new/nested");
    expect(inserted[0].children[0].children[0].path).toBe(
      "new/nested/note.md",
    );
  });

  it("places new entries after custom positions and alphabetically", () => {
    const inserted = insertWorkspaceNode(
      [
        { ...node("zebra.md"), position: 0 },
        node("banana.md"),
        node("pear.md"),
      ],
      node("mango.md"),
    );

    expect(inserted.map(({ path }) => path)).toEqual([
      "zebra.md",
      "banana.md",
      "mango.md",
      "pear.md",
    ]);
  });

  it("matches the backend code-point ordering for accented names", () => {
    const inserted = insertWorkspaceNode(
      [node("banana.md"), node("école.md")],
      node("Ärger.md"),
    );

    expect(inserted.map(({ path }) => path)).toEqual([
      "banana.md",
      "Ärger.md",
      "école.md",
    ]);
  });

  it("returns every parent path for expansion after restore", () => {
    expect(workspaceAncestorPaths("one/two/note.md")).toEqual([
      "one",
      "one/two",
    ]);
  });

  it("returns every nested folder path for recursive expansion", () => {
    expect(
      workspaceFolderPaths([
        node("notes", "folder", [
          node("notes/archive", "folder", [node("notes/archive/old.md")]),
        ]),
        node("root.md"),
      ]),
    ).toEqual(["notes", "notes/archive"]);
  });

  it("selects up to eight eligible top-level folders for initial expansion", () => {
    const excludedGit = node(".GIT", "folder");
    const excludedModules = node("Node_Modules", "folder");
    Object.defineProperty(excludedGit, "children", {
      configurable: true,
      get() {
        throw new Error("initial expansion must not traverse excluded folders");
      },
    });
    Object.defineProperty(excludedModules, "children", {
      configurable: true,
      get() {
        throw new Error("initial expansion must not traverse excluded folders");
      },
    });
    const eligibleFolders = Array.from({ length: 10 }, (_, index) =>
      node(`folder-${index}`, "folder", [node(`folder-${index}/nested.md`)]),
    );

    expect(
      initialWorkspaceFolderPaths([
        node("root.md"),
        excludedGit,
        eligibleFolders[0],
        excludedModules,
        ...eligibleFolders.slice(1),
      ]),
    ).toEqual(eligibleFolders.slice(0, 8).map(({ path }) => path));
  });

  it("excludes only .git and node_modules subtrees from bulk expansion", () => {
    const tree = [
      node("code", "folder", [
        node("code/.GIT", "folder", [
          node("code/.GIT/hooks", "folder", [node("code/.GIT/hooks/pre-commit")]),
        ]),
        node("code/Node_Modules", "folder", [
          node("code/Node_Modules/package", "folder"),
        ]),
        node("code/.github", "folder"),
        node("code/node_modules-old", "folder"),
      ]),
    ];

    expect(workspaceBulkExpansion(tree)).toEqual({
      folderPaths: ["code", "code/.github", "code/node_modules-old"],
      excludedRootPaths: ["code/.GIT", "code/Node_Modules"],
    });
  });

  it("preserves explicit excluded expansion until collapse all clears it", () => {
    const expansion = workspaceBulkExpansion([
      node("src", "folder"),
      node(".git", "folder", [
        node(".git/hooks", "folder"),
      ]),
      node("node_modules", "folder", [
        node("node_modules/package", "folder"),
      ]),
    ]);
    let expanded = mergeBulkExpandedPaths(
      expansion,
      new Set([".git", ".git/hooks", "node_modules/package", "stale"]),
    );

    expect([...expanded]).toEqual([
      "src",
      ".git",
      ".git/hooks",
      "node_modules/package",
    ]);
    expanded = new Set();
    expect(expanded).toEqual(new Set());
  });

  it("reports expand-all when any bulk-expandable folder remains collapsed", () => {
    const expansion = workspaceBulkExpansion([
      node("src", "folder"),
      node(".git", "folder"),
      node("node_modules", "folder"),
    ]);

    expect(
      workspaceBulkActionState(
        expansion,
        new Set([".git", "node_modules"]),
      ),
    ).toEqual({ action: "expand", disabled: false });
  });

  it("reports collapse-all when every bulk folder is expanded", () => {
    const expansion = workspaceBulkExpansion([
      node("src", "folder"),
      node(".git", "folder"),
    ]);

    expect(
      workspaceBulkActionState(expansion, new Set(["src", ".git"])),
    ).toEqual({ action: "collapse", disabled: false });
  });

  it("reports collapse-all for an excluded-only expanded tree", () => {
    const expansion = workspaceBulkExpansion([
      node(".git", "folder"),
      node("node_modules", "folder"),
    ]);

    expect(workspaceBulkActionState(expansion, new Set([".git"]))).toEqual({
      action: "collapse",
      disabled: false,
    });
    expect(workspaceBulkActionState(expansion, new Set())).toEqual({
      action: "expand",
      disabled: true,
    });
    expect(applyWorkspaceBulkAction(expansion, new Set([".git"]))).toEqual(
      new Set(),
    );
  });

  it("expands remaining bulk folders without clearing excluded expansion", () => {
    const expansion = workspaceBulkExpansion([
      node("src", "folder"),
      node("docs", "folder"),
      node(".git", "folder"),
    ]);

    expect(
      applyWorkspaceBulkAction(expansion, new Set(["src", ".git"])),
    ).toEqual(new Set(["src", "docs", ".git"]));
  });

  it("flattens visible rows in tree order with their depth", () => {
    const tree = [
      node("notes", "folder", [
        node("notes/today.md"),
        node("notes/archive", "folder", [
          node("notes/archive/old.md"),
        ]),
      ]),
      node("root.md"),
    ];

    expect(
      visibleWorkspaceRows(tree, new Set(["notes", "notes/archive"])).map(
        ({ node: rowNode, depth }) => [rowNode.path, depth],
      ),
    ).toEqual([
      ["notes", 0],
      ["notes/today.md", 1],
      ["notes/archive", 1],
      ["notes/archive/old.md", 2],
      ["root.md", 0],
    ]);
    expect(
      visibleWorkspaceRows(tree, new Set()).map(({ node: rowNode, depth }) => [
        rowNode.path,
        depth,
      ]),
    ).toEqual([
      ["notes", 0],
      ["root.md", 0],
    ]);
  });

  it("handles deep trees iteratively with one child-list visit per folder", () => {
    const depth = 3_000;
    const expandedPaths = new Set<string>();
    let childrenReads = 0;
    let child: FileNode = node("leaf.md");
    for (let index = depth - 1; index >= 0; index -= 1) {
      const path = `folder-${index}`;
      expandedPaths.add(path);
      const children = [child];
      const folder = node(path, "folder", children);
      Object.defineProperty(folder, "children", {
        configurable: true,
        get() {
          childrenReads += 1;
          return children;
        },
      });
      child = folder;
    }
    const tree = [child];

    const rows = visibleWorkspaceRows(tree, expandedPaths);
    expect(rows).toHaveLength(depth + 1);
    expect(rows[rows.length - 1]).toEqual({
      node: expect.objectContaining({ path: "leaf.md" }),
      depth,
    });
    expect(childrenReads).toBe(depth);

    childrenReads = 0;
    expect(workspaceFolderPaths(tree)).toHaveLength(depth);
    expect(childrenReads).toBe(depth);

    childrenReads = 0;
    expect(workspaceBulkExpansion(tree).folderPaths).toHaveLength(depth);
    expect(childrenReads).toBe(depth);
  });
});
