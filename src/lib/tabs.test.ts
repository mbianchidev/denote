import { describe, expect, it } from "vitest";
import type { EditorTab } from "../types";
import {
  moveTabInLayout,
  placeOpenedTab,
  removeTabNavigationPaths,
  rekeyTabNavigation,
  restoreTabHistoryTarget,
  tabHistoryTarget,
  tabReferencedPaths,
  tabsReferencePath,
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

  it("keeps a dirty active tab during ordinary file navigation", () => {
    const dirty = { ...tab("one.md"), content: "changed" };

    expect(
      placeOpenedTab([dirty, tab("two.md")], "one.md", tab("three.md")).map(
        ({ path, content }) => ({ path, content }),
      ),
    ).toEqual([
      { path: "one.md", content: "changed" },
      { path: "three.md", content: "" },
      { path: "two.md", content: "" },
    ]);
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

  it("tracks per-tab back and forward history", () => {
    const first = placeOpenedTab([], null, tab("one.md"))[0];
    const second = placeOpenedTab([first], "one.md", tab("two.md"))[0];
    const third = placeOpenedTab([second], "two.md", tab("three.md"))[0];

    expect(third.navigationHistory).toEqual([
      "one.md",
      "two.md",
      "three.md",
    ]);
    expect(tabHistoryTarget(third, -1)).toEqual({
      path: "two.md",
      index: 1,
    });

    const restored = restoreTabHistoryTarget(third, tab("two.md"), 1);
    expect(tabHistoryTarget(restored, 1)).toEqual({
      path: "three.md",
      index: 2,
    });
    expect(placeOpenedTab([restored], "two.md", tab("four.md"))[0]
      .navigationHistory).toEqual(["one.md", "two.md", "four.md"]);
  });

  it("retains file errors for paths reachable through tab history", () => {
    const current = {
      ...tab("three.md"),
      navigationHistory: ["one.md", "two.md", "three.md"],
      navigationIndex: 2,
    };

    expect(tabReferencedPaths([current, tab("four.md")])).toEqual([
      "three.md",
      "one.md",
      "two.md",
      "four.md",
    ]);
    expect(tabsReferencePath([current], "one.md")).toBe(true);
    expect(tabsReferencePath([current], "missing.md")).toBe(false);
  });

  it("can swap an already-open history target without deleting either tab", () => {
    const current = {
      ...tab("two.md"),
      navigationHistory: ["one.md", "two.md"],
      navigationIndex: 1,
    };
    const existing = tab("one.md");
    const navigated = restoreTabHistoryTarget(current, existing, 0);
    const displaced = placeOpenedTab(
      [{ ...existing, content: "dirty" }],
      existing.path,
      current,
      false,
    )[0];

    expect([navigated.path, displaced.path]).toEqual(["one.md", "two.md"]);
    expect(navigated.navigationIndex).toBe(0);
    expect(tabHistoryTarget(navigated, 1)?.path).toBe("two.md");
  });

  it("rekeys paths inside tab navigation history", () => {
    const current = {
      ...tab("docs/two.md"),
      navigationHistory: ["one.md", "docs/two.md", "docs/three.md"],
      navigationIndex: 1,
    };
    expect(
      rekeyTabNavigation(current, (path) =>
        path.startsWith("docs/") ? `guide/${path.slice(5)}` : path,
      ).navigationHistory,
    ).toEqual(["one.md", "guide/two.md", "guide/three.md"]);
  });

  it("removes deleted files from tab navigation history", () => {
    const current = {
      ...tab("three.md"),
      navigationHistory: ["one.md", "deleted/two.md", "three.md"],
      navigationIndex: 2,
    };
    expect(
      removeTabNavigationPaths(current, (path) =>
        path.startsWith("deleted/"),
      ).navigationHistory,
    ).toEqual(["one.md", "three.md"]);
    expect(
      removeTabNavigationPaths(
        {
          ...tab("a.md"),
          navigationHistory: ["a.md", "b.md", "deleted/c.md", "a.md"],
          navigationIndex: 0,
        },
        (path) => path.startsWith("deleted/"),
      ).navigationIndex,
    ).toBe(0);
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
