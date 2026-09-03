import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  Files,
  FolderTree,
  GitBranch,
  GripVertical,
  Info,
  Moon,
  Plug,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { SidebarView } from "../types";
import type { Theme } from "../lib/theme";
import type { PluginSourceControlContribution } from "../plugins/workerRuntime";

interface ActivityRailProps {
  activeView: SidebarView;
  activePluginView: string | null;
  activeSourceControlProvider: {
    pluginId: string;
    providerId: string;
  } | null;
  pluginViews: Array<{ id: string; title: string }>;
  sourceControlProviders: PluginSourceControlContribution[];
  theme: Theme;
  onViewChange: (view: SidebarView) => void;
  onPluginViewChange: (viewId: string) => void;
  onSourceControlProviderChange: (
    pluginId: string,
    providerId: string,
  ) => void;
  onAbout: () => void;
  onThemeToggle: () => void;
}

interface PluginRailPreferences {
  order: string[];
  hidden: string[];
  groups: Record<string, string>;
  collapsedGroups: string[];
}

interface PluginRailItem {
  key: string;
  title: string;
  selected: boolean;
  kind: "view" | "source-control";
  onSelect: () => void;
}

const PLUGIN_RAIL_STORAGE_KEY = "denote.plugin-rail.v1";
const DEFAULT_GROUP = "Plugins";

