import {
  MAX_CODE_SOURCE_BYTES, isCodePath, isCodeRange,
  type PluginCodeLanguage, type PluginCodeLocation, type PluginCodePosition,
  type PluginCodeScope, type PluginCodeTextEdit,
} from "@denote/plugin-sdk";

/** Host-only configuration; executable paths are never sent to a worker. */
export interface CodeToolConfiguration {
  enabled: boolean;
  executable: string;
  executableSha256: string;
  arguments: string[];
  transport: "stdio" | "tcp" | "java";
  options: Record<string, unknown>;
  launch: Record<string, unknown>;
  attach: Record<string, unknown>;
}
export interface CodeWorkspaceContext {
  workspaceScope: string;
  projectId: string | null;
  documentPath: string | null;
  language: PluginCodeLanguage;
}
export interface CodeToolEnvironment {
  scope: PluginCodeScope;
  language: PluginCodeLanguage;
  lsp: CodeToolConfiguration;
  dap: CodeToolConfiguration;
}
export interface CodeProtocolInvocation {
  operation: "request" | "notify" | "poll" | "respond" | "stop" | "cancel";
  sessionId: string;
  workspaceScope: string;
  method?: string;
  params?: unknown;
  requestToken: string;
  scope?: PluginCodeScope;
  language?: PluginCodeLanguage;
}

export function codePositionOffset(source: string, position: PluginCodePosition): number {
  if (!Number.isSafeInteger(position.line) || position.line < 0 ||
      !Number.isSafeInteger(position.character) || position.character < 0) {
    throw new Error("The server returned an invalid source position.");
  }
  let start = 0;
  for (let line = 0; line < position.line; line += 1) {
    const next = source.indexOf("\n", start);
    if (next < 0) throw new Error("The server returned a source line outside this document.");
    start = next + 1;
  }
  const end = source.indexOf("\n", start);
  const length = (end < 0 ? source.length : end) - start;
  if (position.character > length) throw new Error("The server returned a source column outside this line.");
  return start + position.character;
}

export function codeEditOffsets(source: string, edits: PluginCodeTextEdit[]): Array<{ from: number; to: number; insert: string }> {
  if (edits.length > 500) throw new Error("Code edits exceed the 500-edit limit.");
  let added = 0;
  const offsets = edits.map((edit) => {
    if (!isCodeRange(edit.range) || typeof edit.text !== "string") throw new Error("The server returned an invalid code edit.");
    added += edit.text.length;
    return { from: codePositionOffset(source, edit.range.start), to: codePositionOffset(source, edit.range.end), insert: edit.text };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  if (added > MAX_CODE_SOURCE_BYTES) throw new Error("Code edits exceed the 4 MiB insertion limit.");
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index].from < offsets[index - 1].to || offsets[index].from === offsets[index - 1].from) {
      throw new Error("The server returned overlapping code edits.");
    }
  }
  return offsets;
}

export function applyCodeEdits(source: string, edits: PluginCodeTextEdit[]): string {
  const offsets = codeEditOffsets(source, edits);
  const pieces: string[] = [];
  let cursor = 0;
  for (const edit of offsets) {
    pieces.push(source.slice(cursor, edit.from), edit.insert);
    cursor = edit.to;
  }
  pieces.push(source.slice(cursor));
  const result = pieces.join("");
  if (new TextEncoder().encode(result).length > MAX_CODE_SOURCE_BYTES) throw new Error("The formatted document exceeds the 4 MiB code-intelligence limit.");
  return result;
}

export function parseCodeJump(input: string, currentPath?: string): PluginCodeLocation | null {
  const query = input.trim();
  if (!query) return null;
  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(query);
  const path = match?.[1] || currentPath;
  if (!isCodePath(path, false)) throw new Error("Choose a vault-relative file path.");
  const line = Number(match?.[2] ?? 1);
  const column = Number(match?.[3] ?? 1);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) {
    throw new Error("Line and column must be positive whole numbers.");
  }
  const position = { line: line - 1, character: column - 1 };
  return { path, range: { start: position, end: position } };
}
