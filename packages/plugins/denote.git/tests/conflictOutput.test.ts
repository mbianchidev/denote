import { describe, expect, it } from "vitest";
import { parseUnmergedPaths } from "../src/conflictOutput";

/** One `ls-files --unmerged -z` record. */
function record(stage: number, path: string): string {
  return `100644 ${"1".repeat(40)} ${stage}\t${path}\0`;
}

describe("parseUnmergedPaths", () => {
  it("groups every recorded stage under its exact path", () => {
    const stdout = [
      record(1, "notes/alpha.md"),
      record(2, "notes/alpha.md"),
      record(3, "notes/alpha.md"),
      record(2, "notes/added on both.md"),
      record(3, "notes/added on both.md"),
    ].join("");

    expect(parseUnmergedPaths(stdout)).toEqual([
      { path: "notes/alpha.md", base: true, ours: true, theirs: true },
      { path: "notes/added on both.md", base: false, ours: true, theirs: true },
    ]);
  });

  it("keeps a path that contains a space or a tab-free unusual name", () => {
    expect(parseUnmergedPaths(record(2, "notes/a note.md"))).toEqual([
      { path: "notes/a note.md", base: false, ours: true, theirs: false },
    ]);
  });

  it("drops records it cannot read instead of inventing a path", () => {
    const stdout = [
      "not a record\0",
      `100644 ${"1".repeat(40)} 9\tnotes/odd.md\0`,
      record(3, "notes/kept.md"),
      "\0",
    ].join("");

    expect(parseUnmergedPaths(stdout)).toEqual([
      { path: "notes/kept.md", base: false, ours: false, theirs: true },
    ]);
  });

  it("reports nothing for an empty report", () => {
    expect(parseUnmergedPaths("")).toEqual([]);
  });
});
