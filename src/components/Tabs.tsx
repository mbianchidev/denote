import { FileImage, FileText, Plus, X } from "lucide-react";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { EditorTab } from "../types";

interface TabsProps {
  tabs: EditorTab[];
  activePath: string | null;
  disabled: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (paths: string[]) => void;
  onNewTab: () => void;
}

export function Tabs({
  tabs,
  activePath,
  disabled,
  onActivate,
  onClose,
  onReorder,
  onNewTab,
}: TabsProps) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const pointerDrag = useRef<{ path: string; pointerId: number } | null>(null);

  const clearPointerDrag = () => {
    pointerDrag.current = null;
    setDraggedPath(null);
    setDropTargetPath(null);
  };

  const targetPathAtPointer = (event: PointerEvent): string | null =>
    document
      .elementFromPoint?.(event.clientX, event.clientY)
      ?.closest<HTMLElement>(".tab")
      ?.dataset.tabDropPath ?? null;

  const updatePointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const target = targetPathAtPointer(event);
    setDropTargetPath(target && target !== drag.path ? target : null);
  };

  const finishPointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const target = targetPathAtPointer(event);
    if (target && target !== drag.path) {
      event.preventDefault();
      onReorder(moveTab(tabs, drag.path, target));
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearPointerDrag();
  };

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
    <div
      className="tabs"
      role="tablist"
      aria-label="Open files"
      data-reordering={draggedPath !== null}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.kind === "image" ? FileImage : FileText;
        return (
          <div
            className="tab"
            data-active={tab.path === activePath}
            data-dragging={draggedPath === tab.path}
            data-drop-target={dropTargetPath === tab.path}
            data-tab-drop-path={tab.path}
            key={tab.path}
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
              onPointerDown={(event) => {
                if (event.button === 0 && !disabled) {
                  pointerDrag.current = {
                    path: tab.path,
                    pointerId: event.pointerId,
                  };
                  setDraggedPath(tab.path);
                  setDropTargetPath(null);
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }
              }}
              onPointerMove={updatePointerDrag}
              onPointerUp={finishPointerDrag}
              onPointerCancel={clearPointerDrag}
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
      <button
        type="button"
        className="tab-new"
        aria-label="New tab"
        title={`New tab (${navigator.platform.includes("Mac") ? "⌘T" : "Ctrl+T"})`}
        disabled={disabled}
        onClick={onNewTab}
      >
        <Plus aria-hidden="true" size={14} />
      </button>
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
