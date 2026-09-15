import {
  MAX_PLUGIN_NOTE_GRAPH_EDGES,
  MAX_PLUGIN_NOTE_GRAPH_NODES,
  type PluginNoteGraphDocument,
  type PluginNoteGraphIndexRequest,
  type PluginNoteGraphModel,
  type PluginNoteGraphNode,
  type PluginNoteGraphQuery,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";

export const MAX_RAW_LINKS_PER_NOTE = 128;

const MAX_MODEL_NOTICES = 16;
const MAX_NOTICE_PATH_LENGTH = 360;

interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export interface ParsedNoteGraphDocument {
  links: string[];
  omittedLinks: number;
  parseError: boolean;
}

export type NoteGraphDocumentParser = (
  document: PluginNoteGraphDocument,
) => ParsedNoteGraphDocument;

interface IndexedDocument {
  path: string;
  title: string;
  tags: string[];
  links: string[];
  omittedLinks: number;
  parseError: boolean;
}

interface AvailablePaths {
  exact: Set<string>;
  folded: Map<string, string | null>;
}

interface ResolvedGraph {
  documents: IndexedDocument[];
  paths: AvailablePaths;
  edges: Array<readonly [source: string, target: string]>;
  incoming: Map<string, number>;
  outgoing: Map<string, number>;
  adjacency: Map<string, Set<string>> | null;
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

export class NoteGraphIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private skippedCount = 0;
  private hostTruncated = false;

  constructor(
    private readonly parseDocument: NoteGraphDocumentParser =
      parseNoteGraphDocument,
  ) {}

  index(request: PluginNoteGraphIndexRequest): void {
    if (request.mode === "replace") {
      this.documents.clear();
    }
    for (const path of request.removedPaths) {
      this.documents.delete(path);
    }
    for (const document of request.documents) {
      this.documents.set(document.path, this.indexDocument(document));
    }
    this.skippedCount = request.skippedCount;
    this.hostTruncated = request.truncated;
  }

  query(request: PluginNoteGraphQuery): PluginNoteGraphModel {
    const graph = this.resolveGraph(request.scope === "local");
    const activePath = resolveActivePath(request.activePath, graph.paths);
    const distances =
      request.scope === "local"
        ? localDistances(activePath, request.depth, graph.adjacency)
        : null;
    const normalizedTag =
      request.tag === null ? null : normalizedTagKey(request.tag);

    const matching = graph.documents
      .flatMap((document) => {
        const distance =
          distances === null ? null : (distances.get(document.path) ?? null);
        if (
          (distances !== null && distance === null) ||
          !matchesFolder(document.path, request.folder) ||
          (normalizedTag !== null &&
            !document.tags.some(
              (tag) => normalizedTagKey(tag) === normalizedTag,
            ))
        ) {
          return [];
        }
        const incoming = graph.incoming.get(document.path) ?? 0;
        const outgoing = graph.outgoing.get(document.path) ?? 0;
        const orphan = incoming === 0 && outgoing === 0;
        if (
          (request.orphanFilter === "only" && !orphan) ||
          (request.orphanFilter === "connected" && orphan)
        ) {
          return [];
        }
        return [
          {
            document,
            incoming,
            outgoing,
            orphan,
            distance,
          },
        ];
      })
      .sort((left, right) =>
        request.scope === "local"
          ? compareLocalNodes(left, right)
          : compareGlobalNodes(left, right),
      );

    const matchingNotes = matching.length;
    const selected = matching.slice(0, MAX_PLUGIN_NOTE_GRAPH_NODES);
    const selectedPaths = new Set(
      selected.map(({ document }) => document.path),
    );
    const availableEdges = graph.edges.filter(
      ([source, target]) =>
        selectedPaths.has(source) && selectedPaths.has(target),
    );
    const edges = availableEdges
      .slice(0, MAX_PLUGIN_NOTE_GRAPH_EDGES)
      .map(([sourceId, targetId]) => ({ sourceId, targetId }));
    const nodeTruncated = matchingNotes > selected.length;
    const edgeTruncated = availableEdges.length > edges.length;
    const linkTruncated = graph.documents.some(
      (document) => document.omittedLinks > 0,
    );
    const notices = this.modelNotices({
      graph,
      request,
      activePath,
      nodeTruncated,
      edgeTruncated,
    });
    const nodes: PluginNoteGraphNode[] = selected.map(
      ({ document, incoming, outgoing, orphan, distance }) => ({
        id: document.path,
        path: document.path,
        title: document.title,
        tags: [...document.tags],
        incoming,
        outgoing,
        orphan,
        distance,
      }),
    );

    return {
      nodes,
      edges,
      totalNotes: graph.documents.length,
      matchingNotes,
      totalEdges: graph.edges.length,
      activeNodeId:
        activePath !== null && selectedPaths.has(activePath)
          ? activePath
          : null,
      truncated:
        this.hostTruncated ||
        this.skippedCount > 0 ||
        linkTruncated ||
        nodeTruncated ||
        edgeTruncated,
      notices,
    };
  }

  private indexDocument(
    document: PluginNoteGraphDocument,
  ): IndexedDocument {
    let parsed: ParsedNoteGraphDocument;
    try {
      parsed = this.parseDocument(document);
    } catch {
      parsed = {
        links: [],
        omittedLinks: 0,
        parseError: true,
      };
    }
    return {
      path: document.path,
      title: document.title,
      tags: [...document.tags],
      links: parsed.links.slice(0, MAX_RAW_LINKS_PER_NOTE),
      omittedLinks:
        Math.max(0, parsed.omittedLinks) +
        Math.max(0, parsed.links.length - MAX_RAW_LINKS_PER_NOTE),
      parseError: parsed.parseError,
    };
  }

  private resolveGraph(includeAdjacency: boolean): ResolvedGraph {
    const documents = [...this.documents.values()].sort((left, right) =>
      compareText(left.path, right.path),
    );
    const paths = createAvailablePaths(
      documents.map((document) => document.path),
    );
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    const adjacency = includeAdjacency
      ? new Map<string, Set<string>>()
      : null;
    for (const document of documents) {
      incoming.set(document.path, 0);
      outgoing.set(document.path, 0);
      adjacency?.set(document.path, new Set());
    }

    const edges: Array<readonly [string, string]> = [];
    for (const document of documents) {
      const targets = new Set<string>();
      for (const candidate of document.links) {
        const target = resolveCandidate(candidate, paths);
        if (target !== null && target !== document.path) {
          targets.add(target);
        }
      }
      for (const target of targets) {
        edges.push([document.path, target]);
        outgoing.set(
          document.path,
          (outgoing.get(document.path) ?? 0) + 1,
        );
        incoming.set(target, (incoming.get(target) ?? 0) + 1);
        adjacency?.get(document.path)?.add(target);
        adjacency?.get(target)?.add(document.path);
      }
    }
    edges.sort(
      (left, right) =>
        compareText(left[0], right[0]) ||
        compareText(left[1], right[1]),
    );
    return { documents, paths, edges, incoming, outgoing, adjacency };
  }

  private modelNotices({
    graph,
    request,
    activePath,
    nodeTruncated,
    edgeTruncated,
  }: {
    graph: ResolvedGraph;
    request: PluginNoteGraphQuery;
    activePath: string | null;
    nodeTruncated: boolean;
    edgeTruncated: boolean;
  }): string[] {
    const notices = new NoticeCollector();
    if (this.skippedCount > 0) {
      notices.add(
        `Denote skipped ${this.skippedCount} note${
          this.skippedCount === 1 ? "" : "s"
        } while building the bounded local index.`,
      );
    }
    if (this.hostTruncated) {
      notices.add(
        "The host index reached its document or byte bound, so this graph is incomplete.",
      );
    }
    if (
      request.scope === "local" &&
      request.activePath === null
    ) {
      notices.add("Open a Markdown note to use Local graph mode.");
    } else if (
      request.scope === "local" &&
      request.activePath !== null &&
      activePath === null
    ) {
      notices.add(
        "The active note is not available in the bounded graph index.",
      );
    }
    if (nodeTruncated) {
      notices.add(
        `Only the first ${MAX_PLUGIN_NOTE_GRAPH_NODES} ranked notes are shown.`,
      );
    }
    if (edgeTruncated) {
      notices.add(
        `Only the first ${MAX_PLUGIN_NOTE_GRAPH_EDGES} connections between shown notes are rendered.`,
      );
    }
    for (const document of graph.documents) {
      if (document.parseError) {
        notices.add(
          `${noticePath(document.path)} could not be parsed; its note metadata remains indexed without links.`,
        );
      }
      if (document.omittedLinks > 0) {
        notices.add(
          `${noticePath(document.path)} omitted ${document.omittedLinks} link${
            document.omittedLinks === 1 ? "" : "s"
          } after the ${MAX_RAW_LINKS_PER_NOTE}-link per-note bound.`,
        );
      }
    }
    return notices.finish();
  }
}

export function parseNoteGraphDocument(
  document: PluginNoteGraphDocument,
): ParsedNoteGraphDocument {
  try {
    const initialRoot = fromMarkdown(document.source) as MarkdownNode;
    const frontmatterEnd = frontmatterLength(document.source);
    const normalizedSource = normalizeLegacyDestinations(
      document.source,
      initialRoot,
      frontmatterEnd,
    );
    const root =
      normalizedSource === document.source
        ? initialRoot
        : (fromMarkdown(normalizedSource) as MarkdownNode);
    const definitions = new Map<string, string>();
    for (const node of markdownNodes(root)) {
      if (
        node.type !== "definition" ||
        typeof node.identifier !== "string" ||
        typeof node.url !== "string" ||
        nodeStart(node) < frontmatterEnd
      ) {
        continue;
      }
      const identifier = normalizedReference(node.identifier);
      if (!definitions.has(identifier)) {
        definitions.set(identifier, node.url);
      }
    }

    const links: string[] = [];
    let omittedLinks = 0;
    for (const node of markdownNodes(root)) {
      if (nodeStart(node) < frontmatterEnd) {
        continue;
      }
      const href =
        node.type === "link" && typeof node.url === "string"
          ? node.url
          : node.type === "linkReference" &&
              typeof node.identifier === "string"
            ? definitions.get(normalizedReference(node.identifier))
            : undefined;
      if (href === undefined) {
        continue;
      }
      const candidate = localLinkCandidate(document.path, href);
      if (candidate === null) {
        continue;
      }
      if (links.length < MAX_RAW_LINKS_PER_NOTE) {
        links.push(candidate);
      } else {
        omittedLinks += 1;
      }
    }
    return { links, omittedLinks, parseError: false };
  } catch {
    return {
      links: [],
      omittedLinks: 0,
      parseError: true,
    };
  }
}

function normalizeLegacyDestinations(
  source: string,
  root: MarkdownNode,
  frontmatterEnd: number,
): string {
  if (!/\s/.test(source) || !source.includes("]")) {
    return source;
  }
  const protectedRanges = collectProtectedRanges(root, frontmatterEnd);
  const definitionRanges: Array<readonly [number, number]> = [];
  const edits: TextEdit[] = [];
  const definitionPattern =
    /^ {0,3}\[[^\]\r\n]+\]:[ \t]*([^\r\n]*)/gm;
  for (const match of source.matchAll(definitionPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    definitionRanges.push([start, end]);
    if (overlapsAny(start, end, protectedRanges)) {
      continue;
    }
    const rawTarget = match[1];
    const leading = rawTarget.length - rawTarget.trimStart().length;
    const target = rawTarget.trim();
    if (!isSafeLegacyTarget(target)) {
      continue;
    }
    const targetStart =
      start + match[0].length - rawTarget.length + leading;
    edits.push({
      start: targetStart,
      end: targetStart + target.length,
      replacement: `<${target}>`,
    });
  }

  const inlinePattern = /(\[[^\]\n]+\])\(([^()\n]+)\)/g;
  for (const match of source.matchAll(inlinePattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      isEscapedAt(source, start) ||
      overlapsAny(start, end, protectedRanges) ||
      overlapsAny(start, end, definitionRanges)
    ) {
      continue;
    }
    const rawTarget = match[2];
    const leading = rawTarget.length - rawTarget.trimStart().length;
    const target = rawTarget.trim();
    if (!isSafeLegacyTarget(target)) {
      continue;
    }
    const targetStart =
      start + match[0].indexOf(rawTarget) + leading;
    edits.push({
      start: targetStart,
      end: targetStart + target.length,
      replacement: `<${target}>`,
    });
  }

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (value, edit) =>
        `${value.slice(0, edit.start)}${edit.replacement}${value.slice(
          edit.end,
        )}`,
      source,
    );
}

