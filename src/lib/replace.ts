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
}

export interface ReplacePreview {
  path: string;
  occurrences: number;
  originalContent: string;
  replacedContent: string;
  contentHash?: string;
  beforeSnippet: string;
  afterSnippet: string;
}

export interface ReplaceApplySummary {
  appliedFiles: number;
  failedFiles: number;
  replacedOccurrences: number;
}

export function previewReplacements(
  sources: ReplaceSource[],
  request: ReplaceRequest,
): ReplacePreview[] {
  if (!request.find) {
    return [];
  }
  return sources.flatMap((source) => {
    const matches = findMatches(source.content, request);
    if (matches.length === 0) {
      return [];
    }
    const replacedContent = replaceMatches(
      source.content,
      matches,
      request.replacement,
    );
    const firstIndex = matches[0].index;
    return [
      {
        path: source.path,
        occurrences: matches.length,
        originalContent: source.content,
        replacedContent,
        contentHash: source.contentHash,
        beforeSnippet: snippetAround(
          source.content,
          firstIndex,
          request.find.length,
        ),
        afterSnippet: snippetAround(
          replacedContent,
          firstIndex,
          request.replacement.length,
        ),
      },
    ];
  });
}

interface MatchRange {
  index: number;
  length: number;
}

function findMatches(content: string, request: ReplaceRequest): MatchRange[] {
  const escaped = request.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, request.matchCase ? "gu" : "giu");
  const graphemeBoundaries = request.wholeWord
    ? createGraphemeBoundaries(content)
    : null;
  return [...content.matchAll(pattern)]
    .map((match) => ({
      index: match.index ?? 0,
      length: match[0].length,
    }))
    .filter(
      (match) =>
        !request.wholeWord ||
        isWholeWordMatch(content, match, graphemeBoundaries ?? new Set()),
    );
}

function replaceMatches(
  content: string,
  matches: MatchRange[],
  replacement: string,
): string {
  let cursor = 0;
  let result = "";
  for (const match of matches) {
    result += content.slice(cursor, match.index);
    result += replacement;
    cursor = match.index + match.length;
  }
  return result + content.slice(cursor);
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
  return [...content.slice(0, index)].slice(-1)[0] ?? "";
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
