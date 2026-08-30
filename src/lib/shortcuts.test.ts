import { describe, expect, it } from "vitest";
import {
  editorZoomShortcut,
  isClosePaneShortcut,
  isCommandPaletteShortcut,
  isNewFileShortcut,
  isNewTabShortcut,
  isReplaceShortcut,
  isSearchShortcut,
  isSplitPaneShortcut,
  paneFocusShortcut,
} from "./shortcuts";

describe("replace shortcut", () => {
  it("uses Command-H on macOS", () => {
    expect(
      isReplaceShortcut(
        {
          ctrlKey: false,
          metaKey: true,
          altKey: false,
          shiftKey: false,
          code: "KeyH",
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

    it("does not activate with extra modifiers", () => {
      expect(
        isSearchShortcut(
          {
            ctrlKey: false,
            metaKey: true,
            altKey: false,
            shiftKey: false,
            code: "KeyH",
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
          ctrlKey: false,
          metaKey: true,
          altKey: false,
          shiftKey: false,
          code: "KeyH",
        },
        "Win32",
      ),
    ).toBe(false);
  });

  describe("command palette shortcut", () => {
    it("uses Command-P on macOS", () => {
      expect(
        isCommandPaletteShortcut(
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
        isCommandPaletteShortcut(
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

      describe("new tab shortcut", () => {
        it("uses Command-T on macOS and Control-T elsewhere", () => {
          const base = {
            altKey: false,
            shiftKey: false,
            code: "KeyT",
          };
          expect(
            isNewTabShortcut(
              { ...base, metaKey: true, ctrlKey: false },
              "MacIntel",
            ),
          ).toBe(true);
          expect(
            isNewTabShortcut(
              { ...base, metaKey: false, ctrlKey: true },
              "Win32",
            ),
          ).toBe(true);
        });
      });

      describe("editor zoom shortcuts", () => {
        it("supports zoom in, out, and reset on macOS", () => {
          const base = {
            ctrlKey: false,
            metaKey: true,
            altKey: false,
            shiftKey: false,
          };
          expect(
            editorZoomShortcut({ ...base, code: "Equal", shiftKey: true }, "MacIntel"),
          ).toBe("in");
          expect(editorZoomShortcut({ ...base, code: "Minus" }, "MacIntel")).toBe(
            "out",
          );
          expect(editorZoomShortcut({ ...base, code: "Digit0" }, "MacIntel")).toBe(
            "reset",
          );
        });

        it("uses Control on Windows and Linux", () => {
          expect(
            editorZoomShortcut(
              {
                ctrlKey: true,
                metaKey: false,
                altKey: false,
                shiftKey: false,
                code: "NumpadAdd",
              },
              "Win32",
            ),
          ).toBe("in");
        });

        it("uses produced keys on non-US keyboard layouts", () => {
          expect(
            editorZoomShortcut(
              {
                ctrlKey: false,
                metaKey: true,
                altKey: false,
                shiftKey: false,
                code: "BracketRight",
                key: "+",
              },
              "MacIntel",
            ),
          ).toBe("in");
          expect(
            editorZoomShortcut(
              {
                ctrlKey: false,
                metaKey: true,
                altKey: false,
                shiftKey: false,
                code: "Slash",
                key: "-",
              },
              "MacIntel",
            ),
          ).toBe("out");
          expect(
            editorZoomShortcut(
              {
                ctrlKey: false,
                metaKey: true,
                altKey: false,
                shiftKey: true,
                code: "Digit0",
                key: "0",
              },
              "MacIntel",
            ),
          ).toBe("reset");
          expect(
            editorZoomShortcut(
              {
                ctrlKey: false,
                metaKey: true,
                altKey: false,
                shiftKey: false,
                code: "Digit0",
                key: "à",
              },
              "MacIntel",
            ),
          ).toBeNull();
        });
      });
    });
  });
});

describe("pane shortcuts", () => {
  const event = (
    overrides: Partial<{
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      code: string;
    }>,
  ) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    code: "Backslash",
    ...overrides,
  });

  it("splits panes with the primary modifier and backslash", () => {
    expect(isSplitPaneShortcut(event({ metaKey: true }), "MacIntel")).toBe(true);
    expect(isSplitPaneShortcut(event({ ctrlKey: true }), "Win32")).toBe(true);
    expect(isSplitPaneShortcut(event({ metaKey: true }), "Win32")).toBe(false);
    expect(
      isSplitPaneShortcut(event({ ctrlKey: true, shiftKey: true }), "Win32"),
    ).toBe(false);
  });

  it("closes panes with the shifted split shortcut", () => {
    expect(
      isClosePaneShortcut(event({ metaKey: true, shiftKey: true }), "MacIntel"),
    ).toBe(true);
    expect(isClosePaneShortcut(event({ ctrlKey: true }), "Win32")).toBe(false);
  });

  it("focuses panes by index and by direction", () => {
    expect(
      paneFocusShortcut(
        event({ metaKey: true, altKey: true, code: "Digit3" }),
        "MacIntel",
      ),
    ).toEqual({ kind: "index", index: 2 });
    expect(
      paneFocusShortcut(
        event({ ctrlKey: true, shiftKey: true, code: "Digit3" }),
        "Win32",
      ),
    ).toEqual({ kind: "index", index: 2 });
    expect(
      paneFocusShortcut(event({ code: "F6" }), "Win32"),
    ).toEqual({ kind: "step", direction: 1 });
    expect(
      paneFocusShortcut(event({ code: "F6", shiftKey: true }), "Win32"),
    ).toEqual({ kind: "step", direction: -1 });
    expect(
      paneFocusShortcut(event({ ctrlKey: true, code: "Digit1" }), "Win32"),
    ).toBeNull();
    expect(
      paneFocusShortcut(
        event({ ctrlKey: true, altKey: true, code: "Digit3" }),
        "Win32",
      ),
    ).toBeNull();
    expect(
      paneFocusShortcut(
        event({ ctrlKey: true, shiftKey: true, code: "Digit5" }),
        "Win32",
      ),
    ).toBeNull();
  });
});
