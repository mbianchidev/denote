import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  saveThemePreference,
  systemTheme,
} from "./theme";

describe("appearance preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "";
  });

  it("defaults fresh and invalid state to dark", () => {
    expect(getThemePreference()).toBe("dark");
    localStorage.setItem("denote-theme", "invalid");
    expect(getThemePreference()).toBe("dark");
  });

  it("persists light, dark, and system choices across reloads", () => {
    for (const preference of ["light", "dark", "system"] as const) {
      saveThemePreference(preference);
      expect(getThemePreference()).toBe(preference);
    }
  });

  it("follows system changes only for the system preference", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("uses the same preference rules regardless of application identity", () => {
    localStorage.setItem("denote-theme", "system");
    const production = getThemePreference();
    const development = getThemePreference();
    expect(development).toBe(production);
  });

  it("applies the resolved theme without rewriting the preference", () => {
    saveThemePreference("system");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(getThemePreference()).toBe("system");
  });

  it("resolves the current system color scheme", () => {
    expect(systemTheme({ matches: true })).toBe("dark");
    expect(systemTheme({ matches: false })).toBe("light");
    vi.restoreAllMocks();
  });
});
