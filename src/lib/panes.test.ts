import { describe, expect, it } from "vitest";
import type { EditorTab, PaneLayout, TabSessionState } from "../types";
import {
  addPane,
  applyPaneSessionState,
  buildPaneSessionState,
  closePane,
  createPaneWorkspace,
  createWorkspacePane,
  defaultLayoutKind,
  findPaneByGroup,
  findPaneByPath,
  focusedPaneOf,
  layoutsForPaneCount,
  layoutSupportsPaneCount,
  MAX_PANES,
  movePaneTab,
  nextPaneId,
  normalizePaneLayout,
  paneAccessibleLabel,
  paneAreas,
  paneGroupOffset,
  paneLayoutTracks,
  paneSeparators,
  paneTabs,
  removePaneTabs,
  resizePaneLayout,
  setPaneLayoutKind,
  updatePane,
  upgradeTabSession,
  type PaneWorkspaceState,
} from "./panes";

function tab(path: string, content = ""): EditorTab {
  return {
    path,
    title: path,
    kind: "markdown",
    content,
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    placeholder: false,
    groupId: null,
    navigationHistory: [path],
    navigationIndex: 0,
    rawEditing: false,
    readOnly: false,
    editorRevision: 0,
    editRecorded: false,
    saveState: content ? "dirty" : "saved",
  };
}

function workspace(
  panes: { id: string; tabs: EditorTab[]; activePath?: string | null }[],
  layout: PaneLayout = { kind: "horizontal", sizes: [0.5, 0.5] },
  focusedPaneId = panes[0].id,
): PaneWorkspaceState {
  return {
    panes: panes.map((pane) => ({
      id: pane.id,
      tabs: pane.tabs,
      groups: [],
      activePath:
        pane.activePath === undefined
          ? (pane.tabs[0]?.path ?? null)
          : pane.activePath,
    })),
    layout,
    focusedPaneId,
  };
}

