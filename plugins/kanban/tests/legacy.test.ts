import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_KANBAN_CARD_BODY_BYTES,
  MAX_PLUGIN_KANBAN_CARDS,
  MAX_PLUGIN_KANBAN_COLUMNS,
  MAX_PLUGIN_KANBAN_SOURCE_BYTES,
  isPluginKanbanBoardModel,
} from "@denote/plugin-sdk";
import { editKanbanBoard, parseKanbanBoard } from "../src/board";

const escapedSource = String.raw`\---

kanban-plugin: board

\---

\## Finished

\*\*Complete\*\*
\- \[x] Prepare \[sample notes](Notes/Sample.md) #planning @{2026-02-03}

&#x09;- Review the invented checklist
&#x09;- Keep this second detail

\## Next

\- \[ ] Draft the next example #writing

%% kanban:settings
` + "\n```\n" + String.raw`{"kanban-plugin":"board","list-collapse":\[true,false]}` +
  "\n```\n%%\n";

describe("legacy Kanban boards", () => {
  it("reads an escaped Obsidian board without modifying its source", () => {
    const request = { path: "Example tasks.md", source: escapedSource };
    const model = parseKanbanBoard(request);

    expect(model).toMatchObject({
      sourceFormat: "obsidian-kanban",
      title: "Example tasks",
      canInitialize: false,
      error: null,
    });
    expect(model.columns.map((column) => column.title)).toEqual([
      "Finished",
      "Next",
    ]);
    expect(model.columns[0].cards).toHaveLength(1);
    expect(model.columns[0].cards[0]).toMatchObject({
      title: "Prepare sample notes #planning @{2026-02-03}",
      completed: true,
      body: expect.stringContaining(
        "Prepare [sample notes](Notes/Sample.md) #planning @{2026-02-03}",
      ),
      tags: ["planning"],
      links: [{ label: "sample notes", href: "Notes/Sample.md" }],
    });
    expect(model.columns[0].cards[0].body).toContain(
      "- Review the invented checklist\n- Keep this second detail",
    );
    expect(model.columns[1].cards[0]).toMatchObject({
      title: "Draft the next example #writing",
      completed: false,
    });
    expect(request.source).toBe(escapedSource);
  });

  it("reads ordinary Obsidian boards without treating fenced examples as structure", () => {
    const source = [
      "---",
      'kanban-plugin: "board"',
      "---",
      "## Planned",
      "- [ ] Write the invented example",
      "\t~~~markdown",
      "\t## Not a column",
      "\t- [x] Not a card",
      "\t<!-- denote-kanban:board:v1:start -->",
      "\t~~~",
      "## Complete",
      "**Complete**",
      "- [X] Review the example",
    ].join("\r\n");
    const model = parseKanbanBoard({ path: "Example.markdown", source });

    expect(model.error).toBeNull();
    expect(model.columns.map((column) => column.title)).toEqual([
      "Planned",
      "Complete",
    ]);
    expect(model.columns[0].cards).toHaveLength(1);
    expect(model.columns[0].cards[0].body).toContain(
      "~~~markdown\n## Not a column\n- [x] Not a card",
    );
    expect(model.columns[1].cards[0].completed).toBe(true);
  });

  it("does not mistake escaped fenced native-marker examples for an active board", () => {
    const source = [
      String.raw`\---`,
      "kanban-plugin: board",
      String.raw`\---`,
      String.raw`\## Planned`,
      String.raw`\- \[ ] Describe the synthetic marker`,
      "\t\\~\\~\\~markdown",
      "\t<!-- denote-kanban:board:v1:start -->",
      "\t<!-- denote-kanban:board:end -->",
      "\t\\~\\~\\~",
    ].join("\n");
    const model = parseKanbanBoard({ path: "Example.md", source });

    expect(model.error).toBeNull();
    expect(model.sourceFormat).toBe("obsidian-kanban");
    expect(model.columns[0].cards).toHaveLength(1);
    expect(model.columns[0].cards[0].body).toContain(
      "~~~markdown\n<!-- denote-kanban:board:v1:start -->",
    );
  });

  it("migrates explicitly with completion, links, details, and an exact-source recovery copy", () => {
    const source = escapedSource.replace(/\n/g, "\r\n");
    const before = parseKanbanBoard({ path: "Example tasks.md", source });
    const migrated = editKanbanBoard({
      path: "Example tasks.md",
      source,
      edit: { type: "migrate", title: "Example tasks" },
    });

    expect(migrated.model.sourceFormat).toBe("denote-kanban-v1");
    expect(migrated.model.error).toBeNull();
    expect(
      migrated.model.columns.map((column) => ({
        title: column.title,
        cards: column.cards.map(({ title, body, completed, links, tags }) => ({
          title,
          body,
          completed,
          links,
          tags,
        })),
      })),
    ).toEqual(
      before.columns.map((column) => ({
        title: column.title,
        cards: column.cards.map(({ title, body, completed, links, tags }) => ({
          title,
          body,
          completed,
          links,
          tags,
        })),
      })),
    );
    expect(migrated.source).toContain('completed="true"');
    expect(migrated.source).toContain('completed="false"');
    expect(migrated.source).toContain("## Legacy Kanban source (recovery)");
    expect(migrated.source).toContain(source);
    expect(migrated.source).toContain(String.raw`"list-collapse":\[true,false]`);
    expect(migrated.source.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseKanbanBoard({
      path: "Example tasks.md",
      source: migrated.source,
    })).toEqual(migrated.model);
  });

  it("changes an imported native checkbox without changing card text or the recovery copy", () => {
    const migrated = editKanbanBoard({
      path: "Example tasks.md",
      source: escapedSource,
      edit: { type: "migrate", title: "Example tasks" },
    });
    const card = migrated.model.columns[0].cards[0];
    const changed = editKanbanBoard({
      path: "Example tasks.md",
      source: migrated.source,
      edit: { type: "set-card-completed", cardId: card.id, completed: false },
    });

    expect(changed.source).toBe(migrated.source.replace(
      `id="${card.id}" completed="true"`,
      `id="${card.id}" completed="false"`,
    ));
    expect(changed.model.columns[0].cards[0]).toEqual({
      ...card,
      completed: false,
    });
    expect(changed.source).toContain(escapedSource);
  });

  it("keeps long titles and linked text intact in details after migration", () => {
    const text = `Describe ${"the synthetic example ".repeat(20)}[reference](Docs/Example.md) #sample`;
    const source = ["---", "kanban-plugin: board", "---", "## Planned", `- [ ] ${text}`]
      .join("\n");
    const legacy = parseKanbanBoard({ path: "Example.md", source });
    const card = legacy.columns[0].cards[0];

    expect(isPluginKanbanBoardModel(legacy)).toBe(true);
    expect(card.title.length).toBeLessThanOrEqual(200);
    expect(card.title).toMatch(/…$/);
    expect(card.body).toBe(text);
    const migrated = editKanbanBoard({
      path: "Example.md",
      source,
      edit: { type: "migrate", title: "Example" },
    });
    expect(migrated.model.columns[0].cards[0].body).toBe(text);
    expect(migrated.model.columns[0].cards[0].links)
      .toEqual([{ label: "reference", href: "Docs/Example.md" }]);
    expect(migrated.source).toContain(source);
  });

  it("preserves literal title punctuation and meaningful trailing Markdown spaces", () => {
    const source = [
      "---", "kanban-plugin: board", "---", "## Planned",
      "- [ ] Review sample_key and `mock_value`",
      "\tKeep this Markdown hard break.  ",
      "",
      "",
    ].join("\n");
    const legacy = parseKanbanBoard({ path: "Example.md", source });
    expect(legacy.columns[0].cards[0].title)
      .toBe("Review sample_key and mock_value");
    const body = "Review sample_key and `mock_value`\nKeep this Markdown hard break.  ";
    expect(legacy.columns[0].cards[0].body).toBe(body);
    const migrated = editKanbanBoard({
      path: "Example.md", source, edit: { type: "migrate", title: "Example" },
    });
    expect(migrated.model.columns[0].cards[0].body).toBe(body);
  });

  it("retains fenced examples outside cards without letting them close the recovery fence", () => {
    const source = [
      "---", "kanban-plugin: board", "---",
      "~~~~markdown",
      "<!-- denote-kanban:board:v1:start -->",
      "# Not an active board",
      "<!-- denote-kanban:board:end -->",
      "~~~~",
      "## Planned", "- [ ] Write a synthetic example",
    ].join("\n");
    const migrated = editKanbanBoard({
      path: "Example.md",
      source,
      edit: { type: "migrate", title: "Example" },
    });

    expect(migrated.source).toContain("~~~~~markdown\n");
    expect(migrated.source).toContain(source);
    expect(migrated.model.columns).toHaveLength(1);
    expect(migrated.model.columns[0].cards).toHaveLength(1);
    expect(parseKanbanBoard({ path: "Example.md", source: migrated.source }))
      .toEqual(migrated.model);
  });

  it.each([false, true])("preserves recoverable EOF through host line-ending normalization (%s)", (finalNewline) => {
    const source = "---\nkanban-plugin: board\n---\n## Planned\n- [ ] Synthetic 界 example" +
      (finalNewline ? "\n" : "");
    const migrated = editKanbanBoard({
      path: "Example.md", source, edit: { type: "migrate", title: "Example" },
    });
    for (const lineEnding of ["\n", "\r\n", "\r"]) {
      const saved = migrated.source.replace(/\n/g, lineEnding);
      const marker = /<!-- legacy-kanban-source:v1 final-newline="(true|false)" -->(\r\n|\r|\n)(~{3,})markdown\2/
        .exec(saved);
      expect(marker).not.toBeNull();
      if (!marker) throw new Error("Recovery metadata is missing.");
      expect(marker[1]).toBe(String(finalNewline));
      const recoveryOffset = marker.index + marker[0].length;
      const closingOffset = saved.lastIndexOf(`${marker[3]}${lineEnding}`);
      const recovery = saved.slice(
        recoveryOffset,
        finalNewline ? closingOffset : closingOffset - lineEnding.length,
      );
      expect(recovery).toBe(source.replace(/\n/g, lineEnding));
    }
  });

  it("refuses all ordinary edits before migration and repeated native migration", () => {
    expect(() => editKanbanBoard({
      path: "Example.md",
      source: escapedSource,
      edit: { type: "initialize", title: "Example", initialColumnTitle: "Planned" },
    })).toThrow(/read-only/);
    expect(() => editKanbanBoard({
      path: "Example.md",
      source: escapedSource,
      edit: { type: "rename-board", title: "Changed" },
    })).toThrow(/read-only/);
    const migrated = editKanbanBoard({
      path: "Example.md",
      source: escapedSource,
      edit: { type: "migrate", title: "Example" },
    });
    expect(() => editKanbanBoard({
      path: "Example.md",
      source: migrated.source,
      edit: { type: "migrate", title: "Again" },
    })).toThrow(/Only a legacy/);
  });

  it.each([
    ["---\nkanban-plugin: board\n## Planned\n- [ ] Sample", /closing delimiter/],
    ["---\nkanban-plugin: board\n---\n- [ ] Sample", /column heading/],
    [escapedSource.replace(/\n%%\n$/, "\n"), /closing %%/],
  ])("reports malformed legacy structure without replacing the source", (source, message) => {
    const model = parseKanbanBoard({ path: "Example.kanban.md", source });
    expect(model.error?.code).toBe("INVALID_LEGACY_BOARD");
    expect(model.error?.message).toMatch(message);
    expect(() => editKanbanBoard({
      path: "Example.kanban.md",
      source,
      edit: { type: "migrate", title: "Example" },
    })).toThrow(message);
  });

  it("enforces the exact card-body byte limit without truncating content", () => {
    const prefix = "---\nkanban-plugin: board\n---\n## Planned\n- [ ] ";
    const body = "s".repeat(MAX_PLUGIN_KANBAN_CARD_BODY_BYTES);
    const atLimit = parseKanbanBoard({ path: "Example.md", source: prefix + body });
    expect(atLimit.error).toBeNull();
    expect(atLimit.columns[0].cards[0].body).toBe(body);
    expect(parseKanbanBoard({
      path: "Example.md",
      source: prefix + body + "s",
    }).error?.code).toBe("CARD_BODY_LIMIT");
  });

  it("enforces the existing source, column, and card limits in legacy mode", () => {
    const prefix = "---\nkanban-plugin: board\n---\n";
    const columns = Array.from({ length: MAX_PLUGIN_KANBAN_COLUMNS }, (_, index) =>
      `## Column ${index}`,
    ).join("\n");
    expect(parseKanbanBoard({ path: "Example.md", source: prefix + columns }).error)
      .toBeNull();
    expect(parseKanbanBoard({
      path: "Example.md",
      source: prefix + columns + "\n## Extra",
    }).error?.code).toBe("COLUMN_LIMIT");
    const cards = Array.from({ length: MAX_PLUGIN_KANBAN_CARDS }, (_, index) =>
      `- [ ] Synthetic task ${index}`,
    ).join("\n");
    expect(parseKanbanBoard({
      path: "Example.md",
      source: prefix + "## Planned\n" + cards,
    }).error).toBeNull();
    expect(parseKanbanBoard({
      path: "Example.md",
      source: prefix + "## Planned\n" + cards + "\n- [ ] Extra",
    }).error?.code).toBe("CARD_LIMIT");
    expect(parseKanbanBoard({
      path: "Example.md",
      source: "界".repeat(Math.floor(MAX_PLUGIN_KANBAN_SOURCE_BYTES / 3) + 1),
    }).error?.code).toBe("SOURCE_LIMIT");
  });

  it("refuses migration when the native board and complete recovery copy exceed 4 MiB", () => {
    const source = [
      "---", "kanban-plugin: board", "---", "## Planned",
      ...Array.from({ length: 40 }, () => `- [ ] ${"s".repeat(64_000)}`),
    ].join("\n");
    expect(parseKanbanBoard({ path: "Example.md", source }).error).toBeNull();
    const request = {
      path: "Example.md",
      source,
      edit: { type: "migrate" as const, title: "Example" },
    };
    expect(() => editKanbanBoard(request)).toThrow(/recovery copy exceed 4 MiB/);
    expect(request.source).toBe(source);
  });
});
