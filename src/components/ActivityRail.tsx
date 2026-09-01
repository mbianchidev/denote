import {
  Bookmark,
  Clock3,
  Files,
  GitBranch,
  Info,
  Moon,
  Plug,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
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

export function ActivityRail({
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
        {pluginViews.map((view) => (
          <button
            className="icon-button activity-rail__button"
            type="button"
            key={view.id}
            aria-label={view.title}
            aria-pressed={activePluginView === view.id}
            title={view.title}
            onClick={() => onPluginViewChange(view.id)}
          >
            <Plug aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        ))}
        {sourceControlProviders.map((provider) => {
          const selected =
            activeSourceControlProvider?.pluginId === provider.pluginId &&
            activeSourceControlProvider.providerId === provider.id;
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
          const label = `Source control: ${provider.title}${
            duplicateWithinPlugin
              ? ` (${provider.id})`
              : duplicateTitle
                ? ` (${provider.pluginId})`
                : ""
          }`;
          return (
            <button
              className="icon-button activity-rail__button"
              type="button"
              key={`${provider.pluginId}:${provider.id}`}
              aria-label={label}
              aria-pressed={selected}
              title={label}
              onClick={() =>
                onSourceControlProviderChange(provider.pluginId, provider.id)
              }
            >
              <GitBranch aria-hidden="true" size={19} strokeWidth={1.8} />
            </button>
          );
        })}
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
