import { describe, expect, it } from "vitest";
import { kanbanBoardForPath } from "./kanbanBoards";

const board = {
  pluginId: "denote.kanban",
  id: "denote.kanban.board",
  title: "Kanban boards",
  fileSuffixes: [".kanban.md", ".kanban.markdown"],
  defaultFileName: "Board.kanban.md",
};

describe("Kanban board path matching", () => {
  it("matches declared Markdown suffixes case-insensitively", () => {
    expect(kanbanBoardForPath([board], "Planning/Release.KANBAN.MD")).toEqual(
      board,
    );
    expect(kanbanBoardForPath([board], "Planning/Release.md")).toBeNull();
    expect(kanbanBoardForPath([board], "Planning/Release.kanban.mdx")).toBeNull();
  });
});
