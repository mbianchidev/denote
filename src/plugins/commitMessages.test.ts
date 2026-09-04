import { describe, expect, it } from "vitest";
import { resolveCommitMessage } from "./commitMessages";

describe("resolveCommitMessage", () => {
  it("resolves the timestamp placeholder in the current timezone", () => {
    const now = new Date(2026, 8, 4, 9, 7);

    expect(resolveCommitMessage("Denote automatic commit {timestamp}", "", now)).toBe(
      "Denote automatic commit 2026-09-04 09:07",
    );
  });
});