describe("pane layouts", () => {
  it("only offers layouts that match the open pane count", () => {
    expect(layoutsForPaneCount(1)).toEqual(["single"]);
    expect(layoutsForPaneCount(2)).toEqual(["horizontal", "vertical"]);
    expect(layoutsForPaneCount(3)).toEqual([
      "horizontal",
      "vertical",
      "left-stack",
      "right-stack",
      "top-stack",
      "bottom-stack",
    ]);
    expect(layoutsForPaneCount(4)).toEqual([
      "horizontal",
      "vertical",
      "grid",
    ]);
    expect(layoutSupportsPaneCount("grid", 3)).toBe(false);
    expect(defaultLayoutKind(4)).toBe("grid");
  });

  it("places three panes in every mirrored and rotated arrangement", () => {
    expect(paneAreas("left-stack", 3)).toEqual([
      { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 4 },
      { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 2 },
      { columnStart: 3, columnEnd: 4, rowStart: 3, rowEnd: 4 },
    ]);
    expect(paneAreas("right-stack", 3)).toEqual([
      { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 },
      { columnStart: 1, columnEnd: 2, rowStart: 3, rowEnd: 4 },
      { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 4 },
    ]);
    expect(paneAreas("top-stack", 3)).toEqual([
      { columnStart: 1, columnEnd: 4, rowStart: 1, rowEnd: 2 },
      { columnStart: 1, columnEnd: 2, rowStart: 3, rowEnd: 4 },
      { columnStart: 3, columnEnd: 4, rowStart: 3, rowEnd: 4 },
    ]);
    expect(paneAreas("bottom-stack", 3)).toEqual([
      { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 },
      { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 2 },
      { columnStart: 1, columnEnd: 4, rowStart: 3, rowEnd: 4 },
    ]);
  });

  it("lays out equal splits and grids without overlapping tracks", () => {
    expect(paneAreas("horizontal", 3).map((area) => area.columnStart)).toEqual([
      1, 3, 5,
    ]);
    expect(paneAreas("vertical", 4).map((area) => area.rowStart)).toEqual([
      1, 3, 5, 7,
    ]);
    expect(paneAreas("grid", 4)).toEqual([
      { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 },
      { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 2 },
      { columnStart: 1, columnEnd: 2, rowStart: 3, rowEnd: 4 },
      { columnStart: 3, columnEnd: 4, rowStart: 3, rowEnd: 4 },
    ]);
  });

  it("describes one separator per adjacent pane boundary", () => {
    expect(paneSeparators("single", 1)).toEqual([]);
    expect(paneSeparators("horizontal", 4)).toHaveLength(3);
    expect(paneSeparators("vertical", 2)[0]).toMatchObject({
      axis: "y",
      groupIndex: 0,
      index: 0,
      rowStart: 2,
    });
    expect(paneSeparators("grid", 4).map((separator) => separator.axis)).toEqual(
      ["x", "y"],
    );
    expect(paneSeparators("top-stack", 3)[1]).toMatchObject({
      axis: "x",
      groupIndex: 1,
      rowStart: 3,
    });
  });

  it("normalizes stored ratios and rejects corrupt ones", () => {
    expect(
      normalizePaneLayout({ kind: "horizontal", sizes: [2, 2] }, 2).sizes,
    ).toEqual([0.5, 0.5]);
    expect(
      normalizePaneLayout({ kind: "horizontal", sizes: [1] }, 2).sizes,
    ).toEqual([0.5, 0.5]);
    expect(
      normalizePaneLayout(
        { kind: "horizontal", sizes: [Number.NaN, 1] },
        2,
      ).sizes,
    ).toEqual([0.5, 0.5]);
    expect(normalizePaneLayout({ kind: "grid", sizes: [] }, 3).kind).toBe(
      "horizontal",
    );
    expect(normalizePaneLayout(null, 4)).toEqual({
      kind: "grid",
      sizes: [0.5, 0.5, 0.5, 0.5],
    });
  });

  it("resizes one boundary without starving its neighbour", () => {
    const layout = normalizePaneLayout(
      { kind: "horizontal", sizes: [0.5, 0.5] },
      2,
    );
    const widened = resizePaneLayout(layout, 2, 0, 0, 0.2);
    expect(widened.sizes[0]).toBeCloseTo(0.7);
    expect(widened.sizes[1]).toBeCloseTo(0.3);
    const clamped = resizePaneLayout(layout, 2, 0, 0, -5);
    expect(clamped.sizes[0]).toBeCloseTo(0.12);
    expect(clamped.sizes[0] + clamped.sizes[1]).toBeCloseTo(1);
    expect(resizePaneLayout(layout, 2, 1, 0, 0.2)).toEqual(layout);
  });

  it("builds grid templates and group offsets for compound layouts", () => {
    expect(
      paneLayoutTracks({ kind: "left-stack", sizes: [0.6, 0.4, 0.5, 0.5] }, 3, "4px"),
    ).toEqual({
      columns: "minmax(0, 0.6fr) 4px minmax(0, 0.4fr)",
      rows: "minmax(0, 0.5fr) 4px minmax(0, 0.5fr)",
    });
    expect(paneGroupOffset("left-stack", 3, 1)).toBe(2);
    expect(paneGroupOffset("top-stack", 3, 1)).toBe(2);
    expect(paneLayoutTracks({ kind: "single", sizes: [] }, 1, "4px")).toEqual({
      columns: "minmax(0, 1fr)",
      rows: "minmax(0, 1fr)",
    });
  });
});

