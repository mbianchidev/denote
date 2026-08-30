import { fromMarkdown } from "mdast-util-from-markdown";
import type { HeadingItem } from "../types";
import { isRichSafeStandardMarkdownAngle } from "./mdxCompatibility";
import { normalizeTag } from "./tagColors";
import type { MarkdownViewMode } from "./markdownView";

const CALLOUT_TYPES = "warning|info|danger|note|tip|caution";

export function calloutsToDirectives(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let fence: Fence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (isIndentedCode(lines[index])) {
      output.push(lines[index]);
      continue;
    }

    fence = updateFence(lines[index], fence);
    if (fence || isFenceLine(lines[index])) {
      output.push(lines[index]);
      continue;
    }
    const match = lines[index].match(
      new RegExp(
        `^(\\s*)>\\s*(?:!\\[(${CALLOUT_TYPES})\\]|\\[!(${CALLOUT_TYPES})\\])\\s*$`,
        "i",
      ),
    );
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const indent = match[1];
    const sourceType = (match[2] ?? match[3]).toLowerCase();
    const directiveType = sourceType === "warning" ? "caution" : sourceType;
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      if (!lines[cursor].startsWith(indent)) {
        break;
      }
      const quote = lines[cursor].slice(indent.length).match(/^>\s?(.*)$/);
      if (!quote) {
        break;
      }
      body.push(quote[1]);
      cursor += 1;
    }
    output.push(
      `${indent}:::${directiveType}`,
      ...body.map((line) => `${indent}${line}`),
      `${indent}:::`,
    );
    index = cursor - 1;
  }

  return output.join("\n");
}

export function markdownEditorSource(markdown: string): string {
  return calloutsToDirectives(normalizeBareSpaceLinkDestinations(markdown));
}

export interface ThematicBreakSnapshot {
  delimiters: string[];
}

export function captureThematicBreaks(markdown: string): ThematicBreakSnapshot {
  return {
    delimiters: thematicBreakRanges(markdown).map(({ delimiter }) => delimiter),
  };
}

export function restoreThematicBreaks(
  markdown: string,
  snapshot: ThematicBreakSnapshot,
): string {
  const ranges = thematicBreakRanges(markdown);
  if (ranges.length !== snapshot.delimiters.length) {
    return markdown;
  }
  let restored = markdown;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    const delimiter = snapshot.delimiters[index];
    restored = `${restored.slice(0, range.start)}${delimiter}${restored.slice(
      range.end,
    )}`;
  }
  return restored;
}

function thematicBreakRanges(
  markdown: string,
): Array<{ start: number; end: number; delimiter: string }> {
  const root = markdownRoot(markdown);
  if (!root) {
    return [];
  }
  const frontmatterEnd =
    markdown.match(/^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?=\r?\n|$)/)?.[0]
      .length ?? 0;
  const ranges: Array<{ start: number; end: number; delimiter: string }> = [];
  visitMarkdownAst(root, (node) => {
    if (node.type !== "thematicBreak") {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < frontmatterEnd) {
      return;
    }
    const delimiter = markdown.slice(start, end).trim();
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(delimiter)) {
      ranges.push({ start, end, delimiter });
    }
  });
  return ranges;
}

export function directivesToCallouts(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let fence: Fence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (isIndentedCode(lines[index])) {
      output.push(lines[index]);
      continue;
    }
    fence = updateFence(lines[index], fence);
    if (fence || isFenceLine(lines[index])) {
      output.push(lines[index]);
      continue;
    }
    const match = lines[index].match(
      new RegExp(`^(\\s*):::(${CALLOUT_TYPES})\\s*$`, "i"),
    );
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const indent = match[1];
    const directiveType = match[2].toLowerCase();
    const sourceType = directiveType === "caution" ? "warning" : directiveType;
    const body: string[] = [];
    let cursor = index + 1;
    let nestedFence: Fence | null = null;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const relativeLine = line.startsWith(indent)
        ? line.slice(indent.length)
        : line;
      if (!nestedFence && /^:::\s*$/.test(relativeLine)) {
        break;
      }
      if (!isIndentedCode(line)) {
        nestedFence = updateFence(relativeLine, nestedFence);
      }
      body.push(relativeLine);
      cursor += 1;
    }
    if (cursor >= lines.length) {
      output.push(lines[index]);
      continue;
    }
    output.push(
      `${indent}>![${sourceType}]`,
      ...body.map((line) =>
        line ? `${indent}> ${line}` : `${indent}>`,
      ),
    );
    index = cursor;
  }

  return output.join("\n");
}

