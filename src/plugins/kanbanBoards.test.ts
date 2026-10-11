import { describe, expect, it } from "vitest";
import { kanbanBoardForPath } from "./kanbanBoards";
import type { PluginKanbanBoardContribution } from "./workerRuntime";

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

  it("matches explicit legacy and native content without renaming ordinary Markdown", () => {
    const contentBoard: PluginKanbanBoardContribution = {
      ...board,
      sourceFormats: ["denote-kanban-v1", "obsidian-kanban"],
    };
    const escaped = String.raw`\---

kanban-plugin: board

\---

\## Planned
\- \[ ] Write a synthetic example`;
    const native = "<!-- denote-kanban:board:v1:start -->\n# Example";

    expect(kanbanBoardForPath([contentBoard], "Example.md", escaped)).toBe(contentBoard);
    expect(kanbanBoardForPath(
      [contentBoard],
      "Example.MARKDOWN",
      escaped.replace(/\\/g, ""),
    )).toBe(contentBoard);
    expect(kanbanBoardForPath([contentBoard], "Example.md", native)).toBe(contentBoard);
    expect(kanbanBoardForPath([board], "Example.md", escaped)).toBeNull();
    expect(kanbanBoardForPath([contentBoard], "Example.mdx", escaped)).toBeNull();
    expect(kanbanBoardForPath([contentBoard], "Example.md", "kanban-plugin: board")).toBeNull();
    expect(kanbanBoardForPath([contentBoard], "Example.md", `~~~markdown\n${native}\n~~~`))
      .toBeNull();
  });
});
