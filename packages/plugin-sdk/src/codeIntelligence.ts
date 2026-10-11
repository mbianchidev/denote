import type { PluginDisposable } from "./contracts";

export const CODE_LANGUAGES = ["rust", "go", "python", "java", "cpp", "typescript"] as const;
export type PluginCodeLanguage = (typeof CODE_LANGUAGES)[number];
export const CODE_FEATURES = [
  "completion", "hover", "signature", "diagnostics", "format",
  "definition", "declaration", "implementation", "type-definition",
  "references", "symbols", "workspace-symbols",
] as const;
export type PluginCodeFeature = (typeof CODE_FEATURES)[number];
export const CODE_FEATURE_METHODS: Record<PluginCodeFeature, string> = {
  completion: "textDocument/completion", hover: "textDocument/hover", signature: "textDocument/signatureHelp",
  diagnostics: "textDocument/diagnostic", format: "textDocument/formatting", definition: "textDocument/definition",
  declaration: "textDocument/declaration", implementation: "textDocument/implementation",
  "type-definition": "textDocument/typeDefinition", references: "textDocument/references",
  symbols: "textDocument/documentSymbol", "workspace-symbols": "workspace/symbol",
};
export const DEBUG_COMMANDS = [
  "launch", "attach", "setBreakpoints", "setExceptionBreakpoints",
  "continue", "pause", "next", "stepIn", "stepOut", "restart", "disconnect",
  "threads", "stackTrace", "scopes", "variables", "evaluate", "exceptionInfo",
] as const;
export type PluginDebugCommand = (typeof DEBUG_COMMANDS)[number];
export const MAX_CODE_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_CODE_RESULTS = 500;
export const MAX_CODE_LOGS = 200;

export interface PluginCodeScope {
  projectId: string | null;
  rootPath: string;
}

/** Protocol positions are zero-based UTF-16, including on Unix platforms. */
export interface PluginCodePosition {
  line: number;
  character: number;
}

export interface PluginCodeRange {
  start: PluginCodePosition;
  end: PluginCodePosition;
}

export interface PluginCodeDocument {
  path: string;
  language: PluginCodeLanguage;
  version: number;
  text: string;
}

export interface PluginCodeLocation {
  path: string;
  range: PluginCodeRange;
  name?: string;
  container?: string;
  language?: PluginCodeLanguage;
  project?: string;
}

export interface PluginCodeDiagnostic {
  range: PluginCodeRange;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
}

export interface PluginCodeTextEdit {
  range: PluginCodeRange;
  text: string;
}

export interface PluginCodeCompletion extends PluginCodeTextEdit {
  label: string;
  detail?: string;
}

export interface PluginDebugModel {
  stopEpoch?: number;
  state: "starting" | "running" | "stopped" | "terminated";
  capabilities: string[];
  threads: Array<{ id: number; name: string }>;
  frames: Array<{ id: number; name: string; location?: PluginCodeLocation }>;
  scopes: Array<{ name: string; variablesReference: number }>;
  variables: Array<{ name: string; value: string; type?: string; variablesReference: number }>;
  breakpoints: Array<{ line: number; verified: boolean; message?: string }>;
  output: string[];
  exception?: string;
  watches?: Array<{ expression: string; value: string; type?: string; variablesReference: number }>;
}

export interface PluginCodeResult {
  status: string;
  capabilities?: PluginCodeFeature[];
  locations?: PluginCodeLocation[];
  completions?: PluginCodeCompletion[];
  hover?: string;
  signatures?: string[];
  diagnostics?: PluginCodeDiagnostic[];
  edits?: PluginCodeTextEdit[];
  logs?: string[];
  notices?: string[];
  debug?: PluginDebugModel;
}

export type PluginCodeOperation = PluginCodeFeature |
  "start" | "stop" | "restart" | "poll" | "open" | "change" | "save" | "close" | "debug";

export interface PluginCodeRequest {
  operation: PluginCodeOperation;
  language: PluginCodeLanguage;
  scope: PluginCodeScope;
  document?: PluginCodeDocument;
  position?: PluginCodePosition;
  query?: string;
  debug?: { command: PluginDebugCommand; arguments?: Record<string, unknown> };
}

export interface PluginCodeLanguageAdapter {
  id: PluginCodeLanguage;
  title: string;
  server: string;
  debugger: string;
  setup: string;
}

export interface PluginCodeProtocolEvent {
  kind: "message" | "log" | "exit";
  message?: Record<string, unknown>;
  text?: string;
}