export function extractTags(markdown: string): string[] {
  const tags = new Set<string>();
  let fence: Fence | null = null;
  let inlineCodeTicks = 0;
  for (const line of markdown.split("\n")) {
    const fenceLine = inlineCodeTicks === 0 && isFenceLine(line);
    if (fence || fenceLine) {
      fence = updateFence(line, fence);
      continue;
    }
    if (inlineCodeTicks === 0 && isIndentedCode(line)) {
      continue;
    }
    const characters = [...line];
    for (let index = 0; index < characters.length; index += 1) {
      if (characters[index] === "`") {
        let end = index + 1;
        while (characters[end] === "`") {
          end += 1;
        }
        const ticks = end - index;
        if (inlineCodeTicks === 0) {
          inlineCodeTicks = ticks;
        } else if (inlineCodeTicks === ticks) {
          inlineCodeTicks = 0;
        }
        index = end - 1;
        continue;
      }
      if (
        inlineCodeTicks > 0 ||
        characters[index] !== "#" ||
        !isTagBoundary(characters, index)
      ) {
        continue;
      }
      let end = index + 1;
      while (end < characters.length && isTagCharacter(characters[end])) {
        end += 1;
      }
      if (end > index + 1) {
        tags.add(normalizeTag(characters.slice(index + 1, end).join("")));
        index = end - 1;
      }
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

const MARKDOWN_TAG_PATTERN = /(^|[\s([{'""])#([\p{L}\p{N}\p{M}_/-]+)/u;
const TAG_CHARACTER = /[\p{L}\p{N}\p{M}_/-]/u;
const TAG_BOUNDARY = /[\s([{'"*~]/u;

export function findMarkdownTagMatch(
  text: string,
): { start: number; end: number } | null {
  const match = MARKDOWN_TAG_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const start = match.index + match[1].length;
  return {
    start,
    end: start + match[2].length + 1,
  };
}

export function restoreRichTextTagSyntax(markdown: string): string {
  return markdown.replace(
    /(^|[\s([{'"*~])\\#(?=[\p{L}\p{N}\p{M}_/-])/gmu,
    "$1#",
  );
}

function isTagCharacter(character: string): boolean {
  return TAG_CHARACTER.test(character);
}

function isTagBoundary(characters: string[], index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = characters[index - 1];
  if (TAG_BOUNDARY.test(previous)) {
    return true;
  }
  if (previous !== "_") {
    return false;
  }
  let cursor = index - 1;
  while (cursor >= 0 && characters[cursor] === "_") {
    cursor -= 1;
  }
  return cursor < 0 || TAG_BOUNDARY.test(characters[cursor]);
}

export function extractHeadings(markdown: string): HeadingItem[] {
  return markdownHeadingRecords(markdown).map(({ heading }) => heading);
}

export function findMarkdownHeadingLine(
  markdown: string,
  anchor: string,
): number | null {
  const slug = slugifyHeading(anchor);
  try {
    const usedSlugs = new Set<string>();
    let matchedLine: number | null = null;
    visitHeadingNodes(
      fromMarkdown(markdown) as unknown as HeadingAstNode,
      (heading) => {
        if (
          matchedLine === null &&
          nextHeadingSlug(markdownNodeText(heading).trim(), usedSlugs) === slug
        ) {
          matchedLine = heading.position?.start.line ?? null;
        }
      },
    );
    return matchedLine;
  } catch {
    return (
      markdownHeadingRecords(markdown).find(
        ({ heading }) => heading.slug === slug,
      )?.line ?? null
    );
  }
}

function markdownHeadingRecords(
  markdown: string,
): Array<{ heading: HeadingItem; line: number }> {
  try {
    const headings: Array<{ heading: HeadingItem; line: number }> = [];
    const usedSlugs = new Set<string>();
    visitHeadingNodes(
      fromMarkdown(markdown) as unknown as HeadingAstNode,
      (heading) => {
        const text = markdownNodeText(heading).trim();
        headings.push({
          line: heading.position?.start.line ?? 1,
          heading: {
            depth: heading.depth ?? 1,
            text,
            slug: nextHeadingSlug(text, usedSlugs),
          },
        });
      },
    );
    return headings;
  } catch {
    return [];
  }
}

interface HeadingAstNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string | null;
  children?: HeadingAstNode[];
  position?: {
    start: {
      line: number;
    };
  };
}

function visitHeadingNodes(
  node: HeadingAstNode,
  callback: (heading: HeadingAstNode) => void,
) {
  if (node.type === "heading") {
    callback(node);
  }
  for (const child of node.children ?? []) {
    visitHeadingNodes(child, callback);
  }
}

function markdownNodeText(node: HeadingAstNode): string {
  if (typeof node.value === "string") {
    return node.type === "html"
      ? node.value.replace(/<[^>]*>/g, "")
      : node.value;
  }
  if (typeof node.alt === "string") {
    return node.alt;
  }
  if (node.type === "break") {
    return " ";
  }
  return (node.children ?? []).map(markdownNodeText).join("");
}

export function slugifyHeading(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nextHeadingSlug(value: string, usedSlugs: Set<string>): string {
  const base = slugifyHeading(value) || "section";
  let candidate = base;
  let suffix = 0;
  while (usedSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  usedSlugs.add(candidate);
  return candidate;
}

export function resolveInternalLink(
  currentPath: string,
  href: string,
  availablePaths: string[],
): { path: string; anchor: string | null } | null {
  if (
    /^(?:[a-z]+:)?\/\//i.test(href) ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return null;
  }

  const [encodedPath, encodedAnchor] = href.split("#", 2);
  const rawPath = decodeURIComponent(encodedPath);
  const anchor = encodedAnchor ? decodeURIComponent(encodedAnchor) : null;
  if (!rawPath) {
    return { path: currentPath, anchor };
  }
  const base = rawPath.startsWith("/")
    ? []
    : currentPath.split("/").slice(0, -1);
  const segments = [...base, ...rawPath.replace(/^\/+/, "").split("/")];
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  const candidate = normalized.join("/");
  const candidates = /\.[^/]+$/.test(candidate)
    ? [candidate]
    : [candidate, `${candidate}.md`, `${candidate}.markdown`, `${candidate}.txt`];
  const exact = new Set(availablePaths);
  const folded = new Map<string, string | null>();
  for (const available of availablePaths) {
    const key = available.toLocaleLowerCase();
    folded.set(key, folded.has(key) ? null : available);
  }
  const path =
    candidates.find((candidate) => exact.has(candidate)) ??
    candidates
      .map((candidate) => folded.get(candidate.toLocaleLowerCase()))
      .find((candidate): candidate is string => typeof candidate === "string");
  return path ? { path, anchor } : null;
}

export function recoverMarkdownLinkTarget(
  markdown: string,
  linkText: string,
  renderedHref: string,
): string | null {
  const normalizedText = linkText.trim();
  const sanitizedSchemeTargets = new Set<string>();
  const syntheticRelativeTargets = new Set<string>();
  const pattern =
    /\[([^\]]+)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const text = match[1].replace(/[*_`~]/g, "").trim();
    const target = match[2].replace(/^<|>$/g, "");
    if (text !== normalizedText) {
      continue;
    }
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(target) &&
      renderedHref === "about:blank"
    ) {
      sanitizedSchemeTargets.add(target);
      continue;
    }
    if (normalizedRenderedHref(target) === normalizedRenderedHref(renderedHref)) {
      return target;
    }
    if (
      !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
      syntheticRelativeHref(renderedHref) === decodedLinkTarget(target)
    ) {
      syntheticRelativeTargets.add(target);
    }
  }
  if (syntheticRelativeTargets.size === 1) {
    return [...syntheticRelativeTargets][0];
  }
  return sanitizedSchemeTargets.size === 1
    ? [...sanitizedSchemeTargets][0]
    : null;
}

export function normalizeBareSpaceLinkDestinations(markdown: string): string {
  if (!/\[[^\]\n]+\]\([^()\n]*\s+[^()\n]*\)/.test(markdown)) {
    return markdown;
  }
  const ranges = protectedMarkdownRanges(markdown);
  let normalized = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    normalized += normalizeBareSpaceLinks(markdown.slice(cursor, start));
    normalized += markdown.slice(start, end);
    cursor = end;
  }
  return normalized + normalizeBareSpaceLinks(markdown.slice(cursor));
}

function normalizeBareSpaceLinks(value: string): string {
  return value.replace(
    /(\[[^\]\n]+\])\(([^()\n]+)\)/g,
    (
      match,
      label: string,
      rawTarget: string,
      offset: number,
      source: string,
    ) => {
      const target = rawTarget.trim();
      if (
        isEscapedAt(source, offset) ||
        !/\s/.test(target) ||
        /[<>"']/.test(target) ||
        /^[a-z][a-z0-9+.-]*:/i.test(target) ||
        target.startsWith("//")
      ) {
        return match;
      }
      return `${label}(<${target}>)`;
    },
  );
}

function protectedMarkdownRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const frontmatter = markdown.match(
    /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?=\r?\n|$)/,
  );
  if (frontmatter) {
    ranges.push([0, frontmatter[0].length]);
  }
  const root = markdownRoot(markdown);
  if (root) {
    visitMarkdownAst(root, (node) => {
      if (!["code", "inlineCode", "html"].includes(node.type)) {
        return;
      }
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        ranges.push([start, end]);
      }
    });
  }
  return mergeRanges(ranges);
}

export function protectedMarkdownDiagnosticRanges(
  markdown: string,
): Array<[number, number]> {
  const ranges = protectedMarkdownRanges(markdown);
  const root = markdownRoot(markdown);
  if (!root) {
    return ranges;
  }
  visitMarkdownAst(root, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return;
    }
    if (node.type === "definition") {
      ranges.push([start, end]);
      return;
    }
    if (node.type !== "link" && node.type !== "image") {
      return;
    }
    const source = markdown.slice(start, end);
    if (source.startsWith("<") && source.endsWith(">")) {
      ranges.push([start, end]);
      return;
    }
    const destinationStart = inlineLinkDestinationStart(source);
    if (destinationStart !== null) {
      ranges.push([start + destinationStart, end]);
    }
  });
  return mergeRanges(ranges);
}

function inlineLinkDestinationStart(source: string): number | null {
  const labelStart = source.startsWith("![")
    ? 2
    : source.startsWith("[")
      ? 1
      : -1;
  if (labelStart < 0) {
    return null;
  }
  let nestedBrackets = 0;
  let codeTicks = 0;
  for (let index = labelStart; index < source.length - 1; index += 1) {
    if (source[index] === "`" && !isEscapedAt(source, index)) {
      let runLength = 1;
      while (source[index + runLength] === "`") {
        runLength += 1;
      }
      if (codeTicks === 0) {
        codeTicks = runLength;
      } else if (codeTicks === runLength) {
        codeTicks = 0;
      }
      index += runLength - 1;
      continue;
    }
    if (codeTicks > 0 || isEscapedAt(source, index)) {
      continue;
    }
    if (source[index] === "[") {
      nestedBrackets += 1;
      continue;
    }
    if (source[index] !== "]") {
      continue;
    }
    if (nestedBrackets > 0) {
      nestedBrackets -= 1;
      continue;
    }
    if (source[index + 1] === "(") {
      return index + 2;
    }
  }
  return null;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const range of ranges.sort((left, right) => left[0] - right[0])) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function syntheticRelativeHref(value: string): string {
  return decodedLinkTarget(value)
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

function decodedLinkTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface TocMarkerSnapshot {
  blocks: Array<{
    links: string[];
    items: string[];
    listOrdinal: number;
    itemOrdinal: number;
    rootListCount: number;
    rootItemCount: number;
    previousContext: string | null;
    nextContext: string | null;
  }>;
}

export function captureTocMarkers(markdown: string): TocMarkerSnapshot {
  return { blocks: validTocBlocks(markdown).map((block) => block.snapshot) };
}

export function restoreTocMarkers(
  markdown: string,
  snapshot: TocMarkerSnapshot,
): string {
  if (
    snapshot.blocks.length === 0 ||
    /^<!-- \/?toc -->\r?$/m.test(markdown)
  ) {
    return markdown;
  }
  const lists = rootMarkdownLists(markdown);
  const claimed: ClaimedListRange[] = [];
  const insertions: Array<{ start: number; end: number }> = [];
  for (const block of snapshot.blocks) {
    let index = -1;
    let startItem = 0;
    let endItem = 0;
    const ordinalCandidate = lists[block.listOrdinal];
    const ordinalItemCount = listItems(ordinalCandidate?.node).length;
    if (
      ordinalCandidate &&
      isListRangeAvailable(
        claimed,
        block.listOrdinal,
        0,
        ordinalItemCount,
      ) &&
      ((lists.length === block.rootListCount &&
        (sameLinks(markdownListLinks(ordinalCandidate.node), block.links) ||
          lists.length === 1)) ||
        sameTocContext(ordinalCandidate, block))
    ) {
      index = block.listOrdinal;
      endItem = ordinalItemCount;
    }
    if (index < 0) {
      const exactMatches = lists
        .map((list, candidateIndex) => ({ list, candidateIndex }))
        .filter(
          ({ list, candidateIndex }) =>
            isListRangeAvailable(
              claimed,
              candidateIndex,
              0,
              listItems(list.node).length,
            ) &&
            verifiedTocMatch(list, block),
        );
      if (exactMatches.length === 1) {
        index = exactMatches[0].candidateIndex;
        endItem = listItems(exactMatches[0].list.node).length;
      }
    }
    if (index < 0) {
      const contextMatches = lists
        .map((list, candidateIndex) => ({ list, candidateIndex }))
        .filter(
          ({ list, candidateIndex }) =>
            isListRangeAvailable(
              claimed,
              candidateIndex,
              0,
              listItems(list.node).length,
            ) && sameTocContext(list, block),
        );
      if (contextMatches.length === 1) {
        index = contextMatches[0].candidateIndex;
        endItem = listItems(contextMatches[0].list.node).length;
      }
    }
    let start = lists[index]?.node.position?.start.offset;
    let end = lists[index]?.node.position?.end.offset;
    if (
      index < 0 &&
      rootListItemCount(lists) >= block.rootItemCount
    ) {
      const segment = matchingTocSegments(lists, block, claimed).sort(
        (left, right) =>
          Math.abs(left.itemOrdinal - block.itemOrdinal) -
            Math.abs(right.itemOrdinal - block.itemOrdinal) ||
          left.itemOrdinal - right.itemOrdinal,
      )[0];
      if (segment) {
        index = segment.listIndex;
        start = segment.start;
        end = segment.end;
        startItem = segment.startItem;
        endItem = segment.endItem;
      }
    }
    if (index < 0 || start === undefined || end === undefined) {
      continue;
    }
    claimed.push({ listIndex: index, startItem, endItem });
    insertions.push({ start, end });
  }
  let restored = markdown;
  for (const insertion of insertions.sort((left, right) => right.start - left.start)) {
    restored = `${restored.slice(0, insertion.start)}<!-- toc -->\n${restored.slice(
      insertion.start,
      insertion.end,
    )}\n<!-- /toc -->${restored.slice(insertion.end)}`;
  }
  return restored;
}

export function applyTocMarkerViewChange(
  markdown: string,
  snapshot: TocMarkerSnapshot,
  viewMode: MarkdownViewMode,
): { markdown: string; snapshot: TocMarkerSnapshot } {
  if (viewMode === "source") {
    return { markdown, snapshot: captureTocMarkers(markdown) };
  }
  const restored = restoreTocMarkers(markdown, snapshot);
  return { markdown: restored, snapshot: captureTocMarkers(restored) };
}

export function hasUnsupportedRichMarkdown(markdown: string): boolean {
  return (
    /(^|\n)\[\^[^\]]+\]:/m.test(markdown) ||
    /\[\^[^\]]+\]/.test(markdown) ||
    containsUnsupportedHtmlComment(markdown) ||
    containsEscapedAngleSyntax(markdown) ||
    containsDetailsMdxIncompatibleAngles(markdown) ||
    containsDetailsMdxIncompatibleMarkdown(markdown) ||
    containsUnsafeAngleSyntax(maskSupportedDetailsTags(markdown)) ||
    /(^|\n)\s{0,3}\[[^\]]+\]:\s+\S+/m.test(markdown) ||
    /(^|\n)\s*\$\$[\s\S]*?\$\$/m.test(markdown) ||
    /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(markdown) ||
    /\\#(?=[\p{L}\p{N}\p{M}_/-])/u.test(markdown)
  );
}

export function hasSupportedDetailsMarkdown(markdown: string): boolean {
  return richDetailsBlocks(markdown).length > 0;
}

function containsDetailsMdxIncompatibleAngles(markdown: string): boolean {
  if (!hasSupportedDetailsMarkdown(markdown)) {
    return false;
  }
  const masked = maskSupportedDetailsTags(markdown);
  const protectedRanges: Array<[number, number]> = [];
  visitMarkdownAst(fromMarkdown(masked), (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return;
    }
    if (node.type === "code" || node.type === "inlineCode") {
      protectedRanges.push([start, end]);
    } else if (node.type === "link") {
      const range = angleLinkDestinationRange(masked, node, start, end);
      if (range) {
        protectedRanges.push(range);
      }
    }
  });
  const protectedIndex = createRangeIndex(protectedRanges);
  for (const match of masked.matchAll(/</g)) {
    const offset = match.index ?? 0;
    if (
      rangeContains(protectedIndex, offset, offset + 1) ||
      masked.startsWith("<!--", offset)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function containsDetailsMdxIncompatibleMarkdown(markdown: string): boolean {
  if (!hasSupportedDetailsMarkdown(markdown)) {
    return false;
  }
  const root = markdownRoot(markdown);
  if (!root) {
    return true;
  }
  let incompatible = false;
  visitMarkdownAst(root, (node) => {
    if (incompatible || node.type !== "code") {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      incompatible = true;
      return;
    }
    incompatible = /^(?: {4}|\t)/.test(markdown.slice(start, end));
  });
  return incompatible;
}

function maskSupportedDetailsTags(markdown: string): string {
  return replaceRichDetailsBlocks(markdown, (block) =>
    block.replace(/<\/?(?:details|summary)(?: open)?>/g, (tag) =>
      " ".repeat(tag.length),
    ),
  );
}

interface RichDetailsBlock {
  start: number;
  end: number;
  value: string;
}

function richDetailsBlocks(markdown: string): RichDetailsBlock[] {
  const blocks: RichDetailsBlock[] = [];
  const codeRanges: Array<[number, number]> = [];
  const root = markdownRoot(markdown);
  if (root) {
    visitMarkdownAst(root, (node) => {
      if (node.type !== "code" && node.type !== "inlineCode") {
        return;
      }
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        codeRanges.push([start, end]);
      }
    });
  }
  const codeIndex = createRangeIndex(codeRanges);
  const closingPattern = /^<\/details>[ \t]*$/gm;
  for (const opening of markdown.matchAll(/^<details(?: open)?>[ \t]*$/gm)) {
    const start = opening.index ?? 0;
    if (rangeContains(codeIndex, start, start + opening[0].length)) {
      continue;
    }
    const summary = /^\r?\n(?:[ \t]*<summary>[^\r\n<>]*<\/summary>[ \t]*|[ \t]*<summary>[ \t]*\r?\n[ \t]+[^\r\n<>]*\r?\n[ \t]*<\/summary>[ \t]*)\r?\n/.exec(
      markdown.slice(start + opening[0].length),
    );
    if (!summary) {
      continue;
    }
    const contentStart = start + opening[0].length + summary[0].length;
    closingPattern.lastIndex = contentStart;
    let closing = closingPattern.exec(markdown);
    while (
      closing &&
      rangeContains(
        codeIndex,
        closing.index,
        closing.index + closing[0].length,
      )
    ) {
      closing = closingPattern.exec(markdown);
    }
    if (!closing) {
      continue;
    }
    const end = closing.index + closing[0].length;
    const value = markdown.slice(start, end);
    const tags = [
      ...value.matchAll(/<\/?(?:details|summary)\b[^>]*>/g),
    ]
      .filter((tag) => {
        const tagStart = start + (tag.index ?? 0);
        return !rangeContains(
          codeIndex,
          tagStart,
          tagStart + tag[0].length,
        );
      })
      .map((tag) => tag[0]);
    if (
      rangeContains(codeIndex, start, end) ||
      tags.length !== 4 ||
      !/^<details(?: open)?>$/.test(tags[0]) ||
      tags[1] !== "<summary>" ||
      tags[2] !== "</summary>" ||
      tags[3] !== "</details>"
    ) {
      continue;
    }
    blocks.push({
      start,
      end,
      value,
    });
  }
  return blocks;
}

function replaceRichDetailsBlocks(
  markdown: string,
  replace: (block: string) => string,
): string {
  const blocks = richDetailsBlocks(markdown);
  let output = "";
  let cursor = 0;
  for (const block of blocks) {
    output += markdown.slice(cursor, block.start);
    output += replace(block.value);
    cursor = block.end;
  }
  return output + markdown.slice(cursor);
}

function containsUnsupportedHtmlComment(markdown: string): boolean {
  if (!markdown.includes("<!--")) {
    return false;
  }
  const allowedMarkers = new Set(
    validTocBlocks(markdown).flatMap((block) =>
      block.markerRanges.map(([start, end]) => `${start}:${end}`),
    ),
  );
  const root = markdownRoot(markdown);
  if (!root) {
    return /<!--/.test(markdown);
  }
  let unsupported = false;
  visitMarkdownAst(root, (node) => {
    if (
      node.type === "html" &&
      node.value?.trimStart().startsWith("<!--")
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (
        start === undefined ||
        end === undefined ||
        !allowedMarkers.has(`${start}:${end}`)
      ) {
        unsupported = true;
      }
    }
  });
  return unsupported;
}

interface TocBlock {
  snapshot: TocMarkerSnapshot["blocks"][number];
  markerRanges: Array<[number, number]>;
}

interface RootMarkdownList {
  node: MarkdownAstNode;
  previousContext: string | null;
  nextContext: string | null;
}

function validTocBlocks(markdown: string): TocBlock[] {
  const root = markdownRoot(markdown);
  if (!root) {
    return [];
  }
  const rootLists = rootMarkdownLists(markdown, root);
  const blocks: TocBlock[] = [];
  const markerPattern =
    /^<!-- toc -->\r?\n([\s\S]*?)^<!-- \/toc -->\r?(?=\n|$)/gm;
  for (const match of markdown.matchAll(markerPattern)) {
    const bodyRoot = markdownRoot(match[1]);
    const bodyChildren = bodyRoot?.children ?? [];
    if (bodyChildren.length !== 1 || bodyChildren[0].type !== "list") {
      continue;
    }
    if (!isLinkOnlyTocList(bodyChildren[0])) {
      continue;
    }
    const links = markdownListLinks(bodyChildren[0]);
    if (links.length === 0) {
      continue;
    }
    const blockStart = match.index ?? 0;
    const closingOffset = match[0].lastIndexOf("<!-- /toc -->");
    const bodyStart = blockStart + match[0].indexOf(match[1]);
    const bodyEnd = blockStart + closingOffset;
    const listOrdinal = rootLists.findIndex((list) => {
      const start = list.node.position?.start.offset;
      const end = list.node.position?.end.offset;
      return (
        start !== undefined &&
        end !== undefined &&
        start >= bodyStart &&
        end <= bodyEnd
      );
    });
    if (listOrdinal < 0) {
      continue;
    }
    const list = rootLists[listOrdinal];
    blocks.push({
      snapshot: {
        links,
        items: listItemFingerprints(bodyChildren[0]),
        listOrdinal,
        itemOrdinal: rootLists
          .slice(0, listOrdinal)
          .reduce(
            (count, candidate) => count + listItems(candidate.node).length,
            0,
          ),
        rootListCount: rootLists.length,
        rootItemCount: rootListItemCount(rootLists),
        previousContext: list.previousContext,
        nextContext: list.nextContext,
      },
      markerRanges: [
        [blockStart, blockStart + "<!-- toc -->".length],
        [
          blockStart + closingOffset,
          blockStart + closingOffset + "<!-- /toc -->".length,
        ],
      ],
    });
  }
  return blocks;
}

function markdownRoot(markdown: string): MarkdownAstNode | null {
  try {
    return fromMarkdown(markdown) as MarkdownAstNode;
  } catch {
    return null;
  }
}

function rootMarkdownLists(
  markdown: string,
  parsedRoot = markdownRoot(markdown),
): RootMarkdownList[] {
  const children = parsedRoot?.children ?? [];
  return children.flatMap((node, index) =>
    node.type === "list"
      ? [
          {
            node,
            previousContext: neighboringBlockSignature(children, index, -1),
            nextContext: neighboringBlockSignature(children, index, 1),
          },
        ]
      : [],
  );
}

function neighboringBlockSignature(
  children: MarkdownAstNode[],
  index: number,
  direction: -1 | 1,
): string | null {
  for (
    let candidate = index + direction;
    candidate >= 0 && candidate < children.length;
    candidate += direction
  ) {
    if (isTocMarkerNode(children[candidate])) {
      continue;
    }
    return markdownBlockSignature(children[candidate]);
  }
  return null;
}

function isTocMarkerNode(node: MarkdownAstNode): boolean {
  return (
    node.type === "html" &&
    (node.value === "<!-- toc -->" || node.value === "<!-- /toc -->")
  );
}

function markdownBlockSignature(node: MarkdownAstNode): string {
  return `${node.type}:${markdownAstText(node).trim().slice(0, 256)}:${markdownListLinks(
    node,
  ).join("\u0000")}`;
}

function markdownAstText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  if (typeof node.alt === "string") {
    return node.alt;
  }
  return (node.children ?? []).map(markdownAstText).join("");
}

function sameTocContext(
  candidate: RootMarkdownList,
  block: TocMarkerSnapshot["blocks"][number],
): boolean {
  const hasContext =
    block.previousContext !== null || block.nextContext !== null;
  return (
    hasContext &&
    candidate.previousContext === block.previousContext &&
    candidate.nextContext === block.nextContext
  );
}

function verifiedTocMatch(
  candidate: RootMarkdownList,
  block: TocMarkerSnapshot["blocks"][number],
): boolean {
  const linksMatch = sameLinks(markdownListLinks(candidate.node), block.links);
  const hasContext =
    block.previousContext !== null || block.nextContext !== null;
  return linksMatch && (!hasContext || sameTocContext(candidate, block));
}

function markdownListLinks(list: MarkdownAstNode): string[] {
  const links: string[] = [];
  visitMarkdownAst(list, (node) => {
    if (node.type === "link" && node.url) {
      links.push(node.url);
    }
  });
  return links;
}

function listItemFingerprints(list: MarkdownAstNode): string[] {
  return listItems(list).map(
      (item) =>
        `${markdownAstText(item).trim()}\u0001${markdownListLinks(item).join(
          "\u0000",
        )}`,
  );
}

interface ClaimedListRange {
  listIndex: number;
  startItem: number;
  endItem: number;
}

function matchingTocSegments(
  lists: RootMarkdownList[],
  block: TocMarkerSnapshot["blocks"][number],
  claimed: ClaimedListRange[],
): Array<{
  listIndex: number;
  start: number;
  end: number;
  startItem: number;
  endItem: number;
  itemOrdinal: number;
}> {
  const matches: Array<{
    listIndex: number;
    start: number;
    end: number;
    startItem: number;
    endItem: number;
    itemOrdinal: number;
  }> = [];
  let precedingItems = 0;
  for (const [listIndex, list] of lists.entries()) {
    const items = listItems(list.node);
    const fingerprints = listItemFingerprints(list.node);
    for (
      let startIndex = 0;
      startIndex + block.items.length <= fingerprints.length;
      startIndex += 1
    ) {
      if (
        !isListRangeAvailable(
          claimed,
          listIndex,
          startIndex,
          startIndex + block.items.length,
        ) ||
        !block.items.every(
          (fingerprint, offset) =>
            fingerprint === fingerprints[startIndex + offset],
        )
      ) {
        continue;
      }
      const first = items[startIndex]?.position?.start.offset;
      const last =
        items[startIndex + block.items.length - 1]?.position?.end.offset;
      if (first !== undefined && last !== undefined) {
        matches.push({
          listIndex,
          start: first,
          end: last,
          startItem: startIndex,
          endItem: startIndex + block.items.length,
          itemOrdinal: precedingItems + startIndex,
        });
      }
    }
    precedingItems += items.length;
  }
  return matches;
}

function listItems(list?: MarkdownAstNode): MarkdownAstNode[] {
  return (list?.children ?? []).filter((child) => child.type === "listItem");
}

function rootListItemCount(lists: RootMarkdownList[]): number {
  return lists.reduce(
    (count, list) => count + listItems(list.node).length,
    0,
  );
}

function isListRangeAvailable(
  claimed: ClaimedListRange[],
  listIndex: number,
  startItem: number,
  endItem: number,
): boolean {
  return !claimed.some(
    (range) =>
      range.listIndex === listIndex &&
      startItem < range.endItem &&
      endItem > range.startItem,
  );
}

function isLinkOnlyTocList(list: MarkdownAstNode): boolean {
  return (
    list.type === "list" &&
    (list.children?.length ?? 0) > 0 &&
    (list.children ?? []).every(isLinkOnlyTocItem)
  );
}

function isLinkOnlyTocItem(item: MarkdownAstNode): boolean {
  if (item.type !== "listItem") {
    return false;
  }
  let linkParagraphs = 0;
  for (const child of item.children ?? []) {
    if (child.type === "list") {
      if (!isLinkOnlyTocList(child)) {
        return false;
      }
      continue;
    }
    if (child.type !== "paragraph") {
      return false;
    }
    const contents = child.children ?? [];
    if (
      contents.length !== 1 ||
      contents[0].type !== "link" ||
      !contents[0].url
    ) {
      return false;
    }
    linkParagraphs += 1;
  }
  return linkParagraphs === 1;
}

function sameLinks(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => link === right[index])
  );
}

interface MarkdownAstNode {
  type: string;
  url?: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownAstNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function containsUnsafeAngleSyntax(markdown: string): boolean {
  const matches = [
    ...markdown.matchAll(/<\/?[a-z][^<>]*>/gi),
    ...markdown.matchAll(/<![a-z][^<>]*>/gi),
    ...markdown.matchAll(
      /<(?:https?:\/\/|mailto:|tel:|[^<>\s]+@)[^<>\n]*>/gi,
    ),
    ...markdown.matchAll(/<[a-z][^<>\n]*(?=\n|$)/gi),
    ...markdown.matchAll(/<(?!\!--)[^<>\n]+>/g),
  ];
  if (!markdown.includes("<")) {
    return false;
  }
  try {
    const allowedRanges = new Set<string>();
    const literalRanges: Array<[number, number]> = [];
    const textRanges: Array<[number, number]> = [];
    const codeRanges: Array<[number, number]> = [];
    const literalHtmlOpenTags = new Set<string>();
    let unsafeHtml = false;
    visitMarkdownAst(fromMarkdown(markdown), (node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) {
        return;
      }
      if (node.type === "code" || node.type === "inlineCode") {
        codeRanges.push([start, end]);
      } else if (node.type === "text") {
        textRanges.push([start, end]);
      } else if (node.type === "link") {
        const range = angleLinkDestinationRange(markdown, node, start, end);
        if (range) {
          allowedRanges.add(`${range[0]}:${range[1]}`);
        }
      } else if (
        node.type === "html" &&
        node.value
      ) {
        if (node.value.trim().startsWith("<!--")) {
          return;
        }
        if (isRichSafeStandardMarkdownAngle(node.value)) {
          const value = node.value.trim();
          const closingTag = value.match(
            /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/,
          )?.[1]?.toLowerCase();
          if (closingTag && literalHtmlOpenTags.has(closingTag)) {
            unsafeHtml = true;
            return;
          }
          const openingTag = value.match(
            /^<([A-Za-z][A-Za-z0-9:-]*)\b/,
          )?.[1]?.toLowerCase();
          if (openingTag) {
            if (/\/\s*>$/.test(value)) {
              unsafeHtml = true;
              return;
            }
            literalHtmlOpenTags.add(openingTag);
          }
          literalRanges.push([start, end]);
        } else {
          unsafeHtml = true;
        }
      }
    });
    if (unsafeHtml) {
      return true;
    }
    const candidates = [
      ...new Map(
        matches
          .flatMap((match) =>
            match.index === undefined
              ? []
              : [{ index: match.index, value: match[0] }],
          )
          .map((match) => [
            `${match.index}:${match.value.length}`,
            match,
          ]),
      ).values(),
    ].sort((left, right) => left.index - right.index);
    if (candidates.length === 0) {
      return false;
    }
    const codeIndex = createRangeIndex(codeRanges);
    const literalIndex = createRangeIndex(literalRanges);
    const literalStarts = new Set(literalRanges.map(([start]) => start));
    const textIndex = createRangeIndex(textRanges);
    let scannedOffset = 0;
    let unclosedTagOffset = -1;
    for (const candidate of candidates) {
      while (scannedOffset < candidate.index) {
        const character = markdown[scannedOffset];
        if (character === "\n" || character === ">") {
          unclosedTagOffset = -1;
        } else if (
          character === "<" &&
          isPotentialTagStart(markdown, scannedOffset + 1)
        ) {
          unclosedTagOffset = scannedOffset;
        }
        scannedOffset += 1;
      }
      const candidateEnd = candidate.index + candidate.value.length;
      const range = `${candidate.index}:${candidateEnd}`;
      if (rangeContains(codeIndex, candidate.index, candidateEnd)) {
        continue;
      }
      if (allowedRanges.has(range)) {
        continue;
      }
      const literal =
        (rangeContains(literalIndex, candidate.index, candidateEnd) &&
          literalStarts.has(candidate.index)) ||
        (isRichSafeStandardMarkdownAngle(candidate.value) &&
          rangeContains(textIndex, candidate.index, candidateEnd));
      if (!literal || unclosedTagOffset >= 0) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function isPotentialTagStart(markdown: string, offset: number): boolean {
  const code = markdown.charCodeAt(offset);
  if (code === 47) {
    return isTagNameStartCode(markdown.charCodeAt(offset + 1));
  }
  return isTagNameStartCode(code);
}

function isTagNameStartCode(code: number): boolean {
  return (
    code === 36 ||
    code === 95 ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function containsEscapedAngleSyntax(markdown: string): boolean {
  if (!/\\+</.test(markdown)) {
    return false;
  }
  const protectedIndex = createRangeIndex(protectedMarkdownRanges(markdown));
  return [...markdown.matchAll(/\\+</g)].some((match) => {
    const angleOffset = (match.index ?? 0) + match[0].length - 1;
    return !rangeContains(protectedIndex, angleOffset, angleOffset + 1);
  });
}

interface RangeIndex {
  starts: number[];
  maxEnds: number[];
}

function createRangeIndex(ranges: Array<[number, number]>): RangeIndex {
  const sorted = [...ranges].sort(
    (left, right) => left[0] - right[0] || right[1] - left[1],
  );
  const starts: number[] = [];
  const maxEnds: number[] = [];
  let maxEnd = -1;
  for (const [start, end] of sorted) {
    starts.push(start);
    maxEnd = Math.max(maxEnd, end);
    maxEnds.push(maxEnd);
  }
  return { starts, maxEnds };
}

function rangeContains(
  index: RangeIndex,
  start: number,
  end: number,
): boolean {
  let low = 0;
  let high = index.starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.starts[middle] <= start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const candidate = low - 1;
  return candidate >= 0 && index.maxEnds[candidate] >= end;
}

function angleLinkDestinationRange(
  markdown: string,
  node: MarkdownAstNode,
  start: number,
  end: number,
): [number, number] | null {
  const source = markdown.slice(start, end);
  if (!source.startsWith("[")) {
    return null;
  }
  const ignoredRanges: Array<[number, number]> = [];
  collectLinkLabelIgnoredRanges(node, start, ignoredRanges);
  ignoredRanges.sort((left, right) => left[0] - right[0]);
  let ignoredIndex = 0;
  let depth = 1;
  for (let index = 1; index < source.length - 1; index += 1) {
    const ignored = ignoredRanges[ignoredIndex];
    if (ignored && index >= ignored[0]) {
      if (index < ignored[1]) {
        index = ignored[1] - 1;
        continue;
      }
      ignoredIndex += 1;
    }
    const character = source[index];
    if (
      (character !== "[" && character !== "]") ||
      isEscapedAt(source, index)
    ) {
      continue;
    }
    if (character === "[") {
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth !== 0 || source[index + 1] !== "(") {
      continue;
    }
    let destinationStart = index + 2;
    while (
      source[destinationStart] === " " ||
      source[destinationStart] === "\t"
    ) {
      destinationStart += 1;
    }
    if (source[destinationStart] !== "<") {
      return null;
    }
    const destinationEnd = source.indexOf(">", destinationStart + 1);
    if (
      destinationEnd < 0 ||
      source.slice(destinationStart + 1, destinationEnd).includes("\n")
    ) {
      return null;
    }
    const destination = source.slice(destinationStart + 1, destinationEnd);
    if (node.url !== undefined && destination !== node.url) {
      return null;
    }
    return [start + destinationStart, start + destinationEnd + 1];
  }
  return null;
}

function collectLinkLabelIgnoredRanges(
  node: MarkdownAstNode,
  linkStart: number,
  ranges: Array<[number, number]>,
) {
  for (const child of node.children ?? []) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (
      start !== undefined &&
      end !== undefined &&
      (child.type === "inlineCode" ||
        child.type === "html" ||
        child.type === "image" ||
        child.type === "imageReference")
    ) {
      ranges.push([start - linkStart, end - linkStart]);
      continue;
    }
    collectLinkLabelIgnoredRanges(child, linkStart, ranges);
  }
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function visitMarkdownAst(
  node: MarkdownAstNode,
  visit: (node: MarkdownAstNode) => void,
) {
  visit(node);
  for (const child of node.children ?? []) {
    visitMarkdownAst(child, visit);
  }
}


export interface MarkdownBoundaryWhitespace {
  leading: string;
  trailing: string;
}

export function captureMarkdownBoundaryWhitespace(
  markdown: string,
): MarkdownBoundaryWhitespace {
  if (!markdown.trim()) {
    return { leading: "", trailing: "" };
  }
  return {
    leading: markdown.match(/^\s*/)?.[0] ?? "",
    trailing: markdown.match(/\s*$/)?.[0] ?? "",
  };
}

export function restoreMarkdownBoundaryWhitespace(
  markdown: string,
  boundary: MarkdownBoundaryWhitespace,
): string {
  const content = markdown.trim();
  return content ? `${boundary.leading}${content}${boundary.trailing}` : "";
}

interface Fence {
  character: "`" | "~";
  length: number;
}

function isFenceLine(line: string): boolean {
  return /^ {0,3}(`{3,}|~{3,})/.test(line);
}

function updateFence(line: string, current: Fence | null): Fence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) {
    return current;
  }
  const marker = match[1];
  const character = marker[0] as Fence["character"];
  if (!current) {
    return { character, length: marker.length };
  }
  return current.character === character && marker.length >= current.length
    ? null
    : current;
}

function isIndentedCode(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function normalizedRenderedHref(value: string): string {
  if (/^[/.#]/.test(value)) {
    return value;
  }
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
    ).href.replace(/\/$/, "");
  } catch {
    return value;
  }
}
