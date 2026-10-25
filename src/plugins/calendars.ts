import {
  calendarDocumentBytes,
  isCalendarNotePath,
  MAX_PLUGIN_CALENDAR_DOCUMENTS,
  MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES,
  MAX_PLUGIN_CALENDAR_INPUT_BYTES,
  type PluginCalendarDocument,
  type PluginCalendarRequest,
} from "@denote/plugin-sdk";
import type { DocumentBatch, FileNode } from "../types";

export type CalendarSnapshot = Pick<
  PluginCalendarRequest,
  "documents" | "skippedCount" | "truncated"
>;
const projections = new WeakMap<object, {
  path: string; title: string; source: string; available: boolean;
  createdAt: number | null; modifiedAt: number | null;
  document: PluginCalendarDocument; bytes: number; truncated: boolean;
}>();

export function createCalendarSnapshot(
  files: Pick<FileNode, "path" | "createdAt" | "modifiedAt">[],
  batch: DocumentBatch | null,
  previous: CalendarSnapshot | null = null,
): CalendarSnapshot {
  const indexed = new Map(batch?.documents.map((document) => [document.path, document]));
  const documents: PluginCalendarDocument[] = [];
  const prior = new Map(previous?.documents.map((document) => [document.path, document]));
  let bytes = 0;
  let skippedCount = 0;
  let truncated = batch?.truncated ?? false;
  const uniqueFiles = new Map(files.map((file) => [file.path, file]));
  for (const [path, file] of [...uniqueFiles].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!/\.(?:md|markdown)$/i.test(path)) continue;
    if (!isCalendarNotePath(path)) {
      skippedCount += 1;
      continue;
    }
    if (documents.length >= MAX_PLUGIN_CALENDAR_DOCUMENTS) {
      skippedCount += 1;
      truncated = true;
      continue;
    }
    const source = indexed.get(path);
    const available = source?.kind === "markdown" && source.encoding === "utf8";
    if (!available) skippedCount += 1;
    const title = source?.title || path.split("/").pop()?.replace(/\.(?:md|markdown)$/i, "") || "Markdown note";
    const content = available ? source.content : "";
    const createdAt = timestamp(source?.createdAt === undefined ? file.createdAt : source.createdAt);
    const modifiedAt = timestamp(source?.modifiedAt === undefined ? file.modifiedAt : source.modifiedAt);
    const key = source ?? file;
    let cached = projections.get(key);
    if (!cached || cached.path !== path || cached.title !== title || cached.source !== content ||
      cached.available !== available || cached.createdAt !== createdAt || cached.modifiedAt !== modifiedAt) {
      const metadata = available ? leadingFrontmatter(content) : { frontmatter: "", truncated: false };
      const document = {
        path, title: title.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ").trim().slice(0, 200) || "Markdown note",
        frontmatter: metadata.frontmatter, metadataAvailable: available && !metadata.truncated, createdAt, modifiedAt,
      };
      cached = { path, title, source: content, available, createdAt, modifiedAt,
        document, bytes: calendarDocumentBytes(document), truncated: metadata.truncated };
      projections.set(key, cached);
    }
    truncated ||= cached.truncated;
    let document = cached.document;
    const old = prior.get(path);
    if (old && old.title === document.title && old.frontmatter === document.frontmatter &&
      old.metadataAvailable === document.metadataAvailable && old.createdAt === document.createdAt &&
      old.modifiedAt === document.modifiedAt) document = old;
    const size = cached.bytes;
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
  if (previous && previous.skippedCount === skippedCount && previous.truncated === truncated &&
    documents.length === previous.documents.length && documents.every((document, index) => document === previous.documents[index])) return previous;
  return { documents, skippedCount, truncated };
}

function timestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000
    ? value : null;
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
