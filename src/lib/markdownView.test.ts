import { beforeEach, describe, expect, it } from "vitest";
import {
  getMarkdownViewMode,
  saveMarkdownViewMode,
} from "./markdownView";

describe("Markdown view preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to rich text", () => {
    expect(getMarkdownViewMode()).toBe("rich-text");
  });

  it("persists source mode across editor instances", () => {
    saveMarkdownViewMode("source");
    expect(getMarkdownViewMode()).toBe("source");
  });
});
