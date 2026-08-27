import type { HeadingItem } from "../types";

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
  const pattern = /(^|[\s([{'""])#([\p{L}\p{N}_/-]+)/gu;
  for (const match of markdown.matchAll(pattern)) {
    tags.add(match[2].toLocaleLowerCase());
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
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
    /<\/?[a-z][^>]*>/i.test(markdown) ||
    /(^|\n)\s{0,3}\[[^\]]+\]:\s+\S+/m.test(markdown) ||
    /(^|\n)\s*\$\$[\s\S]*?\$\$/m.test(markdown) ||
    /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(markdown)
  );
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
