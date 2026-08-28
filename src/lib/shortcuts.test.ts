import { describe, expect, it } from "vitest";
import {
  isGlobalSearchShortcut,
  isNewFileShortcut,
  isReplaceShortcut,
  isSearchShortcut,
} from "./shortcuts";

describe("replace shortcut", () => {
  it("uses physical key codes so macOS Option does not change detection", () => {
    expect(
      isReplaceShortcut(
        {
          ctrlKey: false,
          metaKey: true,
          altKey: true,
          shiftKey: false,
          code: "KeyF",
        },
        "MacIntel",
      ),
    ).toBe(true);
  });

  describe("search shortcut", () => {
    it("uses Command-F on macOS", () => {
      expect(
        isSearchShortcut(
          {
            ctrlKey: false,
            metaKey: true,
            altKey: false,
            shiftKey: false,
            code: "KeyF",
          },
          "MacIntel",
        ),
      ).toBe(true);
    });

    it("uses Control-F on Windows and Linux", () => {
      expect(
        isSearchShortcut(
          {
            ctrlKey: true,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            code: "KeyF",
          },
          "Linux x86_64",
        ),
      ).toBe(true);
    });

    it("does not override the macOS replace shortcut", () => {
      expect(
        isSearchShortcut(
          {
            ctrlKey: false,
            metaKey: true,
            altKey: true,
            shiftKey: false,
            code: "KeyF",
          },
          "MacIntel",
        ),
      ).toBe(false);
    });
  });

  it("supports Control-H on Windows and Linux", () => {
    expect(
      isReplaceShortcut(
        {
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          code: "KeyH",
        },
        "Win32",
      ),
    ).toBe(true);
  });

  it("does not activate platform-specific shortcuts on the wrong OS", () => {
    expect(
      isReplaceShortcut(
        {
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          code: "KeyH",
        },
        "MacIntel",
      ),
    ).toBe(false);
  });

  describe("global search shortcut", () => {
    it("uses Command-P on macOS", () => {
      expect(
        isGlobalSearchShortcut(
          {
            ctrlKey: false,
            metaKey: true,
            altKey: false,
            shiftKey: false,
            code: "KeyP",
          },
          "MacIntel",
        ),
      ).toBe(true);
    });

    it("uses Control-P on Windows and Linux", () => {
      expect(
        isGlobalSearchShortcut(
          {
            ctrlKey: true,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            code: "KeyP",
          },
          "Linux x86_64",
        ),
      ).toBe(true);
    });

    describe("new file shortcut", () => {
      it("uses Command-N on macOS and Control-N elsewhere", () => {
        const base = {
          altKey: false,
          shiftKey: false,
          code: "KeyN",
        };
        expect(
          isNewFileShortcut(
            { ...base, metaKey: true, ctrlKey: false },
            "MacIntel",
          ),
        ).toBe(true);
        expect(
          isNewFileShortcut(
            { ...base, metaKey: false, ctrlKey: true },
            "Linux x86_64",
          ),
        ).toBe(true);
      });
    });
  });
});
