import type { EditorTab, ProjectRoot } from "../types";
import { detectPluginKanbanSourceFormat } from "@denote/plugin-sdk";

type MarkdownRoutingTab = Pick<EditorTab, "kind" | "encoding" | "path"> &
  Partial<Pick<EditorTab, "content">>;

function isUtf8MarkdownSource(
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
): boolean {
  return (
    tab.kind === "markdown" &&
    tab.encoding === "utf8" &&
    !tab.path.toLocaleLowerCase().endsWith(".mdx")
  );
}

function isPortablePluginMarkdown(
  tab: MarkdownRoutingTab,
): boolean {
  return (
    isUtf8MarkdownSource(tab) &&
    (/\.kanban\.(?:md|markdown)$/i.test(tab.path) ||
      detectPluginKanbanSourceFormat(tab.content ?? "") !== null)
  );
}

export function usesRichMarkdownEditor(
  tab: MarkdownRoutingTab,
  project: ProjectRoot | null,
): boolean {
  return (
    project === null &&
    isUtf8MarkdownSource(tab) &&
    !isPortablePluginMarkdown(tab)
  );
}

export function usesMarkdownSourceEditor(
  tab: MarkdownRoutingTab,
  project: ProjectRoot | null,
): boolean {
  return (
    isUtf8MarkdownSource(tab) &&
    (project !== null || isPortablePluginMarkdown(tab))
  );
}
