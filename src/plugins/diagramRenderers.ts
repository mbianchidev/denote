import createDOMPurify from "dompurify";
import { api, errorMessage } from "../lib/api";
import type {
  PluginDiagramRenderRequest,
  PluginDiagramRenderResult,
  PluginDiagramTheme,
} from "@denote/plugin-sdk";
import {
  MAX_PLUGIN_DIAGRAM_SOURCE_BYTES,
  MAX_PLUGIN_DIAGRAM_SOURCE_LINES,
  MAX_PLUGIN_DIAGRAM_SVG_BYTES,
  isPluginDiagramRenderResult,
} from "@denote/plugin-sdk";

export interface PluginDiagramRendererContribution {
  pluginId: string;
  id: string;
  title: string;
  languages: string[];
}

function abortable<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    request.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export interface SanitizedDiagram {
  svg: string;
  accessibleName: string;
  diagramType: string;
}

export interface DiagramEditorBinding {
  scopeId: string;
  renderers: PluginDiagramRendererContribution[];
  renderDiagram: (
    renderer: PluginDiagramRendererContribution,
    request: PluginDiagramRenderRequest,
    scopeId: string,
    signal: AbortSignal,
  ) => Promise<PluginDiagramRenderResult>;
  releaseScope: (scopeId: string) => void;
  exportSvg: (suggestedName: string, svg: string) => Promise<boolean>;
}

const ALLOWED_SVG_TAGS = [
  "svg",
  "g",
  "defs",
  "marker",
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
  "text",
  "tspan",
  "title",
  "desc",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
] as const;

const ALLOWED_SVG_ATTRIBUTES = [
  "xmlns",
  "viewBox",
  "width",
  "height",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-roledescription",
  "id",
  "class",
  "data-look",
  "transform",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "points",
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
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "preserveAspectRatio",
  "text-anchor",
  "dominant-baseline",
  "font-family",
  "font-size",
  "font-weight",
  "color",
  "offset",
  "stop-color",
  "stop-opacity",
] as const;

const RENDERABLE_SVG_TAGS = new Set([
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
  "text",
]);
const LOCAL_FRAGMENT_URL = /^url\(#[-A-Za-z0-9_.:]+\)$/;
const UNSAFE_ATTRIBUTE_VALUE =
  /[\\\u0000-\u001f\u007f]|(?:javascript|vbscript|data|file|https?):|@import|@font-face|expression\s*\(|behavior\s*:|-moz-binding/i;

export function sanitizeDiagramSvg(
  source: string,
  limits: {
    maxOutputBytes?: number;
    maxElements?: number;
  } = {},
): string {
  const maxOutputBytes =
    limits.maxOutputBytes ?? MAX_PLUGIN_DIAGRAM_SVG_BYTES;
  const maxElements = limits.maxElements ?? 10_000;
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).byteLength > maxOutputBytes
  ) {
    throw new Error("Diagram SVG exceeds the size limit.");
  }
  const purifier = createDOMPurify(window);
  const cleaned = purifier.sanitize(source, {
    NAMESPACE: "http://www.w3.org/2000/svg",
    ALLOWED_TAGS: [...ALLOWED_SVG_TAGS],
    ALLOWED_ATTR: [...ALLOWED_SVG_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    SAFE_FOR_XML: true,
    FORBID_TAGS: [
      "script",
      "style",
      "foreignObject",
      "a",
      "image",
      "use",
      "iframe",
      "object",
      "embed",
      "animate",
      "set",
      "mpath",
      "feImage",
    ],
    FORBID_ATTR: [
      "href",
      "xlink:href",
      "src",
      "target",
      "onload",
      "onclick",
      "onerror",
      "style",
    ],
  });
  const parsed = new DOMParser().parseFromString(
    cleaned,
    "image/svg+xml",
  );
  if (parsed.querySelector("parsererror")) {
    throw new Error("Diagram renderer returned malformed SVG.");
  }
  const root = parsed.documentElement;
  if (root.localName !== "svg") {
    throw new Error("Diagram renderer output root must be SVG.");
  }
  let elements = 0;
  let renderable = 0;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    elements += 1;
    if (elements > maxElements) {
      throw new Error("Diagram SVG exceeds the element limit.");
    }
    if (RENDERABLE_SVG_TAGS.has(element.localName)) {
      renderable += 1;
    }
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim();
      if (
        attribute.name === "xmlns" &&
        value === "http://www.w3.org/2000/svg"
      ) {
        continue;
      }
      if (
        UNSAFE_ATTRIBUTE_VALUE.test(value) ||
        (/\burl\s*\(/i.test(value) && !LOCAL_FRAGMENT_URL.test(value))
      ) {
        throw new Error(
          `Diagram SVG contains an unsafe ${attribute.name} attribute.`,
        );
      }
    }
  }
  if (renderable === 0) {
    throw new Error("Diagram SVG contains no renderable content.");
  }
  const serialized = new XMLSerializer().serializeToString(root);
  if (new TextEncoder().encode(serialized).byteLength > maxOutputBytes) {
    throw new Error("Diagram SVG exceeds the size limit.");
  }
  return serialized;
}

