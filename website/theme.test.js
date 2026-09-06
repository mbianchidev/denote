import { describe, expect, it } from "vitest";
import { readThemePreference, resolveTheme } from "./theme.js";

describe("website appearance", () => {
  it("defaults to dark and preserves explicit choices", () => {
    expect(readThemePreference({ getItem: () => null })).toBe("dark");
    expect(readThemePreference({ getItem: () => "light" })).toBe("light");
    expect(readThemePreference({ getItem: () => "system" })).toBe("system");
  });

  it("resolves system preference without overriding explicit themes", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
