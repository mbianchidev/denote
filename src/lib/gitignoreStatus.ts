import type { GitignoreStatusUpdate } from "../types";
import { workspacePathMatches } from "./workspaceTree";

export function enqueueGitignoreStatusOperation(
  currentTail: Promise<void>,
  operation: () => Promise<boolean>,
): { result: Promise<boolean>; tail: Promise<void> } {
  const result = currentTail.then(operation);
  return {
    result,
    tail: result.then(
      () => {},
      () => {},
    ),
  };
}

export function applyGitignoreStatusUpdate(
  currentIgnoredPaths: readonly string[],
  update: GitignoreStatusUpdate,
): string[] {
  if (!update.complete) {
    return [...currentIgnoredPaths];
  }

  if (
    update.scopePaths.length === 0 ||
    update.scopePaths.some((scopePath) => scopePath === "")
  ) {
    return [...new Set(update.ignoredPaths)];
  }

  const next = new Set(
    currentIgnoredPaths.filter(
      (path) =>
        !update.scopePaths.some((scopePath) =>
          workspacePathMatches(path, scopePath),
        ),
    ),
  );
  for (const path of update.ignoredPaths) {
    next.add(path);
  }
  return [...next];
}

export function ignoredPathsAfterWorkspaceSnapshot(
  snapshotIgnoredPaths: readonly string[],
  updatesAppliedWhileLoading: readonly GitignoreStatusUpdate[],
): string[] {
  return updatesAppliedWhileLoading.reduce(
    (ignoredPaths, update) =>
      applyGitignoreStatusUpdate(ignoredPaths, update),
    [...snapshotIgnoredPaths],
  );
}

export function removeIgnoredPathsAtOrBelow(
  ignoredPaths: readonly string[],
  path: string,
): string[] {
  return ignoredPaths.filter(
    (ignoredPath) => !workspacePathMatches(ignoredPath, path),
  );
}

export function gitignoreRefreshScope(path: string): string[] {
  return [path.split("/").slice(0, -1).join("/")];
}

export function isGitignorePath(path: string): boolean {
  const segments = path.split("/");
  return segments[segments.length - 1]?.toLowerCase() === ".gitignore";
}
