import { describe, expect, it } from "vitest";
import { BUILD_INFO, shortCommitHash } from "./buildInfo";

describe("build information", () => {
  it("embeds the package version and full artifact commit", () => {
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(BUILD_INFO.commitHash).toMatch(/^[0-9a-f]{40}$/i);
    expect(BUILD_INFO.dirty).toBeTypeOf("boolean");
    expect(shortCommitHash(BUILD_INFO.commitHash)).toHaveLength(12);
  });
});
