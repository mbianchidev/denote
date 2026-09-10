import mermaid from "mermaid";
import type {
  PluginDiagramRenderError,
  PluginDiagramRendererModule,
  PluginDiagramTheme,
} from "@denote/plugin-sdk";
import {
  MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME,
  MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE,
  MAX_PLUGIN_DIAGRAM_LINE_BYTES,
  MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
  MAX_PLUGIN_DIAGRAM_SOURCE_LINES,
} from "@denote/plugin-sdk";

export const MERMAID_RENDERER_LIMITS = {
  maxSourceBytes: MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
  maxLines: MAX_PLUGIN_DIAGRAM_SOURCE_LINES,
  maxLineBytes: MAX_PLUGIN_DIAGRAM_LINE_BYTES,
  maxStatements: 500,
  maxEdges: 300,
} as const;

const SUPPORTED_DIAGRAMS = [
  /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/,
  /^(?:flowchart(?:-elk)?|graph)\b/i,
  /^swimlane-beta\b/i,
  /^sequenceDiagram\b/i,
  /^classDiagram(?:-v2)?\b/i,
  /^stateDiagram(?:-v2)?\b/i,
  /^erDiagram\b/i,
  /^gitGraph\b/i,
  /^gantt\b/i,
  /^pie\b/i,
  /^quadrantChart\b/i,
  /^xychart(?:-beta)?\b/i,
  /^requirement(?:Diagram)?\b/i,
  /^journey\b/i,
  /^timeline\b/i,
  /^mindmap\b/i,
  /^kanban\b/i,
  /^sankey(?:-beta)?\b/i,
  /^packet(?:-beta)?\b/i,
  /^radar-beta\b/i,
  /^block(?:-beta)?\b/i,
  /^treeView-beta\b/i,
  /^architecture(?:-beta)?\b/i,
  /^eventmodeling\b/i,
  /^ishikawa(?:-beta)?\b/i,
  /^venn-beta\b/i,
  /^treemap\b/i,
  /^wardley-beta\b/i,
  /^cynefin-beta(?:[\s:]|$)/i,
  /^railroad-(?:beta|ebnf-beta|abnf-beta|peg-beta)\b/i,
] as const;

