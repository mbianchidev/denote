import type { EditorTab } from "../types";
import type { PluginCodePosition } from "@denote/plugin-sdk";

export const MAX_TAB_SESSION_TABS = 100;
export const MAX_TAB_SESSION_GROUPS = 50;

export function tabsInVisualOrder(tabs: EditorTab[]): EditorTab[] {
  const emittedGroups = new Set<string>();
  return tabs.flatMap((tab) => {
    if (!tab.groupId) {
      return [tab];
    }
    if (emittedGroups.has(tab.groupId)) {
      return [];
    }
    emittedGroups.add(tab.groupId);
    return tabs.filter((candidate) => candidate.groupId === tab.groupId);
  });
}

export function tabReferencedPaths(tabs: EditorTab[]): string[] {
  return [
    ...new Set(
      tabs.flatMap((tab) =>
        tab.transient ? [] : [tab.path, ...(tab.navigationHistory ?? [])],
      ),
    ),
  ];
}

export function tabsReferencePath(tabs: EditorTab[], path: string): boolean {
  return tabs.some(
    (tab) =>
      !tab.transient &&
      (tab.path === path || tab.navigationHistory?.includes(path)),
  );
}

export function moveTabInLayout(
  tabs: EditorTab[],
  sourcePath: string,
  targetPath: string,
): EditorTab[] {
  const ordered = tabsInVisualOrder(tabs);
  const sourceIndex = ordered.findIndex((tab) => tab.path === sourcePath);
  const targetIndex = ordered.findIndex((tab) => tab.path === targetPath);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return ordered;
  }
  const targetGroupId = ordered[targetIndex].groupId;
  const [source] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, { ...source, groupId: targetGroupId });
  return tabsInVisualOrder(ordered);
}

export function placeOpenedTab(
  tabs: EditorTab[],
  activePath: string | null,
  opened: EditorTab,
  preserveUnsaved = true,
): EditorTab[] {
  if (tabs.some((tab) => tab.path === opened.path)) {
    return tabs;
  }
  const activeIndex = activePath
    ? tabs.findIndex((tab) => tab.path === activePath)
    : -1;
  if (activeIndex < 0) {
    return tabsInVisualOrder([
      ...tabs,
      {
        ...opened,
        navigationHistory: [opened.path],
        navigationIndex: 0,
      },
    ]);
  }
  const navigation = tabs[activeIndex].transient
    ? {
        navigationHistory: [opened.path],
        navigationIndex: 0,
      }
    : pushTabNavigation(tabs[activeIndex], opened.path);
  const next = [...tabs];
  if (preserveUnsaved && tabHasUnsavedChanges(next[activeIndex])) {
    next.splice(activeIndex + 1, 0, {
      ...opened,
      groupId: next[activeIndex].groupId,
      ...navigation,
    });
    return tabsInVisualOrder(next);
  }
  next.splice(activeIndex, 1, {
    ...opened,
    groupId: next[activeIndex].groupId,
    ...navigation,
  });
  return tabsInVisualOrder(next);
}

export function tabHasUnsavedChanges(tab: EditorTab): boolean {
  return !tab.transient && tab.content !== tab.savedContent;
}

export function placeTabInGroup(
  tabs: EditorTab[],
  path: string,
  groupId: string | null,
): EditorTab[] {
  const index = tabs.findIndex((tab) => tab.path === path);
  if (index < 0) {
    return tabs;
  }
  const target = { ...tabs[index], groupId };
  const remaining = tabs.filter((tab) => tab.path !== path);
  if (!groupId) {
    remaining.splice(Math.min(index, remaining.length), 0, target);
    return tabsInVisualOrder(remaining);
  }
  const lastGroupIndex = remaining.reduce(
    (last, tab, tabIndex) => (tab.groupId === groupId ? tabIndex : last),
    -1,
  );
  remaining.splice(
    lastGroupIndex >= 0 ? lastGroupIndex + 1 : remaining.length,
    0,
    target,
  );
  return tabsInVisualOrder(remaining);
}

export function tabHistoryTarget(
  tab: EditorTab,
  direction: -1 | 1,
): { path: string; index: number; position?: PluginCodePosition } | null {
  const navigation = tabNavigation(tab);
  const index = navigation.navigationIndex + direction;
  const path = navigation.navigationHistory[index];
  const position = tab.navigationPositions?.[index];
  return path ? { path, index, ...(position ? { position } : {}) } : null;
}

