import { describe, expect, it } from "vitest";
import type { DocumentBatch } from "../types";
import {
  createTaskListSnapshot,
  taskListIndexRequests,
  verifyTaskToggleDelta,
} from "./taskLists";

const document = (path: string, content: string) => ({
  path,
  title: path.replace(".md", ""),
  content,
  contentHash: path,
  encoding: "utf8" as const,
  lineEnding: "lf" as const,
  tags: [],
  kind: "markdown" as const,
  bookmarked: false,
  lastOpenedAt: null,
});

describe("task list host helpers", () => {
  it("builds bounded Markdown snapshots and incremental updates", () => {
    const firstBatch: DocumentBatch = {
      documents: [
        document("Alpha.md", "- [ ] Alpha"),
        document("data.json", '{"task":"- [ ] no"}'),
      ],
      skippedCount: 0,
      truncated: false,
    };
    const first = createTaskListSnapshot("vault:1", firstBatch, "Alpha.md")!;
    expect(first.documents.map(({ path }) => path)).toEqual(["Alpha.md"]);
    const second = createTaskListSnapshot(
      "vault:2",
      {
        ...firstBatch,
        documents: [document("Alpha.md", "- [x] Alpha")],
      },
      null,
    )!;
    expect(taskListIndexRequests(first, second)[0]).toMatchObject({
      mode: "replace",
      documents: [{ source: "- [x] Alpha" }],
    });
  });

  it("accepts only one verified checkbox-marker delta", () => {
    const locator = {
      path: "Alpha.md",
      sourceLine: "- [ ] Alpha",
      headingPath: [],
      occurrence: 1,
      matchCount: 1,
      checked: false,
    };
    expect(
      verifyTaskToggleDelta(
        "# Plan\n- [ ] Alpha\n",
        "# Plan\n- [x] Alpha\n",
        locator,
        true,
      ),
    ).toBe(true);
    expect(
      verifyTaskToggleDelta(
        "# Plan\n- [ ] Alpha\n",
        "# Plan\n- [x] Changed\n",
        locator,
        true,
      ),
    ).toBe(false);
    expect(
      verifyTaskToggleDelta(
        "# Plan\n- [ ] Alpha\n- [ ] Beta\n",
        "# Plan\n- [x] Alpha\n- [x] Beta\n",
        locator,
        true,
      ),
    ).toBe(false);
  });
});