const UNSAFE_SOURCE_PATTERNS: Array<[RegExp, string]> = [
  [/%%\s*\{/, "Mermaid configuration directives are unavailable."],
  [/^\s*click\s+/im, "Clickable nodes and callbacks are unavailable."],
  [/^\s*links?\s+/im, "Diagram links are unavailable."],
  [/(?:javascript|vbscript|data|file|https?):/i, "External and scriptable URLs are unavailable."],
  [/<\/?[A-Za-z][^>]*>/, "HTML labels are unavailable."],
  [/@\s*\{/, "Image, icon, and custom shape attributes are unavailable."],
  [/^\s*(?:classDef|style)\s+/im, "Custom diagram styles are unavailable."],
  [/\b(?:img|image|icon|href)\s*:/i, "Images, icons, and links are unavailable."],
];

const SECURE_CONFIGURATION_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "htmlLabels",
  "dompurifyConfig",
  "theme",
  "themeCSS",
  "themeVariables",
  "fontFamily",
  "fontSize",
  "look",
  "layout",
  "elk",
  "handDrawnSeed",
  "deterministicIds",
  "deterministicIDSeed",
  "legacyMathML",
  "forceLegacyMathML",
  "arrowMarkerAbsolute",
  "flowchart",
  "sequence",
  "gantt",
  "journey",
  "timeline",
  "class",
  "state",
  "er",
  "pie",
  "quadrantChart",
  "xyChart",
  "requirement",
  "architecture",
  "mindmap",
  "kanban",
  "gitGraph",
  "c4",
  "sankey",
  "packet",
  "block",
  "eventmodeling",
  "treeView",
  "radar",
  "venn",
  "ishikawa",
  "swimlane",
  "treemap",
  "wardley-beta",
  "cynefin",
  "railroad",
] as const;

export const renderDiagram: PluginDiagramRendererModule["renderDiagram"] =
  async (request) => {
    const prepared = prepareSource(request.source);
    if ("error" in prepared) {
      return { status: "error", error: prepared.error };
    }
    const diagramType = firstDiagramLine(prepared.source);
    if (!SUPPORTED_DIAGRAMS.some((pattern) => pattern.test(diagramType))) {
      return error(
        "UNSUPPORTED_DIAGRAM",
        "This Mermaid diagram type is outside Denote's safe supported subset.",
      );
    }
    const statementCount = prepared.source
      .split(/\r\n?|\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("%%")).length;
    if (statementCount > MERMAID_RENDERER_LIMITS.maxStatements) {
      return error(
        "SOURCE_LIMIT",
        "Diagram source exceeds the 500-statement limit.",
      );
    }
    if (
      relationshipCount(prepared.source, diagramType) >
      MERMAID_RENDERER_LIMITS.maxEdges
    ) {
      return error(
        "SOURCE_LIMIT",
        "Diagram source exceeds the 300-relationship limit.",
      );
    }
    try {
      mermaid.initialize(
        configuration(
          request.theme,
          stableSeed(prepared.source),
          prepared.displayMode,
        ),
      );
      const rendered = await mermaid.render(
        `denote-mermaid-${stableSeed(`${request.theme}\u0000${prepared.source}`)}`,
        prepared.source,
      );
      return {
        status: "success",
        svg: flattenSvgStyles(rendered.svg),
        diagramType: rendered.diagramType,
        accessibleName: prepared.title,
      };
    } catch (caught) {
      return {
        status: "error",
        error: parseError(caught, prepared.lineOffset),
      };
    }
  };

interface PreparedSource {
  source: string;
  title: string;
  displayMode?: "compact";
  lineOffset: number;
}

function prepareSource(
  value: string,
): PreparedSource | { error: PluginDiagramRenderError } {
  const bytes = new TextEncoder().encode(value).byteLength;
  const lines = value.split(/\r\n?|\n/);
  if (
    bytes > MERMAID_RENDERER_LIMITS.maxSourceBytes ||
    lines.length > MERMAID_RENDERER_LIMITS.maxLines ||
    lines.some(
      (line) =>
        new TextEncoder().encode(line).byteLength >
        MERMAID_RENDERER_LIMITS.maxLineBytes,
    )
  ) {
    return {
      error: {
        code: "SOURCE_LIMIT",
        message:
          "Diagram source exceeds the 32 KiB, 1,000-line, or 4 KiB line limit.",
      },
    };
  }
  const frontmatter = safeFrontmatter(value);
  if ("error" in frontmatter) {
    return frontmatter;
  }
  let source = frontmatter.source;
  let lineOffset = frontmatter.lineOffset;
  for (const [pattern, message] of UNSAFE_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      return { error: { code: "UNSAFE_SOURCE", message } };
    }
  }
  const sourceLines = source.split(/\r\n?|\n/);
  const titleMatch = sourceLines[0]?.match(
    /^%%\s*denote:title:\s*(.+?)\s*$/i,
  );
  if (titleMatch && frontmatter.title) {
    return {
      error: {
        code: "UNSAFE_SOURCE",
        message:
          "Use either YAML title frontmatter or denote:title metadata, not both.",
      },
    };
  }
  const title = titleMatch
    ? safeTitle(titleMatch[1])
    : (frontmatter.title ?? "Mermaid diagram");
  if (titleMatch && title === null) {
    return {
      error: {
        code: "UNSAFE_SOURCE",
        message:
          "Diagram titles must be plain text of at most 80 characters.",
      },
    };
  }
  if (titleMatch) {
    source = sourceLines.slice(1).join("\n");
    lineOffset += 1;
  }
  return {
    source,
    title: title ?? "Mermaid diagram",
    ...(frontmatter.displayMode
      ? { displayMode: frontmatter.displayMode }
      : {}),
    lineOffset,
  };
}