describe("pane workspace", () => {
  it("starts with one focused pane", () => {
    const state = createPaneWorkspace();
    expect(state.panes).toHaveLength(1);
    expect(state.layout.kind).toBe("single");
    expect(focusedPaneOf(state).id).toBe(state.panes[0].id);
  });

  it("adds panes after the focused pane and stops at the maximum", () => {
    let state = createPaneWorkspace();
    state = addPane(state);
    expect(state.panes.map((pane) => pane.id)).toEqual(["pane-1", "pane-2"]);
    expect(state.focusedPaneId).toBe("pane-2");
    expect(state.layout.kind).toBe("horizontal");
    state = { ...state, focusedPaneId: "pane-1" };
    state = addPane(state);
    expect(state.panes.map((pane) => pane.id)).toEqual([
      "pane-1",
      "pane-3",
      "pane-2",
    ]);
    state = addPane(state);
    expect(state.panes).toHaveLength(MAX_PANES);
    expect(state.layout.kind).toBe("horizontal");
    expect(state.layout.sizes).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(addPane(state)).toBe(state);
    expect(nextPaneId(state.panes)).toBe("pane-5");
  });

  it("falls back to a supported layout when the pane count changes", () => {
    const grid = workspace(
      [
        { id: "pane-1", tabs: [] },
        { id: "pane-2", tabs: [] },
        { id: "pane-3", tabs: [] },
        { id: "pane-4", tabs: [] },
      ],
      { kind: "grid", sizes: [0.5, 0.5, 0.5, 0.5] },
    );
    expect(closePane(grid, "pane-4").layout.kind).toBe("horizontal");
    const stacked = workspace(
      [
        { id: "pane-1", tabs: [] },
        { id: "pane-2", tabs: [] },
        { id: "pane-3", tabs: [] },
      ],
      { kind: "top-stack", sizes: [0.5, 0.5, 0.5, 0.5] },
    );
    expect(addPane(stacked).layout.kind).toBe("grid");
  });

  it("keeps unsaved edits when a pane closes by merging its tabs", () => {
    const dirty = tab("draft.md", "unsaved words");
    const state = workspace([
      { id: "pane-1", tabs: [tab("one.md")] },
      { id: "pane-2", tabs: [dirty] },
    ]);
    const closed = closePane({ ...state, focusedPaneId: "pane-2" }, "pane-2");
    expect(closed.panes).toHaveLength(1);
    expect(closed.focusedPaneId).toBe("pane-1");
    expect(closed.layout.kind).toBe("single");
    expect(paneTabs(closed.panes).map((entry) => entry.path)).toEqual([
      "one.md",
      "draft.md",
    ]);
    expect(
      paneTabs(closed.panes).find((entry) => entry.path === "draft.md")?.content,
    ).toBe("unsaved words");
  });

  it("refuses to close the last pane", () => {
    const state = createPaneWorkspace();
    expect(closePane(state, state.panes[0].id)).toBe(state);
  });

  it("moves a tab between panes without losing unsaved content", () => {
    const dirty = tab("draft.md", "unsaved words");
    const state = workspace([
      { id: "pane-1", tabs: [tab("one.md"), dirty], activePath: "draft.md" },
      { id: "pane-2", tabs: [tab("two.md")] },
    ]);
    const moved = movePaneTab(state.panes, "draft.md", "pane-2");
    expect(moved[0].tabs.map((entry) => entry.path)).toEqual(["one.md"]);
    expect(moved[0].activePath).toBe("one.md");
    expect(moved[1].tabs.map((entry) => entry.path)).toEqual([
      "two.md",
      "draft.md",
    ]);
    expect(moved[1].activePath).toBe("draft.md");
    expect(moved[1].tabs[1].content).toBe("unsaved words");
    expect(moved[1].tabs[1].navigationHistory).toEqual(["draft.md"]);
  });

  it("inserts a moved tab before the drop target", () => {
    const state = workspace([
      { id: "pane-1", tabs: [tab("one.md")] },
      { id: "pane-2", tabs: [tab("two.md"), tab("three.md")] },
    ]);
    const moved = movePaneTab(state.panes, "one.md", "pane-2", "three.md");
    expect(moved[1].tabs.map((entry) => entry.path)).toEqual([
      "two.md",
      "one.md",
      "three.md",
    ]);
    expect(movePaneTab(state.panes, "missing.md", "pane-2")).toBe(state.panes);
    expect(movePaneTab(state.panes, "one.md", "pane-1")).toBe(state.panes);
  });

  it("removes tabs across panes and repairs each active file", () => {
    const state = workspace([
      {
        id: "pane-1",
        tabs: [tab("notes/one.md"), tab("keep.md")],
        activePath: "notes/one.md",
      },
      { id: "pane-2", tabs: [tab("notes/two.md")] },
    ]);
    const removal = removePaneTabs(state.panes, (path) =>
      path.startsWith("notes/"),
    );
    expect(removal.removedPaths).toEqual(["notes/one.md", "notes/two.md"]);
    expect(removal.panes[0].activePath).toBe("keep.md");
    expect(removal.panes[1].tabs).toEqual([]);
    expect(removal.panes[1].activePath).toBeNull();
  });

  it("keeps navigation history when tabs are only closed", () => {
    const visited: EditorTab = {
      ...tab("one.md"),
      navigationHistory: ["one.md", "two.md"],
      navigationIndex: 0,
    };
    const state = workspace([
      { id: "pane-1", tabs: [visited, tab("two.md")], activePath: "one.md" },
    ]);
    const closed = removePaneTabs(
      state.panes,
      (path) => path === "two.md",
      false,
    );
    expect(closed.panes[0].tabs[0].navigationHistory).toEqual([
      "one.md",
      "two.md",
    ]);
  });

  it("finds panes by path and by group and labels them accessibly", () => {
    const state = workspace([
      { id: "pane-1", tabs: [tab("one.md")] },
      { id: "pane-2", tabs: [{ ...tab("two.md"), groupId: "research" }] },
    ]);
    const panes = updatePane(state.panes, "pane-2", (pane) => ({
      ...pane,
      groups: [{ id: "research", name: "Research", collapsed: false }],
    }));
    expect(findPaneByPath(panes, "two.md")?.id).toBe("pane-2");
    expect(findPaneByPath(panes, null)).toBeNull();
    expect(findPaneByGroup(panes, "research")?.id).toBe("pane-2");
    expect(paneAccessibleLabel(panes, "pane-2")).toBe("Pane 2 of 2: two.md");
    expect(paneAccessibleLabel(panes, "missing")).toBe("Editor pane");
  });

  it("changes layout only when the pane count allows it", () => {
    const state = workspace([
      { id: "pane-1", tabs: [] },
      { id: "pane-2", tabs: [] },
    ]);
    expect(setPaneLayoutKind(state, "vertical").layout.kind).toBe("vertical");
    expect(setPaneLayoutKind(state, "grid")).toBe(state);
  });
});

