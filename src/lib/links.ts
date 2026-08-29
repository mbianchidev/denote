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

export function shouldOpenLinkOnClick(
  href: string,
  _modifierPressed: boolean,
): boolean {
  return href.trim().length > 0;
}