function safeFrontmatter(
  source: string,
):
  | {
      source: string;
      title: string | null;
      displayMode?: "compact";
      lineOffset: number;
    }
  | { error: PluginDiagramRenderError } {
  const lines = source.split(/\r\n?|\n/);
  if (lines[0]?.trim() !== "---") {
    return { source, title: null, lineOffset: 0 };
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end < 0) {
    return frontmatterError("YAML frontmatter is missing its closing ---.");
  }
  let title: string | null = null;
  let displayMode: "compact" | undefined;
  const seen = new Set<string>();
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (
      line !== line.trimStart() ||
      /[&*!]|<<\s*:|[\[\]{}|>]/.test(trimmed)
    ) {
      return frontmatterError(
        "YAML frontmatter supports only simple title and displayMode values.",
      );
    }
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match || !["title", "displayMode"].includes(match[1])) {
      return frontmatterError(
        "YAML frontmatter supports only title and displayMode.",
      );
    }
    if (seen.has(match[1])) {
      return frontmatterError(
        `YAML frontmatter contains duplicate ${match[1]}.`,
      );
    }
    seen.add(match[1]);
    const scalar = safeYamlScalar(match[2]);
    if (scalar === null) {
      return frontmatterError(
        `YAML frontmatter ${match[1]} must be a simple string.`,
      );
    }
    if (match[1] === "title") {
      title = safeTitle(scalar);
      if (title === null) {
        return frontmatterError(
          "Diagram titles must be plain text of at most 80 characters.",
        );
      }
    } else if (scalar === "compact") {
      displayMode = "compact";
    } else {
      return frontmatterError(
        "YAML displayMode supports only compact.",
      );
    }
  }
  return {
    source: lines.slice(end + 1).join("\n"),
    title,
    ...(displayMode ? { displayMode } : {}),
    lineOffset: end + 1,
  };
}

function safeYamlScalar(value: string): string | null {
  const scalar = value.trim();
  if (!scalar) {
    return null;
  }
  if (scalar.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(scalar);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (scalar.startsWith("'")) {
    return scalar.endsWith("'") && scalar.length >= 2
      ? scalar.slice(1, -1).replace(/''/g, "'")
      : null;
  }
  return /[\u0000-\u001f\u007f]/.test(scalar) ? null : scalar;
}

function frontmatterError(
  message: string,
): { error: PluginDiagramRenderError } {
  return {
    error: {
      code: "UNSAFE_SOURCE",
      message,
    },
  };
}

function safeTitle(value: string): string | null {
  const title = value.trim();
  return title.length > 0 &&
    title.length <= MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME &&
    !/[\u0000-\u001f\u007f<>]/.test(title)
    ? title
    : null;
}

function firstDiagramLine(source: string): string {
  return (
    source
      .split(/\r\n?|\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("%%")) ?? ""
  );
}

function relationshipCount(source: string, diagramType: string): number {
  const lines = source
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  const body = lines.slice(1);
  if (/^sankey(?:-beta)?\b/i.test(diagramType)) {
    return body.filter((line) => line.split(",").length >= 3).length;
  }
  if (/^sequenceDiagram\b/i.test(diagramType)) {
    return body.filter((line) =>
      /(?:--?|==?|-\.-?)[<>x)]{1,2}/.test(line),
    ).length;
  }
  if (/^C4/i.test(diagramType)) {
    return body.filter((line) => /^\s*(?:Bi)?Rel(?:_[A-Za-z]+)?\s*\(/i.test(line))
      .length;
  }
  if (/^requirement(?:Diagram)?\b/i.test(diagramType)) {
    return body.filter((line) =>
      /^\s*(?:contains|copies|derives|satisfies|verifies|refines|traces)\b/i.test(
        line,
      ),
    ).length;
  }
  if (/^gitGraph\b/i.test(diagramType)) {
    return body.filter((line) =>
      /^\s*(?:commit|merge|cherry-pick)\b/i.test(line),
    ).length;
  }
  if (/^(?:flowchart|graph|classDiagram|stateDiagram|architecture)/i.test(
    diagramType,
  )) {
    return body.reduce(
      (count, line) =>
        count +
        (
          line.match(
            /(?:-->|---|-\.-?>|==>|<\|--|\*--|o--|\.\.>|\.\.\|>|--\||\}o--|\|\|--|}--)/g,
          ) ?? []
        ).length,
      0,
    );
  }
  if (/^erDiagram\b/i.test(diagramType)) {
    return body.filter((line) =>
      /(?:\|\||o\||\|o|oo|\}\||\|[{}]|[{}]\|).*(?:--|\.\.)/.test(line),
    ).length;
  }
  return 0;
}

