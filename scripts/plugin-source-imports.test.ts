// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runtimeSourceImports } from "./plugin-source-imports";

describe("plugin runtime dependency classification", () => {
  it("erases type-only imports without treating shared declarations as runtime dependencies", async () => {
    expect(await runtimeSourceImports(
      'import type { Nodes } from "mdast"; export const value: Nodes | null = null;',
      "example.ts",
    )).toEqual([]);
  });

  it("keeps actual imports, side effects, dynamic imports, and require calls", async () => {
    const source = [
      'import { value } from "actual-package";',
      'import "side-effect";',
      'export { other } from "re-export";',
      'export const result = [value, import("dynamic-package"), require("required-package")];',
    ].join("\n");
    expect(await runtimeSourceImports(source, "example.ts")).toEqual([
      "actual-package", "side-effect", "re-export", "dynamic-package", "required-package",
    ]);
  });

  it("does not confuse comments or strings with imports or hide a default binding named type", async () => {
    expect(await runtimeSourceImports(
      'import type from "actual-package"; const text = "import type { X } from fake"; export const result = [type, text];',
      "example.ts",
    )).toEqual(["actual-package"]);
  });
});