export function restoreTabHistoryTarget(
  current: EditorTab,
  opened: EditorTab,
  index: number,
): EditorTab {
  const navigation = tabNavigation(current);
  return {
    ...opened,
    groupId: current.groupId,
    navigationHistory: navigation.navigationHistory,
    navigationIndex: index,
    ...(current.navigationPositions ? {
      navigationPositions: current.navigationPositions,
      cursorPosition: current.navigationPositions[index] ?? undefined,
    } : {}),
  };
}

export function rekeyTabNavigation(
  tab: EditorTab,
  replacePath: (path: string) => string,
): EditorTab {
  const navigation = tabNavigation(tab);
  return {
    ...tab,
    navigationHistory: navigation.navigationHistory.map(replacePath),
    navigationIndex: navigation.navigationIndex,
  };
}

export function removeTabNavigationPaths(
  tab: EditorTab,
  remove: (path: string) => boolean,
): EditorTab {
  const navigation = tabNavigation(tab);
  const history = navigation.navigationHistory.filter((path) => !remove(path));
  const retainedThroughCursor = navigation.navigationHistory
    .slice(0, navigation.navigationIndex + 1)
    .filter((path) => !remove(path)).length;
  return {
    ...tab,
    navigationHistory: history,
    navigationIndex: Math.max(
      Math.min(retainedThroughCursor - 1, history.length - 1),
      0,
    ),
    ...(tab.navigationPositions ? {
      navigationPositions: tab.navigationPositions.filter((_, index) => !remove(navigation.navigationHistory[index])),
    } : {}),
  };
}

function pushTabNavigation(
  tab: EditorTab,
  path: string,
): Pick<EditorTab, "navigationHistory" | "navigationIndex" | "navigationPositions"> {
  const navigation = tabNavigation(tab);
  const history = navigation.navigationHistory.slice(
    0,
    navigation.navigationIndex + 1,
  );
  const positions = tab.navigationPositions?.slice(0, navigation.navigationIndex + 1);
  if (history[history.length - 1] !== path) {
    history.push(path);
    positions?.push(null);
  }
  const trim = positions ? Math.max(0, history.length - 500) : 0;
  return {
    navigationHistory: history.slice(trim),
    navigationIndex: history.length - trim - 1,
    ...(positions ? { navigationPositions: positions.slice(trim) } : {}),
  };
}

export function recordTabCursor(tab: EditorTab, position: PluginCodePosition): EditorTab {
  const navigation = tabNavigation(tab);
  const positions = navigation.navigationHistory.map((_, index) =>
    index === navigation.navigationIndex ? { ...position } : tab.navigationPositions?.[index] ?? null);
  return { ...tab, ...navigation, cursorPosition: { ...position }, navigationPositions: positions };
}

export function pushTabLocation(tab: EditorTab, position: PluginCodePosition): EditorTab {
  if (tab.cursorPosition?.line === position.line && tab.cursorPosition.character === position.character) return recordTabCursor(tab, position);
  const current = recordTabCursor(tab, tab.cursorPosition ?? { line: 0, character: 0 });
  const navigation = tabNavigation(current);
  const history = navigation.navigationHistory.slice(0, navigation.navigationIndex + 1);
  const positions = current.navigationPositions!.slice(0, navigation.navigationIndex + 1);
  history.push(tab.path); positions.push({ ...position });
  const trim = Math.max(0, history.length - 500);
  return { ...tab, cursorPosition: { ...position }, navigationHistory: history.slice(trim),
    navigationPositions: positions.slice(trim), navigationIndex: history.length - trim - 1 };
}

function tabNavigation(
  tab: EditorTab,
): Required<
  Pick<EditorTab, "navigationHistory" | "navigationIndex">
> {
  const history = [
    ...(tab.navigationHistory?.filter((path) => path.length > 0) ??
      (tab.placeholder ? [] : [tab.path])),
  ];
  if (history.length === 0) {
    return { navigationHistory: [], navigationIndex: -1 };
  }
  let index = Math.min(
    Math.max(tab.navigationIndex ?? history.length - 1, 0),
    history.length - 1,
  );
  if (history[index] !== tab.path) {
    const existing = history.lastIndexOf(tab.path);
    if (existing >= 0) {
      index = existing;
    } else {
      history.splice(index + 1);
      history.push(tab.path);
      index = history.length - 1;
    }
  }
  return { navigationHistory: history, navigationIndex: index };
}
