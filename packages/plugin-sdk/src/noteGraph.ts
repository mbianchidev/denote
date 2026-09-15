import type {
  PluginNoteGraphDocument,
  PluginNoteGraphIndexRequest,
  PluginNoteGraphModel,
  PluginNoteGraphNode,
  PluginNoteGraphQuery,
} from "./contracts";

export const MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS = 5_000;
export const MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES = 256 * 1024;
export const MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES = 512 * 1024;
export const MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS = 256;
export const MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS = 512;
export const MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT = 32;
export const MAX_PLUGIN_NOTE_GRAPH_NODES = 500;
export const MAX_PLUGIN_NOTE_GRAPH_EDGES = 2_000;

const SAFE_TEXT =
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export function isPluginNoteGraphRegistration(
  value: unknown,
): value is { id: string; title: string } {
  return (
    isRecord(value) &&
    safeSingleLine(value.id, 160) &&
    safeSingleLine(value.title, 160)
  );
}

export function isPluginNoteGraphIndexRequest(
  value: unknown,
): value is PluginNoteGraphIndexRequest {
  if (
    !isRecord(value) ||
    (value.mode !== "replace" && value.mode !== "update") ||
    !Array.isArray(value.documents) ||
    value.documents.length > MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS ||
    !Array.isArray(value.removedPaths) ||
    value.removedPaths.length > MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS ||
    !nonNegativeInteger(value.skippedCount) ||
    typeof value.truncated !== "boolean"
  ) {
    return false;
  }

  const documentPaths = new Set<string>();
  let sourceBytes = 0;
  for (const document of value.documents) {
    if (
      !isPluginNoteGraphDocument(document) ||
      documentPaths.has(document.path)
    ) {
      return false;
    }
    documentPaths.add(document.path);
    sourceBytes += stringBytes(document.source);
    if (sourceBytes > MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES) {
      return false;
    }
  }

  const removedPaths = new Set<string>();
  for (const path of value.removedPaths) {
    if (
      !safePath(path) ||
      documentPaths.has(path) ||
      removedPaths.has(path)
    ) {
      return false;
    }
    removedPaths.add(path);
  }
  return value.mode !== "replace" || removedPaths.size === 0;
}

export function isPluginNoteGraphQuery(
  value: unknown,
): value is PluginNoteGraphQuery {
  return (
    isRecord(value) &&
    (value.scope === "global" || value.scope === "local") &&
    (value.activePath === null || safePath(value.activePath)) &&
    (value.folder === null || safeFolder(value.folder)) &&
    (value.tag === null || safeSingleLine(value.tag, 80)) &&
    ["all", "only", "connected"].includes(String(value.orphanFilter)) &&
    (value.depth === 1 || value.depth === 2 || value.depth === 3)
  );
}

export function isPluginNoteGraphModel(
  value: unknown,
): value is PluginNoteGraphModel {
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > MAX_PLUGIN_NOTE_GRAPH_NODES ||
    !Array.isArray(value.edges) ||
    value.edges.length > MAX_PLUGIN_NOTE_GRAPH_EDGES ||
    !nonNegativeInteger(value.totalNotes) ||
    !nonNegativeInteger(value.matchingNotes) ||
    !nonNegativeInteger(value.totalEdges) ||
    value.totalNotes < value.matchingNotes ||
    value.matchingNotes < value.nodes.length ||
    value.totalEdges < value.edges.length ||
    !(value.activeNodeId === null || safeSingleLine(value.activeNodeId, 4096)) ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.notices) ||
    value.notices.length > 16 ||
    !value.notices.every((notice) => safeDisplayText(notice, 512))
  ) {
    return false;
  }

  const nodes = new Map<string, PluginNoteGraphNode>();
  const paths = new Set<string>();
  for (const node of value.nodes) {
    if (
      !isPluginNoteGraphNode(node) ||
      nodes.has(node.id) ||
      paths.has(node.path)
    ) {
      return false;
    }
    nodes.set(node.id, node);
    paths.add(node.path);
  }
  if (value.activeNodeId !== null && !nodes.has(value.activeNodeId)) {
    return false;
  }

  const edges = new Set<string>();
  for (const edge of value.edges) {
    const source =
      isRecord(edge) && typeof edge.sourceId === "string"
        ? nodes.get(edge.sourceId)
        : undefined;
    const target =
      isRecord(edge) && typeof edge.targetId === "string"
        ? nodes.get(edge.targetId)
        : undefined;
    if (
      !isRecord(edge) ||
      !safeSingleLine(edge.sourceId, 4096) ||
      !safeSingleLine(edge.targetId, 4096) ||
      edge.sourceId === edge.targetId ||
      !source ||
      !target ||
      source.outgoing === 0 ||
      target.incoming === 0
    ) {
      return false;
    }
    const key = `${edge.sourceId}\u0000${edge.targetId}`;
    if (edges.has(key)) {
      return false;
    }
    edges.add(key);
  }
  return true;
}

function isPluginNoteGraphDocument(
  value: unknown,
): value is PluginNoteGraphDocument {
  if (
    !isRecord(value) ||
    !safePath(value.path) ||
    !safeSingleLine(value.title, 200) ||
    typeof value.source !== "string" ||
    stringBytes(value.source) > MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES ||
    !Array.isArray(value.tags) ||
    value.tags.length > MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT
  ) {
    return false;
  }
  const tags = new Set<string>();
  for (const tag of value.tags) {
    if (!safeSingleLine(tag, 80) || tags.has(tag)) {
      return false;
    }
    tags.add(tag);
  }
  return true;
}

function isPluginNoteGraphNode(value: unknown): value is PluginNoteGraphNode {
  return (
    isRecord(value) &&
    safeSingleLine(value.id, 4096) &&
    safePath(value.path) &&
    safeSingleLine(value.title, 200) &&
    Array.isArray(value.tags) &&
    value.tags.length <= MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT &&
    value.tags.every((tag) => safeSingleLine(tag, 80)) &&
    new Set(value.tags).size === value.tags.length &&
    nonNegativeInteger(value.incoming) &&
    nonNegativeInteger(value.outgoing) &&
    typeof value.orphan === "boolean" &&
    value.orphan === (value.incoming === 0 && value.outgoing === 0) &&
    (value.distance === null ||
      (nonNegativeInteger(value.distance) && value.distance <= 3))
  );
}

function safePath(value: unknown): value is string {
  if (
    !safeDisplayText(value, 4096) ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\")
  ) {
    return false;
  }
  return !value
    .split("/")
    .some((segment) => !segment || segment === "." || segment === "..");
}

function safeFolder(value: unknown): value is string {
  if (
    !safeDisplayText(value, 4096) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\")
  ) {
    return false;
  }
  return (
    value.length === 0 ||
    !value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  );
}

function safeSingleLine(value: unknown, maxLength: number): value is string {
  return (
    safeDisplayText(value, maxLength) &&
    value.trim().length > 0 &&
    !/[\r\n]/.test(value)
  );
}

function safeDisplayText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    SAFE_TEXT.test(value)
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
