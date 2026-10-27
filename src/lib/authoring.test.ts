import { describe, expect, it } from "vitest";
import { TEXT_STYLE_PALETTE } from "./authoring";

function luminance(hex: string): number {
  const channels = hex.match(/[a-f0-9]{2}/gi)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("text style palette", () => {
  it("meets WCAG AA for every offered foreground/background pair in both themes", () => {
    for (const palette of Object.values(TEXT_STYLE_PALETTE)) {
      for (const theme of ["dark", "light"] as const) {
        expect(contrast(palette[theme].ink, palette[theme].background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette[theme].foreground, theme === "dark" ? "#181a1d" : "#f8f6f1")).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
