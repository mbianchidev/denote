import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import {
  closestAvailableProjectRoot,
  insertWorkspaceNode,
  projectRootAtPath,
  projectRootLabel,
  removeProjectRootsAtOrBelow,
  removeWorkspacePath,
  workspaceAncestorPaths,
  workspaceFolderPaths,
  workspacePathMatches,
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
      { id: "vault", rootPath: "", available: true },
      { id: "app", rootPath: "code/app", available: true },
      { id: "nested", rootPath: "code/app/packages/ui", available: true },
      { id: "missing", rootPath: "code/app/packages/api", available: false },
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
            { id: "second", rootPath: "code", available: true },
            { id: "first", rootPath: "code", available: true },
          ],
          "code/main.ts",
        )?.id,
      ).toBe("first");
    });
  });

  it("finds exact project roots and labels them for display", () => {
    const projectRoots = [
      { id: "vault", rootPath: "", available: true },
      { id: "nested", rootPath: "code/packages/ui", available: true },
    ];

    expect(projectRootAtPath(projectRoots, "code")).toBeNull();
    expect(projectRootAtPath(projectRoots, "code/packages/ui")).toEqual(
      projectRoots[1],
    );
    expect(projectRootLabel(projectRoots[0])).toBe("Vault root");
    expect(projectRootLabel(projectRoots[1])).toBe("ui");
  });

  it("removes project roots at or below a trashed path", () => {
    const projectRoots = [
      { id: "vault", rootPath: "", available: true },
      { id: "code", rootPath: "code", available: true },
      { id: "ui", rootPath: "code/packages/ui", available: false },
      { id: "similar", rootPath: "code-old", available: true },
    ];

    expect(removeProjectRootsAtOrBelow(projectRoots, "code")).toEqual([
      projectRoots[0],
      projectRoots[3],
    ]);
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
