import type { EditorTab } from "../types";

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
  const navigation = pushTabNavigation(tabs[activeIndex], opened.path);
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
): { path: string; index: number } | null {
  const navigation = tabNavigation(tab);
  const index = navigation.navigationIndex + direction;
  const path = navigation.navigationHistory[index];
  return path ? { path, index } : null;
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
  };
}

function pushTabNavigation(
  tab: EditorTab,
  path: string,
): Pick<EditorTab, "navigationHistory" | "navigationIndex"> {
  const navigation = tabNavigation(tab);
  const history = navigation.navigationHistory.slice(
    0,
    navigation.navigationIndex + 1,
  );
  if (history[history.length - 1] !== path) {
    history.push(path);
  }
  return {
    navigationHistory: history,
    navigationIndex: history.length - 1,
  };
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
