import { PeleError, render } from "pele";
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
  MAX_PLUGIN_DIAGRAM_SVG_BYTES,
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
      const rendered = render(prepared.source, {
        links: false,
        images: false,
        autoDirection: false,
        fontFamily: "system-ui, sans-serif",
        idPrefix: `denote-mermaid-${stableSeed(`${request.theme}\u0000${prepared.source}`)}`,
        limit: MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
        outputLimit: MAX_PLUGIN_DIAGRAM_SVG_BYTES,
        maxEdges: MERMAID_RENDERER_LIMITS.maxEdges,
        ...(prepared.displayMode
          ? { config: { gantt: { displayMode: prepared.displayMode } } }
          : {}),
      });
      const svg = flattenSvgStyles(rendered.svg, request.theme);
      if (new TextEncoder().encode(svg).byteLength > MAX_PLUGIN_DIAGRAM_SVG_BYTES) {
        return error("RENDER_ERROR", "Diagram SVG exceeds the 2 MiB limit.");
      }
      return {
        status: "success",
        svg,
        diagramType: rendered.mermaidType,
        accessibleName: prepared.title,
      };
    } catch (caught) {
      return {
        status: "error",
        error: renderError(caught, prepared.lineOffset),
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

function themeVariables(theme: PluginDiagramTheme): Record<string, string> {
  const palette =
    theme === "dark"
      ? {
          background: "#17191d",
          primaryColor: "#2b3139",
          primaryTextColor: "#f2f0e9",
          primaryBorderColor: "#b7c88b",
          lineColor: "#d7d2c7",
          secondaryColor: "#343b44",
        }
      : theme === "high-contrast"
        ? {
            background: "Canvas",
            primaryColor: "Canvas",
            primaryTextColor: "CanvasText",
            primaryBorderColor: "Highlight",
            lineColor: "CanvasText",
            secondaryColor: "Canvas",
          }
        : {
            background: "#ffffff",
            primaryColor: "#f4f1e8",
            primaryTextColor: "#202421",
            primaryBorderColor: "#52652e",
            lineColor: "#343a35",
            secondaryColor: "#e5ead8",
          };
  const series =
    theme === "dark"
      ? [
          "#9fbe85", "#a9cdf1", "#d7bcf1", "#ffb4bd",
          "#add7bc", "#f2d87c", "#b1cf98", "#aaa9a2",
        ]
      : [
          "#3f6132", "#285f91", "#6e3e91", "#9b2643",
          "#276344", "#725600", "#173e64", "#51554d",
        ];
  return {
    "--pele-bg": palette.background,
    "--pele-fg": palette.primaryTextColor,
    "--pele-muted": palette.lineColor,
    "--pele-line": palette.lineColor,
    "--pele-surface": palette.primaryColor,
    "--pele-surface-alt": palette.secondaryColor,
    "--pele-border": palette.primaryBorderColor,
    "--pele-accent": palette.primaryBorderColor,
    "--pele-critical":
      theme === "high-contrast"
        ? "CanvasText"
        : theme === "dark" ? "#ffb4bd" : "#9b2643",
    "--pele-fg-on-light": "#202421",
    "--pele-fg-on-dark": "#f2f0e9",
    ...Object.fromEntries(series.map((color, index) => [
      `--pele-series-${index + 1}`,
      theme === "high-contrast" ? "CanvasText" : color,
    ])),
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
  "stop-color",
  "stop-opacity",
  "rx",
  "ry",
] as const;

const LOCAL_PAINT_WITH_FALLBACK =
  /^url\((["']?)(#[-A-Za-z0-9_.:]+)\1\)(?:\s+(?:none|rgba?\([\d.,%\s]+\)))?$/;

function flattenSvgStyles(source: string, theme: PluginDiagramTheme): string {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new Error("Pele returned malformed SVG.");
  }
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "1024px";
  host.style.height = "768px";
  const root = document.importNode(parsed.documentElement, true);
  const variables = themeVariables(theme);
  root.setAttribute("style", [
    root.getAttribute("style") ?? "",
    ...Object.entries(variables).map(
      ([property, value]) => `${property}:${value}`,
    ),
  ].join(";"));
  const bounds = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (
    !bounds || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
    bounds[2] <= 0 || bounds[3] <= 0
  ) {
    throw new Error("Pele returned an invalid SVG view box.");
  }
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [index, property] of ["x", "y", "width", "height"].entries()) {
    background.setAttribute(property, String(bounds[index]));
  }
  background.setAttribute("fill", variables["--pele-bg"]);
  root.prepend(background);
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
          const localPaint = value.replace(
            LOCAL_PAINT_WITH_FALLBACK,
            "url($2)",
          );
          return localPaint ? [[property, localPaint] as [string, string]] : [];
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

function renderError(
  caught: unknown,
  lineOffset = 0,
): PluginDiagramRenderError {
  const raw = caught instanceof Error ? caught.message : String(caught);
  const message = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE);
  const located = caught instanceof PeleError ? caught : null;
  return {
    code: located
      ? located.code === "unsupported-diagram"
        ? "UNSUPPORTED_DIAGRAM"
        : located.code === "limit" ? "SOURCE_LIMIT" : "PARSE_ERROR"
      : "RENDER_ERROR",
    message: message || "Pele could not render this diagram.",
    ...(located && Number.isSafeInteger(located.line) && located.line > 0
      ? { line: located.line + lineOffset }
      : {}),
    ...(located && Number.isSafeInteger(located.column) && located.column > 0
      ? { column: located.column }
      : {}),
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
