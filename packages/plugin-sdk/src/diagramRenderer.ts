import type {
  PluginDiagramRenderResult,
  PluginDiagramRenderer,
} from "./contracts";

export const MAX_PLUGIN_DIAGRAM_SOURCE_BYTES = 32 * 1024;
export const MAX_PLUGIN_DIAGRAM_SOURCE_LINES = 1_000;
export const MAX_PLUGIN_DIAGRAM_LINE_BYTES = 4 * 1024;
export const MAX_PLUGIN_DIAGRAM_SVG_BYTES = 2 * 1024 * 1024;
export const MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE = 1_024;
export const MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME = 80;
export const MAX_PLUGIN_DIAGRAM_LANGUAGES = 8;

const encoder = new TextEncoder();

export function isPluginDiagramRendererRegistration(
  value: unknown,
): value is PluginDiagramRenderer {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 160 ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title.length > 120 ||
    !Array.isArray(value.languages) ||
    value.languages.length === 0 ||
    value.languages.length > MAX_PLUGIN_DIAGRAM_LANGUAGES
  ) {
    return false;
  }
  const languages = new Set<string>();
  for (const language of value.languages) {
    if (
      typeof language !== "string" ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(language) ||
      languages.has(language)
    ) {
      return false;
    }
    languages.add(language);
  }
  return true;
}

export function isPluginDiagramRenderResult(
  value: unknown,
): value is PluginDiagramRenderResult {
  if (!isRecord(value) || (value.status !== "success" && value.status !== "error")) {
    return false;
  }
  if (value.status === "success") {
    return (
      typeof value.svg === "string" &&
      encoder.encode(value.svg).byteLength <= MAX_PLUGIN_DIAGRAM_SVG_BYTES &&
      typeof value.diagramType === "string" &&
      value.diagramType.length > 0 &&
      value.diagramType.length <= 80 &&
      typeof value.accessibleName === "string" &&
      value.accessibleName.trim().length > 0 &&
      value.accessibleName.length <= MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME
    );
  }
  if (!isRecord(value.error)) {
    return false;
  }
  return (
    [
      "SOURCE_LIMIT",
      "UNSAFE_SOURCE",
      "UNSUPPORTED_DIAGRAM",
      "PARSE_ERROR",
      "RENDER_ERROR",
    ].includes(String(value.error.code)) &&
    typeof value.error.message === "string" &&
    value.error.message.trim().length > 0 &&
    value.error.message.length <= MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE &&
    optionalPositiveInteger(value.error.line) &&
    optionalPositiveInteger(value.error.column)
  );
}

function optionalPositiveInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 1)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
