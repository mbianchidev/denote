import type { EditorTab, ProjectRoot } from "../types";

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
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
): boolean {
  return (
    isUtf8MarkdownSource(tab) &&
    /\.kanban\.(?:md|markdown)$/i.test(tab.path)
  );
}

export function usesRichMarkdownEditor(
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
  project: ProjectRoot | null,
): boolean {
  return (
    project === null &&
    isUtf8MarkdownSource(tab) &&
    !isPortablePluginMarkdown(tab)
  );
}

export function usesMarkdownSourceEditor(
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
  project: ProjectRoot | null,
): boolean {
  return (
    isUtf8MarkdownSource(tab) &&
    (project !== null || isPortablePluginMarkdown(tab))
  );
}
