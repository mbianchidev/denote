const EXTERNAL_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isExternalLink(href: string): boolean {
  return EXTERNAL_SCHEME.test(href) || href.startsWith("//");
}

export function externalLinkTarget(href: string): string {
  return href.startsWith("//") ? `https:${href}` : href;
}

export function hasUriScheme(href: string): boolean {
  return URI_SCHEME.test(href);
}

export function shouldOpenLinkOnClick(
  href: string,
  modifierPressed: boolean,
): boolean {
  return (
    modifierPressed || isExternalLink(href) || href.startsWith("file://")
  );
}
