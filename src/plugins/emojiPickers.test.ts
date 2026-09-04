import { describe, expect, it } from "vitest";
import {
  isEmojiSequence,
  isPluginEmojiPicker,
  isPluginEmojiPreferences,
  type PluginEmojiPicker,
} from "@denote/plugin-sdk";
import { emojiPreferenceSettings, readEmojiPreferences } from "./emojiPickers";
import { isPluginRuntimeMessage } from "./runtimeMessages";

const wave = "\u{1f44b}";
const tonedWave = "\u{1f44b}\u{1f3fd}";
const picker: PluginEmojiPicker = {
  id: "denote.synthetic.emoji",
  title: "Insert emoji",
  entries: [{
    id: "wave",
    name: "Waving hand",
    unicode: wave,
    category: "People",
    keywords: ["hello"],
    shortcodes: ["wave"],
    variants: [{ name: "Waving hand: medium skin tone", unicode: tonedWave, tone: 3 }],
  }],
  shortcodes: true,
  settingsKeys: { recents: "recents", favorites: "favorites", tone: "tone" },
};

describe("emoji contribution boundary", () => {
  it("rejects sparse arrays and hidden payloads that JSON byte counting would omit", () => {
    for (const key of ["keywords", "shortcodes", "variants"] as const) {
      const original = picker.entries[0];
      const malicious = {
        ...picker,
        entries: [{
          ...original,
          [key]: Object.assign([...original[key]], { undeclaredPayload: "x".repeat(3 * 1024 * 1024) }),
        }],
      };
      expect(isPluginEmojiPicker(malicious)).toBe(false);
      expect(isPluginEmojiPicker(structuredClone(malicious))).toBe(false);
    }
    expect(isPluginEmojiPicker({
      ...picker,
      entries: Object.assign([...picker.entries], { hidden: "payload" }),
    })).toBe(false);
    expect(isPluginEmojiPicker({
      ...picker,
      entries: [{ ...picker.entries[0], keywords: new Array(1) }],
    })).toBe(false);
    expect(isPluginEmojiPreferences({
      recents: Object.assign([wave], { ignored: "payload" }), favorites: [], tone: 0,
    })).toBe(false);
  });

  it.each([
    wave,
    tonedWave,
    "\u2764\ufe0f",
    "\u{1f469}\u200d\u{1f4bb}",
    "\u{1f3f3}\ufe0f\u200d\u{1f308}",
    "\u{1f1ee}\u{1f1f9}",
    "1\ufe0f\u20e3",
    "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}",
  ])("preserves one Unicode emoji grapheme %s", (value) => {
    expect(isEmojiSequence(value)).toBe(true);
  });

  it.each(["", "note", ":wave:", "<script>", "1", "#", "\ud83d", "\u200d",
    "\ufe0f", "\u{1f3fd}", wave + "\n", wave + wave, "\u200d" + wave, wave + "\u200d"])(
    "rejects non-emoji insertion payload %j",
    (value) => expect(isEmojiSequence(value)).toBe(false),
  );

  it("accepts only bounded declarative registrations", () => {
    expect(isPluginEmojiPicker(picker)).toBe(true);
    expect(isPluginRuntimeMessage({ type: "register-emoji-picker", picker })).toBe(true);
    for (const invalid of [
      { ...picker, html: "<div>" },
      { ...picker, entries: [] },
      { ...picker, entries: Array(5001).fill(picker.entries[0]) },
      { ...picker, entries: [picker.entries[0], picker.entries[0]] },
      { ...picker, settingsKeys: { ...picker.settingsKeys, favorites: "recents" } },
      { ...picker, title: "Label\u202e" },
      { ...picker, entries: [{ ...picker.entries[0], unicode: "text" }] },
      { ...picker, entries: [{ ...picker.entries[0], shortcodes: [":wave:"] }] },
      { ...picker, entries: [{ ...picker.entries[0], keywords: Array(33).fill("hello") }] },
      { ...picker, entries: [{ ...picker.entries[0], variants: [
        { name: "Wrong tone", unicode: tonedWave, tone: 6 },
      ] }] },
    ]) {
      expect(isPluginRuntimeMessage({ type: "register-emoji-picker", picker: invalid })).toBe(false);
    }
  });
});

describe("emoji settings", () => {
  it("round trips full sequences without changing unrelated settings", () => {
    const preferences = { recents: [tonedWave, wave], favorites: [tonedWave], tone: 3 };
    const settings = { autocomplete: true, ...emojiPreferenceSettings(picker, preferences) };
    expect(readEmojiPreferences(picker, settings)).toEqual(preferences);
    expect(settings.autocomplete).toBe(true);
    expect(readEmojiPreferences(picker, {})).toEqual({ recents: [], favorites: [], tone: 0 });
  });

  it("rejects malformed, duplicate, oversized and unknown stored selections", () => {
    for (const settings of [
      { recents: "[" },
      { recents: JSON.stringify([wave, wave]) },
      { favorites: JSON.stringify(["text"]) },
      { recents: JSON.stringify(["\u{1f680}"]) },
      { tone: 1.5 },
      { tone: 6 },
    ]) {
      expect(() => readEmojiPreferences(picker, settings)).toThrow(/preferences/);
    }
    expect(isPluginEmojiPreferences({ recents: Array(33).fill(wave), favorites: [], tone: 0 })).toBe(false);
    expect(isPluginEmojiPreferences({ recents: [], favorites: Array(129).fill(wave), tone: 0 })).toBe(false);
    expect(() => emojiPreferenceSettings(picker, { recents: ["text"], favorites: [], tone: 0 })).toThrow();
  });
});
