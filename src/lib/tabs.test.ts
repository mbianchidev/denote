import { describe, expect, it } from "vitest";
import type { EditorTab } from "../types";
import { placeOpenedTab } from "./tabs";

function tab(path: string, placeholder = false): EditorTab {
  return {
    path,
    title: placeholder ? "New tab" : path,
    kind: "text",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    placeholder,
    rawEditing: false,
    editorRevision: 0,
    editRecorded: false,
    saveState: "saved",
  };
}

describe("tab placement", () => {
  it("replaces the active tab during ordinary file navigation", () => {
    expect(
      placeOpenedTab([tab("one.md"), tab("two.md")], "one.md", tab("three.md")).map(
        ({ path }) => path,
      ),
    ).toEqual(["three.md", "two.md"]);
  });

  it("fills an explicit blank tab and appends only when no tab is active", () => {
    expect(
      placeOpenedTab([tab("new-tab", true)], "new-tab", tab("note.md"))[0]
        .placeholder,
    ).toBe(false);
    expect(placeOpenedTab([], null, tab("note.md"))).toHaveLength(1);
  });
});
