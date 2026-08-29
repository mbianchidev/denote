import { fromMarkdown } from "mdast-util-from-markdown";
import { hasUriScheme } from "./links";

interface MarkdownNode {
  type: string;
  url?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

export interface AvailablePathIndex {
  exact: Set<string>;
  folded: Map<string, string | null>;
}

export function rewriteMarkdownLinksAfterMove(
  markdown: string,
  oldSourcePath: string,
  newSourcePath: string,
  oldPath: string,
  newPath: string,
  availablePaths: string[] | AvailablePathIndex,
): string {
  if (markdown.startsWith("\uFEFF")) {
    return `\uFEFF${rewriteMarkdownLinksAfterMove(
      markdown.slice(1),
      oldSourcePath,
      newSourcePath,
      oldPath,
      newPath,
      availablePaths,
    )}`;
  }
  const available = Array.isArray(availablePaths)
    ? createAvailablePathIndex(availablePaths)
    : availablePaths;
  const frontmatterEnd = yamlFrontmatterEnd(markdown);
  const edits: Edit[] = [];
  visit(fromMarkdown(markdown), (node) => {
    if (
      !node.url ||
      !["link", "image", "definition"].includes(node.type) ||
      !node.position
    ) {
      return;
    }
    if ((node.position.start.offset ?? 0) < frontmatterEnd) {
      return;
    }
    const resolved = resolveVaultTarget(oldSourcePath, node.url, available);
    if (!resolved) {
      return;
    }
    const targetPath = rekeyMovedPath(resolved.path, oldPath, newPath);
    if (oldSourcePath === newSourcePath && resolved.path === targetPath) {
      return;
    }
    const range = markdownUrlRange(markdown, node);
    if (!range) {
      return;
    }
    const source = markdown.slice(range.start, range.end);
    const absolute = resolved.absolute;
    const nextPath = absolute
      ? `/${targetPath}`
      : relativeVaultPath(newSourcePath, targetPath);
    const nextUrl = `${encodeLinkPath(
      nextPath,
      source.startsWith("<"),
    )}${rawLinkSuffix(source)}`;
    edits.push({
      start: range.start,
      end: range.end,
      replacement: source.startsWith("<") ? `<${nextUrl}>` : nextUrl,
    });
  });
  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (content, edit) =>
        `${content.slice(0, edit.start)}${edit.replacement}${content.slice(edit.end)}`,
      markdown,
    );
}

function rawLinkSuffix(source: string): string {
  const value = source.startsWith("<") ? source.slice(1, -1) : source;
  const index = [value.indexOf("?"), value.indexOf("#")]
    .filter((candidate) => candidate >= 0)
    .sort((left, right) => left - right)[0];
  return index === undefined ? "" : value.slice(index);
}

export function rekeyMovedPath(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  return path === oldPath || path.startsWith(`${oldPath}/`)
    ? `${newPath}${path.slice(oldPath.length)}`
    : path;
}

export function oldPathBeforeMove(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  return path === newPath || path.startsWith(`${newPath}/`)
    ? `${oldPath}${path.slice(newPath.length)}`
    : path;
}

function resolveVaultTarget(
  sourcePath: string,
  href: string,
  available: AvailablePathIndex,
): { path: string; suffix: string; absolute: boolean } | null {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    hasUriScheme(href)
  ) {
    return null;
  }
  const suffixIndex = [href.indexOf("?"), href.indexOf("#")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const rawPath = suffixIndex === undefined ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === undefined ? "" : href.slice(suffixIndex);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const absolute = decoded.startsWith("/");
  const base = absolute ? [] : sourcePath.split("/").slice(0, -1);
  const normalized = normalizeSegments([
    ...base,
    ...decoded.replace(/^\/+/, "").split("/"),
  ]);
  if (!normalized) {
    return null;
  }
  const candidate = normalized.join("/");
  const candidates = /\.[^/]+$/.test(candidate)
    ? [candidate]
    : [candidate, `${candidate}.md`, `${candidate}.markdown`, `${candidate}.txt`];
  const path =
    candidates.find((value) => available.exact.has(value)) ??
    candidates
      .map((value) => available.folded.get(value.toLocaleLowerCase()))
      .find((value): value is string => typeof value === "string");
  return path ? { path, suffix, absolute } : null;
}

export function createAvailablePathIndex(
  paths: string[],
): AvailablePathIndex {
  const exact = new Set(paths);
  const folded = new Map<string, string | null>();
  for (const path of paths) {
    const key = path.toLocaleLowerCase();
    folded.set(key, folded.has(key) ? null : path);
  }
  return { exact, folded };
}

