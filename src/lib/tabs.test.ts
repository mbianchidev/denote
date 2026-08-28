import { describe, expect, it } from "vitest";
import type { EditorTab } from "../types";
import {
  applyTabSessionLayout,
  buildTabSessionState,
  moveTabInLayout,
  placeOpenedTab,
  tabsInVisualOrder,
} from "./tabs";

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
    groupId: null,
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

  it("preserves the active tab group during ordinary file navigation", () => {
    expect(
      placeOpenedTab(
        [{ ...tab("one.md"), groupId: "work" }, tab("two.md")],
        "one.md",
        tab("three.md"),
      )[0].groupId,
    ).toBe("work");
  });

  it("fills an explicit blank tab and appends only when no tab is active", () => {
    expect(
      placeOpenedTab([tab("new-tab", true)], "new-tab", tab("note.md"))[0]
        .placeholder,
    ).toBe(false);
    expect(placeOpenedTab([], null, tab("note.md"))).toHaveLength(1);
  });

  it("persists and restores ordered grouped tabs without blank placeholders", () => {
    const groups = [{ id: "work", name: "Work", collapsed: true }];
    const session = buildTabSessionState(
      [
        { ...tab("one.md"), groupId: "work" },
        tab("new-tab", true),
        { ...tab("two.md"), groupId: "work" },
      ],
      groups,
      "two.md",
    );
    expect(session.tabs.map(({ path }) => path)).toEqual(["one.md", "two.md"]);

    const restored = applyTabSessionLayout(
      [tab("two.md"), tab("one.md")],
      session,
    );
    expect(restored.tabs.map(({ path }) => path)).toEqual([
      "one.md",
      "two.md",
    ]);
    expect(restored.groups).toEqual(groups);
    expect(restored.activePath).toBe("two.md");
  });

  it("keeps grouped tabs contiguous in visual and persisted order", () => {
    const interleaved = [
      { ...tab("one.md"), groupId: "work" },
      tab("outside.md"),
      { ...tab("two.md"), groupId: "work" },
    ];

    expect(tabsInVisualOrder(interleaved).map(({ path }) => path)).toEqual([
      "one.md",
      "two.md",
      "outside.md",
    ]);
    expect(
      buildTabSessionState(
        interleaved,
        [{ id: "work", name: "Work", collapsed: false }],
        "two.md",
      ).tabs.map(({ path }) => path),
    ).toEqual(["one.md", "two.md", "outside.md"]);
  });

  it("moves tabs between groups without splitting either group", () => {
    const moved = moveTabInLayout(
      [
        { ...tab("one.md"), groupId: "work" },
        { ...tab("two.md"), groupId: "work" },
        tab("outside.md"),
      ],
      "outside.md",
      "one.md",
    );

    expect(moved.map(({ path }) => path)).toEqual([
      "outside.md",
      "one.md",
      "two.md",
    ]);
    expect(moved.map(({ groupId }) => groupId)).toEqual([
      "work",
      "work",
      "work",
    ]);
  });
});
