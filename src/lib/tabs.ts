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
    return tabsInVisualOrder([...tabs, opened]);
  }
  const next = [...tabs];
  next.splice(activeIndex, 1, opened);
  return tabsInVisualOrder(next);
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
