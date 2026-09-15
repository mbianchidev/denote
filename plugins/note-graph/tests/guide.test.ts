import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const guide = readFileSync(
  join(process.cwd(), "plugins/note-graph/guide.md"),
  "utf8",
);

describe("Note graph guide", () => {
  it("documents the exact host and rendering bounds", () => {
    expect(guide).toContain("at most 5,000 notes and 8 MiB");
    expect(guide).toContain("at most 256 KiB from any one note");
    expect(guide).toContain("at most 256 documents and 512 KiB");
    expect(guide).toContain("at most 512 removed paths");
    expect(guide).toContain("first 100,000 local link occurrences");
    expect(guide).toContain("at most 500 nodes and 2,000 edges");
    expect(guide).not.toContain("1 MiB of source per document");
    expect(guide).not.toContain("8 MiB per index request");
  });
});
