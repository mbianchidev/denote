import { describe, expect, it } from "vitest";
import { parseStatus } from "../src/statusOutput";
import { splitFields } from "../src/splitFields";

/** One synthetic `--porcelain=v2 --branch -z` payload. */
function statusOutput(records: string[]): string {
  return `${records.join("\0")}\0`;
}

describe("parseStatus", () => {
  it("reads branch, upstream, divergence, and every resource group", () => {
    const report = parseStatus(
      statusOutput([
        "# branch.oid 1111111111111111111111111111111111111111",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        "1 M. N... 100644 100644 100644 1111111 2222222 notes/alpha note.md",
        "1 .M N... 100644 100644 100644 1111111 2222222 notes/beta.md",
        "1 MM N... 100644 100644 100644 1111111 2222222 notes/gamma.md",
        "1 D. N... 100644 000000 000000 1111111 0000000 notes/removed.md",
        "2 R. N... 100644 100644 100644 1111111 2222222 R100 notes/renamed.md",
        "notes/original.md",
        "u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 notes/conflict.md",
        "? notes/untracked.md",
      ]),
    );

    expect(report.branch).toBe("main");
    expect(report.detached).toBe(false);
    expect(report.upstream).toBe("origin/main");
    expect(report.ahead).toBe(2);
    expect(report.behind).toBe(1);
    expect(report.staged).toEqual([
      {
        path: "notes/alpha note.md",
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
      },
      {
        path: "notes/gamma.md",
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
      },
      {
        path: "notes/removed.md",
        status: "deleted",
        additions: 0,
        deletions: 0,
        binary: false,
      },
      {
        path: "notes/renamed.md",
        status: "renamed",
        additions: 0,
        deletions: 0,
        binary: false,
      },
    ]);
    expect(report.unstaged.map((resource) => resource.path)).toEqual([
      "notes/beta.md",
      "notes/gamma.md",
    ]);
    expect(report.untracked.map((resource) => resource.path)).toEqual([
      "notes/untracked.md",
    ]);
    expect(report.conflicted).toEqual([
      {
        path: "notes/conflict.md",
        status: "unmerged",
        additions: 0,
        deletions: 0,
        binary: false,
      },
    ]);
  });

  it("consumes the original path of a rename instead of treating it as a record", () => {
    const report = parseStatus(
      statusOutput([
        "# branch.head main",
        "2 R. N... 100644 100644 100644 1111111 2222222 R100 notes/renamed.md",
        "? untouched.md",
        "? actually-untracked.md",
      ]),
    );

    // The field after a rename record is its original path, so the first `?`
    // record here is consumed and only the second is untracked.
    expect(report.untracked.map((resource) => resource.path)).toEqual([
      "actually-untracked.md",
    ]);
  });

  it("reports a detached head and an empty repository without inventing values", () => {
    const report = parseStatus(
      statusOutput(["# branch.oid (initial)", "# branch.head (detached)"]),
    );

    expect(report.branch).toBeNull();
    expect(report.detached).toBe(true);
    expect(report.upstream).toBeNull();
    expect(report.ahead).toBe(0);
    expect(report.behind).toBe(0);
    expect(report.staged).toEqual([]);
    expect(parseStatus("")).toMatchObject({ branch: null, staged: [] });
  });

  it("keeps a separator inside the final field", () => {
    expect(splitFields("a b c d", " ", 3)).toEqual(["a", "b", "c d"]);
    expect(splitFields("single", "\t", 4)).toEqual(["single"]);
    expect(splitFields("a\tb", "\t", 1)).toEqual(["a\tb"]);
  });
});
