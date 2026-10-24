import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_KANBAN_CARD_BODY_BYTES,
  MAX_PLUGIN_KANBAN_CARDS,
  detectPluginKanbanSourceFormat,
  isPluginKanbanBoardModel,
  isPluginKanbanEditRequest,
  isPluginKanbanEditResult,
  isPluginKanbanRegistration,
} from "./kanban";

const model = {
  title: "Release board",
  columns: [
    {
      id: "column-backlog",
      title: "Backlog",
      cards: [
        {
          id: "card-spec",
          title: "Write specification",
          body: "See [Specification](Specification.md). #planning",
          tags: ["planning"],
          links: [
            {
              label: "Specification",
              href: "Specification.md",
            },
          ],
        },
      ],
    },
  ],
  error: null,
  notices: [],
  canInitialize: false,
};

describe("Kanban board contract", () => {
  it("bounds content detection by UTF-8 bytes rather than JavaScript characters", () => {
    const marker = "<!-- denote-kanban:board:v1:start -->";
    expect(detectPluginKanbanSourceFormat(`${"界".repeat(1_000)}\n${marker}`))
      .toBe("denote-kanban-v1");
    expect(detectPluginKanbanSourceFormat(`${"界".repeat(3_000)}\n${marker}`))
      .toBeNull();
  });

  it("accepts one bounded Markdown board registration", () => {
    expect(
      isPluginKanbanRegistration({
        id: "denote.kanban.board",
        title: "Kanban boards",
        fileSuffixes: [".kanban.md", ".kanban.markdown"],
        defaultFileName: "Board.kanban.md",
      }),
    ).toBe(true);
    expect(
      isPluginKanbanRegistration({
        id: "denote.kanban.board",
        title: "Kanban boards",
        fileSuffixes: [".KANBAN.md"],
        defaultFileName: "Board.kanban.md",
      }),
    ).toBe(false);
    expect(
      isPluginKanbanRegistration({
        id: "denote.kanban.board",
        title: "Kanban boards",
        fileSuffixes: [".kanban.md"],
        defaultFileName: "../Board.kanban.md",
      }),
    ).toBe(false);
  });

  it("validates bounded models, parse errors, and initialization state", () => {
    expect(isPluginKanbanBoardModel(model)).toBe(true);
    expect(
      isPluginKanbanBoardModel({
        title: "",
        columns: [],
        error: null,
        notices: ["Existing Markdown will remain above the board."],
        canInitialize: true,
      }),
    ).toBe(true);
    expect(
      isPluginKanbanBoardModel({
        title: "",
        columns: [],
        error: {
          code: "INVALID_MARKER",
          message: "Column marker is not closed.",
          line: 8,
        },
        notices: [],
        canInitialize: false,
      }),
    ).toBe(true);
    expect(
      isPluginKanbanBoardModel({
        ...model,
        columns: [
          model.columns[0],
          {
            ...model.columns[0],
            title: "Duplicate",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isPluginKanbanBoardModel({
        ...model,
        columns: [
          {
            ...model.columns[0],
            cards: Array.from({ length: MAX_PLUGIN_KANBAN_CARDS + 1 }, (_, index) => ({
              ...model.columns[0].cards[0],
              id: `card-${index}`,
            })),
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts only bounded typed edit requests and results", () => {
    expect(
      isPluginKanbanEditRequest({
        path: "planning/Release.kanban.md",
        source: "# Existing Markdown",
        edit: {
          type: "move-card",
          cardId: "card-spec",
          targetColumnId: "column-doing",
          beforeCardId: null,
        },
      }),
    ).toBe(true);
    expect(
      isPluginKanbanEditRequest({
        path: "planning/Release.kanban.md",
        source: "# Existing Markdown",
        edit: {
          type: "edit-card",
          cardId: "card-spec",
          title: "Write specification",
          body: "x".repeat(MAX_PLUGIN_KANBAN_CARD_BODY_BYTES + 1),
        },
      }),
    ).toBe(false);
    expect(
      isPluginKanbanEditResult({
        source: "<!-- denote-kanban:board:v1:start -->",
        model,
      }),
    ).toBe(true);
  });

  it("validates legacy format opt-in, completion state, and explicit migration", () => {
    const registration = {
      id: "denote.kanban.board",
      title: "Kanban boards",
      fileSuffixes: [".kanban.md"],
      defaultFileName: "Board.kanban.md",
      sourceFormats: ["denote-kanban-v1", "obsidian-kanban"],
    };
    expect(isPluginKanbanRegistration(registration)).toBe(true);
    expect(isPluginKanbanRegistration({
      ...registration,
      sourceFormats: ["arbitrary-markdown"],
    })).toBe(false);
    expect(isPluginKanbanRegistration({
      ...registration,
      sourceFormats: ["obsidian-kanban", "obsidian-kanban"],
    })).toBe(false);
    expect(isPluginKanbanBoardModel({
      ...model,
      sourceFormat: "obsidian-kanban",
      columns: [{
        ...model.columns[0],
        cards: [{ ...model.columns[0].cards[0], completed: true }],
      }],
    })).toBe(true);
    expect(isPluginKanbanBoardModel({
      ...model,
      sourceFormat: "unknown",
    })).toBe(false);
    expect(isPluginKanbanBoardModel({
      title: "",
      columns: [],
      error: null,
      notices: [],
      canInitialize: true,
      sourceFormat: "obsidian-kanban",
    })).toBe(false);
    expect(isPluginKanbanBoardModel({
      ...model,
      columns: [{
        ...model.columns[0],
        cards: [{ ...model.columns[0].cards[0], completed: "yes" }],
      }],
    })).toBe(false);
    expect(isPluginKanbanEditRequest({
      path: "Example.md",
      source: "---\nkanban-plugin: board\n---",
      edit: { type: "migrate", title: "Example" },
    })).toBe(true);
    expect(isPluginKanbanEditRequest({
      path: "Example.md",
      source: "---\nkanban-plugin: board\n---",
      edit: { type: "migrate", title: "" },
    })).toBe(false);
  });
});
