import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  getEditorDisplaySettings,
  hasEditorDisplayGuides,
  saveEditorDisplaySettings,
} from "./editorDisplay";

describe("editor display settings", () => {
  beforeEach(() => localStorage.clear());

  it("uses safe defaults when no valid preference exists", () => {
    expect(getEditorDisplaySettings()).toEqual(
      DEFAULT_EDITOR_DISPLAY_SETTINGS,
    );
    localStorage.setItem("denote-editor-display", "{broken");
    expect(getEditorDisplaySettings()).toEqual(
      DEFAULT_EDITOR_DISPLAY_SETTINGS,
    );
  });

  it("persists supported display guides", () => {
    const settings = {
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      showLineNumbers: true,
      showWhitespace: true,
    };
    saveEditorDisplaySettings(settings);

    expect(getEditorDisplaySettings()).toEqual(settings);
    expect(hasEditorDisplayGuides(settings)).toBe(true);
  });
});
