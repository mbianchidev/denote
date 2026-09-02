import { describe, expect, it } from "vitest";
import {
  DiffTooLarge,
  hunkRequest,
  parseUnifiedDiff,
  supportsHunkStaging,
} from "../src/diffOutput";

/** One synthetic file with two separated edits, so Git emits two hunks. */
const SYNTHETIC_DIFF = [
  "diff --git a/notes/alpha.md b/notes/alpha.md",
  "index 1111111..2222222 100644",
  "--- a/notes/alpha.md",
  "+++ b/notes/alpha.md",
  "@@ -1,4 +1,4 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  " four",
  "@@ -8,3 +8,4 @@",
  " eight",
  "-nine",
  "+NINE",
  "+nine and a half",
  " ten",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("reads every hunk, line kind, and line number of a modified file", () => {
    const [file] = parseUnifiedDiff(SYNTHETIC_DIFF);

    expect(file.path).toBe("notes/alpha.md");
    expect(file.previousPath).toBeNull();
    expect(file.status).toBe("modified");
    expect(file.binary).toBe(false);
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(2);
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[0]).toMatchObject({
      header: "@@ -1,4 +1,4 @@",
      oldStart: 1,
      oldLines: 4,
      newStart: 1,
      newLines: 4,
    });
    expect(file.hunks[0].lines).toEqual([
      { kind: "context", oldLineNumber: 1, newLineNumber: 1, content: "one" },
      { kind: "deletion", oldLineNumber: 2, newLineNumber: null, content: "two" },
      { kind: "addition", oldLineNumber: null, newLineNumber: 2, content: "TWO" },
      { kind: "context", oldLineNumber: 3, newLineNumber: 3, content: "three" },
      { kind: "context", oldLineNumber: 4, newLineNumber: 4, content: "four" },
    ]);
    expect(file.hunks[1].lines.filter((line) => line.kind === "addition")).toEqual(
      [
        {
          kind: "addition",
          oldLineNumber: null,
          newLineNumber: 9,
          content: "NINE",
        },
        {
          kind: "addition",
          oldLineNumber: null,
          newLineNumber: 10,
          content: "nine and a half",
        },
      ],
    );
  });

  it("reads a path that contains a space without losing part of the name", () => {
    const [file] = parseUnifiedDiff(
      [
        "diff --git a/notes/my note.md b/notes/my note.md",
        "--- a/notes/my note.md",
        "+++ b/notes/my note.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
    );

    expect(file.path).toBe("notes/my note.md");
    // A single-line hunk header omits the count, which still means one line.
    expect(file.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 });
  });

  it("carries the missing final newline annotation on the line it follows", () => {
    const [file] = parseUnifiedDiff(
      [
        "diff --git a/alpha.md b/alpha.md",
        "--- a/alpha.md",
        "+++ b/alpha.md",
        "@@ -1 +1 @@",
        "-before",
        "\\ No newline at end of file",
        "+after",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );

    expect(file.hunks[0].lines[0].noNewlineAtEndOfFile).toBe(true);
    expect(file.hunks[0].lines[1].noNewlineAtEndOfFile).toBe(true);
    expect(hunkRequest(file.hunks[0]).lines).toEqual([
      { kind: "deletion", content: "before", noNewlineAtEndOfFile: true },
      { kind: "addition", content: "after", noNewlineAtEndOfFile: true },
    ]);
  });

  it("reports binary, added, deleted, renamed, and copied files without inventing hunks", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/image.png b/image.png",
        "index 1111111..2222222 100644",
        "Binary files a/image.png and b/image.png differ",
        "diff --git a/new.md b/new.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.md",
        "@@ -0,0 +1 @@",
        "+fresh",
        "diff --git a/gone.md b/gone.md",
        "deleted file mode 100644",
        "--- a/gone.md",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-removed",
        "diff --git a/old.md b/moved.md",
        "similarity index 100%",
        "rename from old.md",
        "rename to moved.md",
        "",
      ].join("\n"),
    );

    expect(files.map((file) => [file.path, file.status, file.binary])).toEqual([
      ["image.png", "modified", true],
      ["new.md", "added", false],
      ["gone.md", "deleted", false],
      ["moved.md", "renamed", false],
    ]);
    expect(files[0].hunks).toEqual([]);
    expect(files[3].previousPath).toBe("old.md");
    expect(files.map(supportsHunkStaging)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("offers hunk staging only for an ordinary text modification", () => {
    const [file] = parseUnifiedDiff(SYNTHETIC_DIFF);

    expect(supportsHunkStaging(file)).toBe(true);
  });

  it("refuses a diff larger than it will parse instead of truncating it", () => {
    const header = [
      "diff --git a/alpha.md b/alpha.md",
      "--- a/alpha.md",
      "+++ b/alpha.md",
      "@@ -1,1 +1,20001 @@",
      " one",
    ];
    const body = Array.from({ length: 20001 }, (_, index) => `+line ${index}`);

    expect(() => parseUnifiedDiff([...header, ...body].join("\n"))).toThrow(
      DiffTooLarge,
    );
    expect(() =>
      parseUnifiedDiff(
        [...header, `+${"a".repeat(9000)}`].join("\n"),
      ),
    ).toThrow(DiffTooLarge);
  });

  it("reads the tab-terminated and C-quoted names Git actually writes", () => {
    const files = parseUnifiedDiff(
      [
        // A name containing " b/" makes the `diff --git` line ambiguous, so
        // the tab-terminated file headers are what resolve it.
        "diff --git a/Plan b/notes.md b/Plan b/notes.md",
        "index 1111111..2222222 100644",
        "--- a/Plan b/notes.md\t",
        "+++ b/Plan b/notes.md\t",
        "@@ -1 +1 @@",
        "-x",
        "+y",
        // Git C-quotes a non-ASCII name as octal bytes.
        'diff --git "a/sub dir/caf\\303\\251.md" "b/sub dir/caf\\303\\251.md"',
        '--- "a/sub dir/caf\\303\\251.md"\t',
        '+++ "b/sub dir/caf\\303\\251.md"\t',
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO",
        "",
      ].join("\n"),
    );

    expect(files.map((file) => file.path)).toEqual([
      "Plan b/notes.md",
      "sub dir/café.md",
    ]);
    expect(files.map((file) => file.hunks.length)).toEqual([1, 1]);
    expect(files.every(supportsHunkStaging)).toBe(true);
  });

  it("keeps a rename whose new name is quoted separate from the file before it", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/alpha.md b/alpha.md",
        "--- a/alpha.md",
        "+++ b/alpha.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        // Only the new name needs quoting, so the header has no " b/" at all.
        'diff --git a/plain.md "b/r\\303\\251name.md"',
        "similarity index 100%",
        "rename from plain.md",
        'rename to "r\\303\\251name.md"',
        "",
      ].join("\n"),
    );

    expect(files.map((file) => [file.path, file.previousPath, file.status])).toEqual(
      [
        ["alpha.md", null, "modified"],
        ["réname.md", "plain.md", "renamed"],
      ],
    );
    // The first file keeps its own hunk instead of collecting the rename's.
    expect(files[0].hunks).toHaveLength(1);
    expect(files[1].hunks).toHaveLength(0);
  });

  it("names a deleted file from the side that still has a name", () => {
    const [file] = parseUnifiedDiff(
      [
        "diff --git a/gone.md b/gone.md",
        "deleted file mode 100644",
        "--- a/gone.md",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-removed",
        "",
      ].join("\n"),
    );

    expect(file.path).toBe("gone.md");
    expect(file.status).toBe("deleted");
  });

  it("ignores text that is not part of a hunk", () => {
    const files = parseUnifiedDiff(
      [
        "warning: something Git said",
        "diff --git a/alpha.md b/alpha.md",
        "--- a/alpha.md",
        "+++ b/alpha.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "trailing text that carries no diff marker",
        "",
      ].join("\n"),
    );

    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].lines).toHaveLength(2);
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  it("keeps the carriage return of a CRLF file on every line", () => {
    // Git writes the file's own bytes after the marker, so a CRLF file carries
    // a carriage return that has to reach the host untouched: a patch rebuilt
    // without it would not match the file it came from.
    const files = parseUnifiedDiff(
      [
        "diff --git a/notes/alpha.md b/notes/alpha.md",
        "--- a/notes/alpha.md",
        "+++ b/notes/alpha.md",
        "@@ -1,3 +1,3 @@",
        " one\r",
        "-two\r",
        "+TWO\r",
        " three\r",
        "",
      ].join("\n"),
    );

    expect(files[0].hunks[0].lines.map((line) => line.content)).toEqual([
      "one\r",
      "two\r",
      "TWO\r",
      "three\r",
    ]);
    expect(hunkRequest(files[0].hunks[0]).lines).toEqual([
      { kind: "context", content: "one\r" },
      { kind: "deletion", content: "two\r" },
      { kind: "addition", content: "TWO\r" },
      { kind: "context", content: "three\r" },
    ]);
  });

  it("reads hunk content that looks like a file header as content", () => {
    // Git writes the file's own bytes straight after the marker, so a deleted
    // `-- ` line (a SQL comment, or the separator an email signature starts
    // with) reaches the parser as `--- `, and an added `++ ` line reaches it
    // as `+++ `. Read as file headers, they would rename the file mid-hunk and
    // drop the rest of its body.
    const files = parseUnifiedDiff(
      [
        "diff --git a/notes/log.md b/notes/log.md",
        "index 1111111..2222222 100644",
        "--- a/notes/log.md",
        "+++ b/notes/log.md",
        "@@ -1,5 +1,5 @@",
        " intro",
        "--- separator",
        " middle",
        "-old tail",
        "+++ other.md",
        "+new tail",
        " outro",
        "",
      ].join("\n"),
    );

    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file.path).toBe("notes/log.md");
    expect(file.previousPath).toBeNull();
    expect(file.status).toBe("modified");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(2);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 5,
    });
    // Every line after the two ambiguous ones keeps counting from the right
    // place on both sides.
    expect(file.hunks[0].lines).toEqual([
      { kind: "context", oldLineNumber: 1, newLineNumber: 1, content: "intro" },
      {
        kind: "deletion",
        oldLineNumber: 2,
        newLineNumber: null,
        content: "-- separator",
      },
      { kind: "context", oldLineNumber: 3, newLineNumber: 2, content: "middle" },
      {
        kind: "deletion",
        oldLineNumber: 4,
        newLineNumber: null,
        content: "old tail",
      },
      {
        kind: "addition",
        oldLineNumber: null,
        newLineNumber: 3,
        content: "++ other.md",
      },
      {
        kind: "addition",
        oldLineNumber: null,
        newLineNumber: 4,
        content: "new tail",
      },
      { kind: "context", oldLineNumber: 5, newLineNumber: 5, content: "outro" },
    ]);
    expect(supportsHunkStaging(file)).toBe(true);
    // The request the host rebuilds its patch from carries the same bytes, so
    // the two sides still count exactly what the header states.
    const request = hunkRequest(file.hunks[0]);
    expect(request).toMatchObject({
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 5,
    });
    expect(
      request.lines.filter((line) => line.kind !== "addition").length,
    ).toBe(5);
    expect(
      request.lines.filter((line) => line.kind !== "deletion").length,
    ).toBe(5);
  });

  it("resumes reading file metadata once a hunk's counts are spent", () => {
    // The hunk header states how many lines each side carries, so the body
    // ends where those counts run out rather than at the first line that
    // resembles a header. The file that follows is read as its own entry.
    const files = parseUnifiedDiff(
      [
        "diff --git a/notes/log.md b/notes/log.md",
        "--- a/notes/log.md",
        "+++ b/notes/log.md",
        "@@ -1,2 +1,2 @@",
        "--- separator",
        " kept",
        "+++ other.md",
        "@@ -9,2 +9,2 @@",
        "-- ",
        " tail",
        "++ ",
        "diff --git a/notes/next.md b/notes/next.md",
        "--- a/notes/next.md",
        "+++ b/notes/next.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
    );

    expect(files.map((file) => file.path)).toEqual([
      "notes/log.md",
      "notes/next.md",
    ]);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[1]).toMatchObject({
      header: "@@ -9,2 +9,2 @@",
      oldStart: 9,
      newStart: 9,
    });
    // The second hunk starts counting from its own header, not from the first.
    expect(files[0].hunks[1].lines).toEqual([
      {
        kind: "deletion",
        oldLineNumber: 9,
        newLineNumber: null,
        content: "- ",
      },
      { kind: "context", oldLineNumber: 10, newLineNumber: 9, content: "tail" },
      {
        kind: "addition",
        oldLineNumber: null,
        newLineNumber: 10,
        content: "+ ",
      },
    ]);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(2);
    expect(files[1].hunks[0].lines).toEqual([
      {
        kind: "deletion",
        oldLineNumber: 1,
        newLineNumber: null,
        content: "before",
      },
      {
        kind: "addition",
        oldLineNumber: null,
        newLineNumber: 1,
        content: "after",
      },
    ]);
  });

  it("annotates a missing final newline on content that looks like a header", () => {
    const [file] = parseUnifiedDiff(
      [
        "diff --git a/notes/sig.md b/notes/sig.md",
        "--- a/notes/sig.md",
        "+++ b/notes/sig.md",
        "@@ -1,2 +1,2 @@",
        " kept",
        "--- separator",
        "\\ No newline at end of file",
        "+++ other.md",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );

    expect(file.path).toBe("notes/sig.md");
    expect(hunkRequest(file.hunks[0]).lines).toEqual([
      { kind: "context", content: "kept" },
      {
        kind: "deletion",
        content: "-- separator",
        noNewlineAtEndOfFile: true,
      },
      {
        kind: "addition",
        content: "++ other.md",
        noNewlineAtEndOfFile: true,
      },
    ]);
  });
});