function configuration(
  theme: PluginDiagramTheme,
  seed: string,
  displayMode?: "compact",
) {
  const themeVariables =
    theme === "dark"
      ? {
          background: "#17191d",
          primaryColor: "#2b3139",
          primaryTextColor: "#f2f0e9",
          primaryBorderColor: "#b7c88b",
          lineColor: "#d7d2c7",
          secondaryColor: "#343b44",
          tertiaryColor: "#22272e",
          textColor: "#f2f0e9",
          mainBkg: "#2b3139",
          nodeBorder: "#b7c88b",
        }
      : theme === "high-contrast"
        ? {
            background: "Canvas",
            primaryColor: "Canvas",
            primaryTextColor: "CanvasText",
            primaryBorderColor: "Highlight",
            lineColor: "CanvasText",
            secondaryColor: "Canvas",
            tertiaryColor: "Canvas",
            textColor: "CanvasText",
            mainBkg: "Canvas",
            nodeBorder: "Highlight",
          }
        : {
            background: "#ffffff",
            primaryColor: "#f4f1e8",
            primaryTextColor: "#202421",
            primaryBorderColor: "#52652e",
            lineColor: "#343a35",
            secondaryColor: "#e5ead8",
            tertiaryColor: "#f8f7f3",
            textColor: "#202421",
            mainBkg: "#f4f1e8",
            nodeBorder: "#52652e",
          };
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    htmlLabels: false,
    maxTextSize: MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
    maxEdges: MERMAID_RENDERER_LIMITS.maxEdges,
    look: "classic" as const,
    theme: "base" as const,
    themeVariables,
    fontFamily: "system-ui, sans-serif",
    handDrawnSeed: 1,
    deterministicIds: true,
    deterministicIDSeed: seed,
    arrowMarkerAbsolute: false,
    legacyMathML: false,
    forceLegacyMathML: false,
    logLevel: "fatal" as const,
    secure: [...SECURE_CONFIGURATION_KEYS],
    flowchart: { htmlLabels: false },
    ...(displayMode ? { gantt: { displayMode } } : {}),
  };
}

function stableSeed(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const PRESENTATION_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
] as const;

function flattenSvgStyles(source: string): string {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new Error("Mermaid returned malformed SVG.");
  }
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "1024px";
  host.style.height = "768px";
  const root = document.importNode(parsed.documentElement, true);
  host.appendChild(root);
  document.body.appendChild(host);
  try {
    const elements = [root, ...root.querySelectorAll("*")];
    const presentation = new Map<Element, Array<[string, string]>>();
    for (const element of elements) {
      if (element.localName === "style") {
        continue;
      }
      const computed = window.getComputedStyle(element);
      presentation.set(
        element,
        PRESENTATION_PROPERTIES.flatMap((property) => {
          const value = computed.getPropertyValue(property).trim();
          return value ? [[property, value] as [string, string]] : [];
        }),
      );
    }
    for (const element of elements) {
      if (element.localName === "style") {
        element.remove();
        continue;
      }
      for (const [property, value] of presentation.get(element) ?? []) {
        element.setAttribute(property, value);
      }
      element.removeAttribute("style");
      element.removeAttribute("class");
    }
    return new XMLSerializer().serializeToString(root);
  } finally {
    host.remove();
  }
}

function parseError(
  caught: unknown,
  lineOffset = 0,
): PluginDiagramRenderError {
  const raw =
    caught instanceof Error
      ? caught.message
      : typeof caught === "object" &&
          caught !== null &&
          "str" in caught &&
          typeof caught.str === "string"
        ? caught.str
        : String(caught);
  const message = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE);
  const line = raw.match(/(?:line|Line)\s+(\d+)/)?.[1];
  const column = raw.match(/(?:column|col)\s+(\d+)/i)?.[1];
  return {
    code: "PARSE_ERROR",
    message: message || "Mermaid could not parse this diagram.",
    ...(line ? { line: Number(line) + lineOffset } : {}),
    ...(column ? { column: Number(column) } : {}),
  };
}

function error(
  code: PluginDiagramRenderError["code"],
  message: string,
) {
  return {
    status: "error" as const,
    error: { code, message },
  };
}
