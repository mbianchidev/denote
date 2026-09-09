import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  type Node,
  type Pair,
} from "yaml";
import type {
  PluginStructuredNode,
  PluginStructuredNodeType,
  PluginStructuredViewerParseRequest,
  PluginStructuredViewModel,
} from "@denote/plugin-sdk";
import { MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES } from "@denote/plugin-sdk";
import { MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES } from "@denote/plugin-sdk";

export interface StructuredParseLimits {
  maxSourceBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxModelBytes: number;
  maxAliases: number;
  maxDocuments: number;
}

export const DEFAULT_STRUCTURED_PARSE_LIMITS: StructuredParseLimits = {
  maxSourceBytes: MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES,
  maxDepth: 128,
  maxNodes: 50_000,
  maxModelBytes: MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES,
  maxAliases: 500,
  maxDocuments: 100,
};

const ALLOWED_YAML_TAGS = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:null",
]);
const MAX_LABEL_LENGTH = 512;
const MAX_VALUE_LENGTH = 4096;

interface PendingValue {
  value: unknown;
  label: string;
  parentId: string | null;
  depth: number;
  segment: string;
}

export function parseStructuredSource(
  request: PluginStructuredViewerParseRequest,
  limits: StructuredParseLimits = DEFAULT_STRUCTURED_PARSE_LIMITS,
): PluginStructuredViewModel {
  if (new TextEncoder().encode(request.source).byteLength > limits.maxSourceBytes) {
    return failure(
      `Structured view size limit is ${formatBytes(limits.maxSourceBytes)}. Use Raw view for this file.`,
      "SOURCE_LIMIT",
    );
  }
  try {
    return request.format === "json"
      ? parseJson(request.source, limits)
      : parseYaml(request.source, limits);
  } catch (error) {
    return failure(errorMessage(error), "PARSE_ERROR");
  }
}

function parseJson(
  source: string,
  limits: StructuredParseLimits,
): PluginStructuredViewModel {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const location = jsonErrorLocation(error, source);
    return failure(
      `JSON parse error: ${errorMessage(error)}`,
      "JSON_PARSE_ERROR",
      location.line,
      location.column,
    );
  }
  return buildTree(
    [{ value, label: "Root", parentId: null, depth: 0, segment: "root" }],
    limits,
    "json",
  );
}

function parseYaml(
  source: string,
  limits: StructuredParseLimits,
): PluginStructuredViewModel {
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(source, {
    version: "1.2",
    schema: "core",
    customTags: [],
    merge: false,
    resolveKnownTags: false,
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    prettyErrors: true,
    keepSourceTokens: false,
    lineCounter,
    logLevel: "silent",
  });
  if (documents.length > limits.maxDocuments) {
    return failure(
      `YAML document limit exceeded (${limits.maxDocuments}). Use Raw view for the complete stream.`,
      "DOCUMENT_LIMIT",
    );
  }
  for (const document of documents) {
    const error = document.errors[0];
    if (error) {
      const offset = error.pos?.[0];
      const location =
        error.linePos?.[0] ??
        (typeof offset === "number" ? lineCounter.linePos(offset) : null);
      return failure(
        `YAML parse error: ${error.message}`,
        error.code || "YAML_PARSE_ERROR",
        location?.line,
        location?.col,
      );
    }
  }

  const roots: PendingValue[] =
    documents.length <= 1
      ? [
          {
            value: documents[0]?.contents ?? null,
            label: "Root",
            parentId: null,
            depth: 0,
            segment: "root",
          },
        ]
      : [
          {
            value: documents.map((document) => document.contents ?? null),
            label: "Documents",
            parentId: null,
            depth: 0,
            segment: "stream",
          },
        ];
  return buildTree(roots, limits, documents.length > 1 ? "yaml-stream" : "yaml");
}

