import { describe, expect, it } from "vitest";
import { applyCodeEdits, codePositionOffset, parseCodeJump } from "./codeTools";

describe("host-owned code positions and edits", () => {
  it("uses UTF-16 columns and preserves text outside an explicitly approved edit", () => {
    const source = "a\u{1f680}b\nsecond\n";
    expect(codePositionOffset(source, { line: 1, character: 2 })).toBe(7);
    expect(applyCodeEdits(source, [{
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, text: "z",
    }])).toBe("azb\nsecond\n");
    expect(() => applyCodeEdits(source, [{
      range: { start: { line: 0, character: 99 }, end: { line: 0, character: 100 } }, text: "x",
    }])).toThrow(/column/i);
    const duplicate = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "x" };
    expect(() => applyCodeEdits(source, [duplicate, duplicate])).toThrow(/overlap/i);
  });

  it("parses searchable file/line/column navigation without permitting traversal", () => {
    expect(parseCodeJump("sample/main.rs:12:4")).toMatchObject({
      path: "sample/main.rs", range: { start: { line: 11, character: 3 }, end: { line: 11, character: 3 } },
    });
    expect(parseCodeJump(":3", "sample/main.rs")?.range.start).toEqual({ line: 2, character: 0 });
    expect(() => parseCodeJump("../outside.rs:2")).toThrow(/vault/i);
    expect(() => parseCodeJump("sample/main.rs:0")).toThrow(/positive/i);
  });
});
