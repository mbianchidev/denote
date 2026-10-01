import {
  MAX_CODE_RESULTS, codeDocumentUri, isCodePath, isCodeRange, record,
  type PluginCodeCompletion, type PluginCodeDiagnostic, type PluginCodeDocument,
  type PluginCodeFeature, type PluginCodeLocation, type PluginCodePosition,
  type PluginCodeRequest, type PluginCodeTextEdit,
} from "@denote/plugin-sdk";

export { CODE_FEATURE_METHODS as FEATURE_METHODS } from "@denote/plugin-sdk";

export function serverFeatures(capabilities: Record<string, unknown>): PluginCodeFeature[] {
  const properties: Record<PluginCodeFeature, string> = {
    completion: "completionProvider", hover: "hoverProvider", signature: "signatureHelpProvider",
    diagnostics: "diagnosticProvider", format: "documentFormattingProvider", definition: "definitionProvider",
    declaration: "declarationProvider", implementation: "implementationProvider",
    "type-definition": "typeDefinitionProvider", references: "referencesProvider",
    symbols: "documentSymbolProvider", "workspace-symbols": "workspaceSymbolProvider",
  };
  return (Object.keys(properties) as PluginCodeFeature[]).filter((feature) =>
    feature === "diagnostics" || capabilities[properties[feature]] === true || record(capabilities[properties[feature]]));
}

export function pathFromUri(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("denote://vault/")) {
    throw new Error("The server returned a target outside the current vault. Denote cannot open it here.");
  }
  let path: string;
  try { path = value.slice("denote://vault/".length).split("/").map(decodeURIComponent).join("/"); }
  catch { throw new Error("The server returned an invalid encoded source path."); }
  if (!isCodePath(path, false)) throw new Error("The server returned an unsafe source path.");
  return path;
}

export function locations(value: unknown, request: PluginCodeRequest): PluginCodeLocation[] {
  const result: PluginCodeLocation[] = [];
  const visit = (item: unknown, container = "", depth = 0): void => {
    if (result.length >= MAX_CODE_RESULTS) return;
    if (depth > 32 || !record(item)) throw new Error("The server returned an invalid or excessively nested symbol.");
    const location = record(item.location) ? item.location : item;
    const range = location.targetSelectionRange ?? location.selectionRange ?? location.range;
    if (!isCodeRange(range)) throw new Error("The server returned an invalid navigation range.");
    const uri = location.targetUri ?? location.uri ??
      (request.document ? codeDocumentUri(request.document.path) : undefined);
    result.push({
      path: pathFromUri(uri), range, language: request.language, project: request.scope.rootPath,
      ...(typeof item.name === "string" ? { name: item.name.slice(0, 1024) } : {}),
      ...(typeof item.containerName === "string" ? { container: item.containerName.slice(0, 1024) } :
        container ? { container } : {}),
    });
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        if (result.length >= MAX_CODE_RESULTS) break;
        visit(child, typeof item.name === "string" ? item.name.slice(0, 1024) : container, depth + 1);
      }
    }
  };
  if (value === null || value === undefined) return result;
  for (const item of Array.isArray(value) ? value.slice(0, MAX_CODE_RESULTS) : [value]) visit(item);
  return result;
}

export function textEdits(value: unknown): PluginCodeTextEdit[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CODE_RESULTS) {
    throw new Error("The server returned more than 500 formatting edits or an invalid edit list.");
  }
  return value.map((item) => {
    if (!record(item) || !isCodeRange(item.range) || typeof item.newText !== "string" ||
        item.newText.length > 4 * 1024 * 1024) throw new Error("The server returned an invalid formatting edit.");
    return { range: item.range, text: item.newText };
  });
}

export function diagnostics(value: unknown): PluginCodeDiagnostic[] {
  if (!Array.isArray(value)) throw new Error("The server returned an invalid diagnostics list.");
  return value.slice(0, MAX_CODE_RESULTS).map((item) => {
    if (!record(item) || !isCodeRange(item.range) || typeof item.message !== "string") {
      throw new Error("The server returned an invalid diagnostic.");
    }
    return {
      range: item.range, message: item.message.slice(0, 8192) || "Unspecified diagnostic",
      severity: item.severity === 1 ? "error" : item.severity === 2 ? "warning" : item.severity === 4 ? "hint" : "info",
      ...(typeof item.source === "string" ? { source: item.source.slice(0, 128) } : {}),
    };
  });
}

export function documentation(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 32_768);
  if (record(value) && typeof value.value === "string") return value.value.slice(0, 32_768);
  if (Array.isArray(value)) return value.slice(0, 32).map(documentation).join("\n\n").slice(0, 32_768);
  throw new Error("The server returned invalid hover documentation.");
}

export function completions(value: unknown, document: PluginCodeDocument, position: PluginCodePosition): PluginCodeCompletion[] {
  const items = Array.isArray(value) ? value : record(value) && Array.isArray(value.items) ? value.items :
    value === null ? [] : null;
  if (!items) throw new Error("The server returned an invalid completion list.");
  const line = document.text.split("\n")[position.line] ?? "";
  const prefix = line.slice(0, position.character).match(/[\p{L}\p{N}_$]+$/u)?.[0] ?? "";
  const fallbackRange = { start: { line: position.line, character: position.character - prefix.length }, end: position };
  const result: PluginCodeCompletion[] = [];
  for (const item of items.slice(0, MAX_CODE_RESULTS)) {
    if (!record(item) || typeof item.label !== "string") throw new Error("The server returned an invalid completion item.");
    if (item.insertTextFormat === 2) continue;
    const edit = record(item.textEdit) ? item.textEdit : null;
    const range = edit?.range ?? edit?.replace ?? fallbackRange;
    const text = edit?.newText ?? item.insertText ?? item.label;
    if (!isCodeRange(range) || typeof text !== "string") throw new Error("The server returned an invalid completion edit.");
    result.push({
      label: item.label.slice(0, 1024), range, text: text.slice(0, 32_768),
      ...(typeof item.detail === "string" ? { detail: item.detail.slice(0, 4096) } : {}),
    });
  }
  return result;
}

export function languageId(document: PluginCodeDocument): string {
  if (document.language === "cpp") return /\.c$/i.test(document.path) ? "c" : "cpp";
  if (document.language !== "typescript") return document.language;
  if (/\.jsx$/i.test(document.path)) return "javascriptreact";
  if (/\.tsx$/i.test(document.path)) return "typescriptreact";
  return /\.(?:js|mjs|cjs)$/i.test(document.path) ? "javascript" : "typescript";
}
