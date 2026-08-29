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

  it("persists and clamps the editor font size without enabling guides", () => {
    saveEditorDisplaySettings({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      fontSize: 40,
    });

    expect(getEditorDisplaySettings().fontSize).toBe(24);
    expect(
      hasEditorDisplayGuides({
        ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
        fontSize: 20,
        tabSize: 2,
      }),
    ).toBe(false);
  });

  it("persists a two- or four-space tab size", () => {
    saveEditorDisplaySettings({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      tabSize: 2,
    });
    expect(getEditorDisplaySettings().tabSize).toBe(2);
  });
});
