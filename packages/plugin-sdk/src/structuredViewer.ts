import type {
  PluginStructuredNode,
  PluginStructuredNodeType,
  PluginStructuredViewModel,
} from "./contracts";

export const MAX_PLUGIN_STRUCTURED_VIEWER_EXTENSIONS = 16;
export const MAX_PLUGIN_STRUCTURED_VIEWER_NODES = 50_000;
export const MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES = 4 * 1024 * 1024;

const CONTAINER_TYPES = new Set<PluginStructuredNodeType>([
  "object",
  "array",
  "mapping",
  "sequence",
  "stream",
]);
const SCALAR_TYPES = new Set<PluginStructuredNodeType>([
  "string",
  "number",
  "boolean",
  "null",
  "scalar",
  "alias",
]);
const STRUCTURED_VIEWER_EXTENSIONS = new Set(["json", "yaml", "yml"]);
const SAFE_TEXT = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;

export function isPluginStructuredViewerRegistration(
  value: unknown,
): value is { id: string; title: string; extensions: string[] } {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !safeText(value.id, 160) ||
    !safeText(value.title, 160) ||
    !Array.isArray(value.extensions) ||
    value.extensions.length === 0 ||
    value.extensions.length > MAX_PLUGIN_STRUCTURED_VIEWER_EXTENSIONS
  ) {
    return false;
  }
  const extensions = new Set<string>();
  for (const extension of value.extensions) {
    if (
      typeof extension !== "string" ||
      !/^[a-z0-9][a-z0-9+-]{0,15}$/.test(extension) ||
      !STRUCTURED_VIEWER_EXTENSIONS.has(extension) ||
      extensions.has(extension)
    ) {
      return false;
    }
    extensions.add(extension);
  }
  return true;
}

export function isPluginStructuredViewModel(
  value: unknown,
): value is PluginStructuredViewModel {
  if (
    !isRecord(value) ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.notices) ||
    value.notices.length > 16 ||
    !value.notices.every((notice) => safeText(notice, 512)) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > MAX_PLUGIN_STRUCTURED_VIEWER_NODES
  ) {
    return false;
  }
  let modelBytes = value.notices.reduce(
    (total, notice) => total + stringBytes(notice),
    0,
  );
  if (value.error !== null) {
    if (
      value.rootId !== null ||
      value.nodes.length !== 0 ||
      !isParseError(value.error)
    ) {
      return false;
    }
    modelBytes += parseErrorBytes(value.error as Record<string, unknown>);
    return modelBytes <= MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES;
  }
  if (
    typeof value.rootId !== "string" ||
    value.nodes.length === 0 ||
    value.nodes[0]?.id !== value.rootId
  ) {
    return false;
  }

  const nodes = new Map<string, PluginStructuredNode>();
  const directChildren = new Map<string, number>();
  for (const candidate of value.nodes) {
    if (!isStructuredNode(candidate) || nodes.has(candidate.id)) {
      return false;
    }
    if (candidate.parentId === null) {
      if (candidate.id !== value.rootId || candidate.depth !== 0) {
        return false;
      }
    } else {
      const parent = nodes.get(candidate.parentId);
      if (!parent || candidate.depth !== parent.depth + 1) {
        return false;
      }
      directChildren.set(
        candidate.parentId,
        (directChildren.get(candidate.parentId) ?? 0) + 1,
      );
    }
    nodes.set(candidate.id, candidate);
    modelBytes += structuredNodeBytes(candidate);
    if (modelBytes > MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES) {
      return false;
    }
  }
  for (const node of nodes.values()) {
    if (node.childCount !== (directChildren.get(node.id) ?? 0)) {
      return false;
    }
  }
  return true;
}

function isStructuredNode(value: unknown): value is PluginStructuredNode {
  if (
    !isRecord(value) ||
    !safeText(value.id, 256) ||
    !(value.parentId === null || safeText(value.parentId, 256)) ||
    !safeDisplayText(value.label, 512) ||
    typeof value.type !== "string" ||
    (!CONTAINER_TYPES.has(value.type as PluginStructuredNodeType) &&
      !SCALAR_TYPES.has(value.type as PluginStructuredNodeType)) ||
    !nonNegativeInteger(value.depth) ||
    value.depth > 256 ||
    !nonNegativeInteger(value.childCount) ||
    !(value.anchor === undefined || safeText(value.anchor, 128))
  ) {
    return false;
  }
  const container = CONTAINER_TYPES.has(
    value.type as PluginStructuredNodeType,
  );
  return container
    ? value.value === undefined
    : safeDisplayText(value.value, 4096) && value.childCount === 0;
}

function isParseError(value: unknown): boolean {
  return (
    isRecord(value) &&
    safeText(value.message, 1024) &&
    (value.line === undefined || positiveInteger(value.line)) &&
    (value.column === undefined || positiveInteger(value.column)) &&
    (value.code === undefined || safeText(value.code, 80))
  );
}

function safeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    SAFE_TEXT.test(value)
  );
}

function safeDisplayText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    SAFE_TEXT.test(value)
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function structuredNodeBytes(node: PluginStructuredNode): number {
  return [
    node.id,
    node.parentId ?? "",
    node.label,
    node.type,
    node.value ?? "",
    node.anchor ?? "",
  ].reduce((total, text) => total + stringBytes(text), 32);
}

function parseErrorBytes(error: Record<string, unknown>): number {
  return (
    stringBytes(String(error.message)) +
    stringBytes(String(error.code ?? "")) +
    32
  );
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
