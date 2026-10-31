import type { PluginDisposable } from "./contracts";
import { isCodePath, isCodeRange, record, type PluginCodeRange, type PluginCodeScope } from "./codeIntelligence";

export const TOOL_FORMATS = ["unix", "msvc", "eslint-json", "cargo-json"] as const;
export type PluginToolFormat = (typeof TOOL_FORMATS)[number];
export type PluginToolKind = "linter" | "build" | "terminal";
export const MAX_TOOL_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_TOOL_DIAGNOSTICS = 1000;

export interface PluginToolDocument {
  path: string;
  version: string;
}

export interface PluginToolFix {
  from: number;
  to: number;
  text: string;
}

export interface PluginToolDiagnostic extends PluginToolDocument {
  range: PluginCodeRange;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  rule?: string;
  fix?: PluginToolFix;
}

export interface PluginToolParseRequest {
  runId: string;
  scope: PluginCodeScope;
  format: PluginToolFormat;
  stdout: string;
  stderr: string;
  documents: PluginToolDocument[];
}

export interface PluginToolParseResult {
  runId: string;
  diagnostics: PluginToolDiagnostic[];
  notices: string[];
}

export interface PluginToolRegistration {
  id: string;
  title: string;
  kind: PluginToolKind;
  formats: PluginToolFormat[];
}

export interface PluginToolingProvider extends PluginToolRegistration {
  kind: "linter" | "build";
  parse: (request: PluginToolParseRequest) => PluginToolParseResult | Promise<PluginToolParseResult>;
}

export interface PluginToolContribution extends PluginToolRegistration {
  pluginId: string;
}

export interface PluginToolingCapability {
  register: (provider: PluginToolingProvider) => PluginDisposable;
}

