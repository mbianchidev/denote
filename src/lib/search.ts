import { create, insertMultiple, search } from "zbsearch";
import type { SearchDocument, SearchMatch, SearchResult } from "../types";
import { findCaseInsensitiveMatches } from "./textMatch";

const SEARCH_SCHEMA = {
  path: "string",
  title: "string",
  content: "string",
  tags: "string[]",
  kind: "enum",
  bookmarked: "boolean",
  lastOpenedAt: "string",
} as const;

const MAX_SEARCH_RESULTS = 200;

type SearchDatabase = ReturnType<typeof create<typeof SEARCH_SCHEMA>>;

interface ParsedSearch {
  term: string;
  tags: string[];
  filenames: string[];
  paths: string[];
  content: string[];
  kinds: string[];
  bookmarked?: boolean;
  recentDays?: number;
}

export interface SearchFilters {
  tags: string[];
  filenames: string[];
  paths: string[];
  content: string[];
  kinds: string[];
  bookmarked?: boolean;
  recentDays?: number;
}

export interface SearchRequest {
  query: string;
  location: string;
  filters: SearchFilters;
}

export function createEmptySearchFilters(): SearchFilters {
  return {
    tags: [],
    filenames: [],
    paths: [],
    content: [],
    kinds: [],
  };
}

export class VaultSearchIndex {
  private database: SearchDatabase = create({ schema: SEARCH_SCHEMA });
  private documents: SearchDocument[] = [];

  recordOpen(path: string, lastOpenedAt: string | null): void {
    this.documents = this.documents.map((document) =>
      document.path === path ? { ...document, lastOpenedAt } : document,
    );
  }

  removePaths(remove: (path: string) => boolean): void {
    this.documents = this.documents.filter(
      (document) => !remove(document.path),
    );
  }

  async rebuild(documents: SearchDocument[]): Promise<void> {
    this.documents = documents;
    this.database = create({ schema: SEARCH_SCHEMA });
    for (const batch of searchInsertionBatches(documents)) {
      await insertMultiple(
        this.database,
        batch.map((document) => ({
          ...document,
          lastOpenedAt: document.lastOpenedAt ?? "",
        })),
      );
      await yieldToBrowser();
    }
  }

