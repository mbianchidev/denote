import type { EditorTab } from "../types";

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
    return [...tabs, opened];
  }
  const next = [...tabs];
  next.splice(activeIndex, 1, opened);
  return next;
}