function isSafeLegacyTarget(target: string): boolean {
  return (
    /\s/.test(target) &&
    !/[<>"'()\r\n]/.test(target) &&
    !hasUriScheme(target) &&
    !target.startsWith("//")
  );
}

function collectProtectedRanges(
  root: MarkdownNode,
  frontmatterEnd: number,
): Array<readonly [number, number]> {
  const ranges: Array<[number, number]> =
    frontmatterEnd > 0 ? [[0, frontmatterEnd]] : [];
  for (const node of markdownNodes(root)) {
    if (!["code", "inlineCode", "html"].includes(node.type)) {
      continue;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      ranges.push([start, end]);
    }
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function* markdownNodes(root: MarkdownNode): Generator<MarkdownNode> {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    yield node;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
}

function nodeStart(node: MarkdownNode): number {
  return node.position?.start.offset ?? Number.POSITIVE_INFINITY;
}

function frontmatterLength(source: string): number {
  const yaml = source.match(
    /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/,
  );
  if (yaml) {
    return yaml[0].length;
  }
  return (
    source.match(
      /^\uFEFF?\+\+\+[ \t]*\r?\n[\s\S]*?\r?\n\+\+\+[ \t]*(?=\r?\n|$)/,
    )?.[0].length ?? 0
  );
}

function normalizedReference(identifier: string): string {
  return identifier.trim().replace(/\s+/g, " ").toLowerCase();
}

function localLinkCandidate(
  sourcePath: string,
  href: string,
): string | null {
  const value = href.trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("?") ||
    value.startsWith("//") ||
    value.startsWith("\\") ||
    hasUriScheme(value)
  ) {
    return null;
  }
  const suffixIndex = [value.indexOf("?"), value.indexOf("#")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const encodedPath =
    suffixIndex === undefined ? value : value.slice(0, suffixIndex);
  if (!encodedPath) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (
    !decodedPath ||
    decodedPath.endsWith("/") ||
    decodedPath.startsWith("//") ||
    decodedPath.includes("\\") ||
    hasUriScheme(decodedPath) ||
    /[\u0000-\u001f\u007f]/.test(decodedPath)
  ) {
    return null;
  }

  const base = decodedPath.startsWith("/")
    ? []
    : sourcePath.split("/").slice(0, -1);
  const normalized: string[] = [];
  for (const segment of [
    ...base,
    ...decodedPath.replace(/^\/+/, "").split("/"),
  ]) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalized.length === 0) {
        return null;
      }
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  const candidate = normalized.join("/");
  return candidate || null;
}

function createAvailablePaths(paths: string[]): AvailablePaths {
  const exact = new Set(paths);
  const folded = new Map<string, string | null>();
  for (const path of paths) {
    const key = path.toLowerCase();
    folded.set(key, folded.has(key) ? null : path);
  }
  return { exact, folded };
}

function resolveCandidate(
  candidate: string,
  paths: AvailablePaths,
): string | null {
  const candidates = /\.[^/]+$/.test(candidate)
    ? [candidate]
    : [candidate, `${candidate}.md`, `${candidate}.markdown`];
  const exact = candidates.find((value) => paths.exact.has(value));
  if (exact) {
    return exact;
  }
  for (const value of candidates) {
    const folded = paths.folded.get(value.toLowerCase());
    if (typeof folded === "string") {
      return folded;
    }
  }
  return null;
}

function resolveActivePath(
  activePath: string | null,
  paths: AvailablePaths,
): string | null {
  if (activePath === null) {
    return null;
  }
  if (paths.exact.has(activePath)) {
    return activePath;
  }
  return paths.folded.get(activePath.toLowerCase()) ?? null;
}

function localDistances(
  activePath: string | null,
  depth: 1 | 2 | 3,
  adjacency: Map<string, Set<string>> | null,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (activePath === null || adjacency === null) {
    return distances;
  }
  distances.set(activePath, 0);
  const pending = [activePath];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const path = pending[cursor];
    const distance = distances.get(path) ?? 0;
    if (distance >= depth) {
      continue;
    }
    for (const neighbor of adjacency.get(path) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1);
        pending.push(neighbor);
      }
    }
  }
  return distances;
}

