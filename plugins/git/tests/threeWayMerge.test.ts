import { describe, expect, it } from "vitest";
import {
  MAX_MERGE_LINES,
  MAX_MERGE_LINE_LENGTH,
  MergeTooLarge,
  chunkResultLines,
  mergeResultText,
  splitMergeLines,
  threeWayMerge,
} from "../src/threeWayMerge";

/** Joins synthetic lines into a file that ends with a newline. */
function file(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("splitMergeLines", () => {
  it("keeps every line and records a missing final newline", () => {
    expect(splitMergeLines("one\ntwo\n")).toEqual({
      lines: ["one", "two"],
      finalNewline: true,
    });
    expect(splitMergeLines("one\ntwo")).toEqual({
      lines: ["one", "two"],
      finalNewline: false,
    });
    expect(splitMergeLines("")).toEqual({ lines: [], finalNewline: true });
  });

  it("keeps carriage returns as part of the line", () => {
    expect(splitMergeLines("one\r\ntwo\r\n").lines).toEqual(["one\r", "two\r"]);
  });
});

describe("threeWayMerge", () => {
  it("combines changes that do not overlap without asking anything", () => {
    const merge = threeWayMerge(
      file("one", "two", "three", "four"),
      file("ONE", "two", "three", "four"),
      file("one", "two", "three", "FOUR"),
    );

    expect(merge.conflicted).toBe(false);
    expect(merge.chunks.every((chunk) => chunk.kind !== "conflict")).toBe(true);
    expect(mergeResultText(merge)).toBe(file("ONE", "two", "three", "FOUR"));
  });

  it("reports a chunk with all three sides when both changed the same lines", () => {
    const merge = threeWayMerge(
      file("one", "two", "three"),
      file("one", "OURS", "three"),
      file("one", "THEIRS", "three"),
    );

    expect(merge.conflicted).toBe(true);
    const conflicts = merge.chunks.filter((chunk) => chunk.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].base).toEqual(["two"]);
    expect(conflicts[0].ours).toEqual(["OURS"]);
    expect(conflicts[0].theirs).toEqual(["THEIRS"]);
    // Nothing is chosen for the user: a conflicting chunk starts unanswered.
    expect(conflicts[0].automatic).toBeNull();
  });

  it("keeps a chunk answerable with any of the three sides", () => {
    const merge = threeWayMerge(
      file("one", "two", "three"),
      file("one", "OURS", "three"),
      file("one", "THEIRS", "three"),
    );
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    if (!conflict) {
      throw new Error("expected a conflicting chunk");
    }

    expect(chunkResultLines(conflict, "ours")).toEqual(["OURS"]);
    expect(chunkResultLines(conflict, "theirs")).toEqual(["THEIRS"]);
    expect(chunkResultLines(conflict, "base")).toEqual(["two"]);
    expect(mergeResultText(merge, { [conflict.id]: "theirs" })).toBe(
      file("one", "THEIRS", "three"),
    );
    expect(mergeResultText(merge, { [conflict.id]: "base" })).toBe(
      file("one", "two", "three"),
    );
  });

  it("takes an identical change from both sides once", () => {
    const merge = threeWayMerge(
      file("one", "two"),
      file("one", "TWO"),
      file("one", "TWO"),
    );

    expect(merge.conflicted).toBe(false);
    expect(mergeResultText(merge)).toBe(file("one", "TWO"));
  });

  it("merges an addition on one side with a deletion on the other", () => {
    const merge = threeWayMerge(
      file("one", "two", "three"),
      file("one", "two", "three", "four"),
      file("one", "three"),
    );

    expect(merge.conflicted).toBe(false);
    expect(mergeResultText(merge)).toBe(file("one", "three", "four"));
  });

  it("conflicts when one side deletes the lines the other changed", () => {
    const merge = threeWayMerge(
      file("one", "two", "three"),
      file("one", "TWO", "three"),
      file("one", "three"),
    );

    expect(merge.conflicted).toBe(true);
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    expect(conflict?.ours).toEqual(["TWO"]);
    expect(conflict?.theirs).toEqual([]);
    expect(conflict?.base).toEqual(["two"]);
  });

  it("keeps every line of every side somewhere in the chunk model", () => {
    const base = file("alpha", "beta", "gamma", "delta");
    const ours = file("alpha", "BETA", "gamma", "delta", "epsilon");
    const theirs = file("alpha", "beta", "GAMMA", "zeta");
    const merge = threeWayMerge(base, ours, theirs);

    const collected = (side: "base" | "ours" | "theirs") =>
      merge.chunks.flatMap((chunk) => chunk[side]);
    expect(collected("base")).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(collected("ours")).toEqual([
      "alpha",
      "BETA",
      "gamma",
      "delta",
      "epsilon",
    ]);
    expect(collected("theirs")).toEqual(["alpha", "beta", "GAMMA", "zeta"]);
  });

  it("preserves CRLF line endings on every side", () => {
    const merge = threeWayMerge(
      "one\r\ntwo\r\n",
      "ONE\r\ntwo\r\n",
      "one\r\nTWO\r\n",
    );

    expect(merge.conflicted).toBe(false);
    expect(mergeResultText(merge)).toBe("ONE\r\nTWO\r\n");
  });

  it("keeps a missing final newline out of the merged result", () => {
    const merge = threeWayMerge("one\ntwo", "ONE\ntwo", "one\ntwo");

    expect(merge.finalNewline).toBe(false);
    expect(mergeResultText(merge)).toBe("ONE\ntwo");
  });

  it("adds the final newline back when every side has one", () => {
    const merge = threeWayMerge("one\n", "ONE\n", "one\n");

    expect(merge.finalNewline).toBe(true);
    expect(mergeResultText(merge)).toBe("ONE\n");
  });

  it("merges Unicode content by whole lines", () => {
    const merge = threeWayMerge(
      file("émoji 🌱", "ünïcödé", "行"),
      file("émoji 🌳", "ünïcödé", "行"),
      file("émoji 🌱", "ünïcödé", "漢"),
    );

    expect(merge.conflicted).toBe(false);
    expect(mergeResultText(merge)).toBe(file("émoji 🌳", "ünïcödé", "漢"));
  });

  it("treats a side that Git does not hold as an empty side", () => {
    const merge = threeWayMerge(null, file("ours"), file("theirs"));

    expect(merge.conflicted).toBe(true);
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    expect(conflict?.base).toEqual([]);
    expect(conflict?.ours).toEqual(["ours"]);
    expect(conflict?.theirs).toEqual(["theirs"]);
  });

  it("refuses content with more lines than it will merge", () => {
    const many = `${Array.from({ length: MAX_MERGE_LINES + 1 }, (_, index) => `line ${index}`).join("\n")}\n`;

    expect(() => threeWayMerge(many, many, many)).toThrow(MergeTooLarge);
  });

  it("refuses a line longer than it will merge", () => {
    const long = `${"a".repeat(MAX_MERGE_LINE_LENGTH + 1)}\n`;

    expect(() => threeWayMerge(long, long, long)).toThrow(MergeTooLarge);
  });

  it("gives every chunk a stable identity", () => {
    const merge = threeWayMerge(
      file("one", "two", "three"),
      file("one", "OURS", "three"),
      file("one", "THEIRS", "three"),
    );
    const again = threeWayMerge(
      file("one", "two", "three"),
      file("one", "OURS", "three"),
      file("one", "THEIRS", "three"),
    );

    expect(merge.chunks.map((chunk) => chunk.id)).toEqual(
      again.chunks.map((chunk) => chunk.id),
    );
    expect(new Set(merge.chunks.map((chunk) => chunk.id)).size).toBe(
      merge.chunks.length,
    );
  });

  it("reports an unanswered chunk as unresolved until it is chosen", () => {
    const merge = threeWayMerge(
      file("one", "two"),
      file("one", "OURS"),
      file("one", "THEIRS"),
    );
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    if (!conflict) {
      throw new Error("expected a conflicting chunk");
    }

    // An unanswered chunk contributes nothing invented: the result keeps the
    // lines every side agreed on and nothing else.
    expect(mergeResultText(merge)).toBe(file("one"));
    expect(mergeResultText(merge, { [conflict.id]: "ours" })).toBe(
      file("one", "OURS"),
    );
  });
});
