// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkPluginApi } from "./check-plugin-api.mjs";

it("rejects a changed public declaration without rewriting the frozen baseline", () => {
  const directory = mkdtempSync(join(tmpdir(), "denote-api-contract-test-"));
  const baseline = join(directory, "baseline");
  const project = join(directory, "tsconfig.json");
  const source = join(directory, "api.ts");
  try {
    mkdirSync(baseline);
    writeFileSync(project, JSON.stringify({
      compilerOptions: {
        target: "es2020", declaration: true, emitDeclarationOnly: true,
        removeComments: true, skipLibCheck: true, types: [],
      },
      files: ["api.ts"],
    }));
    writeFileSync(source, "export function lookup(value: string): string { return value; }\n");
    checkPluginApi({ project, baseline, update: true });
    const frozen = readFileSync(join(baseline, "api.d.ts"), "utf8");

    writeFileSync(source, "// Internal implementation change.\nexport function lookup(value: string): string { return value.trim(); }\n");
    expect(() => checkPluginApi({ project, baseline })).not.toThrow();
    writeFileSync(source, "export function lookup(value: number): string { return String(value); }\n");
    expect(() => checkPluginApi({ project, baseline })).toThrow(/API 1 declarations changed/);
    expect(readFileSync(join(baseline, "api.d.ts"), "utf8")).toBe(frozen);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
