import type { FileNode, ProjectRoot } from "../types";

export function workspacePathMatches(candidate: string, path: string): boolean {
  return candidate === path || candidate.startsWith(`${path}/`);
}

export function closestAvailableProjectRoot(
  projectRoots: ProjectRoot[],
  filePath: string | null,
): ProjectRoot | null {
  if (filePath === null) {
    return null;
  }

  let closest: ProjectRoot | null = null;
  for (const projectRoot of projectRoots) {
    if (
      !projectRoot.available ||
      (projectRoot.rootPath !== "" &&
        !workspacePathMatches(filePath, projectRoot.rootPath))
    ) {
      continue;
    }
    if (
      closest === null ||
      compareProjectRootProximity(projectRoot, closest) < 0
    ) {
      closest = projectRoot;
    }
  }
  return closest;
}

export function projectRootAtPath(
  projectRoots: ProjectRoot[],
  path: string,
): ProjectRoot | null {
  return projectRoots.find((projectRoot) => projectRoot.rootPath === path) ?? null;
}

export function projectRootLabel(projectRoot: ProjectRoot): string {
  if (projectRoot.rootPath === "") {
    return "Vault root";
  }
  const segments = projectRoot.rootPath.split("/");
  return segments[segments.length - 1] ?? projectRoot.rootPath;
}

export function removeProjectRootsAtOrBelow(
  projectRoots: ProjectRoot[],
  path: string,
): ProjectRoot[] {
  return projectRoots.filter(
    (projectRoot) => !workspacePathMatches(projectRoot.rootPath, path),
  );
}

export function removeWorkspacePath(
  nodes: FileNode[],
  path: string,
): FileNode[] {
  return nodes.flatMap((node) => {
    if (workspacePathMatches(node.path, path)) {
      return [];
    }
    if (node.kind !== "folder") {
      return [node];
    }
    const children = removeWorkspacePath(node.children, path);
    const unchanged =
      children.length === node.children.length &&
      children.every((child, index) => child === node.children[index]);
    return unchanged ? [node] : [{ ...node, children }];
  });
}

export function insertWorkspaceNode(
  nodes: FileNode[],
  node: FileNode,
): FileNode[] {
  const segments = node.path.split("/");
  return insertAtPath(nodes, node, segments, 0);
}

export function workspaceAncestorPaths(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) =>
    segments.slice(0, index + 1).join("/"),
  );
}

export function workspaceFolderPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [node.path, ...workspaceFolderPaths(node.children)]
      : [],
  );
}

function insertAtPath(
  nodes: FileNode[],
  node: FileNode,
  segments: string[],
  depth: number,
): FileNode[] {
  if (depth === segments.length - 1) {
    return insertSibling(nodes, node);
  }

  const folderPath = segments.slice(0, depth + 1).join("/");
  const existingIndex = nodes.findIndex(
    (candidate) =>
      candidate.path === folderPath && candidate.kind === "folder",
  );
  const folder =
    existingIndex >= 0
      ? nodes[existingIndex]
      : {
          path: folderPath,
          name: segments[depth],
          kind: "folder" as const,
          children: [],
          size: 0,
          modifiedAt: null,
          bookmarked: false,
          pinned: false,
        };
  const nextFolder = {
    ...folder,
    children: insertAtPath(folder.children, node, segments, depth + 1),
  };

  if (existingIndex >= 0) {
    const next = [...nodes];
    next[existingIndex] = nextFolder;
    return next;
  }
  return insertSibling(nodes, nextFolder);
}

function insertSibling(nodes: FileNode[], node: FileNode): FileNode[] {
  const next = nodes.filter((candidate) => candidate.path !== node.path);
  const insertionIndex = next.findIndex(
    (candidate) => compareWorkspaceNodes(node, candidate) < 0,
  );
  next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, node);
  return next;
}

function compareWorkspaceNodes(left: FileNode, right: FileNode): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    (left.position ?? Number.MAX_SAFE_INTEGER) -
      (right.position ?? Number.MAX_SAFE_INTEGER) ||
    Number(right.kind === "folder") - Number(left.kind === "folder") ||
    compareFoldedNames(left.name, right.name)
  );
}

function compareProjectRootProximity(
  left: ProjectRoot,
  right: ProjectRoot,
): number {
  const depthDifference =
    projectRootDepth(right.rootPath) - projectRootDepth(left.rootPath);
  if (depthDifference !== 0) {
    return depthDifference;
  }
  if (left.rootPath !== right.rootPath) {
    return left.rootPath < right.rootPath ? -1 : 1;
  }
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}

function projectRootDepth(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

function compareFoldedNames(left: string, right: string): number {
  const leftCodePoints = [...left.toLowerCase()];
  const rightCodePoints = [...right.toLowerCase()];
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      leftCodePoints[index].codePointAt(0)! -
      rightCodePoints[index].codePointAt(0)!;
    if (difference !== 0) {
      return difference;
    }
  }
  return leftCodePoints.length - rightCodePoints.length;
}
