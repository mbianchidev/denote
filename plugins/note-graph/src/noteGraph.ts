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
export const MAX_RESOLVED_LINKS = 100_000;

const MAX_MODEL_NOTICES = 16;
const MAX_NOTICE_PATH_LENGTH = 360;
const MAX_RESOLVED_LINKS_LABEL = "100,000";

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

export interface NoteGraphParseDiagnostics {
  definitionEdits: number;
  definitionScannerCharacters: number;
  inlineScannerCharacters: number;
  rangeComparisons: number;
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
  adjacency: Map<string, Set<string>>;
  omittedResolvedLinks: number;
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

interface InlineLinkCandidate {
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
}

interface MarkdownFence {
  character: "`" | "~";
  length: number;
}

interface HtmlBlock {
  endMarker: string | null;
  caseInsensitive: boolean;
}

interface LegacyDefinitionLine {
  edit: { start: number; end: number; target: string } | null;
}

export class NoteGraphIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private resolvedGraphCache: ResolvedGraph | null = null;
  private resolvedGraphBuilds = 0;
  private skippedCount = 0;
  private hostTruncated = false;

  constructor(
    private readonly parseDocument: NoteGraphDocumentParser =
      parseNoteGraphDocument,
  ) {}

  get resolvedGraphBuildCount(): number {
    return this.resolvedGraphBuilds;
  }

  index(request: PluginNoteGraphIndexRequest): void {
    let graphChanged = request.mode === "replace";
    if (request.mode === "replace") {
      this.documents.clear();
    }
    for (const path of request.removedPaths) {
      graphChanged = this.documents.delete(path) || graphChanged;
    }
    for (const document of request.documents) {
      this.documents.set(document.path, this.indexDocument(document));
      graphChanged = true;
    }
    if (graphChanged) {
      this.resolvedGraphCache = null;
    }
    this.skippedCount = request.skippedCount;
    this.hostTruncated = request.truncated;
  }

