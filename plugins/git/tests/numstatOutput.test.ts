import { describe, expect, it } from "vitest";
import { PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS } from "@denote/plugin-sdk";
import { parseNumstat } from "../src/numstatOutput";

describe("parseNumstat", () => {
  it("reads additions, deletions, binary files, and real zero-line changes", () => {
    expect(parseNumstat([
      "3\t1\tnotes/edited.md",
      "0\t4\tremoved.md",
      "-\t-\timage.bin",
      "0\t0\tscript.sh",
      "",
    ].join("\0")))
      .toEqual([
        { path: "notes/edited.md", previousPath: null, additions: 3, deletions: 1, binary: false },
        { path: "removed.md", previousPath: null, additions: 0, deletions: 4, binary: false },
        { path: "image.bin", previousPath: null, additions: 0, deletions: 0, binary: true },
        { path: "script.sh", previousPath: null, additions: 0, deletions: 0, binary: false },
      ]);
    expect(parseNumstat("")).toEqual([]);
  });

  it("keeps whitespace, Unicode, and both paths in a rename intact", () => {
    const previousPath = " old\tname\n.md ";
    const path = " notes/\u65e5\u672c\u8a9e.md ";
    expect(parseNumstat(`2\t1\t\0${previousPath}\0${path}\0`)).toEqual([
      { path, previousPath, additions: 2, deletions: 1, binary: false },
    ]);
    expect(parseNumstat(`1\t0\t${previousPath}\0`)[0].path).toBe(previousPath);
  });

  it.each([
    "1\t2\tincomplete.md",
    "1\t2\t\0old.md\0",
    "1\t2\t\0\0new.md\0",
    "bad\t1\tfile.md\0",
    "1\t-\tfile.md\0",
    "-1\t1\tfile.md\0",
    "1.5\t1\tfile.md\0",
    "9007199254740992\t1\tfile.md\0",
    "\0",
  ])("refuses an incomplete or invalid report instead of inventing zeros", (output) => {
    expect(() => parseNumstat(output)).toThrow(/incomplete or invalid/);
  });

  it("refuses oversized reports instead of showing a truncated total", () => {
    const atLimit = Array.from(
      { length: PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS },
      (_, index) => `1\t0\tfile-${index}.md\0`,
    ).join("");
    expect(parseNumstat(atLimit)).toHaveLength(PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS);
    const output = Array.from(
      { length: PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS + 1 },
      (_, index) => `1\t0\tfile-${index}.md\0`,
    ).join("");
    expect(() => parseNumstat(output)).toThrow(/more than 5000 changed files/);
  });
});
