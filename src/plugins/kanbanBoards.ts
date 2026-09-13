import type { PluginKanbanBoardContribution } from "./workerRuntime";

export function kanbanBoardForPath(
  boards: PluginKanbanBoardContribution[],
  path: string,
): PluginKanbanBoardContribution | null {
  const normalized = path.toLowerCase();
  return (
    boards.find((board) =>
      board.fileSuffixes.some((suffix) => normalized.endsWith(suffix)),
    ) ?? null
  );
}
