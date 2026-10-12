import type { PluginKanbanBoardContribution } from "./workerRuntime";
import { detectPluginKanbanSourceFormat } from "@denote/plugin-sdk";

export function kanbanBoardForPath(
  boards: PluginKanbanBoardContribution[],
  path: string,
  source = "",
): PluginKanbanBoardContribution | null {
  const normalized = path.toLowerCase();
  const suffixMatch = boards.find((board) =>
    board.fileSuffixes.some((suffix) => normalized.endsWith(suffix)),
  );
  if (suffixMatch || boards.length === 0 || !/\.(?:md|markdown)$/.test(normalized)) {
    return suffixMatch ?? null;
  }
  const format = detectPluginKanbanSourceFormat(source);
  return format
    ? boards.find((board) => board.sourceFormats?.includes(format)) ?? null
    : null;
}