function yamlFrontmatterEnd(markdown: string): number {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return 0;
  }
  const match = /(?:^|\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  match.lastIndex = markdown.startsWith("---\r\n") ? 5 : 4;
  const closing = match.exec(markdown);
  return closing ? closing.index + closing[0].length : 0;
}

function normalizeSegments(segments: string[]): string[] | null {
  const normalized: string[] = [];
  for (const segment of segments) {
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
  return normalized;
}

function relativeVaultPath(sourcePath: string, targetPath: string): string {
  const source = sourcePath.split("/").slice(0, -1);
  const target = targetPath.split("/");
  let common = 0;
  while (source[common] === target[common] && common < source.length) {
    common += 1;
  }
  return [
    ...Array.from({ length: source.length - common }, () => ".."),
    ...target.slice(common),
  ].join("/");
}

function encodeLinkPath(path: string, angleBracket: boolean): string {
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return angleBracket ? encoded.replace(/%20/g, " ") : encoded;
}

function markdownUrlRange(
  markdown: string,
  node: MarkdownNode,
): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return null;
  }
  const source = markdown.slice(start, end);
  return node.type === "definition"
    ? definitionUrlRange(source, start)
    : inlineUrlRange(source, node, start);
}

function definitionUrlRange(
  source: string,
  absoluteStart: number,
): { start: number; end: number } | null {
  let labelEnd = -1;
  for (let index = 1; index < source.length - 1; index += 1) {
    if (
      source[index] === "]" &&
      source[index + 1] === ":" &&
      !isEscapedAt(source, index)
    ) {
      labelEnd = index;
      break;
    }
  }
  if (labelEnd < 0) {
    return null;
  }
  let start = labelEnd + 2;
  while (/\s/.test(source[start] ?? "")) {
    start += 1;
  }
  if (source[start] === "<") {
    const end = findUnescaped(source, ">", start + 1);
    return end < 0
      ? null
      : { start: absoluteStart + start, end: absoluteStart + end + 1 };
  }
  let end = start;
  while (
    end < source.length &&
    !/\s/.test(source[end])
  ) {
    end += 1;
  }
  return end > start
    ? { start: absoluteStart + start, end: absoluteStart + end }
    : null;
}

function inlineUrlRange(
  source: string,
  node: MarkdownNode,
  absoluteStart: number,
): { start: number; end: number } | null {
  const labelStart = source.startsWith("![") ? 2 : source.startsWith("[") ? 1 : -1;
  if (labelStart < 0) {
    return null;
  }
  const ignored: Array<[number, number]> = [];
  collectIgnored(node, absoluteStart, ignored);
  ignored.sort((left, right) => left[0] - right[0]);
  let ignoredIndex = 0;
  let depth = 1;
  for (let index = labelStart; index < source.length - 1; index += 1) {
    const range = ignored[ignoredIndex];
    if (range && index >= range[0]) {
      if (index < range[1]) {
        index = range[1] - 1;
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
    let start = index + 2;
    while (/\s/.test(source[start] ?? "")) {
      start += 1;
    }
    if (source[start] === "<") {
      const end = findUnescaped(source, ">", start + 1);
      return end < 0
        ? null
        : { start: absoluteStart + start, end: absoluteStart + end + 1 };
    }

    let end = start;
    let parentheses = 0;
    while (end < source.length) {
      const current = source[end];
      if (current === "\\" && end + 1 < source.length) {
        end += 2;
        continue;
      }
      if (current === "(") {
        parentheses += 1;
      } else if (current === ")") {
        if (parentheses === 0) {
          break;
        }
        parentheses -= 1;
      } else if (
        parentheses === 0 &&
        [" ", "\t", "\n", "\r"].includes(current)
      ) {
        break;
      }
      end += 1;
    }
    return end > start
      ? { start: absoluteStart + start, end: absoluteStart + end }
      : null;
  }
  return null;
}

function findUnescaped(
  value: string,
  character: string,
  start: number,
): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === character && !isEscapedAt(value, index)) {
      return index;
    }
  }
  return -1;
}

function collectIgnored(
  node: MarkdownNode,
  absoluteStart: number,
  ranges: Array<[number, number]>,
) {
  for (const child of node.children ?? []) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (
      start !== undefined &&
      end !== undefined &&
      ["inlineCode", "html", "image", "imageReference"].includes(child.type)
    ) {
      ranges.push([start - absoluteStart, end - absoluteStart]);
      continue;
    }
    collectIgnored(child, absoluteStart, ranges);
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

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void) {
  callback(node);
  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}
