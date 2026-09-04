import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EmojiIndex, emojiCandidate, emojiIndex, emojiSelectionPatch, emojiSourcePatch, emojiSourceProjection } from "./emoji";
import { syntheticEmojiPicker } from "./emoji.testFixtures";
import { sourceAllowsEmojiCandidate } from "./emojiSource";
import { loadSyntaxLanguage } from "./syntaxLanguages";
import { readEmojiPreferences } from "../plugins/emojiPickers";
import { isEmojiPickerShortcut } from "./emojiHost";

it("uses only the platform primary modifier without intercepting macOS Control-Shift-E", () => {
  const event = { key: "E", code: "KeyE", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, isComposing: false };
  expect(isEmojiPickerShortcut(event, "MacIntel")).toBe(true);
  expect(isEmojiPickerShortcut(event, "Win32")).toBe(false);
  expect(isEmojiPickerShortcut({ ...event, metaKey: false, ctrlKey: true }, "MacIntel")).toBe(false);
  expect(isEmojiPickerShortcut({ ...event, metaKey: false, ctrlKey: true }, "Win32")).toBe(true);
  expect(isEmojiPickerShortcut({ ...event, altKey: true }, "MacIntel")).toBe(false);
  expect(isEmojiPickerShortcut({ ...event, shiftKey: false }, "MacIntel")).toBe(false);
  expect(isEmojiPickerShortcut({ ...event, isComposing: true }, "MacIntel")).toBe(false);
});

describe("local emoji lookup", () => {
  it("memoizes contribution indexes and searches names, keywords, aliases and categories", () => {
    const picker = syntheticEmojiPicker();
    const index = emojiIndex(picker);
    expect(emojiIndex(picker)).toBe(index);
    for (const query of ["smiling", "happy", "smile", ":smile:", ":sm", "faces"]) expect(index.search(query)[0].id).toBe("smile");
    expect(index.search("hello", "Faces")).toEqual([]);
    expect(index.suggest("sm")[0].unicode).toBe("😀");
  });
  it("bounds autocomplete even for thousands of entries", () => {
    const entries = Array.from({ length: 5000 }, (_, index) => ({
      ...syntheticEmojiPicker().entries[0], id: `synthetic-${index}`, name: `Synthetic face ${index}`,
    }));
    expect(new EmojiIndex(entries).suggest("sy")).toHaveLength(8);
  });
  it("indexes numeric-leading aliases and full-length 80-character aliases", () => {
    const entry = { ...syntheticEmojiPicker().entries[0], shortcodes: ["100", "1234", "longalias_".repeat(8)] };
    const index = new EmojiIndex([entry]);
    for (const alias of entry.shortcodes) {
      expect(index.suggest(alias)).toEqual([entry]);
      expect(emojiCandidate(`:${alias}`, alias.length + 1)?.query).toBe(alias);
    }
  });
  it("loads known Unicode preferences and refuses invalid settings", () => {
    const picker = syntheticEmojiPicker();
    expect(readEmojiPreferences(picker, { recent: '["👋🏻"]', favorite: "[]", tone: 1 })).toEqual({
      recents: ["👋🏻"], favorites: [], tone: 1,
    });
    expect(() => readEmojiPreferences(picker, { favorite: "{", tone: 9 })).toThrow("Reset");
  });
});

describe("conservative shortcode candidate", () => {
  it.each([":sm", "Hello :sm", "(:sm", "One\n:sm"])("allows %j", (text) => {
    expect(emojiCandidate(text, text.length)?.query).toBe("sm");
  });
  it.each([":s", "12:30", "09:45", "https://host/:sm", "word:sm", "::sm", ":smile:", "\\:sm", "12:30:sm"])("ignores %j", (text) => {
    expect(emojiCandidate(text, text.length)).toBeNull();
  });
  it.each([
    "`:sm", "`code :sm`", "``code\n:sm\nmore``", "```\nhello\n:sm\n```",
    "~~~text\n:sm\n~~~", "> ```\n> :sm\n> ```", "    :sm", "\\\\`one :sm",
  ])("does not autocomplete code %j", async (source) => {
    const from = source.indexOf(":sm");
    const state = EditorState.create({ doc: source, extensions: [await loadSyntaxLanguage("markdown")] });
    expect(sourceAllowsEmojiCandidate(state, { from, to: from + 3, query: "sm" })).toBe(false);
  });
  it("allows prose after a closed multiline fence", async () => {
    const source = "```text\none\ntwo\n```\n\n:sm";
    const state = EditorState.create({ doc: source, extensions: [await loadSyntaxLanguage("markdown")] });
    expect(sourceAllowsEmojiCandidate(state, emojiCandidate(source, source.length)!)).toBe(true);
  });
  it.each([
    ["[Link](:sm)", false],
    ["![Image](:sm)", false],
    ['[Link](target " :sm")', false],
    ["[Label :sm](target)", true],
  ] as const)("handles Markdown link context %s", async (source, allowed) => {
    const from = source.indexOf(":sm");
    const state = EditorState.create({ doc: source, extensions: [await loadSyntaxLanguage("markdown")] });
    expect(sourceAllowsEmojiCandidate(state, { from, to: from + 3, query: "sm" })).toBe(allowed);
  });
  it("fails closed without a ready syntax tree or with an excessively long inline context", async () => {
    const source = "text ".repeat(1000) + ":sm";
    expect(sourceAllowsEmojiCandidate(EditorState.create({ doc: source }), emojiCandidate(source, source.length)!)).toBe(false);
    const state = EditorState.create({ doc: source, extensions: [await loadSyntaxLanguage("markdown")] });
    expect(sourceAllowsEmojiCandidate(state, emojiCandidate(source, source.length)!)).toBe(false);
  });
  it("projects source text without losing CRLF or formatting offsets", () => {
    const source = "* Other\r\n\r\n**Keep** 😀";
    const projection = emojiSourceProjection(source);
    expect(projection.offsets[projection.text.indexOf("Keep")]).toBe(source.indexOf("Keep"));
  });
  it("maps escapes and entities as whole source spans", () => {
    const source = "A &amp; B \\:sm";
    const projection = emojiSourceProjection(source);
    expect(projection.text).toBe("A & B :sm");
    expect(projection.offsets[6]).toBe(source.indexOf("\\"));
    expect(emojiSourceProjection(">![info]\n> info").text).toBe("info");
  });
  it("preserves partial inline formatting when replacing a cross-node selection", () => {
    expect(emojiSelectionPatch("**Bold** plain", 4, 14, "😀")).toBe("**Bo😀**");
    expect(emojiSelectionPatch("plain **bold**", 0, 10, "😀")).toBe("😀**ld**");
  });
  it("maps unchanged callout source lines but refuses ambiguous translated syntax", () => {
    const original = ">![info]\r\n> Synthetic\r\n\r\nOther";
    const displayed = ":::info\nSynthetic\n:::\n\nOther";
    const from = displayed.indexOf("Other") + 2;
    expect(emojiSourcePatch(original, displayed, from, from, "😀")).toBe(original.replace("Other", "Ot😀her"));
    expect(emojiSourcePatch(original, displayed, 3, 3, "😀")).toBeNull();
  });
  it.each([":+1", ":-1"])("allows the known two-character alias %s", (source) => {
    expect(emojiCandidate(source, source.length)?.query).toBe(source.slice(1));
  });
});
