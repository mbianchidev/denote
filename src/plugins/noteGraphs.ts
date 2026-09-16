import {
  MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS,
  MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES,
  MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS,
  MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS,
  MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES,
  MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT,
  MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES,
  type PluginNoteGraphDocument,
  type PluginNoteGraphIndexRequest,
} from "@denote/plugin-sdk";
import type { DocumentBatch, EditorTab } from "../types";

const SAFE_GRAPH_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export interface NoteGraphSnapshot {
  workspaceKey: string;
  documents: PluginNoteGraphDocument[];
  skippedCount: number;
  truncated: boolean;
}

export function noteGraphTabPath(
  pluginId: string,
  providerId: string,
): string {
  return `denote-note-graph:${pluginId}:${providerId}`;
}

export function rekeyNoteGraphTab(
  tab: EditorTab,
  rekey: (path: string) => string,
): EditorTab {
  if (tab.transient !== "note-graph" || !tab.noteGraph?.notePath) {
    return tab;
  }
  const notePath = rekey(tab.noteGraph.notePath);
  return notePath === tab.noteGraph.notePath
    ? tab
    : {
        ...tab,
        noteGraph: {
          ...tab.noteGraph,
          notePath,
        },
      };
}

export function createNoteGraphSnapshot(
  workspaceKey: string,
  batch: DocumentBatch | null,
  priorityPaths: string[],
): NoteGraphSnapshot | null {
  if (!batch) {
    return null;
  }
  const documents = new Map<string, PluginNoteGraphDocument>();
  let invalidSkipped = 0;
  for (const document of batch.documents) {
    if (
      document.kind !== "markdown" ||
      document.encoding !== "utf8" ||
      !isMarkdownNotePath(document.path)
    ) {
      continue;
    }
    const graphDocument = createGraphDocument(
      document.path,
      document.title,
      document.content,
      document.tags,
    );
    if (graphDocument) {
      documents.set(document.path, graphDocument);
    } else {
      invalidSkipped += 1;
    }
  }
  const priorities = new Map(
    priorityPaths.map((path, index) => [path, index] as const),
  );
  const ordered = [...documents.values()].sort((left, right) => {
    const leftRank =
      priorities.get(left.path) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      priorities.get(right.path) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.path.localeCompare(right.path);
  });
  const bounded: PluginNoteGraphDocument[] = [];
  let bytes = 0;
  let hostSkipped = 0;
  let truncated = batch.truncated || invalidSkipped > 0;
  for (const document of ordered) {
    const sourceBytes = stringBytes(document.source);
    if (
      sourceBytes > MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES ||
      bounded.length >= MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS ||
      bytes + sourceBytes > MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES
    ) {
      hostSkipped += 1;
      truncated = true;
      continue;
    }
    bounded.push(document);
    bytes += sourceBytes;
  }
  return {
    workspaceKey,
    documents: bounded,
    skippedCount: batch.skippedCount + invalidSkipped + hostSkipped,
    truncated,
  };
}

export function noteGraphIndexRequests(
  previous: NoteGraphSnapshot | null,
  next: NoteGraphSnapshot,
): PluginNoteGraphIndexRequest[] {
  if (!previous || previous.workspaceKey !== next.workspaceKey) {
    return chunkIndexDocuments(
      "replace",
      next.documents,
      [],
      next.skippedCount,
      next.truncated,
    );
  }
  const previousDocuments = new Map(
    previous.documents.map((document) => [document.path, document] as const),
  );
  const nextDocuments = new Map(
    next.documents.map((document) => [document.path, document] as const),
  );
  const changed = next.documents.filter((document) => {
    const prior = previousDocuments.get(document.path);
    return !prior || !sameDocument(prior, document);
  });
  const removedPaths = previous.documents
    .filter((document) => !nextDocuments.has(document.path))
    .map((document) => document.path);
  if (
    changed.length === 0 &&
    removedPaths.length === 0 &&
    previous.skippedCount === next.skippedCount &&
    previous.truncated === next.truncated
  ) {
    return [];
  }
  return chunkIndexDocuments(
    "update",
    changed,
    removedPaths,
    next.skippedCount,
    next.truncated,
  );
}

export function noteGraphFolders(
  documents: PluginNoteGraphDocument[],
): string[] {
  const folders = new Set<string>();
  for (const document of documents) {
    const segments = document.path.split("/").slice(0, -1);
    if (segments.length === 0) {
      folders.add("");
      continue;
    }
    for (let index = 1; index <= segments.length; index += 1) {
      folders.add(segments.slice(0, index).join("/"));
    }
  }
  return [...folders].sort((left, right) =>
    (left || " ").localeCompare(right || " "),
  );
}

export function noteGraphTags(
  documents: PluginNoteGraphDocument[],
): string[] {
  return [
    ...new Set(documents.flatMap((document) => document.tags)),
  ].sort((left, right) => left.localeCompare(right));
}

function sameDocument(
  left: PluginNoteGraphDocument,
  right: PluginNoteGraphDocument,
): boolean {
  return (
    left.title === right.title &&
    left.source === right.source &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function chunkIndexDocuments(
  mode: PluginNoteGraphIndexRequest["mode"],
  documents: PluginNoteGraphDocument[],
  removedPaths: string[],
  skippedCount: number,
  truncated: boolean,
): PluginNoteGraphIndexRequest[] {
  const chunks: PluginNoteGraphDocument[][] = [];
  let chunk: PluginNoteGraphDocument[] = [];
  let bytes = 0;
  for (const document of documents) {
    const sourceBytes = stringBytes(document.source);
    if (
      chunk.length > 0 &&
      (chunk.length >= MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS ||
        bytes + sourceBytes > MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES)
    ) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(document);
    bytes += sourceBytes;
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  const requestCount = Math.max(
    1,
    chunks.length,
    Math.ceil(removedPaths.length / MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS),
  );
  return Array.from({ length: requestCount }, (_, index) => ({
    mode: index === 0 ? mode : "update",
    documents: chunks[index] ?? [],
    removedPaths: removedPaths.slice(
      index * MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS,
      (index + 1) * MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS,
    ),
    skippedCount,
    truncated,
  }));
}

function isMarkdownNotePath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path) && !/\.mdx$/i.test(path);
}

function noteTitle(path: string, source: string): string {
  const heading = source
    .split(/\r?\n/)
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  if (heading) {
    return heading;
  }
  const basename = path.split("/").pop() ?? path;
  return basename.replace(/\.(?:md|markdown)$/i, "") || basename;
}

function createGraphDocument(
  path: string,
  title: string,
  source: string,
  tags: string[],
): PluginNoteGraphDocument | null {
  if (
    path.length > 4096 ||
    !SAFE_GRAPH_TEXT.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const fallback = noteTitle(path, "");
  const safeTitle =
    sanitizeSingleLine(title, 200) || sanitizeSingleLine(fallback, 200);
  if (!safeTitle) {
    return null;
  }
  const safeTags = [
    ...new Set(
      tags.filter(
        (tag) =>
          tag.length > 0 &&
          tag.length <= 80 &&
          !/[\r\n]/.test(tag) &&
          SAFE_GRAPH_TEXT.test(tag),
      ),
    ),
  ].slice(0, MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT);
  return { path, title: safeTitle, source, tags: safeTags };
}

function sanitizeSingleLine(value: string, maxLength: number): string {
  return [...value]
    .filter((character) => SAFE_GRAPH_TEXT.test(character))
    .join("")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
