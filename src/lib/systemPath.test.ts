import { describe, expect, it } from "vitest";
import { systemPathForDisplay } from "./systemPath";

describe("systemPathForDisplay", () => {
  it("removes Windows verbatim drive prefixes", () => {
    expect(systemPathForDisplay(String.raw`\\?\C:\workspace`)).toBe(
      String.raw`C:\workspace`,
    );
  });

  it("converts Windows verbatim UNC prefixes", () => {
    expect(
      systemPathForDisplay(String.raw`\\?\UNC\server\share\workspace`),
    ).toBe(String.raw`\\server\share\workspace`);
  });

  it("normalizes embedded paths without changing ordinary paths", () => {
    expect(
      systemPathForDisplay(
        String.raw`Unable to open \\?\C:\workspace\note.md`,
      ),
    ).toBe(String.raw`Unable to open C:\workspace\note.md`);
    expect(systemPathForDisplay("/workspace/note.md")).toBe(
      "/workspace/note.md",
    );
    expect(systemPathForDisplay(String.raw`notes\\?\literal.md`)).toBe(
      String.raw`notes\\?\literal.md`,
    );
  });
});