export class DiagramRenderCache {
  private readonly entries = new Map<
    string,
    { scopeId: string; value: SanitizedDiagram; bytes: number }
  >();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = 32,
    private readonly maxBytes = 16 * 1024 * 1024,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(scopeId: string, key: string): SanitizedDiagram | null {
    const cacheKey = this.key(scopeId, key);
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      return null;
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry.value;
  }

  set(scopeId: string, key: string, value: SanitizedDiagram): void {
    const cacheKey = this.key(scopeId, key);
    const bytes = new TextEncoder().encode(value.svg).byteLength;
    if (bytes > this.maxBytes) {
      return;
    }
    const previous = this.entries.get(cacheKey);
    if (previous) {
      this.totalBytes -= previous.bytes;
      this.entries.delete(cacheKey);
    }
    this.entries.set(cacheKey, { scopeId, value, bytes });
    this.totalBytes += bytes;
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [
            string,
            { scopeId: string; value: SanitizedDiagram; bytes: number },
          ]
        | undefined;
      if (!oldest) {
        break;
      }
      this.entries.delete(oldest[0]);
      this.totalBytes -= oldest[1].bytes;
    }
  }

  clearScope(scopeId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.scopeId === scopeId) {
        this.entries.delete(key);
        this.totalBytes -= entry.bytes;
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private key(scopeId: string, key: string): string {
    return `${scopeId}\u0000${key}`;
  }
}

export function validateDiagramRequest(
  request: PluginDiagramRenderRequest,
): PluginDiagramRenderResult | null {
  const bytes = new TextEncoder().encode(request.source).byteLength;
  const lines = request.source.split(/\r\n?|\n/);
  if (
    bytes > MAX_PLUGIN_DIAGRAM_SOURCE_BYTES ||
    lines.length > MAX_PLUGIN_DIAGRAM_SOURCE_LINES ||
    lines.some(
      (line) => new TextEncoder().encode(line).byteLength > 4 * 1024,
    )
  ) {
    return {
      status: "error",
      error: {
        code: "SOURCE_LIMIT",
        message:
          "Diagram source exceeds the 32 KiB, 1,000-line, or 4 KiB line limit.",
      },
    };
  }
  return null;
}

export function currentDiagramTheme(): PluginDiagramTheme {
  if (
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(forced-colors: active)").matches ||
      window.matchMedia("(prefers-contrast: more)").matches)
  ) {
    return "high-contrast";
  }
  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

