// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { frontendBundle } from "./frontend-bundle";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function bundleSource(
  source: string,
  path = "node_modules/@shikijs/langs/dist/synthetic.mjs",
) {
  const root = mkdtempSync(join(tmpdir(), "denote-grammar-test-"));
  directories.push(root);
  const entry = join(root, path);
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, source);
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [frontendBundle()],
    build: {
      write: false,
      minify: false,
      target: "esnext",
      lib: { entry, formats: ["es"], fileName: "grammar" },
    },
  });
  const bundle = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (Array.isArray(bundle) || !("output" in bundle)) {
    throw new Error("Expected one in-memory frontend bundle.");
  }
  return bundle.output;
}

describe("frontend bundle", () => {
  it("moves large grammar data into an exact local JSON asset", async () => {
    const grammar = {
      name: "synthetic",
      scopeName: "source.synthetic",
      patterns: [{ match: "x".repeat(510_000) }],
    };
    const output = await bundleSource(
      `const lang = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(grammar))}));\nexport default [lang];\n`,
    );
    const asset = output.find((item) => item.type === "asset");
    expect(asset?.fileName).toMatch(/synthetic.*\.json$/);
    if (asset?.type !== "asset") {
      throw new Error("Missing grammar asset.");
    }
    expect(JSON.parse(String(asset.source))).toEqual(grammar);
    const chunk = output.find((item) => item.type === "chunk");
    expect(chunk?.type === "chunk" && chunk.code).toContain("fetch(");
    expect(chunk?.type === "chunk" && chunk.code).toContain("response.ok");
    expect(chunk?.type === "chunk" && chunk.code).toContain("Object.freeze");
    expect(chunk?.type === "chunk" && chunk.code.length).toBeLessThan(5_000);
  });

  it("leaves small grammar modules inline", async () => {
    const output = await bundleSource(
      'const lang = Object.freeze(JSON.parse("{\\"name\\":\\"synthetic\\"}"));\nexport default [lang];',
    );
    expect(output.every((item) => item.type === "chunk")).toBe(true);
  });

  it("rejects unexpected large grammar formats instead of evaluating package code", async () => {
    await expect(bundleSource(
      `export default [{name: "synthetic", data: ${JSON.stringify("x".repeat(510_000))}}];`,
    )).rejects.toThrow(/grammar.*format/i);
  });

  it("rejects main-thread chunks over the byte budget, including Unicode", async () => {
    await expect(bundleSource(
      `export default ${JSON.stringify("\u00e9".repeat(260_000))};`,
      "entry.mjs",
    )).rejects.toThrow(/500000-byte JavaScript budget/);
  });

  it("keeps main-thread chunks below the byte budget", async () => {
    await expect(bundleSource(
      `export default ${JSON.stringify("x".repeat(490_000))};`,
      "entry.mjs",
    )).resolves.toHaveLength(1);
  });
});
