import {
  calendarDocumentBytes,
  isCalendarNotePath,
  MAX_PLUGIN_CALENDAR_DOCUMENTS,
  MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES,
  MAX_PLUGIN_CALENDAR_INPUT_BYTES,
  type PluginCalendarDocument,
  type PluginCalendarRequest,
} from "@denote/plugin-sdk";
import type { DocumentBatch } from "../types";

export type CalendarSnapshot = Pick<
  PluginCalendarRequest,
  "documents" | "skippedCount" | "truncated"
>;

export function createCalendarSnapshot(
  paths: string[],
  batch: DocumentBatch | null,
): CalendarSnapshot {
  const indexed = new Map(batch?.documents.map((document) => [document.path, document]));
  const documents: PluginCalendarDocument[] = [];
  let bytes = 0;
  let skippedCount = 0;
  let truncated = batch?.truncated ?? false;
  for (const path of [...new Set(paths)].sort()) {
    if (!/\.(?:md|markdown)$/i.test(path)) continue;
    if (!isCalendarNotePath(path)) {
      skippedCount += 1;
      continue;
    }
    const source = indexed.get(path);
    const available = source?.kind === "markdown" && source.encoding === "utf8";
    if (!available) skippedCount += 1;
    const title = (source?.title || path.split("/").pop()?.replace(/\.(?:md|markdown)$/i, "") || "Markdown note")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
      .trim().slice(0, 200) || "Markdown note";
    const metadata = available ? leadingFrontmatter(source.content) : { frontmatter: "", truncated: false };
    truncated ||= metadata.truncated;
    const document = { path, title, frontmatter: metadata.frontmatter };
    const size = calendarDocumentBytes(document);
    if (
      documents.length >= MAX_PLUGIN_CALENDAR_DOCUMENTS ||
      bytes + size > MAX_PLUGIN_CALENDAR_INPUT_BYTES
    ) {
      skippedCount += 1;
      truncated = true;
      continue;
    }
    documents.push(document);
    bytes += size;
  }
  return { documents, skippedCount, truncated };
}

function leadingFrontmatter(content: string): { frontmatter: string; truncated: boolean } {
  const source = content.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(source)) return { frontmatter: "", truncated: false };
  const prefix = new TextDecoder().decode(
    new TextEncoder().encode(source.slice(0, MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES))
      .subarray(0, MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES),
    { stream: true },
  );
  for (const match of prefix.matchAll(/^(?:---|\.\.\.)[ \t]*\r?$/gm)) {
    if (match.index === 0) continue;
    const end = match.index + match[0].length;
    return {
      frontmatter: prefix.slice(0, end + (prefix[end] === "\n" ? 1 : 0)),
      truncated: false,
    };
  }
  return { frontmatter: "---\n", truncated: source.length > prefix.length };
}
