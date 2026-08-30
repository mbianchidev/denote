import type { CSSProperties } from "react";

export type TagColorMap = Readonly<Record<string, string>>;

export interface TagColorStyle extends CSSProperties {
  "--tag-color": string;
}

const TAG_PALETTE = [
  "#a8d5a2",
  "#8fcbd9",
  "#b9b2e6",
  "#d6a7d8",
  "#e6a8b5",
  "#e7b38f",
  "#dfca7d",
  "#91d1bd",
  "#a8c2e5",
  "#c7b59b",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").normalize("NFC").toLowerCase();
}

export function resolveTagColor(tag: string, colors: TagColorMap): string {
  const normalized = normalizeTag(tag);
  const saved = colors[normalized];
  if (saved && HEX_COLOR.test(saved)) {
    return saved.toLowerCase();
  }
  return TAG_PALETTE[tagHash(normalized) % TAG_PALETTE.length];
}

export function tagColorStyle(background: string): TagColorStyle {
  const normalized = HEX_COLOR.test(background)
    ? background.toLowerCase()
    : TAG_PALETTE[0];
  return {
    "--tag-color": normalized,
  };
}

export function blendTagColor(
  color: string,
  surface: string,
  colorWeight = 0.22,
): string {
  const foreground = parseHexColor(color);
  const background = parseHexColor(surface);
  const channels = foreground.map((channel, index) =>
    Math.round(channel * colorWeight + background[index] * (1 - colorWeight)),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function contrastRatio(left: string, right: string): number {
  const light = Math.max(relativeLuminance(left), relativeLuminance(right));
  const dark = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = parseHexColor(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function parseHexColor(color: string): [number, number, number] {
  if (!HEX_COLOR.test(color)) {
    throw new Error(`Invalid tag color: ${color}`);
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function tagHash(tag: string): number {
  let hash = 2_166_136_261;
  for (const character of tag) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