function buildTree(
  roots: PendingValue[],
  limits: StructuredParseLimits,
  mode: "json" | "yaml" | "yaml-stream",
): PluginStructuredViewModel {
  const nodes: PluginStructuredNode[] = [];
  const stack = [...roots].reverse();
  const usedIds = new Set<string>();
  const notices: string[] = [];
  let aliasCount = 0;
  let truncated = false;
  let textTruncated = false;
  let modelBytes = 0;

  while (stack.length > 0) {
    const pending = stack.pop()!;
    if (pending.depth > limits.maxDepth) {
      return failure(
        `Structured view depth limit exceeded (${limits.maxDepth}). Use Raw view for this file.`,
        "DEPTH_LIMIT",
      );
    }
    if (nodes.length >= limits.maxNodes) {
      truncated = true;
      break;
    }
    if (mode !== "json" && isAlias(pending.value)) {
      aliasCount += 1;
      if (aliasCount > limits.maxAliases) {
        return failure(
          `YAML alias limit exceeded (${limits.maxAliases}). Use Raw view to inspect the source safely.`,
          "ALIAS_LIMIT",
        );
      }
    }

    const id = uniqueNodeId(pending.parentId, pending.segment, usedIds);
    const described = describeValue(pending.value, mode);
    if (described.error) {
      return failure(described.error, "UNSUPPORTED_YAML_TAG");
    }
    const visibleLabel = visibleText(pending.label);
    const label = boundedText(
      visibleLabel.length === 0 ? "(empty key)" : visibleLabel,
      MAX_LABEL_LENGTH,
    );
    const visibleValue =
      described.value === undefined ? undefined : visibleText(described.value);
    const value =
      visibleValue === undefined
        ? undefined
        : boundedText(visibleValue, MAX_VALUE_LENGTH);
    const nodeBytes =
      label.length +
      (value?.length ?? 0) +
      id.length +
      (pending.parentId?.length ?? 0) +
      (described.anchor?.length ?? 0) +
      64;
    if (nodes.length > 0 && modelBytes + nodeBytes > limits.maxModelBytes) {
      truncated = true;
      break;
    }
    modelBytes += nodeBytes;
    if (
      label !== visibleLabel ||
      value !== visibleValue
    ) {
      textTruncated = true;
      truncated = true;
    }
    nodes.push({
      id,
      parentId: pending.parentId,
      label,
      type: described.type,
      ...(value === undefined ? {} : { value }),
      ...(described.anchor ? { anchor: described.anchor } : {}),
      depth: pending.depth,
      childCount: 0,
    });

    const children = childValues(pending.value, mode, id, pending.depth + 1);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  const childCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId) {
      childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
    }
  }
  for (const node of nodes) {
    node.childCount = childCounts.get(node.id) ?? 0;
  }
  if (truncated) {
    notices.push(
      `Structured view reached the ${limits.maxNodes}-node limit. Raw source remains complete.`,
    );
  }
  if (textTruncated) {
    notices.push("Long keys or scalar previews were shortened in Structured view.");
  }
  return {
    rootId: nodes[0]?.id ?? null,
    nodes,
    error: null,
    notices,
    truncated,
  };
}

function describeValue(
  value: unknown,
  mode: "json" | "yaml" | "yaml-stream",
): {
  type: PluginStructuredNodeType;
  value?: string;
  anchor?: string;
  error?: string;
} {
  if (mode === "yaml-stream" && Array.isArray(value)) {
    return { type: "stream" };
  }
  if (mode !== "json" && isAlias(value)) {
    return { type: "alias", value: `*${value.source}` };
  }
  if (mode !== "json" && (isMap(value) || isSeq(value) || isScalar(value))) {
    if (value.tag && !ALLOWED_YAML_TAGS.has(value.tag)) {
      return { type: "scalar", error: `Unsupported YAML tag ${value.tag}.` };
    }
    const anchor = value.anchor;
    if (isMap(value)) {
      return { type: "mapping", ...(anchor ? { anchor } : {}) };
    }
    if (isSeq(value)) {
      return { type: "sequence", ...(anchor ? { anchor } : {}) };
    }
    return {
      ...scalarDescription(value.value),
      ...(anchor ? { anchor } : {}),
    };
  }
  if (Array.isArray(value)) {
    return { type: "array" };
  }
  if (value !== null && typeof value === "object") {
    return { type: "object" };
  }
  return scalarDescription(value);
}