/**
 * Native executable paths and approval records never cross this boundary.
 * Starting a session is available only during a matching host-confirmed action.
 */
export interface PluginCodeTransport {
  start: (kind: "lsp" | "dap") => Promise<{ sessionId: string; rootPath: string }>;
  request: (sessionId: string, method: string, params?: unknown) => Promise<unknown>;
  notify: (sessionId: string, method: string, params?: unknown) => Promise<void>;
  poll: (sessionId: string) => Promise<PluginCodeProtocolEvent[]>;
  respond: (sessionId: string, id: string | number, result: unknown) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  cancel: () => Promise<void>;
}

export interface PluginCodeProvider {
  id: string;
  title: string;
  languages: PluginCodeLanguageAdapter[];
  run: (
    request: PluginCodeRequest,
    context: { transport: PluginCodeTransport; signal: AbortSignal },
  ) => Promise<PluginCodeResult>;
}

export interface PluginCodeIntelligenceCapability {
  register: (provider: PluginCodeProvider) => PluginDisposable;
}

export function codeDocumentUri(path: string): string {
  if (!isCodePath(path, false)) {
    throw new Error("Code document paths must stay inside the vault.");
  }
  return `denote://vault/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function codeLanguageForPath(path: string): PluginCodeLanguage | null {
  const parts = path.split(".");
  const extension = parts[parts.length - 1]?.toLowerCase();
  if (extension === "rs") return "rust";
  if (extension === "go") return "go";
  if (extension === "py" || extension === "pyi") return "python";
  if (extension === "java") return "java";
  if (["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"].includes(extension ?? "")) return "cpp";
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(extension ?? "")) return "typescript";
  return null;
}

export function isCodePath(value: unknown, allowRoot = true): value is string {
  return typeof value === "string" && value.length <= 4096 &&
    (allowRoot || value.length > 0) &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes(":") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    (value === "" || value.split("/").every((part) =>
      part !== "" && part !== "." && part !== ".." && part !== ".denote"));
}

export function isCodePosition(value: unknown): value is PluginCodePosition {
  return record(value) && integer(value.line) && integer(value.character);
}

export function isCodeRange(value: unknown): value is PluginCodeRange {
  return record(value) && isCodePosition(value.start) && isCodePosition(value.end) &&
    (value.start.line < value.end.line ||
      (value.start.line === value.end.line && value.start.character <= value.end.character));
}

export function isPluginCodeRequest(value: unknown): value is PluginCodeRequest {
  if (!record(value) || !CODE_LANGUAGES.includes(value.language as PluginCodeLanguage) ||
      ![...CODE_FEATURES, "start", "stop", "restart", "poll", "open", "change", "save", "close", "debug"]
        .includes(String(value.operation)) || !record(value.scope) ||
      !(value.scope.projectId === null || text(value.scope.projectId, 128)) ||
      !isCodePath(value.scope.rootPath)) {
    return false;
  }
  if (value.document !== undefined) {
    const doc = value.document;
    if (!record(doc) || !isCodePath(doc.path, false) || doc.language !== value.language ||
        !integer(doc.version) || typeof doc.text !== "string" ||
        new TextEncoder().encode(doc.text).length > MAX_CODE_SOURCE_BYTES ||
        (value.scope.rootPath !== "" &&
          !doc.path.startsWith(`${value.scope.rootPath}/`))) {
      return false;
    }
  }
  if (["open", "change", "save", "close", ...CODE_FEATURES.filter((feature) =>
    feature !== "workspace-symbols")].includes(String(value.operation)) &&
      value.document === undefined) return false;
  if (value.operation === "debug" && value.debug === undefined) return false;
  return (value.position === undefined || isCodePosition(value.position)) &&
    (value.query === undefined || text(value.query, 1024, true)) &&
    (value.debug === undefined ||
      (record(value.debug) && DEBUG_COMMANDS.includes(value.debug.command as PluginDebugCommand) &&
        (value.debug.arguments === undefined || isCodeJson(value.debug.arguments))));
}

export function isPluginCodeRegistration(value: unknown): value is Omit<PluginCodeProvider, "run"> {
  return record(value) && text(value.id, 128) && text(value.title, 128) &&
    Array.isArray(value.languages) && value.languages.length > 0 && value.languages.length <= 6 &&
    new Set(value.languages.map((language: unknown) => record(language) ? language.id : null)).size === value.languages.length &&
    value.languages.every((language: unknown) => record(language) &&
      CODE_LANGUAGES.some((id) => id === language.id) && text(language.title, 128) &&
      text(language.server, 128) && text(language.debugger, 128) && text(language.setup, 4096));
}

export function isCodeLocation(value: unknown): value is PluginCodeLocation {
  return record(value) && isCodePath(value.path, false) && isCodeRange(value.range) &&
    optional(value.name, (item) => text(item, 1024)) &&
    optional(value.container, (item) => text(item, 1024, true)) &&
    optional(value.project, (item) => text(item, 4096, true)) &&
    optional(value.language, (item) => CODE_LANGUAGES.some((id) => id === item));
}

function isCodeEdit(value: unknown): value is PluginCodeTextEdit {
  return record(value) && isCodeRange(value.range) && text(value.text, MAX_CODE_SOURCE_BYTES, true);
}

export function isPluginCodeResult(value: unknown): value is PluginCodeResult {
  if (!record(value) || !text(value.status, 4096, true) || !isCodeJson(value)) return false;
  return optional(value.capabilities, (item) => array(item, 12, (feature) => CODE_FEATURES.some((id) => id === feature))) &&
    optional(value.locations, (item) => array(item, MAX_CODE_RESULTS, isCodeLocation)) &&
    optional(value.completions, (item) => array(item, MAX_CODE_RESULTS, (completion) =>
      isCodeEdit(completion) && record(completion) && text(completion.label, 1024) &&
      optional(completion.detail, (detail) => text(detail, 4096, true)))) &&
    optional(value.hover, (item) => text(item, 32_768, true)) &&
    optional(value.signatures, (item) => array(item, 32, (label) => text(label, 4096))) &&
    optional(value.diagnostics, (item) => array(item, MAX_CODE_RESULTS, (diagnostic) =>
      record(diagnostic) && isCodeRange(diagnostic.range) && text(diagnostic.message, 8192) &&
      ["error", "warning", "info", "hint"].includes(String(diagnostic.severity)) &&
      optional(diagnostic.source, (source) => text(source, 128)))) &&
    optional(value.edits, (item) => array(item, MAX_CODE_RESULTS, isCodeEdit)) &&
    optional(value.logs, (item) => array(item, MAX_CODE_LOGS, (log) => text(log, 8192, true))) &&
    optional(value.notices, (item) => array(item, 32, (notice) => text(notice, 4096))) &&
    optional(value.debug, isDebugModel);
}

function isDebugModel(value: unknown): value is PluginDebugModel {
  return record(value) && ["starting", "running", "stopped", "terminated"].includes(String(value.state)) &&
    optional(value.stopEpoch, integer) &&
    array(value.capabilities, 64, (item) => text(item, 128)) &&
    array(value.threads, MAX_CODE_RESULTS, (item) => record(item) && integer(item.id) && text(item.name, 1024)) &&
    array(value.frames, MAX_CODE_RESULTS, (item) => record(item) && integer(item.id) && text(item.name, 1024) &&
      optional(item.location, isCodeLocation)) &&
    array(value.scopes, MAX_CODE_RESULTS, (item) => record(item) && text(item.name, 1024) && integer(item.variablesReference)) &&
    array(value.variables, MAX_CODE_RESULTS, (item) => record(item) && text(item.name, 1024) &&
      text(item.value, 8192, true) && integer(item.variablesReference) && optional(item.type, (type) => text(type, 128))) &&
    array(value.breakpoints, MAX_CODE_RESULTS, (item) => record(item) && integer(item.line) &&
      typeof item.verified === "boolean" && optional(item.message, (message) => text(message, 4096))) &&
    array(value.output, MAX_CODE_LOGS, (item) => text(item, 8192, true)) &&
    optional(value.exception, (item) => text(item, 8192)) &&
    optional(value.watches, (item) => array(item, 20, (watch) => record(watch) &&
      text(watch.expression, 1024) && text(watch.value, 8192, true) && integer(watch.variablesReference) &&
      optional(watch.type, (type) => text(type, 128))));
}

function optional(value: unknown, check: (item: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function array(value: unknown, maximum: number, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(check);
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

function text(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && value.length <= maximum;
}

export function isCodeJson(value: unknown): boolean {
  let remaining = 20_000;
  const visit = (item: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 20) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return item.length <= MAX_CODE_SOURCE_BYTES;
    if (Array.isArray(item)) return item.length <= 5000 && item.every((child) => visit(child, depth + 1));
    return record(item) && Object.entries(item).every(([key, child]) =>
      key.length <= 256 && visit(child, depth + 1));
  };
  return visit(value, 0) && JSON.stringify(value).length <= MAX_CODE_SOURCE_BYTES;
}
