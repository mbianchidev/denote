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

export function usesRichMarkdownEditor(
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
  project: ProjectRoot | null,
): boolean {
  return project === null && isUtf8MarkdownSource(tab);
}

export function usesProjectMarkdownSourceEditor(
  tab: Pick<EditorTab, "kind" | "encoding" | "path">,
  project: ProjectRoot | null,
): boolean {
  return project !== null && isUtf8MarkdownSource(tab);
}
