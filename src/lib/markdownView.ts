export type MarkdownViewMode = "rich-text" | "source";

const STORAGE_KEY = "denote-markdown-view-mode";

export function getMarkdownViewMode(): MarkdownViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "source"
      ? "source"
      : "rich-text";
  } catch {
    return "rich-text";
  }
}

export function saveMarkdownViewMode(mode: MarkdownViewMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}
