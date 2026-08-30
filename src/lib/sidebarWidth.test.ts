import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  getSidebarWidth,
  saveSidebarWidth,
} from "./sidebarWidth";

describe("sidebar width preference", () => {
  beforeEach(() => localStorage.clear());

  it("persists a clamped width", () => {
    saveSidebarWidth(420);
    expect(getSidebarWidth()).toBe(420);

    saveSidebarWidth(10);
    expect(getSidebarWidth()).not.toBe(10);
  });

  it("uses the default for invalid storage", () => {
    localStorage.setItem("denote-sidebar-width", "not-a-number");
    expect(getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
