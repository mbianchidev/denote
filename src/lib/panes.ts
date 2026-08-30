import type {
  EditorTab,
  PaneLayout,
  PaneLayoutKind,
  TabGroup,
  TabSessionPane,
  TabSessionState,
  WorkspacePane,
} from "../types";
import { removeTabNavigationPaths, tabsInVisualOrder } from "./tabs";

export const MAX_PANES = 4;
export const MIN_PANE_FRACTION = 0.12;
export const DEFAULT_PANE_ID = "pane-1";

export const PANE_LAYOUT_KINDS: PaneLayoutKind[] = [
  "single",
  "horizontal",
  "vertical",
  "grid",
  "left-stack",
  "right-stack",
  "top-stack",
  "bottom-stack",
];

export const PANE_LAYOUT_LABELS: Record<PaneLayoutKind, string> = {
  single: "Single pane",
  horizontal: "Side by side",
  vertical: "Stacked",
  grid: "Grid",
  "left-stack": "Large left, two stacked right",
  "right-stack": "Two stacked left, large right",
  "top-stack": "Large top, two below",
  "bottom-stack": "Two above, large bottom",
};

export interface PaneLayoutGroup {
  axis: "x" | "y";
  count: number;
}

export interface PaneArea {
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
}

export interface PaneSeparator extends PaneArea {
  groupIndex: number;
  index: number;
  axis: "x" | "y";
}

export interface PaneWorkspaceState {
  panes: WorkspacePane[];
  layout: PaneLayout;
  focusedPaneId: string;
}

export function layoutSupportsPaneCount(
  kind: PaneLayoutKind,
  paneCount: number,
): boolean {
  switch (kind) {
    case "single":
      return paneCount === 1;
    case "horizontal":
    case "vertical":
      return paneCount >= 2 && paneCount <= MAX_PANES;
    case "grid":
      return paneCount === 4;
    default:
      return paneCount === 3;
  }
}

export function layoutsForPaneCount(paneCount: number): PaneLayoutKind[] {
  return PANE_LAYOUT_KINDS.filter((kind) =>
    layoutSupportsPaneCount(kind, paneCount),
  );
}

export function defaultLayoutKind(paneCount: number): PaneLayoutKind {
  if (paneCount <= 1) {
    return "single";
  }
  return paneCount === 4 ? "grid" : "horizontal";
}

export function paneLayoutGroups(
  kind: PaneLayoutKind,
  paneCount: number,
): PaneLayoutGroup[] {
  switch (kind) {
    case "single":
      return [];
    case "horizontal":
      return [{ axis: "x", count: paneCount }];
    case "vertical":
      return [{ axis: "y", count: paneCount }];
    case "grid":
    case "left-stack":
    case "right-stack":
      return [
        { axis: "x", count: 2 },
        { axis: "y", count: 2 },
      ];
    default:
      return [
        { axis: "y", count: 2 },
        { axis: "x", count: 2 },
      ];
  }
}

export function defaultPaneSizes(
  kind: PaneLayoutKind,
  paneCount: number,
): number[] {
  return paneLayoutGroups(kind, paneCount).flatMap((group) =>
    Array.from({ length: group.count }, () => 1 / group.count),
  );
}

export function normalizePaneLayout(
  layout: PaneLayout | null | undefined,
  paneCount: number,
): PaneLayout {
  const clamped = Math.min(Math.max(paneCount, 1), MAX_PANES);
  const kind =
    layout && layoutSupportsPaneCount(layout.kind, clamped)
      ? layout.kind
      : defaultLayoutKind(clamped);
  const groups = paneLayoutGroups(kind, clamped);
  const expected = groups.reduce((total, group) => total + group.count, 0);
  const sizes = layout?.sizes ?? [];
  if (
    sizes.length !== expected ||
    sizes.some((size) => !Number.isFinite(size) || size <= 0)
  ) {
    return { kind, sizes: defaultPaneSizes(kind, clamped) };
  }
  const normalized: number[] = [];
  let offset = 0;
  for (const group of groups) {
    const fractions = sizes.slice(offset, offset + group.count);
    offset += group.count;
    const total = fractions.reduce((sum, value) => sum + value, 0);
    const scaled = fractions.map((value) => value / total);
    normalized.push(...clampFractions(scaled));
  }
  return { kind, sizes: normalized };
}