describe("pane session state", () => {
  it("upgrades a legacy flat session into one pane", () => {
    const legacy: TabSessionState = {
      tabs: [
        { path: "one.md", groupId: "work" },
        { path: "two.md", groupId: null },
      ],
      groups: [{ id: "work", name: "Work", collapsed: false }],
      activePath: "two.md",
    };
    const upgraded = upgradeTabSession(legacy);
    expect(upgraded.panes).toHaveLength(1);
    expect(upgraded.panes[0].id).toBe("pane-1");
    expect(upgraded.panes[0].tabs).toHaveLength(2);
    expect(upgraded.layout).toEqual({ kind: "single", sizes: [] });
    expect(upgraded.focusedPaneId).toBe("pane-1");
  });

  it("repairs duplicate pane identifiers and unknown focus", () => {
    const upgraded = upgradeTabSession({
      tabs: [],
      groups: [],
      activePath: null,
      panes: [
        { id: "pane-1", tabs: [], groups: [], activePath: null },
        { id: "pane-1", tabs: [], groups: [], activePath: null },
      ],
      layout: { kind: "vertical", sizes: [0.4, 0.6] },
      focusedPaneId: "missing",
    });
    expect(new Set(upgraded.panes.map((pane) => pane.id)).size).toBe(2);
    expect(upgraded.focusedPaneId).toBe(upgraded.panes[0].id);
    expect(upgraded.layout.kind).toBe("vertical");
  });

  it("writes panes plus a legacy mirror when saving", () => {
    const state = workspace(
      [
        {
          id: "pane-1",
          tabs: [{ ...tab("one.md"), groupId: "work" }],
          activePath: "one.md",
        },
        { id: "pane-2", tabs: [tab("two.md")], activePath: "two.md" },
      ],
      { kind: "vertical", sizes: [0.6, 0.4] },
      "pane-2",
    );
    state.panes[0].groups = [{ id: "work", name: "Work", collapsed: false }];
    const session = buildPaneSessionState(state);
    expect(session.panes?.map((pane) => pane.id)).toEqual([
      "pane-1",
      "pane-2",
    ]);
    expect(session.tabs.map((entry) => entry.path)).toEqual([
      "one.md",
      "two.md",
    ]);
    expect(session.groups).toHaveLength(1);
    expect(session.activePath).toBe("two.md");
    expect(session.focusedPaneId).toBe("pane-2");
    expect(session.layout).toEqual({ kind: "vertical", sizes: [0.6, 0.4] });
  });

  it("omits placeholder tabs and unknown active files from the session", () => {
    const placeholder: EditorTab = {
      ...tab("denote:new-tab:1"),
      placeholder: true,
    };
    const session = buildPaneSessionState(
      workspace([
        {
          id: "pane-1",
          tabs: [placeholder],
          activePath: "denote:new-tab:1",
        },
      ]),
    );
    expect(session.tabs).toEqual([]);
    expect(session.activePath).toBeNull();
  });

  it("restores panes, layout, and focus from a saved session", () => {
    const session: TabSessionState = {
      tabs: [
        { path: "one.md", groupId: null },
        { path: "two.md", groupId: "work" },
      ],
      groups: [{ id: "work", name: "Work", collapsed: true }],
      activePath: "two.md",
      panes: [
        {
          id: "pane-1",
          tabs: [{ path: "one.md", groupId: null }],
          groups: [],
          activePath: "one.md",
        },
        {
          id: "pane-2",
          tabs: [{ path: "two.md", groupId: "work" }],
          groups: [{ id: "work", name: "Work", collapsed: true }],
          activePath: "two.md",
        },
      ],
      layout: { kind: "horizontal", sizes: [0.7, 0.3] },
      focusedPaneId: "pane-2",
    };
    const restored = applyPaneSessionState(
      [tab("one.md"), tab("two.md")],
      session,
    );
    expect(restored.panes.map((pane) => pane.id)).toEqual([
      "pane-1",
      "pane-2",
    ]);
    expect(restored.panes[1].tabs[0].groupId).toBe("work");
    expect(restored.panes[1].groups).toHaveLength(1);
    expect(restored.focusedPaneId).toBe("pane-2");
    expect(restored.layout.sizes).toEqual([0.7, 0.3]);
  });

  it("restores a legacy session as one pane and drops missing files", () => {
    const restored = applyPaneSessionState([tab("one.md")], {
      tabs: [
        { path: "one.md", groupId: null },
        { path: "deleted.md", groupId: null },
      ],
      groups: [],
      activePath: "deleted.md",
    });
    expect(restored.panes).toHaveLength(1);
    expect(restored.panes[0].tabs.map((entry) => entry.path)).toEqual([
      "one.md",
    ]);
    expect(restored.panes[0].activePath).toBe("one.md");
    expect(restored.layout.kind).toBe("single");
  });

  it("never opens one file in two panes when restoring", () => {
    const restored = applyPaneSessionState([tab("one.md")], {
      tabs: [{ path: "one.md", groupId: null }],
      groups: [],
      activePath: "one.md",
      panes: [
        {
          id: "pane-1",
          tabs: [{ path: "one.md", groupId: null }],
          groups: [],
          activePath: "one.md",
        },
        {
          id: "pane-2",
          tabs: [{ path: "one.md", groupId: null }],
          groups: [],
          activePath: "one.md",
        },
      ],
      layout: { kind: "horizontal", sizes: [0.5, 0.5] },
      focusedPaneId: "pane-1",
    });
    expect(paneTabs(restored.panes).map((entry) => entry.path)).toEqual([
      "one.md",
    ]);
    expect(restored.panes[1].tabs).toEqual([]);
  });

  it("survives a save and restore round trip", () => {
    const state = workspace(
      [
        { id: "pane-1", tabs: [tab("one.md")] },
        { id: "pane-2", tabs: [tab("two.md")] },
        { id: "pane-3", tabs: [tab("three.md")] },
      ],
      { kind: "left-stack", sizes: [0.6, 0.4, 0.3, 0.7] },
      "pane-3",
    );
    const restored = applyPaneSessionState(
      [tab("one.md"), tab("two.md"), tab("three.md")],
      buildPaneSessionState(state),
    );
    expect(restored.layout).toEqual({
      kind: "left-stack",
      sizes: [0.6, 0.4, 0.3, 0.7],
    });
    expect(restored.focusedPaneId).toBe("pane-3");
    expect(restored.panes.map((pane) => pane.activePath)).toEqual([
      "one.md",
      "two.md",
      "three.md",
    ]);
  });

  it("keeps an empty workspace pane addressable", () => {
    const pane = createWorkspacePane("pane-9");
    expect(pane).toEqual({
      id: "pane-9",
      tabs: [],
      groups: [],
      activePath: null,
    });
  });
});
