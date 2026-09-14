import { describe, expect, it, vi } from "vitest";
import { editKanbanBoard, parseKanbanBoard } from "../src/board";

const source = [
  "# Project notes",
  "",
  "Keep this introduction exactly.",
  "",
  "<!-- denote-kanban:board:v1:start -->",
  "# Release board",
  "",
  '<!-- denote-kanban:column:start id="column-backlog" -->',
  "## Backlog",
  "",
  "Column guidance stays with this column.",
  "",
  '<!-- denote-kanban:card:start id="card-spec" -->',
  "### Write the specification",
  "",
  "Keep **unknown Markdown** and [Specification](Specification.md). #planning",
  "<!-- denote-kanban:card:end -->",
  "",
  '<!-- denote-kanban:card:start id="card-review" -->',
  "### Review the change",
  "",
  "Ask [Reviewers](People/Reviewers.md). #review",
  "<!-- denote-kanban:card:end -->",
  "",
  "<!-- denote-kanban:column:end -->",
  "",
  '<!-- denote-kanban:column:start id="column-doing" -->',
  "## Doing",
  "",
  "<!-- denote-kanban:column:end -->",
  "<!-- denote-kanban:board:end -->",
  "",
  "Keep this footer too.",
].join("\n");

describe("Kanban Markdown board", () => {
  it("parses columns, cards, links, tags, and surrounding Markdown", () => {
    const model = parseKanbanBoard({
      path: "Release.kanban.md",
      source,
    });

    expect(model.error).toBeNull();
    expect(model.title).toBe("Release board");
    expect(model.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "Doing",
    ]);
    expect(model.columns[0].cards[0]).toMatchObject({
      id: "card-spec",
      title: "Write the specification",
      tags: ["planning"],
      links: [
        {
          label: "Specification",
          href: "Specification.md",
        },
      ],
    });
    expect(model.columns[0].cards[0].body).toContain(
      "Keep **unknown Markdown**",
    );
  });

  it("initializes after existing Markdown without replacing it", () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-2222-4333-8444-555555555555"),
    });
    const existing = "# Existing note\n\nDo not replace me.";
    const edited = editKanbanBoard({
      path: "Planning.kanban.md",
      source: existing,
      edit: {
        type: "initialize",
        title: "Planning",
        initialColumnTitle: "Backlog",
      },
    });
    vi.unstubAllGlobals();

    expect(edited.source.startsWith(existing)).toBe(true);
    expect(edited.source).toContain(
      '<!-- denote-kanban:column:start id="column-11111111-2222-4333-8444-555555555555" -->',
    );
    expect(edited.model.title).toBe("Planning");
    expect(edited.model.columns[0].title).toBe("Backlog");
  });

  it("moves raw card and column blocks without changing unknown content", () => {
    const movedCard = editKanbanBoard({
      path: "Release.kanban.md",
      source,
      edit: {
        type: "move-card",
        cardId: "card-spec",
        targetColumnId: "column-doing",
        beforeCardId: null,
      },
    });
    const originalCard = source.slice(
      source.indexOf(
        '<!-- denote-kanban:card:start id="card-spec" -->',
      ),
      source.indexOf("<!-- denote-kanban:card:end -->") +
        "<!-- denote-kanban:card:end -->\n".length,
    );
    expect(movedCard.source).toContain(originalCard);
    expect(movedCard.model.columns[0].cards.map((card) => card.id)).toEqual([
      "card-review",
    ]);
    expect(movedCard.model.columns[1].cards.map((card) => card.id)).toEqual([
      "card-spec",
    ]);

    const movedColumn = editKanbanBoard({
      path: "Release.kanban.md",
      source,
      edit: {
        type: "move-column",
        columnId: "column-doing",
        beforeColumnId: "column-backlog",
      },
    });
    expect(movedColumn.model.columns.map((column) => column.id)).toEqual([
      "column-doing",
      "column-backlog",
    ]);
    expect(movedColumn.source).toContain(
      "Column guidance stays with this column.",
    );
    expect(movedColumn.source.startsWith("# Project notes")).toBe(true);
    expect(movedColumn.source.endsWith("Keep this footer too.")).toBe(true);
  });

  it("edits only the requested heading and card body", () => {
    const renamed = editKanbanBoard({
      path: "Release.kanban.md",
      source,
      edit: {
        type: "rename-column",
        columnId: "column-backlog",
        title: "Ready",
      },
    });
    expect(renamed.source).toBe(source.replace("## Backlog", "## Ready"));

    const edited = editKanbanBoard({
      path: "Release.kanban.md",
      source,
      edit: {
        type: "edit-card",
        cardId: "card-spec",
        title: "Write release specification",
        body: "Updated details with [Plan](Plan.md). #release",
      },
    });
    expect(edited.source).toContain("### Write release specification");
    expect(edited.source).toContain(
      "Updated details with [Plan](Plan.md). #release",
    );
    expect(edited.source).toContain("Ask [Reviewers](People/Reviewers.md).");
    expect(edited.model.columns[0].cards[0].tags).toEqual(["release"]);
  });

  it("adds and deletes columns and cards with the file's line endings", () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("11111111-2222-4333-8444-555555555555")
        .mockReturnValueOnce("66666666-7777-4888-8999-000000000000"),
    });
    const crlf = source.replace(/\n/g, "\r\n");
    const withColumn = editKanbanBoard({
      path: "Release.kanban.md",
      source: crlf,
      edit: {
        type: "add-column",
        title: "Done",
        beforeColumnId: null,
      },
    });
    expect(withColumn.source).toContain(
      '<!-- denote-kanban:column:start id="column-11111111-2222-4333-8444-555555555555" -->\r\n## Done\r\n',
    );

    const withCard = editKanbanBoard({
      path: "Release.kanban.md",
      source: withColumn.source,
      edit: {
        type: "add-card",
        columnId:
          "column-11111111-2222-4333-8444-555555555555",
        title: "Publish",
        body: "See [Release](Release.md).\n#release",
        beforeCardId: null,
      },
    });
    expect(withCard.source).toContain(
      '<!-- denote-kanban:card:start id="card-66666666-7777-4888-8999-000000000000" -->\r\n### Publish\r\n\r\nSee [Release](Release.md).\r\n#release\r\n',
    );
    expect(
      withCard.model.columns[withCard.model.columns.length - 1]?.cards[0],
    ).toMatchObject({
      title: "Publish",
      tags: ["release"],
    });

    const withoutCard = editKanbanBoard({
      path: "Release.kanban.md",
      source: withCard.source,
      edit: {
        type: "delete-card",
        cardId: "card-66666666-7777-4888-8999-000000000000",
      },
    });
    const withoutColumn = editKanbanBoard({
      path: "Release.kanban.md",
      source: withoutCard.source,
      edit: {
        type: "delete-column",
        columnId:
          "column-11111111-2222-4333-8444-555555555555",
      },
    });
    vi.unstubAllGlobals();

    expect(withoutColumn.model.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "Doing",
    ]);
    expect(withoutColumn.source).not.toContain("### Publish");
  });

  it("reports malformed and duplicate markers without changing source", () => {
    const malformed = source.replace(
      "<!-- denote-kanban:card:end -->",
      "<!-- missing-card-end -->",
    );
    expect(
      parseKanbanBoard({
        path: "Release.kanban.md",
        source: malformed,
      }).error,
    ).toMatchObject({
      code: "INVALID_BOARD",
      message: expect.stringMatching(/not closed|missing its end marker/i),
    });

    const duplicate = source.replace("card-review", "card-spec");
    expect(
      parseKanbanBoard({
        path: "Release.kanban.md",
        source: duplicate,
      }).error?.message,
    ).toMatch(/duplicate/i);
  });

  it("refuses reserved markers inside edited card details", () => {
    expect(() =>
      editKanbanBoard({
        path: "Release.kanban.md",
        source,
        edit: {
          type: "edit-card",
          cardId: "card-spec",
          title: "Write the specification",
          body: "<!-- denote-kanban:card:end -->",
        },
      }),
    ).toThrow(/reserved Kanban marker/i);
  });
});
