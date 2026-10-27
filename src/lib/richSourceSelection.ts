import { $getRoot, type RangeSelection } from "lexical";
import { emojiSourceProjection, type EmojiSourceSnapshot } from "./emoji";

export function richSourceTextMap(source: string, snapshot?: EmojiSourceSnapshot) {
  const projection = emojiSourceProjection(source, snapshot);
  const positions = new Map<string, { start: number; length: number }>();
  const nodes = $getRoot().getAllTextNodes().filter((node) => node.getTextContent() !== "");
  let cursor = 0;
  for (const node of nodes) {
    const text = node.getTextContent();
    const start = projection.text.indexOf(text, cursor);
    if (start < 0) return null;
    positions.set(node.getKey(), { start, length: text.length });
    cursor = start + text.length;
  }
  return { projection, positions, nodes };
}

export function richSourceSelection(source: string, selection: RangeSelection, snapshot?: EmojiSourceSnapshot): { from: number; to: number } | null {
  const mapped = richSourceTextMap(source, snapshot);
  if (!mapped) return null;
  const { projection, positions, nodes } = mapped;
  let cursor = projection.text.length;
  for (const node of [...nodes].reverse()) {
    const text = node.getTextContent();
    const start = projection.text.lastIndexOf(text, cursor - text.length);
    if (start < 0 || start !== positions.get(node.getKey())?.start &&
        (node.getKey() === selection.anchor.key || node.getKey() === selection.focus.key)) return null;
    cursor = start;
  }
  const offset = (point: RangeSelection["anchor"]) => {
    if (point.type !== "text") return null;
    const position = positions.get(point.key);
    if (!position) return null;
    const index = position.start + point.offset;
    const value = point.offset === position.length ? projection.ends[index - 1] : projection.offsets[index];
    return value !== undefined && value >= 0 ? value : null;
  };
  const anchor = offset(selection.anchor);
  const focus = offset(selection.focus);
  return anchor === null || focus === null ? null : { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
}