export function paneLayoutTracks(
  layout: PaneLayout,
  paneCount: number,
  gap: string,
): { columns: string; rows: string } {
  const groups = paneLayoutGroups(layout.kind, paneCount);
  const fractionsByAxis = new Map<"x" | "y", number[]>();
  let offset = 0;
  for (const group of groups) {
    fractionsByAxis.set(group.axis, layout.sizes.slice(offset, offset + group.count));
    offset += group.count;
  }
  const template = (axis: "x" | "y") => {
    const fractions = fractionsByAxis.get(axis);
    if (!fractions || fractions.length === 0) {
      return "minmax(0, 1fr)";
    }
    return fractions
      .map((fraction) => `minmax(0, ${fraction}fr)`)
      .join(` ${gap} `);
  };
  return { columns: template("x"), rows: template("y") };
}

function axisLineEnd(kind: PaneLayoutKind, paneCount: number, axis: "x" | "y") {
  const group = paneLayoutGroups(kind, paneCount).find(
    (candidate) => candidate.axis === axis,
  );
  return group ? group.count * 2 : 2;
}

export function paneAreas(
  kind: PaneLayoutKind,
  paneCount: number,
): PaneArea[] {
  const full = (axis: "x" | "y") => axisLineEnd(kind, paneCount, axis);
  const cell = (index: number) => ({
    start: index * 2 + 1,
    end: index * 2 + 2,
  });
  switch (kind) {
    case "single":
      return [{ columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 }];
    case "horizontal":
      return Array.from({ length: paneCount }, (_, index) => ({
        columnStart: cell(index).start,
        columnEnd: cell(index).end,
        rowStart: 1,
        rowEnd: 2,
      }));
    case "vertical":
      return Array.from({ length: paneCount }, (_, index) => ({
        columnStart: 1,
        columnEnd: 2,
        rowStart: cell(index).start,
        rowEnd: cell(index).end,
      }));
    case "grid":
      return Array.from({ length: 4 }, (_, index) => ({
        columnStart: cell(index % 2).start,
        columnEnd: cell(index % 2).end,
        rowStart: cell(Math.floor(index / 2)).start,
        rowEnd: cell(Math.floor(index / 2)).end,
      }));
    case "left-stack":
      return [
        { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: full("y") },
        { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 2 },
        { columnStart: 3, columnEnd: 4, rowStart: 3, rowEnd: 4 },
      ];
    case "right-stack":
      return [
        { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 },
        { columnStart: 1, columnEnd: 2, rowStart: 3, rowEnd: 4 },
        { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: full("y") },
      ];
    case "top-stack":
      return [
        { columnStart: 1, columnEnd: full("x"), rowStart: 1, rowEnd: 2 },
        { columnStart: 1, columnEnd: 2, rowStart: 3, rowEnd: 4 },
        { columnStart: 3, columnEnd: 4, rowStart: 3, rowEnd: 4 },
      ];
    default:
      return [
        { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 2 },
        { columnStart: 3, columnEnd: 4, rowStart: 1, rowEnd: 2 },
        { columnStart: 1, columnEnd: full("x"), rowStart: 3, rowEnd: 4 },
      ];
  }
}

