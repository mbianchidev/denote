import { describe, expect, it } from "vitest";
import {
  blendTagColor,
  contrastRatio,
  normalizeTag,
  resolveTagColor,
} from "./tagColors";

describe("tag colors", () => {
  it("uses a saved color for the same tag regardless of case", () => {
    expect(resolveTagColor("Guide", { guide: "#7aa66a" })).toBe("#7aa66a");
  });

  it("normalizes tag identity without depending on the system locale", () => {
    expect(normalizeTag("#I")).toBe("i");
    expect(normalizeTag("#cafe\u0301")).toBe(normalizeTag("#café"));
  });

  it("assigns a stable default color when no override exists", () => {
    expect(resolveTagColor("guide", {})).toBe(resolveTagColor("guide", {}));
    expect(resolveTagColor("guide", {})).not.toBe(resolveTagColor("music", {}));
  });

  it("keeps custom tag tints readable in both themes", () => {
    const themes = [
      { surface: "#202327", text: "#e8e5de" },
      { surface: "#f0ede6", text: "#252722" },
    ];
    for (const color of ["#101820", "#777777", "#f0c96a", "#ffffff"]) {
      for (const theme of themes) {
        const background = blendTagColor(color, theme.surface);
        expect(contrastRatio(background, theme.text)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
