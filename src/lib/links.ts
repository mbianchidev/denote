import { fromMarkdown } from "mdast-util-from-markdown";

const WEB_SCHEME = /^(?:https?:)/i;
const EXTERNAL_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCKED_SCHEME = /^(?:javascript|data|vbscript|blob|about):/i;

export function isExternalLink(href: string): boolean {
  return EXTERNAL_SCHEME.test(href) || href.startsWith("//");
}

export function isWebLink(href: string): boolean {
  return WEB_SCHEME.test(href) || href.startsWith("//");
}

export function externalLinkTarget(href: string): string {
  if (href.startsWith("//")) {
    return `https:${href}`;
  }
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i);
  return scheme
    ? `${scheme[1].toLowerCase()}:${href.slice(scheme[0].length)}`
    : href;
}

export function implicitHttpsTarget(href: string): string | null {
  const target = href.trim();
  if (
    !target ||
    target.startsWith("/") ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("#") ||
    target.startsWith("?") ||
    target.includes("\\")
  ) {
    return null;
  }

  const authority = target.split(/[/?#]/, 1)[0];
  const portQualifiedHost =
    /^(?:localhost|(?:[^:]+\.)+[^:]+|\[[^\]]+\]):\d+$/i.test(authority);
  if (hasUriScheme(target) && !portQualifiedHost) {
    return null;
  }
  if (!authority || authority.includes("@")) {
    return null;
  }

  const hostname = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.replace(/:\d+$/, "");
  if (
    hostname.toLowerCase() !== "localhost" &&
    !hostname.includes(".") &&
    !(hostname.startsWith("[") && hostname.endsWith("]"))
  ) {
    return null;
  }

  try {
    const url = new URL(`https://${target}`);
    return url.hostname && !url.username && !url.password
      ? `https://${target}`
      : null;
  } catch {
    return null;
  }
}

export function hasUriScheme(href: string): boolean {
  return URI_SCHEME.test(href);
}

export function isBlockedExternalScheme(href: string): boolean {
  return BLOCKED_SCHEME.test(href);
}

export function isLocalFileUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "file:" && url.host === "";
  } catch {
    return false;
  }
}

export function extractWebLinks(markdown: string): string[] {
  const links = new Set<string>();
  try {
    const definitions = new Map<string, string>();
    const candidates: Array<
      { kind: "url"; value: string } | { kind: "reference"; value: string }
    > = [];
    visitMarkdown(fromMarkdown(markdown), (node) => {
      if (node.type === "link" && node.url && isWebLink(node.url)) {
        candidates.push({ kind: "url", value: node.url });
      } else if (node.type === "definition" && node.identifier && node.url) {
        const identifier = normalizeIdentifier(node.identifier);
        if (!definitions.has(identifier)) {
          definitions.set(identifier, node.url);
        }
      } else if (node.type === "linkReference" && node.identifier) {
        candidates.push({
          kind: "reference",
          value: normalizeIdentifier(node.identifier),
        });
      }
    });
    for (const candidate of candidates) {
      const url =
        candidate.kind === "url"
          ? candidate.value
          : definitions.get(candidate.value);
      if (url && isWebLink(url)) {
        links.add(externalLinkTarget(url));
      }
    }
  } catch {
    return [];
  }
  return [...links];
}

export function shouldOpenLinkOnClick(
  href: string,
  _modifierPressed: boolean,
): boolean {
  return href.trim().length > 0;
}

interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
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
