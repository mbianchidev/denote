import type {
  EditorTab,
  TabGroup,
  TabSessionState,
} from "../types";

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
      tabs.flatMap((tab) => [tab.path, ...(tab.navigationHistory ?? [])]),
    ),
  ];
}

export function tabsReferencePath(tabs: EditorTab[], path: string): boolean {
  return tabs.some(
    (tab) => tab.path === path || tab.navigationHistory?.includes(path),
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
  next.splice(activeIndex, 1, {
    ...opened,
    groupId: next[activeIndex].groupId,
    ...navigation,
  });
  return tabsInVisualOrder(next);
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

export function removeTabsForPaths(
  tabs: EditorTab[],
  activePath: string | null,
  remove: (path: string) => boolean,
): {
  tabs: EditorTab[];
  removedPaths: string[];
  activePath: string | null;
} {
  const activeIndex = tabs.findIndex((tab) => tab.path === activePath);
  const removedPaths = tabs
    .filter((tab) => remove(tab.path))
    .map((tab) => tab.path);
  const remaining = tabs
    .filter((tab) => !remove(tab.path))
    .map((tab) => removeTabNavigationPaths(tab, remove));
  return {
    tabs: remaining,
    removedPaths,
    activePath:
      activePath && remove(activePath)
        ? (remaining[
            Math.min(Math.max(activeIndex, 0), remaining.length - 1)
          ]?.path ?? null)
        : activePath,
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

export function buildTabSessionState(
  tabs: EditorTab[],
  groups: TabGroup[],
  activePath: string | null,
): TabSessionState {
  const realTabs = tabsInVisualOrder(tabs).filter((tab) => !tab.placeholder);
  const groupIds = new Set(
    realTabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is string => groupId !== null),
  );
  return {
    tabs: realTabs.map((tab) => ({
      path: tab.path,
      groupId: tab.groupId,
    })),
    groups: groups.filter((group) => groupIds.has(group.id)),
    activePath:
      activePath && realTabs.some((tab) => tab.path === activePath)
        ? activePath
        : null,
  };
}

export function applyTabSessionLayout(
  loadedTabs: EditorTab[],
  session: TabSessionState,
): {
  tabs: EditorTab[];
  groups: TabGroup[];
  activePath: string | null;
} {
  const loadedByPath = new Map(loadedTabs.map((tab) => [tab.path, tab]));
  const tabs = tabsInVisualOrder(
    session.tabs.flatMap((saved) => {
      const tab = loadedByPath.get(saved.path);
      return tab ? [{ ...tab, groupId: saved.groupId }] : [];
    }),
  );
  const groupIds = new Set(
    tabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is string => groupId !== null),
  );
  return {
    tabs,
    groups: session.groups.filter((group) => groupIds.has(group.id)),
    activePath:
      session.activePath && tabs.some((tab) => tab.path === session.activePath)
        ? session.activePath
        : (tabs[0]?.path ?? null),
  };
}
