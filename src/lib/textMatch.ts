import type { SearchMatch } from "../types";

export function findCaseInsensitiveMatches(
  source: string,
  query: string,
): SearchMatch[] {
  const foldedQuery = query.toLocaleLowerCase();
  if (!foldedQuery) {
    return [];
  }
  const foldedSource = source.toLocaleLowerCase();
  const foldedMatches: SearchMatch[] = [];
  let offset = 0;
  while (offset <= foldedSource.length - foldedQuery.length) {
    const foldedIndex = foldedSource.indexOf(foldedQuery, offset);
    if (foldedIndex < 0) {
      break;
    }
    foldedMatches.push({
      from: foldedIndex,
      to: foldedIndex + foldedQuery.length,
    });
    offset = foldedIndex + foldedQuery.length;
  }
  return mapFoldedRangesToSource(source, foldedMatches);
}

export function findEarliestCaseInsensitiveMatch(
  source: string,
  queries: string[],
): SearchMatch | null {
  const foldedSource = source.toLocaleLowerCase();
  let earliest: SearchMatch | null = null;
  for (const query of queries) {
    const foldedQuery = query.toLocaleLowerCase();
    if (!foldedQuery) {
      continue;
    }
    const from = foldedSource.indexOf(foldedQuery);
    const to = from + foldedQuery.length;
    if (
      from >= 0 &&
      (earliest === null ||
        from < earliest.from ||
        (from === earliest.from && to - from > earliest.to - earliest.from))
    ) {
      earliest = { from, to };
    }
  }
  return earliest
    ? (mapFoldedRangesToSource(source, [earliest])[0] ?? null)
    : null;
}

function mapFoldedRangesToSource(
  source: string,
  ranges: SearchMatch[],
): SearchMatch[] {
  if (ranges.length === 0) {
    return [];
  }
  const mapped: SearchMatch[] = [];
  let rangeIndex = 0;
  let rangeSourceStart: number | null = null;
  let sourceOffset = 0;
  let foldedOffset = 0;
  for (const character of source) {
    const sourceEnd = sourceOffset + character.length;
    const foldedEnd = foldedOffset + character.toLocaleLowerCase().length;
    while (rangeIndex < ranges.length) {
      const range = ranges[rangeIndex];
      if (
        rangeSourceStart === null &&
        range.from >= foldedOffset &&
        range.from < foldedEnd
      ) {
        rangeSourceStart = sourceOffset;
      }
      if (rangeSourceStart !== null && range.to <= foldedEnd) {
        const next = { from: rangeSourceStart, to: sourceEnd };
        const previous = mapped[mapped.length - 1];
        if (
          !previous ||
          previous.from !== next.from ||
          previous.to !== next.to
        ) {
          mapped.push(next);
        }
        rangeIndex += 1;
        rangeSourceStart = null;
        continue;
      }
      break;
    }
    if (rangeIndex >= ranges.length) {
      break;
    }
    sourceOffset = sourceEnd;
    foldedOffset = foldedEnd;
  }
  return mapped;
}
