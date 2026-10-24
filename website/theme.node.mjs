import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readThemePreference, resolveTheme } from "./theme.js";

describe("website appearance", () => {
  it("defaults to dark and preserves explicit choices", () => {
    assert.equal(readThemePreference({ getItem: () => null }), "dark");
    assert.equal(readThemePreference({ getItem: () => "light" }), "light");
    assert.equal(readThemePreference({ getItem: () => "system" }), "system");
  });

  it("resolves system preference without overriding explicit themes", () => {
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("system", false), "light");
    assert.equal(resolveTheme("light", true), "light");
  });
});
