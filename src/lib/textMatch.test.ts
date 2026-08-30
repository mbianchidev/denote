import { describe, expect, it } from "vitest";
import { findCaseInsensitiveMatches } from "./textMatch";

describe("text matching", () => {
  it("limits collected matches", () => {
    expect(findCaseInsensitiveMatches("needle needle needle", "needle", 2)).toEqual(
      [
        { from: 0, to: 6 },
        { from: 7, to: 13 },
      ],
    );
  });
});
