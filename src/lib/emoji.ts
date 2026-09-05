import type {
  PluginEmojiEntry,
  PluginEmojiPicker,
} from "@denote/plugin-sdk";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes, Root } from "mdast";

export const MAX_EMOJI_SHORTCODE_LENGTH = 80;

export type EmojiContribution = PluginEmojiPicker & { pluginId: string };
export interface EmojiMatch {
  entry: PluginEmojiEntry;
  unicode: string;
  name: string;
}

export class EmojiIndex {
  readonly byUnicode = new Map<string, EmojiMatch>();
  readonly categories: string[];
  private readonly searchRows: { entry: PluginEmojiEntry; text: string }[];
  private readonly prefixes = new Map<string, PluginEmojiEntry[]>();

  constructor(readonly entries: PluginEmojiEntry[]) {
    this.categories = [...new Set(entries.map((entry) => entry.category))];
    const indexedWords = new Map<string, number>();
    this.searchRows = entries.map((entry) => {
      this.byUnicode.set(entry.unicode, { entry, unicode: entry.unicode, name: entry.name });
      for (const variant of entry.variants) {
        this.byUnicode.set(variant.unicode, { entry, unicode: variant.unicode, name: variant.name });
      }
      const words = [entry.name, entry.category, ...entry.keywords, ...entry.shortcodes]
        .join(" ").toLowerCase().split(/[^a-z0-9_+-]+/).filter(Boolean);
      for (const word of new Set(words)) {
        const count = indexedWords.get(word) ?? 0;
        if (count === 8) continue;
        indexedWords.set(word, count + 1);
        for (let size = 2; size <= Math.min(word.length, MAX_EMOJI_SHORTCODE_LENGTH); size++) {
          const key = word.slice(0, size);
          const values = this.prefixes.get(key) ?? [];
          if (values.length < 8 && !values.includes(entry)) values.push(entry);
          this.prefixes.set(key, values);
        }
      }
      return { entry, text: [entry.name, entry.category, ...entry.keywords, ...entry.shortcodes].join(" ").toLowerCase() };
    });
  }

  search(query: string, category = ""): PluginEmojiEntry[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
      .map((word) => word.replace(/^:([a-z0-9_+-]+):?$/, "$1"));
    return this.searchRows.filter(({ entry, text }) =>
      (!category || entry.category === category) && words.every((word) => text.includes(word)),
    ).map(({ entry }) => entry);
  }

  suggest(query: string): PluginEmojiEntry[] {
    return this.prefixes.get(query.toLowerCase()) ?? [];
  }
}

const indexes = new WeakMap<PluginEmojiEntry[], EmojiIndex>();
export function emojiIndex(picker: PluginEmojiPicker): EmojiIndex {
  let index = indexes.get(picker.entries);
  if (!index) {
    index = new EmojiIndex(picker.entries);
    indexes.set(picker.entries, index);
  }
  return index;
}

export function emojiForTone(entry: PluginEmojiEntry, tone: number): EmojiMatch {
  const variant = tone > 0 ? entry.variants.find((item) => item.tone === tone) : undefined;
  return { entry, unicode: variant?.unicode ?? entry.unicode, name: variant?.name ?? entry.name };
}

export interface EmojiCandidate { from: number; to: number; query: string }
export interface EmojiSourceSnapshot { source: string; root?: Root }