const views: Array<{
  id: SidebarView;
  label: string;
  icon: typeof Files;
}> = [
  { id: "files", label: "Files", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
  { id: "recent", label: "Recent files", icon: Clock3 },
  { id: "trash", label: "Trash", icon: Trash2 },
];

function ActivityRailComponent({
  activeView,
  activePluginView,
  activeSourceControlProvider,
  pluginViews,
  sourceControlProviders,
  theme,
  onViewChange,
  onPluginViewChange,
  onSourceControlProviderChange,
  onAbout,
  onThemeToggle,
}: ActivityRailProps) {
  const [preferences, setPreferences] = useState(loadPluginRailPreferences);
  const [dragged, setDragged] = useState<string | null>(null);
  const items = useMemo<PluginRailItem[]>(() => {
    const sidebarItems = pluginViews.map((view) => ({
      key: `view:${view.id}`,
      title: view.title,
      selected: activePluginView === view.id,
      kind: "view" as const,
      onSelect: () => onPluginViewChange(view.id),
    }));
    const sourceItems = sourceControlProviders.map((provider) => {
      const duplicateTitle = sourceControlProviders.some(
        (candidate) =>
          candidate !== provider && candidate.title === provider.title,
      );
      const duplicateWithinPlugin = sourceControlProviders.some(
        (candidate) =>
          candidate !== provider &&
          candidate.pluginId === provider.pluginId &&
          candidate.title === provider.title,
      );
      const title = `Source control: ${provider.title}${
        duplicateWithinPlugin
          ? ` (${provider.id})`
          : duplicateTitle
            ? ` (${provider.pluginId})`
            : ""
      }`;
      return {
        key: `source:${provider.pluginId}:${provider.id}`,
        title,
        selected:
          activeSourceControlProvider?.pluginId === provider.pluginId &&
          activeSourceControlProvider.providerId === provider.id,
        kind: "source-control" as const,
        onSelect: () =>
          onSourceControlProviderChange(provider.pluginId, provider.id),
      };
    });
    const available = [...sidebarItems, ...sourceItems];
    const rank = new Map(
      preferences.order.map((key, index) => [key, index] as const),
    );
    return available.sort(
      (left, right) =>
        (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title),
    );
  }, [
    activePluginView,
    activeSourceControlProvider,
    onPluginViewChange,
    onSourceControlProviderChange,
    pluginViews,
    preferences.order,
    sourceControlProviders,
  ]);
  const hidden = new Set(preferences.hidden);
  const visibleItems = items.filter((item) => !hidden.has(item.key));
  const hiddenItems = items.filter((item) => hidden.has(item.key));
  const grouped = groupItems(visibleItems, preferences.groups);
  const collapsed = new Set(preferences.collapsedGroups);

  useEffect(() => {
    savePluginRailPreferences(preferences);
  }, [preferences]);

  const updateOrder = (source: string, target: string) => {
    if (source === target) {
      return;
    }
    setPreferences((current) => {
      const available = items.map((item) => item.key);
      const order = [
        ...current.order.filter((key) => available.includes(key)),
        ...available.filter((key) => !current.order.includes(key)),
      ];
      const sourceIndex = order.indexOf(source);
      const targetIndex = order.indexOf(target);
      if (sourceIndex === -1 || targetIndex === -1) {
        return current;
      }
      order.splice(sourceIndex, 1);
      order.splice(targetIndex, 0, source);
      return { ...current, order };
    });
  };

  return (
    <nav className="activity-rail" aria-label="Workspace views">
      <div className="activity-rail__brand" aria-label="Denote">
        D
      </div>
      <div className="activity-rail__views">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            className="icon-button activity-rail__button"
            type="button"
            key={id}
            aria-label={label}
            aria-pressed={
              activePluginView === null &&
              activeSourceControlProvider === null &&
              activeView === id
            }
            title={
              id === "search"
                ? `Search (${
                    navigator.platform.includes("Mac") ? "⌘F" : "Ctrl+F"
                  })`
                : label
            }
            onClick={() => onViewChange(id)}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        ))}
        {grouped.map(([group, groupItems]) => {
          const groupCollapsed = collapsed.has(group);
          return (
            <div className="activity-rail__plugin-group" key={group}>
              <button
                type="button"
                className="activity-rail__group-toggle"
                aria-label={`${groupCollapsed ? "Expand" : "Collapse"} ${group} plugin group`}
                aria-expanded={!groupCollapsed}
                title={group}
                onClick={() =>
                  setPreferences((current) => ({
                    ...current,
                    collapsedGroups: groupCollapsed
                      ? current.collapsedGroups.filter(
                          (candidate) => candidate !== group,
                        )
                      : [...current.collapsedGroups, group],
                  }))
                }
              >
                {groupCollapsed ? (
                  <ChevronRight aria-hidden="true" size={12} />
                ) : (
                  <ChevronDown aria-hidden="true" size={12} />
                )}
                <span className="sr-only">{group}</span>
              </button>
              {groupCollapsed
                ? null
                : groupItems.map((item) => (
                    <button
                      className="icon-button activity-rail__button"
                      type="button"
                      draggable
                      key={item.key}
                      aria-label={item.title}
                      aria-pressed={item.selected}
                      title={`${item.title} · drag to reorder`}
                      onClick={item.onSelect}
                      onDragStart={() => setDragged(item.key)}
                      onDragEnd={() => setDragged(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (dragged) {
                          updateOrder(dragged, item.key);
                        }
                        setDragged(null);
                      }}
                    >
                      {item.kind === "source-control" ? (
                        <GitBranch aria-hidden="true" size={19} strokeWidth={1.8} />
                      ) : (
                        <Plug aria-hidden="true" size={19} strokeWidth={1.8} />
                      )}
                    </button>
                  ))}
            </div>
          );
        })}
        {items.length > 0 ? (
          <details className="activity-rail__plugin-manager">
            <summary
              className="icon-button activity-rail__button"
              aria-label="Organize plugins"
              title="Organize plugins"
            >
              <FolderTree aria-hidden="true" size={18} />
            </summary>
            <div className="activity-rail__plugin-manager-panel">
              <h2>Organize plugins</h2>
              <ul>
                {visibleItems.map((item, index) => (
                  <li key={item.key}>
                    <GripVertical aria-hidden="true" size={14} />
                    <span>{item.title}</span>
                    <input
                      aria-label={`Group for ${item.title}`}
                      value={preferences.groups[item.key] ?? ""}
                      placeholder={DEFAULT_GROUP}
                      onChange={(event) => {
                        const group = event.currentTarget.value;
                        setPreferences((current) => ({
                          ...current,
                          groups: { ...current.groups, [item.key]: group },
                        }));
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Move ${item.title} up`}
                      disabled={index === 0}
                      onClick={() =>
                        updateOrder(item.key, visibleItems[index - 1]?.key ?? item.key)
                      }
                    >
                      <ArrowUp aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.title} down`}
                      disabled={index === visibleItems.length - 1}
                      onClick={() =>
                        updateOrder(item.key, visibleItems[index + 1]?.key ?? item.key)
                      }
                    >
                      <ArrowDown aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hide ${item.title}`}
                      onClick={() =>
                        setPreferences((current) => ({
                          ...current,
                          hidden: [...new Set([...current.hidden, item.key])],
                        }))
                      }
                    >
                      <EyeOff aria-hidden="true" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <details>
                <summary>Hidden plugins ({hiddenItems.length})</summary>
                {hiddenItems.length > 0 ? (
                  <ul>
                    {hiddenItems.map((item) => (
                      <li key={item.key}>
                        <span>{item.title}</span>
                        <button
                          type="button"
                          aria-label={`Show ${item.title}`}
                          onClick={() =>
                            setPreferences((current) => ({
                              ...current,
                              hidden: current.hidden.filter(
                                (key) => key !== item.key,
                              ),
                            }))
                          }
                        >
                          <Eye aria-hidden="true" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No hidden plugins.</p>
                )}
              </details>
            </div>
          </details>
        ) : null}
      </div>
      <button
        className="icon-button activity-rail__button"
        type="button"
        aria-label="About Denote"
        title="About Denote"
        onClick={onAbout}
      >
        <Info aria-hidden="true" size={19} strokeWidth={1.8} />
      </button>
      <button
        className="icon-button activity-rail__button"
        type="button"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onClick={onThemeToggle}
      >
        {theme === "dark" ? (
          <Sun aria-hidden="true" size={19} strokeWidth={1.8} />
        ) : (
          <Moon aria-hidden="true" size={19} strokeWidth={1.8} />
        )}
      </button>
    </nav>
  );
}

function groupItems(
  items: PluginRailItem[],
  groups: Record<string, string>,
): Array<[string, PluginRailItem[]]> {
  const grouped = new Map<string, PluginRailItem[]>();
  for (const item of items) {
    const group = groups[item.key]?.trim() || DEFAULT_GROUP;
    grouped.set(group, [...(grouped.get(group) ?? []), item]);
  }
  return [...grouped.entries()];
}

function loadPluginRailPreferences(): PluginRailPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(PLUGIN_RAIL_STORAGE_KEY) ?? "{}",
    ) as Partial<PluginRailPreferences>;
    return {
      order: stringArray(value.order),
      hidden: stringArray(value.hidden),
      groups: stringRecord(value.groups),
      collapsedGroups: stringArray(value.collapsedGroups),
    };
  } catch {
    return { order: [], hidden: [], groups: {}, collapsedGroups: [] };
  }
}

function savePluginRailPreferences(preferences: PluginRailPreferences) {
  try {
    localStorage.setItem(PLUGIN_RAIL_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.error("Unable to save plugin rail preferences:", error);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export const ActivityRail = memo(ActivityRailComponent);