export function paneSeparators(
  kind: PaneLayoutKind,
  paneCount: number,
): PaneSeparator[] {
  const full = (axis: "x" | "y") => axisLineEnd(kind, paneCount, axis);
  const between = (index: number) => index * 2 + 2;
  switch (kind) {
    case "single":
      return [];
    case "horizontal":
      return Array.from({ length: paneCount - 1 }, (_, index) => ({
        groupIndex: 0,
        index,
        axis: "x" as const,
        columnStart: between(index),
        columnEnd: between(index) + 1,
        rowStart: 1,
        rowEnd: 2,
      }));
    case "vertical":
      return Array.from({ length: paneCount - 1 }, (_, index) => ({
        groupIndex: 0,
        index,
        axis: "y" as const,
        columnStart: 1,
        columnEnd: 2,
        rowStart: between(index),
        rowEnd: between(index) + 1,
      }));
    case "grid":
      return [
        {
          groupIndex: 0,
          index: 0,
          axis: "x",
          columnStart: 2,
          columnEnd: 3,
          rowStart: 1,
          rowEnd: full("y"),
        },
        {
          groupIndex: 1,
          index: 0,
          axis: "y",
          columnStart: 1,
          columnEnd: full("x"),
          rowStart: 2,
          rowEnd: 3,
        },
      ];
    case "left-stack":
      return [
        {
          groupIndex: 0,
          index: 0,
          axis: "x",
          columnStart: 2,
          columnEnd: 3,
          rowStart: 1,
          rowEnd: full("y"),
        },
        {
          groupIndex: 1,
          index: 0,
          axis: "y",
          columnStart: 3,
          columnEnd: 4,
          rowStart: 2,
          rowEnd: 3,
        },
      ];
    case "right-stack":
      return [
        {
          groupIndex: 0,
          index: 0,
          axis: "x",
          columnStart: 2,
          columnEnd: 3,
          rowStart: 1,
          rowEnd: full("y"),
        },
        {
          groupIndex: 1,
          index: 0,
          axis: "y",
          columnStart: 1,
          columnEnd: 2,
          rowStart: 2,
          rowEnd: 3,
        },
      ];
    case "top-stack":
      return [
        {
          groupIndex: 0,
          index: 0,
          axis: "y",
          columnStart: 1,
          columnEnd: full("x"),
          rowStart: 2,
          rowEnd: 3,
        },
        {
          groupIndex: 1,
          index: 0,
          axis: "x",
          columnStart: 2,
          columnEnd: 3,
          rowStart: 3,
          rowEnd: 4,
        },
      ];
    default:
      return [
        {
          groupIndex: 0,
          index: 0,
          axis: "y",
          columnStart: 1,
          columnEnd: full("x"),
          rowStart: 2,
          rowEnd: 3,
        },
        {
          groupIndex: 1,
          index: 0,
          axis: "x",
          columnStart: 2,
          columnEnd: 3,
          rowStart: 1,
          rowEnd: 2,
        },
      ];
  }
}

export function paneGroupOffset(
  kind: PaneLayoutKind,
  paneCount: number,
  groupIndex: number,
): number {
  return paneLayoutGroups(kind, paneCount)
    .slice(0, groupIndex)
    .reduce((total, group) => total + group.count, 0);
}

export function resizePaneLayout(
  layout: PaneLayout,
  paneCount: number,
  groupIndex: number,
  index: number,
  delta: number,
): PaneLayout {
  const normalized = normalizePaneLayout(layout, paneCount);
  const groups = paneLayoutGroups(normalized.kind, paneCount);
  const group = groups[groupIndex];
  if (!group || index < 0 || index >= group.count - 1) {
    return normalized;
  }
  const offset = paneGroupOffset(normalized.kind, paneCount, groupIndex);
  const sizes = [...normalized.sizes];
  const first = sizes[offset + index];
  const second = sizes[offset + index + 1];
  const total = first + second;
  const next = Math.min(
    Math.max(first + delta, MIN_PANE_FRACTION),
    Math.max(total - MIN_PANE_FRACTION, MIN_PANE_FRACTION),
  );
  sizes[offset + index] = next;
  sizes[offset + index + 1] = total - next;
  return { kind: normalized.kind, sizes };
}

function clampFractions(fractions: number[]): number[] {
  if (fractions.length < 2) {
    return fractions.map(() => 1);
  }
  const minimum = Math.min(MIN_PANE_FRACTION, 1 / (fractions.length + 1));
  const clamped = fractions.map((fraction) => Math.max(fraction, minimum));
  const total = clamped.reduce((sum, fraction) => sum + fraction, 0);
  return clamped.map((fraction) => fraction / total);
}

export function createWorkspacePane(id: string): WorkspacePane {
  return { id, tabs: [], groups: [], activePath: null };
}

export function createPaneWorkspace(): PaneWorkspaceState {
  return {
    panes: [createWorkspacePane(DEFAULT_PANE_ID)],
    layout: { kind: "single", sizes: [] },
    focusedPaneId: DEFAULT_PANE_ID,
  };
}

