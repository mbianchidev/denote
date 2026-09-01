import { beforeEach, describe, expect, it, vi } from "vitest";
import { getShowDotfiles, saveShowDotfiles } from "./fileVisibility";

describe("file visibility preference", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows dotfiles by default and persists changes", () => {
    expect(getShowDotfiles()).toBe(true);
    expect(saveShowDotfiles(false)).toBe(false);
    expect(getShowDotfiles()).toBe(false);
    expect(saveShowDotfiles(true)).toBe(true);
    expect(getShowDotfiles()).toBe(true);
  });

  it("uses the default when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(getShowDotfiles()).toBe(true);
  });

  it("uses the default for an invalid stored value", () => {
    localStorage.setItem("denote-show-dotfiles", "invalid");
    expect(getShowDotfiles()).toBe(true);
  });

  it("surfaces write errors without changing the stored preference", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => saveShowDotfiles(false)).toThrow("storage unavailable");
    expect(setItem).toHaveBeenCalled();
  });
});