  async query(request: string | SearchRequest): Promise<SearchResult[]> {
    const searchRequest: SearchRequest =
      typeof request === "string"
        ? {
            query: request,
            location: "*",
            filters: createEmptySearchFilters(),
          }
        : request;
    const parsed = mergeSearchFilters(
      parseSearchQuery(searchRequest.query),
      searchRequest.filters,
    );
    const scopedDocuments = this.documents.filter((document) =>
      matchesSearchLocation(document.path, searchRequest.location),
    );
    const scores = new Map<string, number>();

    if (parsed.term) {
      const results = await search(this.database, {
        term: parsed.term,
        properties: ["title", "path", "content", "tags"],
        boost: { title: 3, path: 2, tags: 2 },
        tolerance: 1,
        limit: Math.max(100, this.documents.length),
      });
      for (const hit of results.hits) {
        scores.set(
          hit.document.path,
          Math.max(scores.get(hit.document.path) ?? 0, hit.score),
        );
      }

      const foldedTerms = parsed.term.toLocaleLowerCase().split(/\s+/);
      let processedBytes = 0;
      for (const document of scopedDocuments) {
        const haystack =
          `${document.title}\n${document.path}\n${document.content}\n${document.tags.join(" ")}`.toLocaleLowerCase();
        if (foldedTerms.every((term) => haystack.includes(term))) {
          scores.set(document.path, Math.max(scores.get(document.path) ?? 0, 0.1));
        }
        processedBytes += haystack.length;
        if (processedBytes >= 512 * 1024) {
          processedBytes = 0;
          await yieldToBrowser();
        }
      }

    } else {
      for (const document of scopedDocuments) {
        scores.set(document.path, 0);
      }
    }

    const rankedDocuments = scopedDocuments
      .filter((document) => scores.has(document.path))
      .filter((document) => matchesFilters(document, parsed))
      .map((document) => ({
        document,
        score: scores.get(document.path) ?? 0,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareRecent(right.document, left.document) ||
          left.document.title.localeCompare(right.document.title),
      );
    const results: SearchResult[] = [];
    for (const result of rankedDocuments) {
      const matches = findContentMatches(
        result.document.content,
        parsed,
        MAX_SEARCH_RESULTS - results.length,
      );
      const resultMatches: Array<SearchMatch | null> =
        matches.length > 0 ? matches : [null];
      for (const [matchIndex, match] of resultMatches.entries()) {
        results.push({
          ...result,
          snippet: createSnippet(result.document, match),
          match,
          occurrence: match ? matchIndex + 1 : null,
        });
        if (results.length >= MAX_SEARCH_RESULTS) {
          return results;
        }
      }
    }
    return results;
  }
}

function searchInsertionBatches(documents: SearchDocument[]): SearchDocument[][] {
  const batches: SearchDocument[][] = [];
  let batch: SearchDocument[] = [];
  let bytes = 0;
  for (const document of documents.flatMap(searchDocumentsForIndex)) {
    const documentBytes =
      document.path.length +
      document.title.length +
      document.content.length +
      document.tags.join("").length;
    if (batch.length > 0 && bytes + documentBytes > 512 * 1024) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(document);
    bytes += documentBytes;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

function searchDocumentsForIndex(document: SearchDocument): SearchDocument[] {
  const metadataBytes =
    document.path.length +
    document.title.length +
    document.tags.join("").length;
  const contentBytes = Math.max(64 * 1024, 512 * 1024 - metadataBytes);
  if (document.content.length <= contentBytes) {
    return [document];
  }
  const chunks: SearchDocument[] = [];
  const overlap = 256;
  const step = contentBytes - overlap;
  for (let start = 0; start < document.content.length; start += step) {
    chunks.push({
      ...document,
      content: document.content.slice(start, start + contentBytes),
    });
  }
  return chunks;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function parseSearchQuery(rawQuery: string): ParsedSearch {
  const parsed: ParsedSearch = {
    term: "",
    tags: [],
    filenames: [],
    paths: [],
    content: [],
    kinds: [],
  };
  const terms: string[] = [];
  const tokenPattern =
    /(?:(\w+):(?:"([^"]+)"|(\S+)))|(?:"([^"]+)"|(\S+))/g;
  for (const match of rawQuery.matchAll(tokenPattern)) {
    const key = match[1]?.toLocaleLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
    if (!value) {
      continue;
    }
    switch (key) {
      case "tag":
        parsed.tags.push(value.replace(/^#/, "").toLocaleLowerCase());
        break;
      case "file":
      case "filename":
        parsed.filenames.push(value.toLocaleLowerCase());
        break;
      case "path":
      case "folder":
        parsed.paths.push(value.toLocaleLowerCase());
        break;
      case "content":
        parsed.content.push(value.toLocaleLowerCase());
        break;
      case "type":
        parsed.kinds.push(value.toLocaleLowerCase());
        break;
      case "bookmarked":
      case "bookmark":
        parsed.bookmarked = value === "true" || value === "yes" || value === "1";
        break;
      case "recent": {
        const days = Number.parseInt(value.replace(/d$/i, ""), 10);
        if (Number.isFinite(days) && days >= 0) {
          parsed.recentDays = days;
        }
        break;
      }
      default:
        terms.push(key ? `${key}:${value}` : value);
    }
  }
  parsed.term = terms.join(" ").trim();
  return parsed;
}

export function matchesSearchLocation(path: string, rawLocation: string): boolean {
  const location = rawLocation.trim().replace(/\\/g, "/");
  if (!location || location === "*") {
    return true;
  }
  const hasWildcard = /[*?]/.test(location);
  if (!hasWildcard) {
    return path.replace(/\\/g, "/") === location;
  }
  const target = location.includes("/")
    ? path.replace(/\\/g, "/")
    : path.split(/[\\/]/).slice(-1)[0] ?? path;
  return globExpression(location).test(target);
}

function globExpression(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "iu");
}

function mergeSearchFilters(
  parsed: ParsedSearch,
  filters: SearchFilters,
): ParsedSearch {
  return {
    ...parsed,
    tags: [
      ...parsed.tags,
      ...filters.tags.map((tag) =>
        tag.replace(/^#/, "").trim().toLocaleLowerCase(),
      ),
    ].filter(Boolean),
    filenames: [
      ...parsed.filenames,
      ...filters.filenames.map((value) => value.trim().toLocaleLowerCase()),
    ].filter(Boolean),
    paths: [
      ...parsed.paths,
      ...filters.paths.map((value) => value.trim().toLocaleLowerCase()),
    ].filter(Boolean),
    content: [
      ...parsed.content,
      ...filters.content.map((value) => value.trim().toLocaleLowerCase()),
    ].filter(Boolean),
    kinds: [
      ...parsed.kinds,
      ...filters.kinds.map((value) => value.trim().toLocaleLowerCase()),
    ].filter(Boolean),
    bookmarked: filters.bookmarked ?? parsed.bookmarked,
    recentDays: filters.recentDays ?? parsed.recentDays,
  };
}

function matchesFilters(document: SearchDocument, parsed: ParsedSearch): boolean {
  const foldedPath = document.path.toLocaleLowerCase();
  const foldedTitle = document.title.toLocaleLowerCase();
  const foldedContent = document.content.toLocaleLowerCase();
  if (
    parsed.tags.some(
      (tag) => !document.tags.some((documentTag) => documentTag === tag),
    )
  ) {
    return false;
  }
  if (
    parsed.filenames.some(
      (filename) =>
        !foldedTitle.includes(filename) &&
        !foldedPath.split("/").slice(-1)[0]?.includes(filename),
    )
  ) {
    return false;
  }
  if (parsed.paths.some((path) => !foldedPath.includes(path))) {
    return false;
  }
  if (parsed.content.some((value) => !foldedContent.includes(value))) {
    return false;
  }
  if (
    parsed.kinds.length > 0 &&
    !parsed.kinds.includes(document.kind.toLocaleLowerCase())
  ) {
    return false;
  }
  if (
    parsed.bookmarked !== undefined &&
    document.bookmarked !== parsed.bookmarked
  ) {
    return false;
  }
  if (parsed.recentDays !== undefined) {
    if (!document.lastOpenedAt) {
      return false;
    }
    const cutoff = Date.now() - parsed.recentDays * 24 * 60 * 60 * 1000;
    if (new Date(document.lastOpenedAt).getTime() < cutoff) {
      return false;
    }
  }
  return true;
}

function createSnippet(
  document: SearchDocument,
  match: SearchMatch | null,
): string {
  const compact = document.content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Empty note";
  }
  if (!match) {
    return compact.slice(0, 180);
  }
  const start = Math.max(0, match.from - 70);
  const end = Math.min(document.content.length, match.to + 110);
  const snippet = document.content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < document.content.length ? "…" : ""}`;
}

function findContentMatches(
  content: string,
  parsed: ParsedSearch,
  limit: number,
): SearchMatch[] {
  if (limit <= 0) {
    return [];
  }
  const candidates = [
    parsed.term,
    ...parsed.term.split(/\s+/),
    ...parsed.content,
  ]
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const uniqueCandidates = [
    ...new Map(
      candidates.map((candidate) => [candidate.toLocaleLowerCase(), candidate]),
    ).values(),
  ];
  const uniqueMatches = new Map<string, SearchMatch>();
  for (const candidate of uniqueCandidates) {
    for (const match of findCaseInsensitiveMatches(content, candidate, limit)) {
      uniqueMatches.set(`${match.from}:${match.to}`, match);
    }
  }
  const sortedMatches = [...uniqueMatches.values()].sort(
    (left, right) =>
      left.from - right.from || right.to - right.from - (left.to - left.from),
  );
  const matches: SearchMatch[] = [];
  for (const match of sortedMatches) {
    const previous = matches[matches.length - 1];
    if (!previous || match.from >= previous.to) {
      matches.push(match);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

function compareRecent(left: SearchDocument, right: SearchDocument): number {
  const leftTime = left.lastOpenedAt
    ? new Date(left.lastOpenedAt).getTime()
    : 0;
  const rightTime = right.lastOpenedAt
    ? new Date(right.lastOpenedAt).getTime()
    : 0;
  return leftTime - rightTime;
}