export function nextPaneId(panes: WorkspacePane[]): string {
  const used = new Set(panes.map((pane) => pane.id));
  for (let index = 1; index <= MAX_PANES + 1; index += 1) {
    const candidate = `pane-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `pane-${panes.length + 1}`;
}

export function addPane(state: PaneWorkspaceState): PaneWorkspaceState {
  if (state.panes.length >= MAX_PANES) {
    return state;
  }
  const created = createWorkspacePane(nextPaneId(state.panes));
  const focusedIndex = state.panes.findIndex(
    (pane) => pane.id === state.focusedPaneId,
  );
  const panes = [...state.panes];
  panes.splice(focusedIndex < 0 ? panes.length : focusedIndex + 1, 0, created);
  return {
    panes,
    layout: nextLayoutForPaneCount(state.layout, panes.length),
    focusedPaneId: created.id,
  };
}

export function closePane(
  state: PaneWorkspaceState,
  paneId: string,
): PaneWorkspaceState {
  const index = state.panes.findIndex((pane) => pane.id === paneId);
  if (index < 0 || state.panes.length <= 1) {
    return state;
  }
  const closed = state.panes[index];
  const mergeIndex = index > 0 ? index - 1 : 1;
  const panes = state.panes
    .map((pane, paneIndex) =>
      paneIndex === mergeIndex
        ? {
            ...pane,
            tabs: tabsInVisualOrder([...pane.tabs, ...closed.tabs]),
            groups: [...pane.groups, ...closed.groups],
            activePath: pane.activePath ?? closed.activePath,
          }
        : pane,
    )
    .filter((_, paneIndex) => paneIndex !== index)
    .map(prunePaneGroups);
  const focusedPaneId =
    state.focusedPaneId === paneId
      ? (panes[Math.min(index, panes.length - 1)]?.id ?? panes[0].id)
      : state.focusedPaneId;
  return {
    panes,
    layout: nextLayoutForPaneCount(state.layout, panes.length),
    focusedPaneId,
  };
}

export function setPaneLayoutKind(
  state: PaneWorkspaceState,
  kind: PaneLayoutKind,
): PaneWorkspaceState {
  if (!layoutSupportsPaneCount(kind, state.panes.length)) {
    return state;
  }
  return {
    ...state,
    layout: normalizePaneLayout(
      { kind, sizes: defaultPaneSizes(kind, state.panes.length) },
      state.panes.length,
    ),
  };
}

function nextLayoutForPaneCount(
  layout: PaneLayout,
  paneCount: number,
): PaneLayout {
  const kind = layoutSupportsPaneCount(layout.kind, paneCount)
    ? layout.kind
    : defaultLayoutKind(paneCount);
  return normalizePaneLayout(
    { kind, sizes: defaultPaneSizes(kind, paneCount) },
    paneCount,
  );
}

export function prunePaneGroups(pane: WorkspacePane): WorkspacePane {
  const referenced = new Set(
    pane.tabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is string => groupId !== null),
  );
  const groups = pane.groups.filter((group) => referenced.has(group.id));
  return groups.length === pane.groups.length ? pane : { ...pane, groups };
}

export function updatePane(
  panes: WorkspacePane[],
  paneId: string,
  updater: (pane: WorkspacePane) => WorkspacePane,
): WorkspacePane[] {
  return panes.map((pane) => (pane.id === paneId ? updater(pane) : pane));
}

export function paneTabs(panes: WorkspacePane[]): EditorTab[] {
  return panes.flatMap((pane) => pane.tabs);
}

export function paneGroups(panes: WorkspacePane[]): TabGroup[] {
  return panes.flatMap((pane) => pane.groups);
}

export function findPaneByPath(
  panes: WorkspacePane[],
  path: string | null,
): WorkspacePane | null {
  if (!path) {
    return null;
  }
  return (
    panes.find((pane) => pane.tabs.some((tab) => tab.path === path)) ?? null
  );
}

export function findPaneByGroup(
  panes: WorkspacePane[],
  groupId: string,
): WorkspacePane | null {
  return (
    panes.find((pane) => pane.groups.some((group) => group.id === groupId)) ??
    null
  );
}

export function focusedPaneOf(state: PaneWorkspaceState): WorkspacePane {
  return (
    state.panes.find((pane) => pane.id === state.focusedPaneId) ??
    state.panes[0]
  );
}

export function setPaneActivePath(
  panes: WorkspacePane[],
  paneId: string,
  path: string | null,
): WorkspacePane[] {
  return updatePane(panes, paneId, (pane) => ({ ...pane, activePath: path }));
}

export function nextActivePath(
  pane: WorkspacePane,
  removed: (path: string) => boolean,
): string | null {
  if (!pane.activePath || !removed(pane.activePath)) {
    return pane.activePath;
  }
  const index = pane.tabs.findIndex((tab) => tab.path === pane.activePath);
  const remaining = pane.tabs.filter((tab) => !removed(tab.path));
  return (
    remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.path ?? null
  );
}

export function removePaneTabs(
  panes: WorkspacePane[],
  remove: (path: string) => boolean,
  rewriteHistory = true,
): { panes: WorkspacePane[]; removedPaths: string[] } {
  const removedPaths: string[] = [];
  const rewrite = (tab: EditorTab) =>
    rewriteHistory ? removeTabNavigationPaths(tab, remove) : tab;
  const next = panes.map((pane) => {
    const removedHere = pane.tabs.filter((tab) => remove(tab.path));
    if (removedHere.length === 0) {
      return {
        ...pane,
        tabs: pane.tabs.map(rewrite),
      };
    }
    removedPaths.push(...removedHere.map((tab) => tab.path));
    const activePath = nextActivePath(pane, remove);
    return prunePaneGroups({
      ...pane,
      tabs: pane.tabs.filter((tab) => !remove(tab.path)).map(rewrite),
      activePath,
    });
  });
  return { panes: next, removedPaths };
}

export function movePaneTab(
  panes: WorkspacePane[],
  path: string,
  targetPaneId: string,
  beforePath: string | null = null,
): WorkspacePane[] {
  const source = findPaneByPath(panes, path);
  const target = panes.find((pane) => pane.id === targetPaneId);
  if (!source || !target || source.id === target.id) {
    return panes;
  }
  const moving = source.tabs.find((tab) => tab.path === path);
  if (!moving) {
    return panes;
  }
  return panes.map((pane) => {
    if (pane.id === source.id) {
      const remaining = pane.tabs.filter((tab) => tab.path !== path);
      return prunePaneGroups({
        ...pane,
        tabs: remaining,
        activePath: nextActivePath(pane, (candidate) => candidate === path),
      });
    }
    if (pane.id !== target.id) {
      return pane;
    }
    const placed = [...pane.tabs];
    const beforeIndex = beforePath
      ? placed.findIndex((tab) => tab.path === beforePath)
      : -1;
    const inserted = { ...moving, groupId: null };
    if (beforeIndex >= 0) {
      placed.splice(beforeIndex, 0, inserted);
    } else {
      placed.push(inserted);
    }
    return {
      ...pane,
      tabs: tabsInVisualOrder(placed),
      activePath: path,
    };
  });
}

export type PaneDockPosition =
  | "center"
  | "tab-strip"
  | "left"
  | "right"
  | "top"
  | "bottom";

export function dockAxis(position: PaneDockPosition): "x" | "y" | null {
  switch (position) {
    case "left":
    case "right":
      return "x";
    case "top":
    case "bottom":
      return "y";
    default:
      return null;
  }
}

export function layoutKindWithoutPane(
  kind: PaneLayoutKind,
  paneCount: number,
  removedIndex: number,
): PaneLayoutKind | null {
  if (paneCount <= 2) {
    return "single";
  }
  if (paneCount === 3) {
    switch (kind) {
      case "horizontal":
        return "horizontal";
      case "vertical":
        return "vertical";
      case "left-stack":
        return removedIndex === 0 ? "vertical" : "horizontal";
      case "right-stack":
        return removedIndex === 2 ? "vertical" : "horizontal";
      case "top-stack":
        return removedIndex === 0 ? "horizontal" : "vertical";
      case "bottom-stack":
        return removedIndex === 2 ? "horizontal" : "vertical";
      default:
        return null;
    }
  }
  if (kind === "horizontal" || kind === "vertical") {
    return kind;
  }
  return null;
}

export function dockLayoutKind(
  baseKind: PaneLayoutKind | null,
  baseCount: number,
  targetIndex: number,
  axis: "x" | "y",
): PaneLayoutKind {
  if (baseCount <= 1) {
    return axis === "x" ? "horizontal" : "vertical";
  }
  if (baseCount === 2) {
    if (baseKind === "vertical") {
      return axis === "y"
        ? "vertical"
        : targetIndex === 0
          ? "bottom-stack"
          : "top-stack";
    }
    return axis === "x"
      ? "horizontal"
      : targetIndex === 0
        ? "right-stack"
        : "left-stack";
  }
  if (baseCount === 3) {
    if (baseKind === "horizontal" && axis === "x") {
      return "horizontal";
    }
    if (baseKind === "vertical" && axis === "y") {
      return "vertical";
    }
    return "grid";
  }
  return defaultLayoutKind(baseCount + 1);
}

function layoutForPanes(kind: PaneLayoutKind, paneCount: number): PaneLayout {
  return normalizePaneLayout(
    { kind, sizes: defaultPaneSizes(kind, paneCount) },
    paneCount,
  );
}

export function dockTab(
  state: PaneWorkspaceState,
  path: string,
  targetPaneId: string,
  position: PaneDockPosition,
): PaneWorkspaceState {
  const source = findPaneByPath(state.panes, path);
  const targetIndex = state.panes.findIndex((pane) => pane.id === targetPaneId);
  const target = state.panes[targetIndex];
  if (!source || !target) {
    return state;
  }
  const moving = source.tabs.find((tab) => tab.path === path);
  if (!moving) {
    return state;
  }
  if (position === "tab-strip") {
    if (source.id !== target.id) {
      return {
        ...state,
        panes: movePaneTab(state.panes, path, target.id),
        focusedPaneId: target.id,
      };
    }
    const ordered = tabsInVisualOrder(target.tabs);
    const sourceIndex = ordered.findIndex((tab) => tab.path === path);
    if (sourceIndex === ordered.length - 1 && moving.groupId === null) {
      return state;
    }
    return {
      ...state,
      panes: updatePane(state.panes, target.id, (pane) =>
        prunePaneGroups({
          ...pane,
          tabs: [
            ...ordered.filter((tab) => tab.path !== path),
            { ...moving, groupId: null },
          ],
          activePath: path,
        }),
      ),
      focusedPaneId: target.id,
    };
  }
  const axis = dockAxis(position);
  if (!axis) {
    if (source.id === target.id) {
      return state;
    }
    return {
      ...state,
      panes: movePaneTab(state.panes, path, target.id),
      focusedPaneId: target.id,
    };
  }
  const after = position === "right" || position === "bottom";

  if (source.tabs.length === 1 && state.panes.length > 1) {
    if (source.id === target.id) {
      return state;
    }
    const remaining = state.panes.filter((pane) => pane.id !== source.id);
    const sourceIndex = state.panes.findIndex((pane) => pane.id === source.id);
    const baseIndex = remaining.findIndex((pane) => pane.id === target.id);
    const panes = [...remaining];
    panes.splice(after ? baseIndex + 1 : baseIndex, 0, {
      ...source,
      activePath: path,
    });
    const baseKind = layoutKindWithoutPane(
      state.layout.kind,
      state.panes.length,
      sourceIndex,
    );
    return {
      panes,
      layout: layoutForPanes(
        dockLayoutKind(baseKind, remaining.length, baseIndex, axis),
        panes.length,
      ),
      focusedPaneId: source.id,
    };
  }

  if (state.panes.length >= MAX_PANES) {
    return state;
  }

  const created: WorkspacePane = {
    id: nextPaneId(state.panes),
    tabs: [{ ...moving, groupId: null }],
    groups: [],
    activePath: path,
  };
  const panes = state.panes.map((pane) =>
    pane.id === source.id
      ? prunePaneGroups({
          ...pane,
          tabs: pane.tabs.filter((tab) => tab.path !== path),
          activePath: nextActivePath(pane, (candidate) => candidate === path),
        })
      : pane,
  );
  const baseIndex = panes.findIndex((pane) => pane.id === target.id);
  panes.splice(after ? baseIndex + 1 : baseIndex, 0, created);
  return {
    panes,
    layout: layoutForPanes(
      dockLayoutKind(state.layout.kind, state.panes.length, baseIndex, axis),
      panes.length,
    ),
    focusedPaneId: created.id,
  };
}

export function buildPaneSessionState(
  state: PaneWorkspaceState,
): TabSessionState {
  const panes: TabSessionPane[] = state.panes.map((pane) => {
    const realTabs = tabsInVisualOrder(pane.tabs).filter(
      (tab) => !tab.placeholder,
    );
    const groupIds = new Set(
      realTabs
        .map((tab) => tab.groupId)
        .filter((groupId): groupId is string => groupId !== null),
    );
    return {
      id: pane.id,
      tabs: realTabs.map((tab) => ({ path: tab.path, groupId: tab.groupId })),
      groups: pane.groups.filter((group) => groupIds.has(group.id)),
      activePath:
        pane.activePath && realTabs.some((tab) => tab.path === pane.activePath)
          ? pane.activePath
          : null,
    };
  });
  const focusedPaneId =
    panes.find((pane) => pane.id === state.focusedPaneId)?.id ??
    panes[0]?.id ??
    DEFAULT_PANE_ID;
  const focused = panes.find((pane) => pane.id === focusedPaneId);
  return {
    tabs: panes.flatMap((pane) => pane.tabs),
    groups: panes.flatMap((pane) => pane.groups),
    activePath:
      focused?.activePath ??
      panes.find((pane) => pane.activePath !== null)?.activePath ??
      null,
    panes,
    layout: normalizePaneLayout(state.layout, state.panes.length),
    focusedPaneId,
  };
}

export function upgradeTabSession(session: TabSessionState): {
  panes: TabSessionPane[];
  layout: PaneLayout;
  focusedPaneId: string;
} {
  const saved = Array.isArray(session.panes) ? session.panes : null;
  const panes: TabSessionPane[] =
    saved && saved.length > 0
      ? saved.slice(0, MAX_PANES).map((pane, index) => ({
          id: pane.id || `pane-${index + 1}`,
          tabs: pane.tabs ?? [],
          groups: pane.groups ?? [],
          activePath: pane.activePath ?? null,
        }))
      : [
          {
            id: DEFAULT_PANE_ID,
            tabs: session.tabs,
            groups: session.groups,
            activePath: session.activePath,
          },
        ];
  const uniqueIds = new Set<string>();
  const deduplicated = panes.map((pane, index) => {
    const id = uniqueIds.has(pane.id) ? `pane-${index + 1}-${index}` : pane.id;
    uniqueIds.add(id);
    return { ...pane, id };
  });
  const focusedPaneId =
    session.focusedPaneId &&
    deduplicated.some((pane) => pane.id === session.focusedPaneId)
      ? session.focusedPaneId
      : deduplicated[0].id;
  return {
    panes: deduplicated,
    layout: normalizePaneLayout(session.layout, deduplicated.length),
    focusedPaneId,
  };
}

export function applyPaneSessionState(
  loadedTabs: EditorTab[],
  session: TabSessionState,
): PaneWorkspaceState {
  const upgraded = upgradeTabSession(session);
  const loadedByPath = new Map(loadedTabs.map((tab) => [tab.path, tab]));
  const claimed = new Set<string>();
  const panes = upgraded.panes.map((saved) => {
    const tabs = tabsInVisualOrder(
      saved.tabs.flatMap((sessionTab) => {
        const tab = loadedByPath.get(sessionTab.path);
        if (!tab || claimed.has(sessionTab.path)) {
          return [];
        }
        claimed.add(sessionTab.path);
        return [{ ...tab, groupId: sessionTab.groupId }];
      }),
    );
    const groupIds = new Set(
      tabs
        .map((tab) => tab.groupId)
        .filter((groupId): groupId is string => groupId !== null),
    );
    return {
      id: saved.id,
      tabs,
      groups: saved.groups.filter((group) => groupIds.has(group.id)),
      activePath:
        saved.activePath && tabs.some((tab) => tab.path === saved.activePath)
          ? saved.activePath
          : (tabs[0]?.path ?? null),
    };
  });
  return {
    panes,
    layout: normalizePaneLayout(upgraded.layout, panes.length),
    focusedPaneId:
      panes.find((pane) => pane.id === upgraded.focusedPaneId)?.id ??
      panes[0].id,
  };
}

export function paneAccessibleLabel(
  panes: WorkspacePane[],
  paneId: string,
): string {
  const index = panes.findIndex((pane) => pane.id === paneId);
  const pane = panes[index];
  if (!pane) {
    return "Editor pane";
  }
  const activeTab = pane.tabs.find((tab) => tab.path === pane.activePath);
  const subject = activeTab ? activeTab.title : "Empty";
  return `Pane ${index + 1} of ${panes.length}: ${subject}`;
}
