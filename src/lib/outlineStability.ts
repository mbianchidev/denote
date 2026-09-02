import type { HeadingItem } from "../types";
import type { SourceMinimapLine, SourceSymbol } from "./sourceOutline";

export interface StableOutlineSnapshot {
  headings: HeadingItem[];
  symbols: SourceSymbol[];
  minimap: SourceMinimapLine[];
}

interface OutlinePublishOptions {
  incomplete: boolean;
  settled: boolean;
}

export function hasIncompleteMarkdownHeading(markdown: string): boolean {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const sequence = fenceMatch[1];
      const marker = sequence[0] as "`" | "~";
      if (!fence) {
        fence = { marker, length: sequence.length };
      } else if (fence.marker === marker && sequence.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (!fence && /^ {0,3}#{1,6}[ \t]*$/.test(line)) {
      return true;
    }
  }
  return false;
}

export function analysisHasIncompleteHeading(
  content: string,
  includeSourceOutline: boolean,
): boolean {
  return !includeSourceOutline && hasIncompleteMarkdownHeading(content);
}

export function shouldPublishOutline(
  previous: StableOutlineSnapshot | null,
  candidate: StableOutlineSnapshot,
  { incomplete, settled }: OutlinePublishOptions,
): boolean {
  if (!previous) {
    return (
      settled || candidate.headings.length > 0 || candidate.symbols.length > 0
    );
  }
  const additive =
    sequenceHasAdditions(previous.headings, candidate.headings, sameHeading) ||
    sequenceHasAdditions(previous.symbols, candidate.symbols, sameSymbol);
  if (additive) {
    return true;
  }
  return !incomplete && settled;
}

function sequenceHasAdditions<T>(
  previous: readonly T[],
  candidate: readonly T[],
  same: (left: T, right: T) => boolean,
): boolean {
  if (candidate.length <= previous.length) {
    return false;
  }
  let previousIndex = 0;
  for (const item of candidate) {
    if (
      previousIndex < previous.length &&
      same(previous[previousIndex], item)
    ) {
      previousIndex += 1;
    }
  }
  return previousIndex === previous.length;
}

function sameHeading(left: HeadingItem, right: HeadingItem): boolean {
  return (
    left.depth === right.depth &&
    left.text === right.text &&
    left.slug === right.slug
  );
}

function sameSymbol(left: SourceSymbol, right: SourceSymbol): boolean {
  return (
    left.name === right.name &&
    left.kind === right.kind &&
    left.line === right.line &&
    left.depth === right.depth
  );
}
