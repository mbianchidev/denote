import { fromMarkdown } from "mdast-util-from-markdown";

const HTML_TAG_NAMES = new Set(
  "a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blink blockquote body br button canvas caption center cite code col colgroup command content data datalist dd del details dfn dialog dir div dl dt element em embed fencedframe fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image img input ins kbd keygen label legend li link listing main map mark marquee math menu menuitem meta meter multicol nav nextid nobr noembed noframes noscript object ol optgroup option output p param picture plaintext portal pre progress q rb rp rt rtc ruby s samp script search section select shadow slot small source spacer span strike strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr xmp".split(
    " ",
  ),
);

type AngleKind = "autolink" | "component" | "html" | "literal";

export function isRichSafeStandardMarkdownAngle(value: string): boolean {
  if (!value.startsWith("<")) {
    return false;
  }
  const next = value.codePointAt(1);
  if (next === undefined || next === 33 || next === 63 || next === 62) {
    return false;
  }
  const body = angleBody(value);
  const kind = angleKind(body);
  if (
    kind === "autolink" ||
    body.includes("<") ||
    /[\r\n="'`]/.test(value) ||
    /\/\s*>$/.test(value)
  ) {
    return false;
  }
  const safeBody =
    /^\/?[\p{L}\p{N}][\p{L}\p{N} .:/+_-]*$/u.test(body);
  if (next !== 47 && !isNameStart(next)) {
    return safeBody;
  }
  return kind === "literal" && safeBody;
}

export function hasIncompleteStandardMarkdownAngle(
  markdown: string,
): boolean {
  const protectedIndex = createRangeIndex(markdownCodeRanges(markdown));
  for (const match of markdown.matchAll(
    /<\/?[A-Za-z][^<>\n]*(?=\r?$)/gm,
  )) {
    const start = match.index ?? 0;
    if (!rangeContains(protectedIndex, start, start + match[0].length)) {
      return true;
    }
  }
  return false;
}

export function restoreStandardMarkdownAngles(
  markdown: string,
  originalMarkdown: string,
): string {
  const originalCounts = new Map<string, number[]>();
  for (const occurrence of markdownAngleOccurrences(originalMarkdown)) {
    const counts = originalCounts.get(occurrence.token) ?? [];
    counts.push(occurrence.slashCount);
    originalCounts.set(occurrence.token, counts);
  }
  let restored = "";
  let cursor = 0;
  for (const occurrence of markdownAngleOccurrences(markdown)) {
    const counts = originalCounts.get(occurrence.token);
    let slashCount: number;
    if (counts && counts.length > 0) {
      const previousSlashCount = counts.shift()!;
      const expectedSerializedCount = previousSlashCount + 1;
      slashCount = Math.max(
        0,
        previousSlashCount +
          occurrence.slashCount -
          expectedSerializedCount,
      );
    } else {
      slashCount =
        occurrence.slashCount % 2 === 1
          ? occurrence.slashCount - 1
          : occurrence.slashCount;
    }
    restored += markdown.slice(cursor, occurrence.slashStart);
    restored += "\\".repeat(slashCount);
    cursor = occurrence.angleOffset;
  }
  return restored + markdown.slice(cursor);
}

interface MarkdownAngleOccurrence {
  slashStart: number;
  angleOffset: number;
  slashCount: number;
  token: string;
}

function markdownAngleOccurrences(markdown: string): MarkdownAngleOccurrence[] {
  const protectedRanges = markdownCodeRanges(markdown);
  const protectedRangeIndex = createRangeIndex(protectedRanges);
  const occurrences: MarkdownAngleOccurrence[] = [];
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const lineBreak = markdown.indexOf("\n", lineStart);
    const lineEnd = lineBreak >= 0 ? lineBreak : markdown.length;
    let searchOffset = lineStart;
    while (searchOffset < lineEnd) {
      const angleOffset = markdown.indexOf("<", searchOffset);
      if (angleOffset < 0 || angleOffset >= lineEnd) {
        break;
      }
      if (
        markdown.startsWith("<!--", angleOffset) ||
        rangeContains(protectedRangeIndex, angleOffset, angleOffset + 1)
      ) {
        searchOffset = angleOffset + 1;
        continue;
      }
      let slashStart = angleOffset;
      while (slashStart > lineStart && markdown[slashStart - 1] === "\\") {
        slashStart -= 1;
      }
      const close = markdown.indexOf(">", angleOffset + 1);
      let tokenEnd =
        close >= 0 && close < lineEnd ? close + 1 : angleOffset + 1;
      if (tokenEnd === angleOffset + 1) {
        while (
          tokenEnd < lineEnd &&
          !/[\s,;:!?|)]/.test(markdown[tokenEnd])
        ) {
          tokenEnd += 1;
        }
      }
      occurrences.push({
        slashStart,
        angleOffset,
        slashCount: angleOffset - slashStart,
        token: markdown.slice(angleOffset, tokenEnd) || "<",
      });
      searchOffset = Math.max(angleOffset + 1, tokenEnd);
    }
    lineStart = lineBreak >= 0 ? lineBreak + 1 : markdown.length;
  }
  return occurrences;
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

function angleBody(value: string): string {
  const close = value.indexOf(">");
  return value.slice(1, close >= 0 ? close : undefined);
}

function angleKind(body: string): AngleKind {
  const nameBody = body.startsWith("/") ? body.slice(1) : body;
  if (
    /^[a-z][a-z\d+.-]*:[^\s]+$/i.test(nameBody) ||
    /^[^\s@]+@[^\s@]+$/.test(nameBody)
  ) {
    return "autolink";
  }
  const name = nameBody.match(/^([A-Za-z_$][\w$.-]*)/)?.[1];
  if (!name) {
    return "literal";
  }
  if (/^[A-Z$_]/.test(name)) {
    return "component";
  }
  return HTML_TAG_NAMES.has(name.toLowerCase()) ? "html" : "literal";
}

function isNameStart(code: number): boolean {
  return (
    code === 36 ||
    code === 95 ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function markdownCodeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const frontmatter = markdown.match(
    /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?=\r?\n|$)/,
  );
  if (frontmatter) {
    ranges.push([0, frontmatter[0].length]);
  }
  visitMarkdown(fromMarkdown(markdown), (node) => {
    if (node.type !== "code" && node.type !== "inlineCode") {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      ranges.push([start, end]);
    }
  });
  return ranges;
}

interface PositionedMarkdownNode {
  type: string;
  children?: PositionedMarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function visitMarkdown(
  node: PositionedMarkdownNode,
  callback: (node: PositionedMarkdownNode) => void,
) {
  callback(node);
  for (const child of node.children ?? []) {
    visitMarkdown(child, callback);
  }
}