function matchesFolder(path: string, folder: string | null): boolean {
  if (folder === null) {
    return true;
  }
  const normalized = folder
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  return normalized
    ? path.startsWith(`${normalized}/`)
    : !path.includes("/");
}

function normalizedTagKey(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, "")
    .normalize("NFKC")
    .toLowerCase();
}

function compareLocalNodes(
  left: {
    document: IndexedDocument;
    incoming: number;
    outgoing: number;
    distance: number | null;
  },
  right: {
    document: IndexedDocument;
    incoming: number;
    outgoing: number;
    distance: number | null;
  },
): number {
  return (
    (left.distance ?? 0) - (right.distance ?? 0) ||
    right.incoming +
      right.outgoing -
      (left.incoming + left.outgoing) ||
    compareText(left.document.title, right.document.title) ||
    compareText(left.document.path, right.document.path)
  );
}

function compareGlobalNodes(
  left: {
    document: IndexedDocument;
    incoming: number;
    outgoing: number;
  },
  right: {
    document: IndexedDocument;
    incoming: number;
    outgoing: number;
  },
): number {
  return (
    right.incoming +
      right.outgoing -
      (left.incoming + left.outgoing) ||
    compareText(left.document.title, right.document.title) ||
    compareText(left.document.path, right.document.path)
  );
}

function compareText(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  return foldedLeft < foldedRight
    ? -1
    : foldedLeft > foldedRight
      ? 1
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function overlapsAny(
  start: number,
  end: number,
  ranges: Array<readonly [number, number]>,
): boolean {
  return ranges.some(
    ([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart,
  );
}

function isEscapedAt(source: string, offset: number): boolean {
  let backslashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && source[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function noticePath(path: string): string {
  return path.length <= MAX_NOTICE_PATH_LENGTH
    ? path
    : `${path.slice(0, MAX_NOTICE_PATH_LENGTH - 1)}…`;
}

class NoticeCollector {
  private readonly notices: string[] = [];
  private readonly seen = new Set<string>();
  private omitted = 0;

  add(notice: string): void {
    if (this.seen.has(notice)) {
      return;
    }
    this.seen.add(notice);
    if (this.notices.length < MAX_MODEL_NOTICES - 1) {
      this.notices.push(notice);
    } else {
      this.omitted += 1;
    }
  }

  finish(): string[] {
    if (this.omitted > 0) {
      this.notices.push(
        `${this.omitted} additional graph notice${
          this.omitted === 1 ? "" : "s"
        } omitted.`,
      );
    }
    return this.notices;
  }
}
