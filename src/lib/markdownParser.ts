import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root } from "mdast";

export type MarkdownParser = (source: string) => Root;

// Scope this cache to one analysis or serialization, never an editor's history.
export function createMarkdownParser(): MarkdownParser {
  const roots = new Map<string, Root>();
  return (source) => {
    const existing = roots.get(source);
    if (existing) return existing;
    const root = fromMarkdown(source);
    roots.set(source, root);
    return root;
  };
}
