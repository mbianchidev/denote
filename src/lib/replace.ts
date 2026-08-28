import type { FileEncoding, FileLineEnding } from "../types";

export type ReplaceScope = "current" | "vault";

export interface ReplaceRequest {
  find: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  scope: ReplaceScope;
}

export interface ReplaceSource {
  path: string;
  content: string;
  contentHash?: string;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
}

export interface ReplacePreview {
  path: string;
  occurrences: number;
  originalContent: string;
  replacedContent: string;
  contentHash?: string;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
  beforeSnippet: string;
  afterSnippet: string;
}

export interface ReplaceApplySummary {
  appliedFiles: number;
  failedFiles: number;
  replacedOccurrences: number;
}

const MAX_REPLACEMENTS_PER_FILE = 100_000;
const MAX_PREVIEW_CHARACTERS = 64 * 1024 * 1024;
const MAX_WHOLE_WORD_CHARACTERS = 8 * 1024 * 1024;

export function previewReplacements(
  sources: ReplaceSource[],
  request: ReplaceRequest,
): ReplacePreview[] {
  if (!request.find) {
    return [];
  }
  const previews: ReplacePreview[] = [];
  let previewCharacters = 0;
  for (const source of sources) {
    const remainingOutputCharacters = Math.max(
      0,
      MAX_PREVIEW_CHARACTERS - previewCharacters - source.content.length,
    );
    const replacement = replaceContent(
      source.content,
      request,
      remainingOutputCharacters,
    );
    if (replacement.occurrences === 0) {
      continue;
    }
    previewCharacters += source.content.length + replacement.content.length;
    if (previewCharacters > MAX_PREVIEW_CHARACTERS) {
      throw new Error(
        "Replace preview exceeds the 64 MB safety limit. Narrow the scope or search text.",
      );
    }
    previews.push({
      path: source.path,
      occurrences: replacement.occurrences,
      originalContent: source.content,
      replacedContent: replacement.content,
      contentHash: source.contentHash,
      encoding: source.encoding,
      lineEnding: source.lineEnding,
      beforeSnippet: snippetAround(
        source.content,
        replacement.firstIndex,
        request.find.length,
      ),
      afterSnippet: snippetAround(
        replacement.content,
        replacement.firstIndex,
        request.replacement.length,
      ),
    });
  }
  return previews;
}

interface ReplacementResult {
  content: string;
  occurrences: number;
  firstIndex: number;
}

function replaceContent(
  content: string,
  request: ReplaceRequest,
  maxOutputCharacters: number,
): ReplacementResult {
  if (request.wholeWord && content.length > MAX_WHOLE_WORD_CHARACTERS) {
    throw new Error(
      "Whole-word replacement is limited to 8 MB per file. Use literal replacement for larger files.",
    );
  }
  const escaped = request.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, request.matchCase ? "gu" : "giu");
  const graphemeBoundaries = request.wholeWord
    ? createGraphemeBoundaries(content)
    : null;
  const parts: string[] = [];
  let cursor = 0;
  let occurrences = 0;
  let firstIndex = -1;
  let projectedLength = content.length;
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    const range = { index: match.index, length: match[0].length };
    if (
      request.wholeWord &&
      !isWholeWordMatch(content, range, graphemeBoundaries ?? new Set())
    ) {
      continue;
    }
    occurrences += 1;
    if (occurrences > MAX_REPLACEMENTS_PER_FILE) {
      throw new Error(
        `More than ${MAX_REPLACEMENTS_PER_FILE.toLocaleString()} replacements match in one file. Narrow the search text.`,
      );
    }
    if (firstIndex < 0) {
      firstIndex = range.index;
    }
    projectedLength += request.replacement.length - range.length;
    if (projectedLength > maxOutputCharacters) {
      throw new Error(
        "Replace preview exceeds the 64 MB safety limit. Narrow the scope, search text, or replacement.",
      );
    }
    parts.push(content.slice(cursor, range.index), request.replacement);
    cursor = range.index + range.length;
  }
  if (occurrences === 0) {
    return { content, occurrences: 0, firstIndex: 0 };
  }
  parts.push(content.slice(cursor));
  return { content: parts.join(""), occurrences, firstIndex };
}

interface MatchRange {
  index: number;
  length: number;
}

function isWholeWordMatch(
  content: string,
  match: MatchRange,
  graphemeBoundaries: Set<number>,
): boolean {
  const end = match.index + match.length;
  if (
    !graphemeBoundaries.has(match.index) ||
    !graphemeBoundaries.has(end)
  ) {
    return false;
  }
  return (
    !isWordCharacter(codePointBefore(content, match.index)) &&
    !isWordCharacter(codePointAt(content, end))
  );
}

function createGraphemeBoundaries(content: string): Set<number> {
  if ("Segmenter" in Intl) {
    const boundaries = new Set<number>([content.length]);
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    for (const segment of segmenter.segment(content)) {
      boundaries.add(segment.index);
    }
    return boundaries;
  }
  const boundaries = new Set<number>([0, content.length]);
  let index = 0;
  for (const character of content) {
    const next = index + character.length;
    if (
      !isGraphemeContinuation(character) &&
      codePointBefore(content, index) !== "\u200d"
    ) {
      boundaries.add(index);
    }
    index = next;
  }
  return boundaries;
}

function isWordCharacter(value: string): boolean {
  return value ? /[\p{L}\p{M}\p{N}_]/u.test(value) : false;
}

function isGraphemeContinuation(value: string): boolean {
  return /[\p{M}\u200d\u{1f3fb}-\u{1f3ff}\ufe0e\ufe0f]/u.test(value);
}

function codePointBefore(content: string, index: number): string {
  if (index === 0) {
    return "";
  }
  const lastUnit = content.charCodeAt(index - 1);
  const start =
    lastUnit >= 0xdc00 && lastUnit <= 0xdfff && index > 1 ? index - 2 : index - 1;
  const value = content.codePointAt(start);
  return value === undefined ? "" : String.fromCodePoint(value);
}

function codePointAt(content: string, index: number): string {
  const value = content.codePointAt(index);
  return value === undefined ? "" : String.fromCodePoint(value);
}

function snippetAround(
  content: string,
  matchIndex: number,
  matchLength: number,
): string {
  const compact = content.replace(/\s+/g, " ");
  const prefixLength = content.slice(0, matchIndex).replace(/\s+/g, " ").length;
  const start = Math.max(0, prefixLength - 55);
  const end = Math.min(compact.length, prefixLength + matchLength + 75);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}
