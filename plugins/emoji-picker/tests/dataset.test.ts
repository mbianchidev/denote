import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isEmojiSequence, type PluginEmojiEntry } from "@denote/plugin-sdk";
import emojiJson from "../src/emoji.json";
import snapshot from "../data/snapshot.json";
import upstream from "../data/upstream.json";

const entries: PluginEmojiEntry[] = emojiJson;
const variants = entries.flatMap((entry) => entry.variants);
const sequences = [...new Set([...entries, ...variants].map((entry) => entry.unicode))];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function withAlias(alias: string): PluginEmojiEntry {
  const matches = entries.filter((entry) => entry.shortcodes.includes(alias));
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("bundled Unicode emoji data", () => {
  it("covers the pinned complete Unicode 17 fully-qualified sequence set", () => {
    expect(entries).toHaveLength(1914);
    expect(sequences).toHaveLength(3944);
    expect(entries.length).toBeLessThanOrEqual(5000);
    expect(sha256(JSON.stringify([...sequences].sort()))).toBe(snapshot.sequenceSetSha256);
    expect(snapshot).toMatchObject({
      upstream: "emojibase-data@17.0.0",
      unicodeVersion: "17.0",
      baseEntries: entries.length,
      fullyQualifiedSequences: sequences.length,
      variants: variants.length,
      toneVariants: variants.filter((variant) => variant.tone !== undefined).length,
      otherVariants: variants.filter((variant) => variant.tone === undefined).length,
    });
  });

  it("keeps the snapshot minimized and checksum-pinned", () => {
    const bytes = readFileSync(join(root, "src/emoji.json"));

    expect(bytes.toString("utf8")).toBe(`${JSON.stringify(emojiJson)}\n`);
    expect(bytes.byteLength).toBe(snapshot.datasetSizeBytes);
    expect(sha256(bytes)).toBe(snapshot.datasetSha256);
  });

  it("has stable unique ASCII IDs and no duplicate base sequences", () => {
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.unicode)).size).toBe(entries.length);
    expect(entries.filter((entry) => !/^u-[a-f0-9-]{1,98}$/.test(entry.id))).toEqual([]);
    expect(withAlias("+1").id).toBe("u-1f44d");
    expect(withAlias("rainbow_flag").id).toBe("u-1f3f3-fe0f-200d-1f308");
  });

  it("contains only bounded single-grapheme emoji, never bare modifiers or regional indicators", () => {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

    for (const sequence of sequences) {
      expect(isEmojiSequence(sequence), sequence).toBe(true);
      expect(sequence.length).toBeLessThanOrEqual(64);
      expect([...segmenter.segment(sequence)]).toHaveLength(1);
      expect(sequence).not.toMatch(/^[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{1F9B0}-\u{1F9B3}]$/u);
    }
  });

  it("keeps names, keywords, aliases, categories, and variants inside the host bounds", () => {
    const safeLabel = (label: string, limit: number) =>
      label.trim().length > 0 &&
      label.length <= limit &&
      !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(label);

    for (const entry of entries) {
      expect(safeLabel(entry.name, 160)).toBe(true);
      expect(safeLabel(entry.category, 80)).toBe(true);
      expect(entry.keywords.length).toBeLessThanOrEqual(32);
      expect(entry.shortcodes.length).toBeGreaterThan(0);
      expect(entry.shortcodes.length).toBeLessThanOrEqual(32);
      expect(entry.keywords.every((keyword) => safeLabel(keyword, 80))).toBe(true);
      expect(entry.shortcodes.every((alias) => /^[a-z0-9_+\-]{2,80}$/.test(alias))).toBe(true);
      expect(new Set(entry.keywords).size).toBe(entry.keywords.length);
      expect(new Set(entry.shortcodes).size).toBe(entry.shortcodes.length);
      expect(entry.variants.length).toBeLessThanOrEqual(30);
      expect(new Set(entry.variants.map((variant) => variant.unicode)).size).toBe(entry.variants.length);
      for (const variant of entry.variants) {
        expect(safeLabel(variant.name, 160)).toBe(true);
        expect(variant.unicode).not.toBe(entry.unicode);
        if (variant.tone !== undefined) {
          expect(Number.isInteger(variant.tone)).toBe(true);
          expect(variant.tone).toBeGreaterThanOrEqual(1);
          expect(variant.tone).toBeLessThanOrEqual(5);
        }
      }
    }
    expect(Math.max(...entries.map((entry) => entry.variants.length))).toBe(snapshot.maximumVariantsPerEntry);
    expect([...new Set(entries.map((entry) => entry.category))]).toEqual([
      "smileys & emotion",
      "people & body",
      "animals & nature",
      "food & drink",
      "travel & places",
      "activities",
      "objects",
      "symbols",
      "flags",
    ]);
  });

  it.each([
    ["smile", [0x1f604]],
    ["family", [0x1f46a]],
    ["family_man_woman_girl_boy", [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466]],
    ["rainbow_flag", [0x1f3f3, 0xfe0f, 0x200d, 0x1f308]],
    ["+1", [0x1f44d]],
    ["one", [0x31, 0xfe0f, 0x20e3]],
    ["woman_technologist", [0x1f469, 0x200d, 0x1f4bb]],
    ["flag_england", [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f]],
    ["sark", [0x1f1e8, 0x1f1f6]],
    ["distorted_face", [0x1faea]],
    ["orca", [0x1facd]],
  ] as const)("preserves the exact standard Unicode sequence for %s", (alias, points) => {
    expect(withAlias(alias).unicode).toBe(String.fromCodePoint(...points));
  });

  it("retains useful keyword and alternative shortcode data without implementing search", () => {
    expect(withAlias("smile").keywords).toContain("happy");
    expect(withAlias("woman_technologist").keywords).toContain("developer");
    expect(withAlias("thumbsup").id).toBe(withAlias("+1").id);
    expect(withAlias("circled_m").unicode).toBe("\u24c2\ufe0f");
    expect(withAlias("circled_m").shortcodes).not.toContain("m");
  });

  it("provides all five exact skin tones without redundant variation selectors", () => {
    const thumbs = withAlias("+1");

    expect(thumbs.variants).toHaveLength(5);
    expect(thumbs.variants.map((variant) => variant.tone)).toEqual([1, 2, 3, 4, 5]);
    for (let tone = 1; tone <= 5; tone += 1) {
      expect(thumbs.variants[tone - 1].unicode).toBe(String.fromCodePoint(0x1f44d, 0x1f3fa + tone));
    }
    expect(withAlias("woman_technologist").variants.find((variant) => variant.tone === 3)?.unicode)
      .toBe("\u{1f469}\u{1f3fd}\u200d\u{1f4bb}");
  });

  it("retains mixed-tone sequences without assigning an incorrect single tone", () => {
    const handshake = withAlias("handshake");
    const mixed = handshake.variants.find((variant) =>
      variant.unicode === "\u{1faf1}\u{1f3fb}\u200d\u{1faf2}\u{1f3ff}",
    );

    expect(handshake.variants).toHaveLength(25);
    expect(mixed).toEqual({
      name: "handshake: light skin tone, dark skin tone",
      unicode: "\u{1faf1}\u{1f3fb}\u200d\u{1faf2}\u{1f3ff}",
    });
  });

  it("offers standard non-tone hair, gender, and direction variants", () => {
    const person = withAlias("adult");
    const walking = entries.find((entry) => entry.id === "u-1f6b6");

    expect(person.variants).toEqual(expect.arrayContaining([
      { name: "man", unicode: "\u{1f468}" },
      { name: "woman", unicode: "\u{1f469}" },
      { name: "person: red hair", unicode: "\u{1f9d1}\u200d\u{1f9b0}" },
      { name: "person: curly hair", unicode: "\u{1f9d1}\u200d\u{1f9b1}" },
    ]));
    expect(walking?.variants).toContainEqual({
      name: "person walking: facing right",
      unicode: "\u{1f6b6}\u200d\u27a1\ufe0f",
    });
  });
});

describe("data provenance and redistribution", () => {
  it("pins the exact source version, URLs, sizes, and SHA-256 digests", () => {
    expect(upstream.version).toBe("17.0.0");
    expect(upstream.unicodeVersion).toBe("17.0");
    for (const source of Object.values(upstream.sources)) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.url).not.toMatch(/latest|@next/);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("retains exact upstream license notices in the guide shipped in every archive", () => {
    const guide = readFileSync(join(root, "guide.md"), "utf8");

    expect(upstream.licenses.map((license) => license.spdx)).toEqual(["MIT", "Unicode-3.0"]);
    for (const license of upstream.licenses) {
      const bytes = readFileSync(join(root, license.path));
      expect(sha256(bytes)).toBe(license.sha256);
      expect(guide).toContain(bytes.toString("utf8").trim());
    }
    expect(guide).toContain("© 2025 Unicode®, Inc.");
  });
});
