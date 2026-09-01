import { fromMarkdown } from "mdast-util-from-markdown";

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const INLINE_TAGS = new Set(["a", "strong", "img"]);
const ROOT_TAGS = new Set([...BLOCK_TAGS, "img"]);
const ALIGNMENTS = new Set(["left", "center", "right"]);
const BLOCKED_LINK_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "javascript",
  "vbscript",
]);
const MAX_IMAGE_DIMENSION = 4096;

export type SafeRichHtmlAlignment = "left" | "center" | "right";

export type SafeRichHtmlInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: SafeRichHtmlInline[] }
  | { type: "link"; href: string; children: SafeRichHtmlInline[] }
  | {
      type: "image";
      src: string;
      alt: string;
      title?: string;
      width?: number;
      height?: number;
      remote: boolean;
    };

export type SafeRichHtmlModel =
  | {
      type: "block";
      tag: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      align?: SafeRichHtmlAlignment;
      children: SafeRichHtmlInline[];
    }
  | {
      type: "image";
      image: Extract<SafeRichHtmlInline, { type: "image" }>;
    };

export interface SafeRichHtmlRange {
  start: number;
  end: number;
  raw: string;
  model: SafeRichHtmlModel;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

interface OpenElement {
  tag: string;
  meaningful: boolean;
}

export function parseSafeRichHtml(raw: string): SafeRichHtmlModel | null {
  if (!validateHtmlSyntax(raw) || typeof DOMParser === "undefined") {
    return null;
  }
  const document = new DOMParser().parseFromString(raw, "text/html");
  const roots = [...document.body.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
  );
  if (
    roots.length !== 1 ||
    !(roots[0] instanceof HTMLElement) ||
    !ROOT_TAGS.has(roots[0].localName)
  ) {
    return null;
  }
  if (roots[0].localName === "img") {
    const image = parseImage(roots[0]);
    return image ? { type: "image", image } : null;
  }
  return parseBlock(roots[0]);
}

export function safeRichHtmlRanges(markdown: string): SafeRichHtmlRange[] {
  let root: MarkdownNode;
  try {
    root = fromMarkdown(markdown) as MarkdownNode;
  } catch {
    return [];
  }
  const ranges: SafeRichHtmlRange[] = [];
  visitMarkdown(root, (node) => {
    if (node.type !== "html" || node.value === undefined) {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return;
    }
    const model = parseSafeRichHtml(node.value);
    if (model) {
      ranges.push({ start, end, raw: node.value, model });
    }
  });
  return ranges;
}

export function maskSafeRichHtml(markdown: string): string {
  const ranges = safeRichHtmlRanges(markdown);
  if (ranges.length === 0) {
    return markdown;
  }
  let masked = "";
  let cursor = 0;
  for (const range of ranges) {
    masked += markdown.slice(cursor, range.start);
    masked += markdown
      .slice(range.start, range.end)
      .replace(/[^\r\n]/g, " ");
    cursor = range.end;
  }
  return masked + markdown.slice(cursor);
}

export function isSafeRichHtmlLinkHref(href: string): boolean {
  if (!isCleanUrlValue(href)) {
    return false;
  }
  if (href.startsWith("//")) {
    return true;
  }
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (!scheme) {
    return true;
  }
  if (BLOCKED_LINK_SCHEMES.has(scheme)) {
    return false;
  }
  if (scheme !== "file") {
    return true;
  }
  try {
    const url = new URL(href);
    return url.protocol === "file:" && url.host === "";
  } catch {
    return false;
  }
}

export function isSafeRichHtmlImageSrc(src: string): boolean {
  if (!isCleanUrlValue(src)) {
    return false;
  }
  if (/^https?:\/\//i.test(src)) {
    return true;
  }
  return (
    !src.startsWith("//") &&
    !src.startsWith("/") &&
    !src.startsWith("\\") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(src)
  );
}

function validateHtmlSyntax(raw: string): boolean {
  const stack: OpenElement[] = [];
  let rootCount = 0;
  let offset = 0;
  while (offset < raw.length) {
    if (raw[offset] !== "<") {
      const next = raw.indexOf("<", offset);
      const end = next < 0 ? raw.length : next;
      const text = raw.slice(offset, end);
      if (/[{}]/.test(text)) {
        return false;
      }
      if (stack.length === 0) {
        if (text.trim()) {
          return false;
        }
      } else if (text.trim()) {
        stack[stack.length - 1].meaningful = true;
      }
      offset = end;
      continue;
    }

    const token = readTag(raw, offset);
    if (!token) {
      return false;
    }
    offset = token.end;
    if (token.closing) {
      const current = stack.pop();
      if (!current || current.tag !== token.tag || !current.meaningful) {
        return false;
      }
      if (stack.length > 0) {
        stack[stack.length - 1].meaningful = true;
      }
      continue;
    }

    if (!isAllowedNesting(stack[stack.length - 1]?.tag, token.tag)) {
      return false;
    }
    if (stack.length === 0) {
      rootCount += 1;
      if (rootCount > 1 || !ROOT_TAGS.has(token.tag)) {
        return false;
      }
    }
    if (token.tag === "img") {
      if (stack.length > 0) {
        stack[stack.length - 1].meaningful = true;
      }
      continue;
    }
    if (token.selfClosing) {
      return false;
    }
    stack.push({ tag: token.tag, meaningful: false });
  }
  return stack.length === 0 && rootCount === 1;
}

function readTag(
  raw: string,
  start: number,
): {
  tag: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
} | null {
  let cursor = start + 1;
  let quote = "";
  while (cursor < raw.length) {
    const character = raw[cursor];
    if (quote) {
      if (character === quote) {
        quote = "";
      } else if (character === "<" || character === "{" || character === "}") {
        return null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      break;
    } else if (character === "<" || character === "{" || character === "}") {
      return null;
    }
    cursor += 1;
  }
  if (cursor >= raw.length || quote) {
    return null;
  }
  const source = raw.slice(start + 1, cursor);
  const closing = source.startsWith("/");
  const content = closing ? source.slice(1) : source;
  const tagMatch = /^([a-z][a-z0-9]*)/.exec(content);
  if (!tagMatch) {
    return null;
  }
  const tag = tagMatch[1];
  if (!BLOCK_TAGS.has(tag) && !INLINE_TAGS.has(tag)) {
    return null;
  }
  let rest = content.slice(tag.length);
  if (closing) {
    if (!/^\s*$/.test(rest) || tag === "img") {
      return null;
    }
    return { tag, closing: true, selfClosing: false, end: cursor + 1 };
  }
  const selfClosing = /\/\s*$/.test(rest);
  if (selfClosing) {
    rest = rest.replace(/\/\s*$/, "");
  }
  const attributes = new Set<string>();
  while (rest.length > 0) {
    if (/^\s*$/.test(rest)) {
      break;
    }
    const attribute = /^\s+([a-z][a-z0-9-]*)\s*=\s*(["'])(.*?)\2/s.exec(
      rest,
    );
    if (!attribute) {
      return null;
    }
    const name = attribute[1];
    if (
      attributes.has(name) ||
      name.startsWith("on") ||
      !allowedAttributes(tag).has(name)
    ) {
      return null;
    }
    attributes.add(name);
    rest = rest.slice(attribute[0].length);
  }
  return { tag, closing: false, selfClosing, end: cursor + 1 };
}

function isAllowedNesting(parent: string | undefined, child: string): boolean {
  if (!parent) {
    return ROOT_TAGS.has(child);
  }
  if (BLOCK_TAGS.has(parent)) {
    return INLINE_TAGS.has(child);
  }
  if (parent === "a") {
    return child === "strong" || child === "img";
  }
  return false;
}

function parseBlock(
  element: HTMLElement,
): Extract<SafeRichHtmlModel, { type: "block" }> | null {
  const tag = element.localName as Extract<
    SafeRichHtmlModel,
    { type: "block" }
  >["tag"];
  const allowed = allowedAttributes(tag);
  if (!attributesAreAllowed(element, allowed)) {
    return null;
  }
  const alignValue = element.getAttribute("align");
  if (alignValue !== null && !ALIGNMENTS.has(alignValue)) {
    return null;
  }
  const children = parseChildren(element);
  if (!children || !hasMeaningfulContent(children)) {
    return null;
  }
  return {
    type: "block",
    tag,
    ...(alignValue
      ? { align: alignValue as SafeRichHtmlAlignment }
      : {}),
    children,
  };
}

function parseChildren(element: HTMLElement): SafeRichHtmlInline[] | null {
  const children: SafeRichHtmlInline[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      children.push({ type: "text", value: node.textContent ?? "" });
      continue;
    }
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const tag = node.localName;
    if (!isAllowedNesting(element.localName, tag)) {
      return null;
    }
    if (tag === "img") {
      const image = parseImage(node);
      if (!image) {
        return null;
      }
      children.push(image);
      continue;
    }
    if (!attributesAreAllowed(node, allowedAttributes(tag))) {
      return null;
    }
    const nested = parseChildren(node);
    if (!nested || !hasMeaningfulContent(nested)) {
      return null;
    }
    if (tag === "strong") {
      children.push({ type: "strong", children: nested });
    } else if (tag === "a") {
      const href = node.getAttribute("href");
      if (href === null || !isSafeRichHtmlLinkHref(href)) {
        return null;
      }
      children.push({ type: "link", href, children: nested });
    } else {
      return null;
    }
  }
  return children;
}

function parseImage(
  element: HTMLElement,
): Extract<SafeRichHtmlInline, { type: "image" }> | null {
  if (!attributesAreAllowed(element, allowedAttributes("img"))) {
    return null;
  }
  const src = element.getAttribute("src");
  const alt = element.getAttribute("alt");
  if (src === null || alt === null || !isSafeRichHtmlImageSrc(src)) {
    return null;
  }
  const width = parseDimension(element.getAttribute("width"));
  const height = parseDimension(element.getAttribute("height"));
  if (width === null || height === null) {
    return null;
  }
  const title = element.getAttribute("title");
  return {
    type: "image",
    src,
    alt,
    ...(title === null ? {} : { title }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    remote: /^https?:\/\//i.test(src),
  };
}

function parseDimension(value: string | null): number | undefined | null {
  if (value === null) {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const dimension = Number(value);
  return dimension <= MAX_IMAGE_DIMENSION ? dimension : null;
}

function attributesAreAllowed(
  element: HTMLElement,
  allowed: Set<string>,
): boolean {
  return [...element.attributes].every(
    (attribute) =>
      allowed.has(attribute.name) && !attribute.name.startsWith("on"),
  );
}

function allowedAttributes(tag: string): Set<string> {
  if (BLOCK_TAGS.has(tag)) {
    return new Set(["align"]);
  }
  if (tag === "a") {
    return new Set(["href"]);
  }
  if (tag === "img") {
    return new Set(["src", "alt", "title", "width", "height"]);
  }
  return new Set();
}

function hasMeaningfulContent(children: SafeRichHtmlInline[]): boolean {
  return children.some(
    (child) => child.type !== "text" || child.value.trim().length > 0,
  );
}

function isCleanUrlValue(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function visitMarkdown(
  node: MarkdownNode,
  callback: (node: MarkdownNode) => void,
) {
  callback(node);
  for (const child of node.children ?? []) {
    visitMarkdown(child, callback);
  }
}