export function diagramSandboxDocument(
  bootstrapUrl = "tauri://localhost/assets/diagramSandboxBootstrap.js",
): string {
  const parsedBootstrap = new URL(bootstrapUrl);
  const bootstrapSource =
    parsedBootstrap.origin === "null"
      ? parsedBootstrap.protocol
      : parsedBootstrap.origin;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${escapeHtmlAttribute(bootstrapSource)} data:; worker-src 'none'; child-src 'none'; frame-src 'none'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>
<script type="module" src="${escapeHtmlAttribute(bootstrapUrl)}"></script>
</body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface QueueEntry {
  renderer: PluginDiagramRendererContribution;
  request: PluginDiagramRenderRequest;
  scopeId: string;
  signal: AbortSignal;
  controller: AbortController;
  generation: number;
  resolve: (value: PluginDiagramRenderResult) => void;
  reject: (error: Error) => void;
}

const MAX_RENDER_QUEUE = 32;
const RENDER_TIMEOUT_MS = 5_000;

export class DiagramRendererHost {
  private readonly cache = new DiagramRenderCache();
  private readonly moduleSources = new Map<string, Promise<string>>();
  private readonly generations = new Map<string, number>();
  private readonly queue: QueueEntry[] = [];
  private active: QueueEntry | null = null;

  constructor(
    private readonly onFatalError: (pluginId: string, error: Error) => void,
  ) {}

  async render(
    renderer: PluginDiagramRendererContribution,
    request: PluginDiagramRenderRequest,
    scopeId: string,
    signal: AbortSignal,
  ): Promise<PluginDiagramRenderResult> {
    const invalid = validateDiagramRequest(request);
    if (invalid) {
      return invalid;
    }
    const key = cacheKey(renderer, request);
    const cached = this.cache.get(scopeId, key);
    if (cached) {
      return { status: "success", ...cached };
    }
    if (signal.aborted) {
      throw abortError();
    }
    this.pruneCancelledQueue();
    if (this.queue.length >= MAX_RENDER_QUEUE) {
      return {
        status: "error",
        error: {
          code: "RENDER_ERROR",
          message: "Diagram rendering is busy. Edit the source to try again.",
        },
      };
    }
    return new Promise<PluginDiagramRenderResult>((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const entry: QueueEntry = {
        renderer,
        request,
        scopeId,
        signal: controller.signal,
        controller,
        generation: this.generation(renderer.pluginId),
        resolve: (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      };
      const removeCancelled = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
          entry.reject(abortError());
        }
      };
      controller.signal.addEventListener("abort", removeCancelled, {
        once: true,
      });
      this.queue.push(entry);
      void this.drain();
    });
  }

  releaseScope(scopeId: string): void {
    this.cache.clearScope(scopeId);
    if (this.active?.scopeId === scopeId) {
      this.active.controller.abort();
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].scopeId === scopeId) {
        this.queue[index].reject(abortError());
        this.queue.splice(index, 1);
      }
    }
  }

  clearDerivedContent(): void {
    this.cache.clear();
    for (const pluginId of new Set([
      ...this.generations.keys(),
      ...this.moduleSources.keys(),
      ...this.queue.map((entry) => entry.renderer.pluginId),
      ...(this.active ? [this.active.renderer.pluginId] : []),
    ])) {
      this.bumpGeneration(pluginId);
    }
    this.cancelQueued("Diagram rendering was cancelled after the vault changed.");
    if (this.active) {
      this.active.controller.abort();
    }
  }

  disposePlugin(pluginId: string): void {
    this.bumpGeneration(pluginId);
    this.moduleSources.delete(pluginId);
    this.cache.clear();
    if (this.active?.renderer.pluginId === pluginId) {
      this.active.controller.abort();
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].renderer.pluginId === pluginId) {
        this.queue[index].reject(
          new Error("The diagram renderer is no longer available."),
        );
        this.queue.splice(index, 1);
      }
    }
  }

  retainPlugins(pluginIds: ReadonlySet<string>): void {
    for (const pluginId of this.moduleSources.keys()) {
      if (!pluginIds.has(pluginId)) {
        this.disposePlugin(pluginId);
      }
    }
  }

  dispose(): void {
    for (const pluginId of this.generations.keys()) {
      this.bumpGeneration(pluginId);
    }
    this.moduleSources.clear();
    this.cache.clear();
    if (this.active) {
      this.active.controller.abort();
    }
    for (const entry of this.queue.splice(0)) {
      entry.reject(new Error("The diagram renderer host stopped."));
    }
  }

  private async drain(): Promise<void> {
    if (this.active !== null) {
      return;
    }
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry) {
          break;
        }
        if (entry.signal.aborted) {
          entry.reject(abortError());
          continue;
        }
        this.active = entry;
        try {
          const result = await this.execute(entry);
          if (
            result.status === "success" &&
            !entry.signal.aborted &&
            entry.generation === this.generation(entry.renderer.pluginId)
          ) {
            this.cache.set(
              entry.scopeId,
              cacheKey(entry.renderer, entry.request),
              result,
            );
          }
          if (
            !entry.signal.aborted &&
            entry.generation === this.generation(entry.renderer.pluginId)
          ) {
            entry.resolve(result);
          } else {
            entry.reject(abortError());
          }
        } catch (caught) {
          entry.reject(
            caught instanceof Error ? caught : new Error(errorMessage(caught)),
          );
        } finally {
          if (this.active === entry) {
            this.active = null;
          }
        }
      }
    } finally {
      this.active = null;
    }
  }

  private async execute(entry: QueueEntry): Promise<PluginDiagramRenderResult> {
    let source = this.moduleSources.get(entry.renderer.pluginId);
    if (!source) {
      source = api.readPluginDiagramRenderer(entry.renderer.pluginId);
      this.moduleSources.set(entry.renderer.pluginId, source);
    }
    let moduleSource: string;
    try {
      moduleSource = await abortable(source, entry.signal);
    } catch (caught) {
      this.moduleSources.delete(entry.renderer.pluginId);
      const error =
        caught instanceof Error ? caught : new Error(errorMessage(caught));
      if (
        error.name === "AbortError" ||
        entry.signal.aborted ||
        entry.generation !== this.generation(entry.renderer.pluginId)
      ) {
        throw abortError();
      }
      this.onFatalError(entry.renderer.pluginId, error);
      throw error;
    }
    if (
      entry.signal.aborted ||
      entry.generation !== this.generation(entry.renderer.pluginId)
    ) {
      throw abortError();
    }
    const result = await renderInSandbox(
      moduleSource,
      entry.request,
      entry.signal,
    );
    if (!isPluginDiagramRenderResult(result)) {
      const error = new Error(
        "Diagram renderer returned an invalid bounded result.",
      );
      this.onFatalError(entry.renderer.pluginId, error);
      throw error;
    }
    if (result.status === "error") {
      return result;
    }
    try {
      return {
        status: "success",
        svg: sanitizeDiagramSvg(result.svg),
        accessibleName: result.accessibleName,
        diagramType: result.diagramType,
      };
    } catch (caught) {
      const error = new Error(
        `Diagram renderer returned unsafe SVG: ${errorMessage(caught)}`,
      );
      if (entry.generation === this.generation(entry.renderer.pluginId)) {
        this.onFatalError(entry.renderer.pluginId, error);
      }
      throw error;
    }
  }

  private generation(pluginId: string): number {
    return this.generations.get(pluginId) ?? 0;
  }

  private bumpGeneration(pluginId: string): void {
    this.generations.set(pluginId, this.generation(pluginId) + 1);
  }

  private cancelQueued(message: string): void {
    for (const entry of this.queue.splice(0)) {
      entry.controller.abort();
      entry.reject(new Error(message));
    }
  }

  private pruneCancelledQueue(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].signal.aborted) {
        const [entry] = this.queue.splice(index, 1);
        entry.reject(abortError());
      }
    }
  }
}

