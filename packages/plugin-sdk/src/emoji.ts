import type {
  PluginEmojiEntry,
  PluginEmojiPicker,
  PluginEmojiPreferences,
  PluginEmojiVariant,
  PluginManifest,
} from "./contracts";

export const EMOJI_MAX_ENTRIES = 5_000;
export const EMOJI_MAX_RECENTS = 32;
export const EMOJI_MAX_FAVORITES = 128;
const MAX_DATASET_BYTES = 2 * 1024 * 1024;
let segmenter: Intl.Segmenter | undefined;
const identifier = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const shortcode = /^[a-z0-9_+-]{2,80}$/;
const pictograph = /\p{Extended_Pictographic}/u;
const emojiCharacters =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u{e0020}-\u{e007f}]+$/u;

export function isEmojiSequence(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  if (/^[#*0-9]\ufe0f?\u20e3$/u.test(value)) {
    return true;
  }
  if (/^[\u{1f1e6}-\u{1f1ff}]{2}$/u.test(value)) {
    return true;
  }
  segmenter ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return (
    pictograph.test(value) &&
    emojiCharacters.test(value) &&
    [...segmenter.segment(value)].length === 1 &&
    !/^[\u200d\ufe0e\ufe0f\p{Emoji_Modifier}]|\u200d$/u.test(value)
  );
}

export function isPluginEmojiPicker(value: unknown): value is PluginEmojiPicker {
  if (
    !record(value) ||
    !keys(value, ["id", "title", "entries", "shortcodes", "settingsKeys"]) ||
    typeof value.id !== "string" ||
    !identifier.test(value.id) ||
    !label(value.title, 100) ||
    typeof value.shortcodes !== "boolean" ||
    !record(value.settingsKeys) ||
    !keys(value.settingsKeys, ["recents", "favorites", "tone"]) ||
    !Object.values(value.settingsKeys).every(
      (key) => typeof key === "string" && identifier.test(key),
    ) ||
    new Set(Object.values(value.settingsKeys)).size !== 3 ||
    !plainArray(value.entries, EMOJI_MAX_ENTRIES) ||
    value.entries.length === 0 ||
    !value.entries.every(entry)
  ) {
    return false;
  }
  if (new Set(value.entries.map((item) => item.id)).size !== value.entries.length) {
    return false;
  }
  // The structural checks above bound each field before serializing the dataset.
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_DATASET_BYTES;
}

export function emojiPickerMatchesManifest(
  picker: PluginEmojiPicker,
  manifest: PluginManifest,
): boolean {
  const properties = manifest.settings?.properties;
  const recent = properties?.[picker.settingsKeys.recents];
  const favorite = properties?.[picker.settingsKeys.favorites];
  const tone = properties?.[picker.settingsKeys.tone];
  return (
    picker.id.startsWith(`${manifest.id}.`) &&
    recent?.type === "string" &&
    recent.default === "[]" &&
    favorite?.type === "string" &&
    favorite.default === "[]" &&
    tone?.type === "number" &&
    tone.minimum === 0 &&
    tone.maximum === 5 &&
    Number.isInteger(tone.default)
  );
}

export function isPluginEmojiPreferences(
  value: unknown,
): value is PluginEmojiPreferences {
  return (
    record(value) &&
    keys(value, ["recents", "favorites", "tone"]) &&
    sequences(value.recents, EMOJI_MAX_RECENTS) &&
    sequences(value.favorites, EMOJI_MAX_FAVORITES) &&
    typeof value.tone === "number" &&
    Number.isInteger(value.tone) &&
    value.tone >= 0 &&
    value.tone <= 5
  );
}

function sequences(value: unknown, limit: number): value is string[] {
  return (
    plainArray(value, limit) &&
    value.every(isEmojiSequence) &&
    new Set(value).size === value.length
  );
}

function entry(value: unknown): value is PluginEmojiEntry {
  return (
    record(value) &&
    keys(value, ["id", "name", "unicode", "category", "keywords", "shortcodes", "variants"]) &&
    typeof value.id === "string" &&
    identifier.test(value.id) &&
    label(value.name, 160) &&
    isEmojiSequence(value.unicode) &&
    label(value.category, 80) &&
    plainArray(value.keywords, 32) &&
    value.keywords.every((item) => label(item, 80)) &&
    plainArray(value.shortcodes, 32) &&
    value.shortcodes.length > 0 &&
    value.shortcodes.every((item) => typeof item === "string" && shortcode.test(item)) &&
    plainArray(value.variants, 30) &&
    value.variants.every(variant) &&
    new Set(value.variants.map((item) => item.unicode)).size === value.variants.length
  );
}

function variant(value: unknown): value is PluginEmojiVariant {
  return (
    record(value) &&
    keys(value, ["name", "unicode"], ["tone"]) &&
    label(value.name, 160) &&
    isEmojiSequence(value.unicode) &&
    (value.tone === undefined ||
      (typeof value.tone === "number" &&
        Number.isInteger(value.tone) &&
        value.tone >= 1 &&
        value.tone <= 5))
  );
}

function label(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}

function keys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === value.length + 1 && ownKeys.every((key) =>
    key === "length" ||
    (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length),
  );
}
