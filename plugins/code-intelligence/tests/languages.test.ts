import { describe, expect, it } from "vitest";
import { LANGUAGE_ADAPTERS, languageForPath } from "../src/languages";

describe("documented code adapters", () => {
  it("covers every initial language without installing or spawning a tool", () => {
    expect(LANGUAGE_ADAPTERS.map((adapter) => adapter.id))
      .toEqual(["rust", "go", "python", "java", "cpp", "typescript"]);
    for (const [path, language] of [
      ["sample/main.rs", "rust"], ["sample/main.go", "go"],
      ["sample/main.py", "python"], ["sample/Main.java", "java"],
      ["sample/main.c", "cpp"], ["sample/main.hpp", "cpp"],
      ["sample/main.cpp", "cpp"], ["sample/main.js", "typescript"],
      ["sample/main.jsx", "typescript"], ["sample/main.ts", "typescript"],
      ["sample/main.tsx", "typescript"], ["sample/main.mjs", "typescript"],
    ]) expect(languageForPath(path)).toBe(language);
    expect(languageForPath("sample/README.md")).toBeNull();
  });
});