function renderInSandbox(
  moduleSource: string,
  request: PluginDiagramRenderRequest,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const token = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.title = "Diagram rendering sandbox";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "1024px";
    frame.style.height = "768px";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    const bootstrapUrl = new URL(
      "./diagramSandboxBootstrap.js",
      import.meta.url,
    );
    bootstrapUrl.hash = encodeURIComponent(token);
    frame.src = `data:text/html;charset=utf-8,${encodeURIComponent(
      diagramSandboxDocument(bootstrapUrl.href),
    )}`;
    let initialized = false;
    let rendering = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      window.removeEventListener("message", receive);
      frame.remove();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(abortError());
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({
        status: "error",
        error: {
          code: "RENDER_ERROR",
          message: "Diagram rendering exceeded the five-second limit.",
        },
      });
    }, RENDER_TIMEOUT_MS);
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.contentWindow ||
        !isRecord(event.data) ||
        event.data.token !== token
      ) {
        return;
      }
      if (event.data.type === "listening" && !initialized) {
        initialized = true;
        frame.contentWindow?.postMessage(
          { token, type: "initialize", moduleSource },
          "*",
        );
        return;
      }
      if (event.data.type === "ready" && !rendering) {
        rendering = true;
        frame.contentWindow?.postMessage(
          { token, type: "render", request },
          "*",
        );
        return;
      }
      if (event.data.type === "result") {
        cleanup();
        resolve(event.data.result);
        return;
      }
      if (event.data.type === "failure") {
        fail(
          new Error(
            typeof event.data.error === "string"
              ? event.data.error
              : "Diagram renderer sandbox failed.",
          ),
        );
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", receive);
    document.body.appendChild(frame);
  });
}

function cacheKey(
  renderer: PluginDiagramRendererContribution,
  request: PluginDiagramRenderRequest,
): string {
  return `${renderer.pluginId}\u0000${renderer.id}\u0000${request.theme}\u0000${request.source}`;
}

function abortError(): Error {
  const error = new Error("Diagram rendering was cancelled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