  query(request: PluginNoteGraphQuery): PluginNoteGraphModel {
    const graph = this.resolvedGraph();
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
    const linkTruncated =
      graph.omittedResolvedLinks > 0 ||
      graph.documents.some((document) => document.omittedLinks > 0);
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

  private resolvedGraph(): ResolvedGraph {
    if (this.resolvedGraphCache) {
      return this.resolvedGraphCache;
    }
    const graph = this.buildResolvedGraph();
    this.resolvedGraphCache = graph;
    this.resolvedGraphBuilds += 1;
    return graph;
  }

  private buildResolvedGraph(): ResolvedGraph {
    const documents = [...this.documents.values()].sort((left, right) =>
      compareText(left.path, right.path),
    );
    const paths = createAvailablePaths(
      documents.map((document) => document.path),
    );
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    for (const document of documents) {
      incoming.set(document.path, 0);
      outgoing.set(document.path, 0);
      adjacency.set(document.path, new Set());
    }

    const edges: Array<readonly [string, string]> = [];
    let remainingLinks = MAX_RESOLVED_LINKS;
    let omittedResolvedLinks = 0;
    for (const document of documents) {
      const targets = new Set<string>();
      const analyzedLinks = Math.min(
        document.links.length,
        remainingLinks,
      );
      omittedResolvedLinks += document.links.length - analyzedLinks;
      remainingLinks -= analyzedLinks;
      for (let index = 0; index < analyzedLinks; index += 1) {
        const candidate = document.links[index];
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
        adjacency.get(document.path)?.add(target);
        adjacency.get(target)?.add(document.path);
      }
    }
    return {
      documents,
      paths,
      edges,
      incoming,
      outgoing,
      adjacency,
      omittedResolvedLinks,
    };
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
        `Denote skipped ${this.skippedCount} vault file${
          this.skippedCount === 1 ? "" : "s"
        } while preparing the bounded graph input.`,
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
    if (graph.omittedResolvedLinks > 0) {
      notices.add(
        `The graph omitted ${graph.omittedResolvedLinks} local link occurrence${
          graph.omittedResolvedLinks === 1 ? "" : "s"
        } after the deterministic ${MAX_RESOLVED_LINKS_LABEL}-link analysis budget.`,
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
  diagnostics?: NoteGraphParseDiagnostics,
): ParsedNoteGraphDocument {
  if (diagnostics) {
    diagnostics.definitionEdits = 0;
    diagnostics.definitionScannerCharacters = 0;
    diagnostics.inlineScannerCharacters = 0;
    diagnostics.rangeComparisons = 0;
  }
  try {
    const preparedSource = prepareLegacyMarkdown(
      document.source,
      diagnostics,
    );
    const initialRoot = fromMarkdown(preparedSource) as MarkdownNode;
    const frontmatterEnd = frontmatterLength(preparedSource);
    const normalizedSource = normalizeLegacyDestinations(
      preparedSource,
      initialRoot,
      frontmatterEnd,
      diagnostics,
    );
    const root =
      normalizedSource === preparedSource
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

function prepareLegacyMarkdown(
  source: string,
  diagnostics?: NoteGraphParseDiagnostics,
): string {
  const frontmatterEnd = frontmatterLength(source);
  const output: string[] = [];
  let changed = false;
  let fence: MarkdownFence | null = null;
  let htmlBlock: HtmlBlock | null = null;
  let inlineCodeTicks = 0;
  let offset = 0;

  while (offset < source.length) {
    const newline = source.indexOf("\n", offset);
    const nextOffset = newline < 0 ? source.length : newline + 1;
    const contentEnd =
      newline >= 0 && source[newline - 1] === "\r"
        ? newline - 1
        : newline < 0
          ? source.length
          : newline;
    const line = source.slice(offset, contentEnd);
    const ending = source.slice(contentEnd, nextOffset);
    let protectedLine = offset < frontmatterEnd;
    const marker = fenceMarker(line);

    if (fence) {
      protectedLine = true;
      if (
        marker &&
        marker.character === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
    } else if (marker) {
      protectedLine = true;
      fence = marker;
      inlineCodeTicks = 0;
    } else if (htmlBlock) {
      protectedLine = true;
      if (
        (htmlBlock.endMarker === null && line.trim().length === 0) ||
        (htmlBlock.endMarker !== null &&
          includesMarker(
            line,
            htmlBlock.endMarker,
            htmlBlock.caseInsensitive,
          ))
      ) {
        htmlBlock = null;
      }
    } else {
      htmlBlock = htmlBlockStart(line);
      if (htmlBlock) {
        protectedLine = true;
        if (
          htmlBlock.endMarker !== null &&
          includesMarker(
            line.slice(line.indexOf("<") + 1),
            htmlBlock.endMarker,
            htmlBlock.caseInsensitive,
          )
        ) {
          htmlBlock = null;
        }
      }
      const inlineCode = inlineCodeState(line, inlineCodeTicks);
      protectedLine =
        protectedLine ||
        inlineCodeTicks > 0 ||
        inlineCode.containsCode ||
        /^(?: {4}|\t)/.test(line);
      inlineCodeTicks = inlineCode.nextTicks;
    }

    let preparedLine = line;
    if (!protectedLine) {
      const definition = legacyDefinitionLine(line);
      if (definition?.edit) {
        preparedLine = `${line.slice(0, definition.edit.start)}<${
          definition.edit.target
        }>${line.slice(definition.edit.end)}`;
        changed = true;
        if (diagnostics) {
          diagnostics.definitionEdits += 1;
        }
      } else if (!definition) {
        const inlineEdits = legacyInlineEdits(line);
        if (inlineEdits.length > 0) {
          preparedLine = applyTextEdits(line, inlineEdits);
          changed = true;
        }
      }
    }
    output.push(preparedLine, ending);
    if (diagnostics) {
      diagnostics.definitionScannerCharacters += nextOffset - offset;
    }
    offset = nextOffset;
  }
  return changed ? output.join("") : source;
}

function legacyDefinitionLine(
  line: string,
): LegacyDefinitionLine | null {
  let cursor = 0;
  while (cursor < 3 && line[cursor] === " ") {
    cursor += 1;
  }
  if (line[cursor] !== "[") {
    return null;
  }
  const labelStart = cursor + 1;
  let safeToPrepare = true;
  cursor = labelStart;
  while (cursor < line.length && line[cursor] !== "]") {
    if (
      line[cursor] === "[" ||
      line[cursor] === "\\" ||
      cursor - labelStart >= 999
    ) {
      safeToPrepare = false;
    }
    cursor += 1;
  }
  if (
    cursor === labelStart ||
    line[cursor] !== "]" ||
    line[cursor + 1] !== ":"
  ) {
    return null;
  }
  if (!safeToPrepare) {
    return { edit: null };
  }
  cursor += 2;
  while (line[cursor] === " " || line[cursor] === "\t") {
    cursor += 1;
  }
  const rawTarget = line.slice(cursor);
  const leading = rawTarget.length - rawTarget.trimStart().length;
  const target = rawTarget.trim();
  if (!isSafeLegacyTarget(target) || target.includes("`")) {
    return { edit: null };
  }
  const start = cursor + leading;
  return {
    edit: {
      start,
      end: start + target.length,
      target,
    },
  };
}

function legacyInlineEdits(line: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const candidate of inlineLinkCandidates(line)) {
    const rawTarget = line.slice(
      candidate.targetStart,
      candidate.targetEnd,
    );
    const leading = rawTarget.length - rawTarget.trimStart().length;
    const target = rawTarget.trim();
    if (!isSafeLegacyTarget(target)) {
      continue;
    }
    const start = candidate.targetStart + leading;
    edits.push({
      start,
      end: start + target.length,
      replacement: `<${target}>`,
    });
  }
  return edits;
}

function fenceMarker(line: string): MarkdownFence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) {
    return null;
  }
  return {
    character: match[1][0] as MarkdownFence["character"],
    length: match[1].length,
  };
}

function htmlBlockStart(line: string): HtmlBlock | null {
  const value = line.replace(/^ {0,3}/, "");
  if (value.startsWith("<!--")) {
    return { endMarker: "-->", caseInsensitive: false };
  }
  if (value.startsWith("<?")) {
    return { endMarker: "?>", caseInsensitive: false };
  }
  if (value.startsWith("<![CDATA[")) {
    return { endMarker: "]]>", caseInsensitive: false };
  }
  if (/^<![A-Z]/.test(value)) {
    return { endMarker: ">", caseInsensitive: false };
  }
  const raw = value.match(/^<(script|pre|style|textarea)(?:\s|>|$)/i);
  if (raw) {
    return {
      endMarker: `</${raw[1]}>`,
      caseInsensitive: true,
    };
  }
  return /^<\/?[A-Za-z][^>]*>/.test(value)
    ? { endMarker: null, caseInsensitive: false }
    : null;
}

function includesMarker(
  line: string,
  marker: string,
  caseInsensitive: boolean,
): boolean {
  return caseInsensitive
    ? line.toLowerCase().includes(marker.toLowerCase())
    : line.includes(marker);
}

function inlineCodeState(
  line: string,
  currentTicks: number,
): { containsCode: boolean; nextTicks: number } {
  let containsCode = currentTicks > 0;
  let ticks = currentTicks;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "`") {
      continue;
    }
    let end = index + 1;
    while (line[end] === "`") {
      end += 1;
    }
    const run = end - index;
    if (ticks === 0) {
      ticks = run;
      containsCode = true;
    } else if (ticks === run) {
      ticks = 0;
    }
    index = end - 1;
  }
  return { containsCode, nextTicks: ticks };
}

function normalizeLegacyDestinations(
  source: string,
  root: MarkdownNode,
  frontmatterEnd: number,
  diagnostics?: NoteGraphParseDiagnostics,
): string {
  if (!/\s/.test(source) || !source.includes("]")) {
    return source;
  }
  const protectedRanges = collectProtectedRanges(root, frontmatterEnd);
  const definitionRanges: Array<readonly [number, number]> = [];
  const edits: TextEdit[] = [];
  const definitionProtectedRanges = new MonotonicRangeCursor(
    protectedRanges,
    diagnostics,
  );
  const definitionPattern =
    /^ {0,3}\[[^\]\r\n]+\]:[ \t]*([^\r\n]*)/gm;
  for (const match of source.matchAll(definitionPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    definitionRanges.push([start, end]);
    if (definitionProtectedRanges.overlaps(start, end)) {
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

  const inlineProtectedRanges = new MonotonicRangeCursor(
    protectedRanges,
    diagnostics,
  );
  const inlineDefinitionRanges = new MonotonicRangeCursor(
    definitionRanges,
    diagnostics,
  );
  for (const candidate of inlineLinkCandidates(source, diagnostics)) {
    if (
      inlineProtectedRanges.overlaps(candidate.start, candidate.end) ||
      inlineDefinitionRanges.overlaps(candidate.start, candidate.end)
    ) {
      continue;
    }
    const rawTarget = source.slice(
      candidate.targetStart,
      candidate.targetEnd,
    );
    const leading = rawTarget.length - rawTarget.trimStart().length;
    const target = rawTarget.trim();
    if (!isSafeLegacyTarget(target)) {
      continue;
    }
    const targetStart = candidate.targetStart + leading;
    edits.push({
      start: targetStart,
      end: targetStart + target.length,
      replacement: `<${target}>`,
    });
  }

  return applyTextEdits(source, edits);
}

function applyTextEdits(source: string, edits: TextEdit[]): string {
  if (edits.length === 0) {
    return source;
  }
  const ordered = [...edits].sort(
    (left, right) =>
      left.start - right.start || left.end - right.end,
  );
  const output: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (
      edit.start < cursor ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length
    ) {
      throw new Error("Legacy Markdown link edits overlap or are invalid.");
    }
    output.push(source.slice(cursor, edit.start), edit.replacement);
    cursor = edit.end;
  }
  output.push(source.slice(cursor));
  return output.join("");
}

function* inlineLinkCandidates(
    source: string,
    diagnostics?: NoteGraphParseDiagnostics,
): Generator<InlineLinkCandidate> {
    let state: "search" | "label" | "target" = "search";
    let labelStart = 0;
    let labelHasContent = false;
    let labelInvalid = false;
    let targetStart = 0;
    let targetHasWhitespace = false;
    let precedingBackslashes = 0;
    let index = 0;

    while (index < source.length) {
      const character = source[index];
      const escaped = precedingBackslashes % 2 === 1;
      precedingBackslashes =
        character === "\\" ? precedingBackslashes + 1 : 0;
      if (diagnostics) {
        diagnostics.inlineScannerCharacters += 1;
      }

      if (state === "search") {
        if (character === "[" && !escaped) {
          state = "label";
          labelStart = index;
          labelHasContent = false;
          labelInvalid = false;
        }
        index += 1;
        continue;
      }

      if (state === "label") {
        if (character === "\n" || character === "\r") {
          state = "search";
        } else if (
          character === "[" &&
          !escaped
        ) {
          labelInvalid = true;
        } else if (character === "]") {
          if (
            labelHasContent &&
            !labelInvalid &&
            source[index + 1] === "("
          ) {
            if (diagnostics) {
              diagnostics.inlineScannerCharacters += 1;
            }
            state = "target";
            targetStart = index + 2;
            targetHasWhitespace = false;
            precedingBackslashes = 0;
            index += 2;
            continue;
          }
          state = "search";
        } else {
          labelHasContent = true;
        }
        index += 1;
        continue;
      }

      if (
        character === "\n" ||
        character === "\r" ||
        character === "("
      ) {
        state = "search";
        index += 1;
        continue;
      }
      if (character === ")") {
        if (index > targetStart && targetHasWhitespace) {
          yield {
            start: labelStart,
            end: index + 1,
            targetStart,
            targetEnd: index,
          };
        }
        state = "search";
        index += 1;
        continue;
      }
      if (/\s/.test(character)) {
        targetHasWhitespace = true;
      }
      index += 1;
    }
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

class MonotonicRangeCursor {
  private index = 0;

  constructor(
    private readonly ranges: Array<readonly [number, number]>,
    private readonly diagnostics?: NoteGraphParseDiagnostics,
  ) {}

  overlaps(start: number, end: number): boolean {
    while (this.index < this.ranges.length) {
      const [rangeStart, rangeEnd] = this.ranges[this.index];
      if (this.diagnostics) {
        this.diagnostics.rangeComparisons += 1;
      }
      if (rangeEnd <= start) {
        this.index += 1;
        continue;
      }
      return rangeStart < end;
    }
    return false;
  }
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
  adjacency: Map<string, Set<string>>,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (activePath === null) {
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
