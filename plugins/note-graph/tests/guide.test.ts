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
    expect(guide).toContain("prioritizes the active note");
    expect(guide).not.toContain("active and open notes");
    expect(guide).toContain("first 100,000 local link occurrences");
    expect(guide).toContain("at most 500 nodes and 2,000 edges");
    expect(guide).toContain("Open Note graph in a tab");
    expect(guide).toContain("never written into the vault or restored");
    expect(guide).toContain("keeps the graph available");
    expect(guide).toContain("reuses the completed local index");
    expect(guide).toContain("Drag a visual node");
    expect(guide).toContain("connected notes follow");
    expect(guide).toContain("With reduced motion");
    expect(guide).not.toContain("1 MiB of source per document");
    expect(guide).not.toContain("8 MiB per index request");
  });
});
