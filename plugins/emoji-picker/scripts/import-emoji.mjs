import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const upstream = JSON.parse(
  await readFile(new URL("data/upstream.json", root), "utf8"),
);
const checkOnly = process.argv.slice(2).includes("--check");
assert(
  process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node scripts/import-emoji.mjs [--check]",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = (hexcode) =>
  hexcode.toUpperCase().split(/[- ]+/).filter((part) => part !== "FE0F").join("-");
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

async function download(source) {
  assert(source.url.startsWith("https://"), "Upstream inputs must use HTTPS.");
  const response = await fetch(source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok && response.body, `Cannot fetch ${source.url}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= source.sizeBytes, `Oversized input: ${source.url}.`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(size, source.sizeBytes, `Input size changed: ${source.url}.`);
  assert.equal(sha256(bytes), source.sha256, `Input digest changed: ${source.url}.`);
  return bytes.toString("utf8");
}

const guide = await readFile(new URL("guide.md", root), "utf8");
for (const license of upstream.licenses) {
  const bytes = await readFile(new URL(license.path, root));
  assert.equal(sha256(bytes), license.sha256, `${license.path} changed.`);
  assert(guide.includes(bytes.toString("utf8").trim()), "The packaged guide must retain every license.");
}

const inputs = Object.fromEntries(
  await Promise.all(
    Object.entries(upstream.sources).map(async ([name, source]) => [
      name,
      await download(source),
    ]),
  ),
);
const sourceEmoji = JSON.parse(inputs.emoji);
const messages = JSON.parse(inputs.messages);
const github = JSON.parse(inputs.githubShortcodes);
const emojibase = JSON.parse(inputs.emojibaseShortcodes);
const groups = new Map(messages.groups.map((group) => [group.order, group]));
const canonical = new Map();
for (const match of inputs.unicode.matchAll(/^([0-9A-F ]+)\s*; fully-qualified\s*#/gm)) {
  const hexcode = match[1].trim().split(/ +/).join("-");
  assert(!canonical.has(key(hexcode)), `Duplicate Unicode sequence: ${hexcode}.`);
  canonical.set(
    key(hexcode),
    String.fromCodePoint(...hexcode.split("-").map((point) => Number.parseInt(point, 16))),
  );
}
assert.equal(canonical.size, 3944, "Unicode 17.0 fully-qualified coverage changed.");

function unicode(emoji) {
  const sequence = canonical.get(key(emoji.hexcode));
  assert(sequence, `Not a fully-qualified Unicode emoji: ${emoji.hexcode}.`);
  return sequence;
}

const bases = sourceEmoji.filter((emoji) =>
  groups.has(emoji.group) && groups.get(emoji.group).key !== "component",
);
const byHexcode = new Map(bases.map((emoji) => [key(emoji.hexcode), emoji]));

function variants(emoji) {
  const result = (emoji.skins ?? []).map((skin) => {
    const tones = Array.isArray(skin.tone) ? skin.tone : [skin.tone];
    assert(tones.every((tone) => Number.isInteger(tone) && tone >= 1 && tone <= 5));
    const tone = new Set(tones).size === 1 ? tones[0] : undefined;
    return {
      name: skin.label,
      unicode: unicode(skin),
      ...(tone === undefined ? {} : { tone }),
    };
  });
  const hexcode = key(emoji.hexcode);
  const alternatives = [
    ...["1F468", "1F469"].map((person) =>
      hexcode.replace(/^1F9D1(?=-|$)/, person),
    ),
    ...["2640", "2642", "27A1"].map((suffix) => `${hexcode}-200D-${suffix}`),
    ...(["1F9D1", "1F468", "1F469"].includes(hexcode)
      ? ["1F9B0", "1F9B1", "1F9B3", "1F9B2"].map((hair) => `${hexcode}-200D-${hair}`)
      : []),
  ];
  for (const alternative of alternatives) {
    const other = byHexcode.get(alternative);
    if (other && other !== emoji) {
      result.push({ name: other.label, unicode: unicode(other) });
    }
  }
  return result.filter(
    (variant, index) => result.findIndex((other) => other.unicode === variant.unicode) === index,
  );
}

function aliases(emoji) {
  const labelAlias = emoji.label.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const candidates = [github[emoji.hexcode], emojibase[emoji.hexcode], labelAlias].flat();
  return [...new Set(candidates)].filter(
    (alias) => typeof alias === "string" && /^[a-z0-9_+\-]{2,80}$/.test(alias),
  );
}

const entries = bases.map((emoji) => ({
  id: `u-${emoji.hexcode.toLowerCase()}`,
  name: emoji.label,
  unicode: unicode(emoji),
  keywords: [...new Set(emoji.tags ?? [])],
  shortcodes: aliases(emoji),
  category: groups.get(emoji.group).message,
  variants: variants(emoji),
}));

assert(entries.length > 0 && entries.length <= 5000);
assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
assert.equal(new Set(entries.map((entry) => entry.unicode)).size, entries.length);
const sequences = new Set();
for (const entry of entries) {
  assert(/^[a-z0-9-]{1,100}$/.test(entry.id));
  assert(entry.name.length > 0 && entry.name.length <= 160);
  assert(entry.category.length > 0 && entry.category.length <= 80);
  assert(entry.keywords.length <= 32 && entry.shortcodes.length <= 32);
  assert(entry.keywords.every((word) => word.length > 0 && word.length <= 80));
  assert(entry.shortcodes.length > 0, `No usable alias for ${entry.id}.`);
  assert(entry.variants.length <= 30);
  for (const variant of [entry, ...entry.variants]) {
    assert(variant.name.length > 0 && variant.name.length <= 160);
    assert(variant.unicode.length <= 64);
    assert.equal([...segmenter.segment(variant.unicode)].length, 1);
    assert(!/^[\u{1F3FB}-\u{1F3FF}]$/u.test(variant.unicode));
    sequences.add(variant.unicode);
  }
}
assert.deepEqual(
  [...sequences].sort(),
  [...canonical.values()].sort(),
  "Generated data must cover exactly every fully-qualified Unicode 17.0 emoji.",
);

const dataset = `${JSON.stringify(entries)}\n`;
const allVariants = entries.flatMap((entry) => entry.variants);
const snapshot = {
  upstream: `${upstream.package}@${upstream.version}`,
  unicodeVersion: upstream.unicodeVersion,
  baseEntries: entries.length,
  variants: allVariants.length,
  toneVariants: allVariants.filter((variant) => variant.tone !== undefined).length,
  otherVariants: allVariants.filter((variant) => variant.tone === undefined).length,
  maximumVariantsPerEntry: Math.max(...entries.map((entry) => entry.variants.length)),
  fullyQualifiedSequences: sequences.size,
  sequenceSetSha256: sha256(JSON.stringify([...sequences].sort())),
  datasetSizeBytes: Buffer.byteLength(dataset),
  datasetSha256: sha256(dataset),
};

for (const [path, content] of [
  ["src/emoji.json", dataset],
  ["data/snapshot.json", `${JSON.stringify(snapshot, null, 2)}\n`],
]) {
  const destination = new URL(path, root);
  if (checkOnly) {
    assert.equal(await readFile(destination, "utf8"), content, `${path} needs regeneration.`);
  } else {
    await writeFile(destination, content);
  }
}
console.log(
  `${checkOnly ? "Verified" : "Generated"} ${entries.length} base entries, ${allVariants.length} variants, ${sequences.size} Unicode sequences.`,
);
