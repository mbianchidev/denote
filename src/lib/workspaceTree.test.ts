import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import {
  closestAvailableProjectRoot,
  insertWorkspaceNode,
  projectConfigurationFields,
  projectRootAtPath,
  projectRootLabel,
  projectWorkspaceAtPath,
  projectWorkspaceLabel,
  removeProjectConfigurationAtOrBelow,
  removeProjectRootsAtOrBelow,
  removeWorkspacePath,
  workspaceAncestorPaths,
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
});