export interface PluginTerminalCapability {
  register: (terminal: { id: string; title: string }) => PluginDisposable;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isToolRegistration(value: unknown): value is PluginToolRegistration {
  return record(value) && text(value.id, 128) && text(value.title, 128) &&
    Object.keys(value).every((key) => ["type", "id", "title", "kind", "formats", "parse"].includes(key)) &&
    ["linter", "build", "terminal"].includes(String(value.kind)) &&
    Array.isArray(value.formats) && value.formats.length <= TOOL_FORMATS.length &&
    new Set(value.formats).size === value.formats.length &&
    (value.kind === "terminal" ? value.formats.length === 0 : value.formats.length > 0) &&
    value.formats.every((format: unknown) => TOOL_FORMATS.some((entry) => entry === format));
}

export function isToolParseRequest(value: unknown): value is PluginToolParseRequest {
  if (!record(value) || !text(value.runId, 128) || !record(value.scope) ||
      !(value.scope.projectId === null || text(value.scope.projectId, 128)) ||
      !isCodePath(value.scope.rootPath) || !TOOL_FORMATS.some((format) => format === value.format) ||
      typeof value.stdout !== "string" || typeof value.stderr !== "string" ||
      new TextEncoder().encode(value.stdout + value.stderr).length > MAX_TOOL_OUTPUT_BYTES ||
      !Array.isArray(value.documents) || value.documents.length > 5000) return false;
  const root = value.scope.rootPath;
  return new Set(value.documents.map((document: unknown) => record(document) ? document.path : null)).size === value.documents.length &&
    value.documents.every((document: unknown) => record(document) && isCodePath(document.path, false) &&
      !document.path.split("/").includes(".git") && text(document.version, 128) &&
      (root === "" || document.path.startsWith(`${root}/`)));
}

export function isToolParseResult(value: unknown): value is PluginToolParseResult {
  let inserted = 0;
  return record(value) && Object.keys(value).every((key) => ["runId", "diagnostics", "notices"].includes(key)) &&
    text(value.runId, 128) && Array.isArray(value.diagnostics) &&
    value.diagnostics.length <= MAX_TOOL_DIAGNOSTICS && value.diagnostics.every((diagnostic: unknown) => {
      if (!record(diagnostic) || !isCodePath(diagnostic.path, false) ||
          diagnostic.path.split("/").includes(".git") || !text(diagnostic.version, 128) ||
          !isCodeRange(diagnostic.range) || !text(diagnostic.message, 8192) ||
          !["error", "warning", "info", "hint"].includes(String(diagnostic.severity)) ||
          (diagnostic.rule !== undefined && !text(diagnostic.rule, 256))) return false;
      const fix = diagnostic.fix;
      if (fix === undefined) return true;
      if (!record(fix) || !integer(fix.from) || !integer(fix.to) || fix.from > fix.to ||
          typeof fix.text !== "string") return false;
      inserted += fix.text.length;
      return inserted <= 4 * 1024 * 1024;
    }) && Array.isArray(value.notices) && value.notices.length <= 20 &&
    value.notices.every((notice: unknown) => text(notice, 1024));
}

export function isToolParseResultFor(request: PluginToolParseRequest, result: unknown): result is PluginToolParseResult {
  if (!isToolParseRequest(request) || !isToolParseResult(result) || result.runId !== request.runId) return false;
  const versions = new Map(request.documents.map((document) => [document.path, document.version]));
  return result.diagnostics.every((diagnostic) => versions.get(diagnostic.path) === diagnostic.version);
}

export function parseToolDiagnostics(request: PluginToolParseRequest): PluginToolParseResult {
  if (!isToolParseRequest(request)) throw new Error("Invalid diagnostic input or output limit exceeded.");
  const diagnostics: PluginToolDiagnostic[] = [];
  const versions = new Map(request.documents.map((document) => [document.path, document.version]));
  let omitted = 0;
  const add = (path: string, line: number, column: number, severity: PluginToolDiagnostic["severity"], message: string, rule?: string, fix?: PluginToolFix) => {
    path = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const root = request.scope.rootPath;
    if (!versions.has(path) && root) path = `${root}/${path}`;
    const version = versions.get(path);
    if (!version || !isCodePath(path, false) || !Number.isSafeInteger(line) || line < 1 ||
        !Number.isSafeInteger(column) || column < 1 || diagnostics.length >= MAX_TOOL_DIAGNOSTICS) {
      omitted += 1;
      return;
    }
    const position = { line: line - 1, character: column - 1 };
    diagnostics.push({ path, version, range: { start: position, end: position }, severity, message,
      ...(rule ? { rule } : {}), ...(fix ? { fix } : {}) });
  };
  if (request.format === "eslint-json") {
    const files: unknown = JSON.parse(request.stdout || "[]");
    if (!Array.isArray(files)) throw new Error("ESLint JSON must be an array of file results.");
    for (const file of files) {
      if (!record(file) || typeof file.filePath !== "string" || !Array.isArray(file.messages)) {
        throw new Error("Invalid ESLint JSON file result.");
      }
      for (const message of file.messages) {
        if (!record(message) || typeof message.message !== "string" ||
            (message.severity !== 1 && message.severity !== 2)) throw new Error("Invalid ESLint JSON message.");
        const proposal = message.fix;
        let fix: PluginToolFix | undefined;
        if (proposal !== undefined) {
          if (!record(proposal) || !Array.isArray(proposal.range) || proposal.range.length !== 2 ||
              !integer(proposal.range[0]) || !integer(proposal.range[1]) || proposal.range[0] > proposal.range[1] ||
              typeof proposal.text !== "string") throw new Error("Invalid ESLint JSON fix proposal.");
          fix = { from: proposal.range[0], to: proposal.range[1], text: proposal.text };
        }
        add(file.filePath, Number(message.line ?? 1), Number(message.column ?? 1),
          message.severity === 2 ? "error" : "warning", message.message,
          typeof message.ruleId === "string" ? message.ruleId : undefined, fix);
      }
    }
  } else for (const raw of `${request.stdout}\n${request.stderr}`.split("\n")) {
    const line = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trimEnd();
    if (request.format === "cargo-json") {
      if (!line.startsWith("{")) continue;
      const event: unknown = JSON.parse(line);
      const message = record(event) && record(event.message) ? event.message : event;
      if (!record(message) || typeof message.message !== "string" || !Array.isArray(message.spans)) continue;
      for (const span of message.spans) {
        if (!record(span) || span.is_primary !== true || typeof span.file_name !== "string") continue;
        add(span.file_name, Number(span.line_start), Number(span.column_start),
          message.level === "warning" ? "warning" : message.level === "note" || message.level === "help" ? "info" : "error",
          message.message, record(message.code) && typeof message.code.code === "string" ? message.code.code : undefined);
      }
    } else if (request.format === "msvc") {
      const match = /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|fatal error)\s+([^:]+):\s*(.+)$/.exec(line.replace(/^\d+>/, ""));
      if (match) add(match[1], Number(match[2]), Number(match[3] ?? 1),
        match[4] === "warning" ? "warning" : "error", match[6], match[5]);
    } else {
      const match = /^(.*?):(\d+):(?:(\d+):)?\s*(error|warning|info|note|fatal error):\s*(.*?)(?:\s+\[([^\]]+)\])?$/.exec(line);
      if (match) add(match[1], Number(match[2]), Number(match[3] ?? 1),
        match[4] === "warning" ? "warning" : match[4] === "info" || match[4] === "note" ? "info" : "error",
        match[5], match[6]);
    }
  }
  const result = { runId: request.runId, diagnostics, notices: omitted ? [`${omitted} diagnostics omitted because their files, positions, or result count are outside this run's snapshot.`] : [] };
  if (!isToolParseResultFor(request, result)) throw new Error("The tool returned invalid diagnostics.");
  return result;
}
