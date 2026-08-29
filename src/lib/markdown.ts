import { fromMarkdown } from "mdast-util-from-markdown";
import type { HeadingItem } from "../types";
import { normalizeTag } from "./tagColors";

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
  const headings: HeadingItem[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    const text = match[2].replace(/[*_`~[\]]/g, "").trim();
    headings.push({
      depth: match[1].length,
      text,
      slug: slugifyHeading(text),
    });
  }
  return headings;
}

export function slugifyHeading(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
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

  const decoded = decodeURIComponent(href);
  const [rawPath, anchor] = decoded.split("#", 2);
  if (!rawPath) {
    return { path: currentPath, anchor: anchor || null };
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
  const path = availablePaths.find((available) =>
    candidates.some(
      (value) => value.toLocaleLowerCase() === available.toLocaleLowerCase(),
    ),
  );
  return path ? { path, anchor: anchor || null } : null;
}

export function recoverMarkdownLinkTarget(
  markdown: string,
  linkText: string,
  renderedHref: string,
): string | null {
  const normalizedText = linkText.trim();
  const pattern =
    /\[([^\]]+)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const text = match[1].replace(/[*_`~]/g, "").trim();
    const target = match[2].replace(/^<|>$/g, "");
    if (text !== normalizedText || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    if (normalizedRenderedHref(target) === normalizedRenderedHref(renderedHref)) {
      return target;
    }
  }
  return null;
}

export function hasUnsupportedRichMarkdown(markdown: string): boolean {
  return (
    /(^|\n)\[\^[^\]]+\]:/m.test(markdown) ||
    /\[\^[^\]]+\]/.test(markdown) ||
    /<!--[\s\S]*?-->/.test(markdown) ||
    containsUnsafeAngleSyntax(markdown) ||
    /(^|\n)\s{0,3}\[[^\]]+\]:\s+\S+/m.test(markdown) ||
    /(^|\n)\s*\$\$[\s\S]*?\$\$/m.test(markdown) ||
    /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(markdown) ||
    /\\#(?=[\p{L}\p{N}\p{M}_/-])/u.test(markdown)
  );
}

interface MarkdownAstNode {
  type: string;
  url?: string;
  children?: MarkdownAstNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function containsUnsafeAngleSyntax(markdown: string): boolean {
  const candidates = [
    ...markdown.matchAll(/<\/?[a-z][^<>]*>/gi),
    ...markdown.matchAll(/<![a-z][^<>]*>/gi),
    ...markdown.matchAll(
      /<(?:https?:\/\/|mailto:|tel:|[^<>\s]+@)[^<>\n]*>/gi,
    ),
    ...markdown.matchAll(/<[a-z][^<>\n]*(?=\n|$)/gi),
  ];
  if (candidates.length === 0) {
    return false;
  }
  try {
    const allowedRanges = new Set<string>();
    visitMarkdownAst(fromMarkdown(markdown), (node) => {
      if (node.type !== "link") {
        return;
      }
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) {
        return;
      }
      const range = angleLinkDestinationRange(markdown, node, start, end);
      if (range) {
        allowedRanges.add(`${range[0]}:${range[1]}`);
      }
    });
    return candidates.some(
      (candidate) =>
        candidate.index === undefined ||
        !allowedRanges.has(
          `${candidate.index}:${candidate.index + candidate[0].length}`,
        ),
    );
  } catch {
    return true;
  }
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
