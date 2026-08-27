import { FileImage, FileText, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { EditorTab } from "../types";

interface TabsProps {
  tabs: EditorTab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

export function Tabs({
  tabs,
  activePath,
  onActivate,
  onClose,
}: TabsProps) {
  const moveFocus = (event: KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    const path = tabs[nextIndex]?.path;
    if (path) {
      onActivate(path);
      document
        .querySelector<HTMLButtonElement>(`[data-tab-path="${CSS.escape(path)}"]`)
        ?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {tabs.map((tab, index) => {
        const Icon = tab.kind === "image" ? FileImage : FileText;
        return (
          <div
            className="tab"
            data-active={tab.path === activePath}
            key={tab.path}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.path === activePath}
              tabIndex={tab.path === activePath ? 0 : -1}
              data-tab-path={tab.path}
              className="tab__activate"
              onClick={() => onActivate(tab.path)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>{tab.title}</span>
              {tab.saveState === "dirty" || tab.saveState === "saving" ? (
                <span className="tab__dirty" aria-label="Unsaved changes">
                  •
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="tab__close"
              aria-label={`Close ${tab.title}`}
              onClick={() => onClose(tab.path)}
            >
              <X aria-hidden="true" size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