function scalarDescription(value: unknown): {
  type: PluginStructuredNodeType;
  value: string;
} {
  if (value === null || value === undefined) {
    return { type: "null", value: "null" };
  }
  switch (typeof value) {
    case "string":
      return { type: "string", value };
    case "number":
    case "bigint":
      return { type: "number", value: String(value) };
    case "boolean":
      return { type: "boolean", value: String(value) };
    default:
      return { type: "scalar", value: String(value) };
  }
}

function childValues(
  value: unknown,
  mode: "json" | "yaml" | "yaml-stream",
  parentId: string,
  depth: number,
): PendingValue[] {
  if (mode === "yaml-stream" && Array.isArray(value)) {
    return value.map((entry, index) => ({
      value: entry,
      label: `Document ${index + 1}`,
      parentId,
      depth,
      segment: `document-${index}`,
    }));
  }
  if (mode !== "json" && isMap(value)) {
    return value.items.map((item: Pair<unknown, unknown>, index) => ({
      value: item.value,
      label: yamlKey(item.key),
      parentId,
      depth,
      segment: `key-${index}-${hashText(yamlKey(item.key))}`,
    }));
  }
  if (mode !== "json" && isSeq(value)) {
    return value.items.map((entry: unknown, index: number) => ({
      value: entry,
      label: `[${index}]`,
      parentId,
      depth,
      segment: `index-${index}`,
    }));
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({
      value: entry,
      label: `[${index}]`,
      parentId,
      depth,
      segment: `index-${index}`,
    }));
  }
  if (value !== null && typeof value === "object" && !isYamlNode(value)) {
    return Object.entries(value).map(([key, entry], index) => ({
      value: entry,
      label: key,
      parentId,
      depth,
      segment: `key-${index}-${hashText(key)}`,
    }));
  }
  return [];
}

function yamlKey(value: unknown): string {
  if (isScalar(value)) {
    return String(value.value);
  }
  return String(value);
}

function isYamlNode(value: object): value is Node {
  return isAlias(value) || isMap(value) || isSeq(value) || isScalar(value);
}

function uniqueNodeId(
  parentId: string | null,
  segment: string,
  used: Set<string>,
): string {
  const full = parentId ? `${parentId}/${segment}` : segment;
  const base =
    full.length <= 240 ? full : `node-${hashText(full)}-${hashText(segment)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function visibleText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
      "�",
    );
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function jsonErrorLocation(
  error: unknown,
  source: string,
): { line?: number; column?: number } {
  const message = errorMessage(error);
  const direct = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (direct) {
    return { line: Number(direct[1]), column: Number(direct[2]) };
  }
  const position = message.match(/position\s+(\d+)/i);
  if (position) {
    const offset = Math.min(Number(position[1]), source.length);
    return offsetLocation(source, offset);
  }
  const unexpected = message.match(/Unexpected token '([^']+)'/i);
  if (unexpected) {
    const offset = source.lastIndexOf(unexpected[1]);
    if (offset >= 0) {
      return offsetLocation(source, offset);
    }
  }
  if (/unexpected end/i.test(message)) {
    return offsetLocation(source, source.length);
  }
  return {};
}

function offsetLocation(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split(/\r\n|\r|\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function failure(
  message: string,
  code: string,
  line?: number,
  column?: number,
): PluginStructuredViewModel {
  return {
    rootId: null,
    nodes: [],
    error: {
      message,
      code,
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    },
    notices: [],
    truncated: false,
  };
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.floor(bytes / (1024 * 1024))} MiB`
    : `${Math.floor(bytes / 1024)} KiB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
