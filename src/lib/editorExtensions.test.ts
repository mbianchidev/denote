import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "./editorDisplay";
import { createEditorDisplayExtensions } from "./editorExtensions";

describe("editor display extensions", () => {
  it("installs only enabled visual guides", () => {
    expect(
      createEditorDisplayExtensions(DEFAULT_EDITOR_DISPLAY_SETTINGS, "lf"),
    ).toHaveLength(0);
    expect(
      createEditorDisplayExtensions(
        {
          showLineNumbers: true,
          showWhitespace: true,
          showLineEndings: true,
          highlightTrailingWhitespace: true,
        },
        "crlf",
      ),
    ).toHaveLength(4);
  });
});
