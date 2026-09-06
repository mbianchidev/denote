import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dependency install scripts", () => {
  it("pins the required esbuild script and denies the optional fsevents rebuild", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.allowScripts).toEqual({
      "esbuild@0.28.2": true,
      fsevents: false,
    });
  });
});
