import { create, insertMultiple, search } from "zbsearch";
import type { SearchDocument, SearchResult } from "../types";

const SEARCH_SCHEMA = {
  path: "string",
  title: "string",
  content: "string",
  tags: "string[]",
  kind: "enum",
  bookmarked: "boolean",
  lastOpenedAt: "string",
} as const;

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

export class VaultSearchIndex {
  private database: SearchDatabase = create({ schema: SEARCH_SCHEMA });
  private documents: SearchDocument[] = [];

  async rebuild(documents: SearchDocument[]): Promise<void> {
    this.documents = documents;
    this.database = create({ schema: SEARCH_SCHEMA });
    if (documents.length > 0) {
      await insertMultiple(
        this.database,
        documents.map((document) => ({
          ...document,
          lastOpenedAt: document.lastOpenedAt ?? "",
        })),
      );
    }
  }

  async query(rawQuery: string): Promise<SearchResult[]> {
    const parsed = parseSearchQuery(rawQuery);
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
        scores.set(hit.document.path, hit.score);
      }

      const foldedTerms = parsed.term.toLocaleLowerCase().split(/\s+/);
      for (const document of this.documents) {
        const haystack =
          `${document.title}\n${document.path}\n${document.content}\n${document.tags.join(" ")}`.toLocaleLowerCase();
        if (foldedTerms.every((term) => haystack.includes(term))) {
          scores.set(document.path, Math.max(scores.get(document.path) ?? 0, 0.1));
        }
      }
    } else {
      for (const document of this.documents) {
        scores.set(document.path, 0);
      }
    }

    return this.documents
      .filter((document) => scores.has(document.path))
      .filter((document) => matchesFilters(document, parsed))
      .map((document) => ({
        document,
        score: scores.get(document.path) ?? 0,
        snippet: createSnippet(document, parsed.term),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareRecent(right.document, left.document) ||
          left.document.title.localeCompare(right.document.title),
      )
      .slice(0, 200);
  }
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

function createSnippet(document: SearchDocument, term: string): string {
  const compact = document.content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Empty note";
  }
  if (!term) {
    return compact.slice(0, 180);
  }
  const firstTerm = term.toLocaleLowerCase().split(/\s+/)[0];
  const index = compact.toLocaleLowerCase().indexOf(firstTerm);
  if (index < 0) {
    return compact.slice(0, 180);
  }
  const start = Math.max(0, index - 70);
  const end = Math.min(compact.length, index + firstTerm.length + 110);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
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
