import { FileImage, FileText, X } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { EditorTab } from "../types";

interface TabsProps {
  tabs: EditorTab[];
  activePath: string | null;
  disabled: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (paths: string[]) => void;
}

export function Tabs({
  tabs,
  activePath,
  disabled,
  onActivate,
  onClose,
  onReorder,
}: TabsProps) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const moveFocus = (event: KeyboardEvent, index: number) => {
    if (
      event.altKey &&
      event.shiftKey &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const destination = index + (event.key === "ArrowRight" ? 1 : -1);
      if (destination >= 0 && destination < tabs.length) {
        onReorder(moveTab(tabs, tabs[index].path, tabs[destination].path));
      }
      return;
    }
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
            data-dragging={draggedPath === tab.path}
            data-drop-target={dropTargetPath === tab.path}
            draggable={!disabled}
            key={tab.path}
            onDragStart={(event) => {
              if (
                (event.target as HTMLElement).closest(".tab__close")
              ) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/x-denote-tab", tab.path);
              setDraggedPath(tab.path);
            }}
            onDragOver={(event) => {
              if (draggedPath && draggedPath !== tab.path) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetPath(tab.path);
              }
            }}
            onDragLeave={() => {
              if (dropTargetPath === tab.path) {
                setDropTargetPath(null);
              }
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const source =
                draggedPath ||
                event.dataTransfer.getData("text/x-denote-tab");
              if (source && source !== tab.path) {
                onReorder(moveTab(tabs, source, tab.path));
              }
              setDraggedPath(null);
              setDropTargetPath(null);
            }}
            onDragEnd={() => {
              setDraggedPath(null);
              setDropTargetPath(null);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.path === activePath}
              tabIndex={tab.path === activePath ? 0 : -1}
              data-tab-path={tab.path}
              className="tab__activate"
              aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
              title="Drag to reorder. Use Alt+Shift+Left or Right from the keyboard."
              disabled={disabled}
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
              disabled={disabled}
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

export function moveTab(
  tabs: EditorTab[],
  sourcePath: string,
  targetPath: string,
): string[] {
  const paths = tabs.map((tab) => tab.path);
  const sourceIndex = paths.indexOf(sourcePath);
  const targetIndex = paths.indexOf(targetPath);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return paths;
  }
  const [source] = paths.splice(sourceIndex, 1);
  paths.splice(targetIndex, 0, source);
  return paths;
}
