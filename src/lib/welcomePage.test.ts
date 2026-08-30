import { describe, expect, it } from "vitest";
import { welcomePageTarget } from "./welcomePage";

describe("welcomePageTarget", () => {
  it("returns the effective welcome page when no other startup file wins", () => {
    expect(
      welcomePageTarget(
        {
          effectivePath: ".denote.md",
          hasTabSession: false,
        },
        false,
      ),
    ).toBe(".denote.md");
  });

  it("does not replace a restored tab session", () => {
    expect(
      welcomePageTarget(
        {
          effectivePath: "Start.md",
          hasTabSession: true,
        },
        false,
      ),
    ).toBeNull();
  });

  it("does not replace an explicit cross-vault file", () => {
    expect(
      welcomePageTarget(
        {
          effectivePath: "Start.md",
          hasTabSession: false,
        },
        true,
      ),
    ).toBeNull();
  });
});
