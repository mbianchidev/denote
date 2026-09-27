import {
  MAX_PLUGIN_TASK_LIST_DOCUMENTS,
  MAX_PLUGIN_TASK_LIST_INDEX_BYTES,
  MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS,
  MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS,
  MAX_PLUGIN_TASK_LIST_SOURCE_BYTES,
  MAX_PLUGIN_TASK_LIST_TOTAL_SOURCE_BYTES,
  type PluginTaskListDocument,
  type PluginTaskListIndexRequest,
  type PluginTaskListLocator,
} from "@denote/plugin-sdk";
import type { DocumentBatch } from "../types";

const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+).+$/u;

export interface TaskListSnapshot {
  workspaceKey: string;
  documents: PluginTaskListDocument[];
  skippedCount: number;
  truncated: boolean;
}

export function createTaskListSnapshot(
  workspaceKey: string,
  batch: DocumentBatch | null,
  priorityPath: string | null,
): TaskListSnapshot | null {
  if (!batch) {
    return null;
  }
  const documents: PluginTaskListDocument[] = [];
  let bytes = 0;
  let hostSkipped = 0;
  let invalidSkipped = 0;
  const ordered = [...batch.documents].sort(
    (left, right) =>
      Number(right.path === priorityPath) -
        Number(left.path === priorityPath) ||
      left.path.localeCompare(right.path),
  );
  for (const document of ordered) {
    if (
      document.kind !== "markdown" ||
      document.encoding !== "utf8" ||
      !/\.(?:md|markdown)$/i.test(document.path)
    ) {
      continue;
    }
    const taskDocument = createTaskDocument(
      document.path,
      document.title,
      document.content,
    );
    if (!taskDocument) {
      invalidSkipped += 1;
      continue;
    }
    const sourceBytes = stringBytes(taskDocument.source);
    if (
      sourceBytes > MAX_PLUGIN_TASK_LIST_SOURCE_BYTES ||
      documents.length >= MAX_PLUGIN_TASK_LIST_DOCUMENTS ||
      bytes + sourceBytes > MAX_PLUGIN_TASK_LIST_TOTAL_SOURCE_BYTES
    ) {
      hostSkipped += 1;
      continue;
    }
    documents.push(taskDocument);
    bytes += sourceBytes;
  }
  return {
    workspaceKey,
    documents,
    skippedCount: batch.skippedCount + invalidSkipped + hostSkipped,
    truncated:
      batch.truncated || invalidSkipped > 0 || hostSkipped > 0,
  };
}

export function taskListIndexRequests(
  previous: TaskListSnapshot | null,
  next: TaskListSnapshot,
): PluginTaskListIndexRequest[] {
  if (!previous || previous.workspaceKey !== next.workspaceKey) {
    return chunkIndexRequests(
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
    return (
      !prior ||
      prior.title !== document.title ||
      prior.source !== document.source
    );
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
  return chunkIndexRequests(
    "update",
    changed,
    removedPaths,
    next.skippedCount,
    next.truncated,
  );
}

export function verifyTaskToggleDelta(
  previous: string,
  next: string,
  locator: PluginTaskListLocator,
  checked: boolean,
): boolean {
  if (previous.length !== next.length || previous === next) {
    return false;
  }
  let changedIndex = -1;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] === next[index]) {
      continue;
    }
    if (changedIndex !== -1) {
      return false;
    }
    changedIndex = index;
  }
  if (changedIndex === -1) {
    return false;
  }
  const lineStart = previous.lastIndexOf("\n", changedIndex - 1) + 1;
  const lineEnd = previous.indexOf("\n", changedIndex);
  const sourceLine = previous.slice(
    lineStart,
    lineEnd === -1 ? previous.length : lineEnd,
  );
  const match = TASK_LINE.exec(sourceLine);
  if (
    !match ||
    sourceLine !== locator.sourceLine ||
    changedIndex !== lineStart + match[1].length
  ) {
    return false;
  }
  const previousMarker = previous[changedIndex];
  const nextMarker = next[changedIndex];
  return (
    (locator.checked
      ? previousMarker === "x" || previousMarker === "X"
      : previousMarker === " ") &&
    nextMarker === (checked ? "x" : " ")
  );
}

function createTaskDocument(
  path: string,
  title: string,
  source: string,
): PluginTaskListDocument | null {
  if (
    path.length === 0 ||
    path.length > 4096 ||
    !SAFE_TEXT.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const fallback =
    path.split("/").pop()?.replace(/\.(?:md|markdown)$/i, "") ?? path;
  const safeTitle =
    sanitizeSingleLine(title, 200) || sanitizeSingleLine(fallback, 200);
  return safeTitle ? { path, title: safeTitle, source } : null;
}

function chunkIndexRequests(
  mode: PluginTaskListIndexRequest["mode"],
  documents: PluginTaskListDocument[],
  removedPaths: string[],
  skippedCount: number,
  truncated: boolean,
): PluginTaskListIndexRequest[] {
  const chunks: PluginTaskListDocument[][] = [];
  let chunk: PluginTaskListDocument[] = [];
  let bytes = 0;
  for (const document of documents) {
    const sourceBytes = stringBytes(document.source);
    if (
      chunk.length > 0 &&
      (chunk.length >= MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS ||
        bytes + sourceBytes > MAX_PLUGIN_TASK_LIST_INDEX_BYTES)
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
    Math.ceil(removedPaths.length / MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS),
  );
  return Array.from({ length: requestCount }, (_, index) => ({
    mode: index === 0 ? mode : "update",
    documents: chunks[index] ?? [],
    removedPaths: removedPaths.slice(
      index * MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS,
      (index + 1) * MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS,
    ),
    skippedCount,
    truncated,
  }));
}

function sanitizeSingleLine(value: string, maxLength: number): string {
  return [...value]
    .filter((character) => SAFE_TEXT.test(character))
    .join("")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
