import { describe, expect, it } from "vitest";
import type { ProjectRoot } from "../types";
import {
  usesMarkdownSourceEditor,
  usesRichMarkdownEditor,
} from "./editorRouting";

const project: ProjectRoot = {
  id: "project-synthetic",
  rootPath: "code/sample",
  available: true,
  explicit: true,
  workspaceId: null,
};

describe("editor routing", () => {
  it("keeps project Markdown in the byte-preserving source editor", () => {
    const readme = {
      kind: "markdown" as const,
      encoding: "utf8" as const,
      path: "code/sample/README.md",
    };

    expect(usesRichMarkdownEditor(readme, project)).toBe(false);
    expect(usesRichMarkdownEditor(readme, null)).toBe(true);
    expect(usesMarkdownSourceEditor(readme, project)).toBe(true);
    expect(usesMarkdownSourceEditor(readme, null)).toBe(false);
    expect(
      usesMarkdownSourceEditor(
        {
          kind: "markdown",
          encoding: "utf8",
          path: "code/sample/guide.markdown",
        },
        project,
      ),
    ).toBe(true);
  });

  it("keeps MDX, binary, and non-Markdown files out of Markdown editor modes", () => {
    const mdx = {
      kind: "markdown" as const,
      encoding: "utf8" as const,
      path: "docs/example.mdx",
    };
    expect(
      usesRichMarkdownEditor(mdx, null),
    ).toBe(false);
    expect(usesMarkdownSourceEditor(mdx, project)).toBe(false);
    expect(
      usesMarkdownSourceEditor(
        {
          kind: "markdown",
          encoding: "base64",
          path: "docs/binary.md",
        },
        project,
      ),
    ).toBe(false);
    expect(
      usesRichMarkdownEditor(
        { kind: "text", encoding: "utf8", path: "src/example.ts" },
        null,
      ),
    ).toBe(false);
    expect(
      usesMarkdownSourceEditor(
        { kind: "text", encoding: "utf8", path: "src/example.ts" },
        project,
      ),
    ).toBe(false);
  });

  it("keeps portable Kanban Markdown in exact source mode without the plugin", () => {
    const board = {
      kind: "markdown" as const,
      encoding: "utf8" as const,
      path: "plugins/Documentation.kanban.md",
    };

    expect(usesRichMarkdownEditor(board, null)).toBe(false);
    expect(usesMarkdownSourceEditor(board, null)).toBe(true);
    expect(usesMarkdownSourceEditor(board, project)).toBe(true);
  });

  it("keeps legacy and migrated ordinary Markdown in exact source mode without a provider", () => {
    const tab = {
      kind: "markdown" as const,
      encoding: "utf8" as const,
      path: "Example tasks.md",
      content: String.raw`\---

kanban-plugin: board

\---

\## Planned
\- \[ ] Invent a sample`,
    };
    expect(usesRichMarkdownEditor(tab, null)).toBe(false);
    expect(usesMarkdownSourceEditor(tab, null)).toBe(true);
    expect(usesRichMarkdownEditor({
      ...tab,
      content: "<!-- denote-kanban:board:v1:start -->\n# Example",
    }, null)).toBe(false);
    expect(usesMarkdownSourceEditor({
      ...tab,
      content: "~~~markdown\n<!-- denote-kanban:board:v1:start -->\n~~~",
    }, null)).toBe(false);
  });
});
