import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  MIN_OUTLINE_WIDTH,
  getOutlineWidth,
  saveOutlineWidth,
} from "./outlineWidth";

describe("outline width preference", () => {
  beforeEach(() => localStorage.clear());

  it("persists and clamps the outline width", () => {
    saveOutlineWidth(360);
    expect(getOutlineWidth()).toBe(360);

    saveOutlineWidth(10);
    expect(getOutlineWidth()).toBe(MIN_OUTLINE_WIDTH);

    saveOutlineWidth(10_000);
    expect(getOutlineWidth()).toBe(MAX_OUTLINE_WIDTH);
  });

  it("uses the default for invalid storage", () => {
    localStorage.setItem("denote-outline-width", "invalid");
    expect(getOutlineWidth()).toBe(DEFAULT_OUTLINE_WIDTH);
  });
});