export function emojiCandidate(text: string, head: number): EmojiCandidate | null {
  const start = Math.max(0, head - MAX_EMOJI_SHORTCODE_LENGTH - 2);
  const match = /(?:^|[\s([{])(:[a-z0-9_+-]{2,80})$/i.exec(text.slice(start, head));
  if (!match) return null;
  const from = head - match[1].length;
  if (from > 0 && !/[\s([{]/.test(text[from - 1])) return null;
  return { from, to: head, query: match[1].slice(1) };
}

/** Source offsets for visible text, used only at an explicit rich insertion. */
export function emojiSourceProjection(source: string, snapshot?: EmojiSourceSnapshot): { text: string; offsets: number[]; ends: number[]; root: Root } {
  let text = "";
  const offsets: number[] = [];
  const ends: number[] = [];
  const entities = new Map<string, string>();
  const visit = (node: Nodes) => {
    if (node.type === "text" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = source.slice(start, end);
      let rawOffset = node.type === "inlineCode" ? /^`+/.exec(raw)?.[0].length ?? 0 : 0;
      for (let i = 0; i < node.value.length; i++) {
        const characterStart = rawOffset;
        const entity = node.type === "text" && raw[rawOffset] === "&"
          ? /^&(?:#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i.exec(raw.slice(rawOffset))?.[0] : undefined;
        if (entity) {
          let decoded = entities.get(entity);
          if (decoded === undefined) {
            const paragraph = fromMarkdown(entity).children[0];
            const child = paragraph && "children" in paragraph ? paragraph.children[0] : undefined;
            decoded = child?.type === "text" ? child.value : entity;
            entities.set(entity, decoded);
          }
          if (decoded !== entity && node.value.slice(i, i + decoded.length) === decoded) {
            text += decoded;
            for (let unit = 0; unit < decoded.length; unit++) {
              offsets.push(start + rawOffset);
              ends.push(start + rawOffset + entity.length);
            }
            rawOffset += entity.length;
            i += decoded.length - 1;
            continue;
          }
        }
        if (raw[rawOffset] === "\\" && raw[rawOffset + 1] === node.value[i]) rawOffset++;
        if (raw[rawOffset] === "\r" && raw[rawOffset + 1] === "\n") rawOffset++;
        if (raw[rawOffset] !== node.value[i]) {
          // Ambiguous entity/whitespace decoding must not select a different source range.
          text += "\u0000";
          offsets.push(-1);
          ends.push(-1);
        } else {
          text += node.value[i];
          offsets.push(start + characterStart);
          ends.push(start + rawOffset + 1);
        }
        rawOffset++;
      }
    } else if ("children" in node) node.children.forEach(visit);
  };
  const prose = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/^ {0,3}>[ \t]*(?:!\[[a-z-]+\]|\[![a-z-]+\])[ \t]*$/gim, (value) => value.replace(/[^\r\n]/g, " "));
  const root = snapshot?.source === prose && snapshot.root ? snapshot.root : fromMarkdown(prose);
  visit(root);
  return { text, offsets, ends, root };
}

export function emojiSelectionPatch(source: string, from: number, to: number, unicode: string, root?: Root): string {
  if (from === to) return source.slice(0, from) + unicode + source.slice(to);
  const start: Nodes[] = [];
  const end: Nodes[] = [];
  const visit = (node: Nodes) => {
    const first = node.position?.start.offset;
    const last = node.position?.end.offset;
    if (first === undefined || last === undefined) return;
    if (["strong", "emphasis", "delete", "link", "linkReference", "inlineCode"].includes(node.type)) {
      if (first < from && from < last) start.push(node);
      if (first < to && to < last) end.push(node);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(root ?? fromMarkdown(source));
  const closing = start.filter((node) => !end.includes(node)).reverse().map((node) =>
    "children" in node ? source.slice(node.children[node.children.length - 1]?.position?.end.offset, node.position?.end.offset)
      : node.type === "inlineCode" ? /`+$/.exec(source.slice(node.position?.start.offset, node.position?.end.offset))?.[0] ?? "" : "",
  ).join("");
  const opening = end.filter((node) => !start.includes(node)).map((node) =>
    "children" in node ? source.slice(node.position?.start.offset, node.children[0]?.position?.start.offset)
      : node.type === "inlineCode" ? /^`+/.exec(source.slice(node.position?.start.offset, node.position?.end.offset))?.[0] ?? "" : "",
  ).join("");
  return source.slice(0, from) + unicode + closing + opening + source.slice(to);
}

export function emojiSourcePatch(source: string, displayed: string, from: number, to: number, unicode: string): string | null {
  const normalized = source.replace(/\r\n?/g, "\n");
  let start = from;
  let end = to;
  if (normalized !== displayed) {
    // The MDX source view can contain translated callout syntax. Only map an
    // unchanged, unambiguous source line; never guess inside translated syntax.
    const lineStart = displayed.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = displayed.indexOf("\n", to);
    const line = displayed.slice(lineStart, lineEnd < 0 ? displayed.length : lineEnd);
    if (!line || line.includes("\n") || /^:{3,}/.test(line)) return null;
    const matches: number[] = [];
    let offset = 0;
    for (const originalLine of normalized.split("\n")) {
      const quote = /^(?: {0,3}>[ \t]?)+/.exec(originalLine)?.[0] ?? "";
      if (originalLine === line) matches.push(offset);
      else if (originalLine.slice(quote.length) === line) matches.push(offset + quote.length);
      offset += originalLine.length + 1;
    }
    if (matches.length !== 1) return null;
    const found = matches[0];
    start = found + from - lineStart;
    end = found + to - lineStart;
  }
  const rawOffset = (offset: number) => {
    let raw = 0;
    for (let normalizedOffset = 0; normalizedOffset < offset; normalizedOffset++, raw++) {
      if (source[raw] === "\r" && source[raw + 1] === "\n") raw++;
    }
    return raw;
  };
  return source.slice(0, rawOffset(start)) + unicode + source.slice(rawOffset(end));
}

/** Preserve exact bytes for emoji undo/redo without retaining every ordinary edit. */
export class EmojiSourceHistory {
  private baseline: { serialized: string; source: string } | null = null;
  private snapshots = new Map<string, string>();
  private characters = 0;
  private pending: string | null = null;
  private historyChange = false;

  record(serialized: string, source: string) { this.baseline = { serialized, source }; }
  beforeChange(history: boolean) { this.historyChange = history; }
  prepare(source: string) {
    if (this.baseline) this.remember(this.baseline.serialized, this.baseline.source);
    this.pending = source;
  }
  restore(serialized: string): string | undefined {
    const source = this.pending ?? (this.historyChange ? this.snapshots.get(serialized) : undefined);
    if (this.pending !== null) this.remember(serialized, this.pending);
    else if (!this.historyChange) this.forget(serialized);
    this.pending = null;
    this.historyChange = false;
    return source;
  }
  private forget(serialized: string) {
    const previous = this.snapshots.get(serialized);
    if (previous !== undefined) {
      this.characters -= serialized.length + previous.length;
      this.snapshots.delete(serialized);
    }
  }
  private remember(serialized: string, source: string) {
    this.forget(serialized);
    this.snapshots.set(serialized, source);
    this.characters += serialized.length + source.length;
    while (this.snapshots.size > 2 && (this.snapshots.size > 16 || this.characters > 4_000_000)) {
      const oldest = this.snapshots.entries().next().value!;
      this.characters -= oldest[0].length + oldest[1].length;
      this.snapshots.delete(oldest[0]);
    }
  }
}
