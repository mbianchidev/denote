import type {
  FileNode,
  ProjectConfiguration,
  ProjectRoot,
  ProjectWorkspace,
} from "../types";

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

export function projectWorkspaceAtPath(
  projectWorkspaces: ProjectWorkspace[],
  path: string,
): ProjectWorkspace | null {
  return (
    projectWorkspaces.find(
      (projectWorkspace) => projectWorkspace.rootPath === path,
    ) ?? null
  );
}

export function projectRootLabel(projectRoot: ProjectRoot): string {
  return projectPathLabel(projectRoot.rootPath);
}

export function projectWorkspaceLabel(
  projectWorkspace: ProjectWorkspace,
): string {
  return projectPathLabel(projectWorkspace.rootPath);
}

export function projectConfigurationFields(
  configuration: ProjectConfiguration,
): ProjectConfiguration {
  return {
    projectRoots: configuration.projectRoots,
    projectWorkspaces: configuration.projectWorkspaces,
    suggestGitProject: configuration.suggestGitProject,
  };
}

export function withProjectConfiguration<T extends ProjectConfiguration>(
  value: T,
  configuration: ProjectConfiguration,
): T {
  return { ...value, ...projectConfigurationFields(configuration) };
}

export function removeProjectConfigurationAtOrBelow(
  configuration: ProjectConfiguration,
  path: string,
): ProjectConfiguration {
  return {
    ...configuration,
    projectRoots: configuration.projectRoots.filter(
      (projectRoot) => !workspacePathMatches(projectRoot.rootPath, path),
    ),
    projectWorkspaces: configuration.projectWorkspaces.filter(
      (projectWorkspace) =>
        !workspacePathMatches(projectWorkspace.rootPath, path),
    ),
  };
}

function projectPathLabel(rootPath: string): string {
  if (rootPath === "") {
    return "Vault root";
  }
  const segments = rootPath.split("/");
  return segments[segments.length - 1] ?? rootPath;
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
  const paths: string[] = [];
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind !== "folder") {
      continue;
    }
    paths.push(node.path);
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return paths;
}

export function initialWorkspaceFolderPaths(
  nodes: FileNode[],
  limit = 8,
  showDotfiles = true,
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (paths.length >= limit) {
      break;
    }
    if (
      node.kind !== "folder" ||
      (!showDotfiles && isDotEntry(node.name)) ||
      isBulkExpansionExcludedFolder(node.name)
    ) {
      continue;
    }
    paths.push(node.path);
  }
  return paths;
}

export interface VisibleWorkspaceRow {
  node: FileNode;
  depth: number;
}

export function visibleWorkspaceRows(
  nodes: FileNode[],
  expandedPaths: ReadonlySet<string>,
  showDotfiles = true,
): VisibleWorkspaceRow[] {
  const rows: VisibleWorkspaceRow[] = [];
  const stack: VisibleWorkspaceRow[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: nodes[index], depth: 0 });
  }
  while (stack.length > 0) {
    const row = stack.pop()!;
    if (!showDotfiles && isDotEntry(row.node.name)) {
      continue;
    }
    rows.push(row);
    if (
      row.node.kind !== "folder" ||
      !expandedPaths.has(row.node.path)
    ) {
      continue;
    }
    const children = row.node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: row.depth + 1 });
    }
  }
  return rows;
}

export interface WorkspaceBulkExpansion {
  folderPaths: string[];
  excludedRootPaths: string[];
  hiddenRootPaths: string[];
}

export interface WorkspaceBulkActionState {
  action: "expand" | "collapse";
  disabled: boolean;
}

export function workspaceBulkExpansion(
  nodes: FileNode[],
  showDotfiles = true,
): WorkspaceBulkExpansion {
  const folderPaths: string[] = [];
  const excludedRootPaths: string[] = [];
  const hiddenRootPaths: string[] = [];
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!showDotfiles && isDotEntry(node.name)) {
      if (node.kind === "folder") {
        hiddenRootPaths.push(node.path);
      }
      continue;
    }
    if (node.kind !== "folder") {
      continue;
    }
    if (isBulkExpansionExcludedFolder(node.name)) {
      excludedRootPaths.push(node.path);
      continue;
    }
    folderPaths.push(node.path);
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return { folderPaths, excludedRootPaths, hiddenRootPaths };
}

export function mergeBulkExpandedPaths(
  expansion: WorkspaceBulkExpansion,
  expandedPaths: ReadonlySet<string>,
): Set<string> {
  const next = new Set(expansion.folderPaths);
  const preservedRoots = new Set([
    ...expansion.excludedRootPaths,
    ...expansion.hiddenRootPaths,
  ]);
  for (const path of expandedPaths) {
    let candidate = path;
    while (candidate !== "") {
      if (preservedRoots.has(candidate)) {
        next.add(path);
        break;
      }
      const separatorIndex = candidate.lastIndexOf("/");
      candidate =
        separatorIndex < 0 ? "" : candidate.slice(0, separatorIndex);
    }
  }
  return next;
}

export function workspaceBulkActionState(
  expansion: WorkspaceBulkExpansion,
  expandedPaths: ReadonlySet<string>,
): WorkspaceBulkActionState {
  const hasBulkFolders = expansion.folderPaths.length > 0;
  const bulkFolders = new Set(expansion.folderPaths);
  const hasVisibleExpandedFolder = [...expandedPaths].some(
    (path) =>
      bulkFolders.has(path) ||
      expansion.excludedRootPaths.some((rootPath) =>
        workspacePathMatches(path, rootPath),
      ),
  );
  const allBulkFoldersExpanded =
    hasBulkFolders &&
    expansion.folderPaths.every((path) => expandedPaths.has(path));
  return {
    action:
      allBulkFoldersExpanded || (!hasBulkFolders && hasVisibleExpandedFolder)
        ? "collapse"
        : "expand",
    disabled: !hasBulkFolders && !hasVisibleExpandedFolder,
  };
}

export function applyWorkspaceBulkAction(
  expansion: WorkspaceBulkExpansion,
  expandedPaths: ReadonlySet<string>,
): Set<string> {
  return workspaceBulkActionState(expansion, expandedPaths).action === "collapse"
    ? new Set()
    : mergeBulkExpandedPaths(expansion, expandedPaths);
}

function isBulkExpansionExcludedFolder(name: string): boolean {
  const foldedName = name.toLowerCase();
  return foldedName === ".git" || foldedName === "node_modules";
}

export function isDotEntry(name: string): boolean {
  return name.startsWith(".");
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
