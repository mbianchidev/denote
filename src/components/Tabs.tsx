import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileText,
  FolderPlus,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { tabsInVisualOrder } from "../lib/tabs";
import type { EditorTab, TabGroup } from "../types";

interface TabsProps {
  tabs: EditorTab[];
  groups: TabGroup[];
  activePath: string | null;
  disabled: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseMany: (paths: string[]) => void;
  onReorder: (sourcePath: string, targetPath: string) => void;
  onNewTab: () => void;
  onToggleGroup: (groupId: string) => void;
  onCreateGroup: (path: string) => void;
  onRenameGroup: (groupId: string) => void;
  onMoveToGroup: (path: string, groupId: string | null) => void;
}

export function Tabs({
  tabs,
  groups,
  activePath,
  disabled,
  onActivate,
  onClose,
  onCloseMany,
  onReorder,
  onNewTab,
  onToggleGroup,
  onCreateGroup,
  onRenameGroup,
  onMoveToGroup,
}: TabsProps) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tab: EditorTab;
    x: number;
    y: number;
  } | null>(null);
  const pointerDrag = useRef<{ path: string; pointerId: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpener = useRef<HTMLElement | null>(null);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const visualTabs = tabsInVisualOrder(tabs);
  const visibleTabs = visualTabs.filter((tab) => {
    const group = tab.groupId ? groupById.get(tab.groupId) : null;
    return !group || !group.collapsed || tab.path === activePath;
  });

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = () => closeContextMenu(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const closeContextMenu = (restoreFocus: boolean) => {
    setContextMenu(null);
    const opener = menuOpener.current;
    menuOpener.current = null;
    if (restoreFocus) {
      opener?.focus();
    }
  };

  const openContextMenu = (
    event: MouseEvent | KeyboardEvent,
    tab: EditorTab,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const opener = event.currentTarget as HTMLElement;
    const bounds = opener.getBoundingClientRect();
    const pointer = "clientX" in event;
    menuOpener.current = opener;
    setContextMenu({
      tab,
      x: Math.max(
        4,
        Math.min(pointer ? event.clientX : bounds.left + 18, window.innerWidth - 224),
      ),
      y: Math.max(
        4,
        Math.min(pointer ? event.clientY : bounds.bottom, window.innerHeight - 320),
      ),
    });
  };

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
      onReorder(drag.path, target);
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
      if (destination >= 0 && destination < visibleTabs.length) {
        onReorder(visibleTabs[index].path, visibleTabs[destination].path);
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
          ? visibleTabs.length - 1
          : (index +
              (event.key === "ArrowRight" ? 1 : -1) +
              visibleTabs.length) %
            visibleTabs.length;
    const path = visibleTabs[nextIndex]?.path;
    if (path) {
      onActivate(path);
      document
        .querySelector<HTMLButtonElement>(`[data-tab-path="${CSS.escape(path)}"]`)
        ?.focus();
    }
  };

  const renderTab = (tab: EditorTab) => {
    const index = visibleTabs.findIndex(
      (candidate) => candidate.path === tab.path,
    );
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
          onContextMenu={(event) => openContextMenu(event, tab)}
          onKeyDown={(event) => {
            if (
              (event.shiftKey && event.key === "F10") ||
              event.key === "ContextMenu"
            ) {
              openContextMenu(event, tab);
            } else {
              moveFocus(event, index);
            }
          }}
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
  };

  const renderedGroups = new Set<string>();
  const renderedTabs = visualTabs.flatMap((tab) => {
    if (!tab.groupId) {
      return [renderTab(tab)];
    }
    const group = groupById.get(tab.groupId);
    if (!group) {
      return [renderTab(tab)];
    }
    if (renderedGroups.has(tab.groupId)) {
      return [];
    }
    renderedGroups.add(tab.groupId);
    const members = visualTabs.filter(
      (candidate) => candidate.groupId === group.id,
    );
    const active = members.some((member) => member.path === activePath);
    const renderedMembers = group.collapsed
      ? members.filter((member) => member.path === activePath)
      : members;
    return [
      <div
        className="tab-group"
        data-active={active}
        data-collapsed={group.collapsed}
        key={`group:${group.id}`}
      >
        <button
          type="button"
          className="tab-group__toggle"
          aria-expanded={!group.collapsed}
          aria-label={`${group.collapsed ? "Expand" : "Collapse"} tab group ${group.name}`}
          disabled={disabled}
          onClick={() => onToggleGroup(group.id)}
        >
          {group.collapsed ? (
            <ChevronRight aria-hidden="true" size={13} />
          ) : (
            <ChevronDown aria-hidden="true" size={13} />
          )}
          <span>{group.name}</span>
          <small>{members.length}</small>
        </button>
        {renderedMembers.length > 0 ? (
         <div className="tab-group__tabs">
           {renderedMembers.map(renderTab)}
         </div>
        ) : null}
      </div>,
    ];
  });

  const menuTab = contextMenu?.tab ?? null;
  const menuIndex = menuTab
    ? visualTabs.findIndex((tab) => tab.path === menuTab.path)
    : -1;
  const leftPaths =
    menuIndex > 0
      ? visualTabs.slice(0, menuIndex).map(({ path }) => path)
      : [];
  const rightPaths =
    menuIndex >= 0
      ? visualTabs.slice(menuIndex + 1).map(({ path }) => path)
      : [];
  const otherPaths = menuTab
    ? visualTabs
        .filter((tab) => tab.path !== menuTab.path)
        .map(({ path }) => path)
    : [];
  const runMenuAction = (action: () => void) => {
    closeContextMenu(true);
    action();
  };

  return (
    <>
      <div
        className="tabs"
        role="tablist"
        aria-label="Open files"
        data-reordering={draggedPath !== null}
      >
        {renderedTabs}
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
      {contextMenu && menuTab
        ? createPortal(
            <div
              ref={menuRef}
              className="tab-context-menu"
              role="menu"
              aria-label={`Tab actions for ${menuTab.title}`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  closeContextMenu(true);
                } else {
                  moveMenuFocus(event);
                }
              }}
            >
              <MenuButton
                label="Close all"
                disabled={tabs.length === 0}
                onClick={() =>
                  runMenuAction(() =>
                    onCloseMany(tabs.map(({ path }) => path)),
                  )
                }
              />
              <MenuButton
                label="Close others"
                disabled={otherPaths.length === 0}
                onClick={() => runMenuAction(() => onCloseMany(otherPaths))}
              />
              <MenuButton
                label="Close all to the left"
                disabled={leftPaths.length === 0}
                onClick={() => runMenuAction(() => onCloseMany(leftPaths))}
              />
              <MenuButton
                label="Close all to the right"
                disabled={rightPaths.length === 0}
                onClick={() => runMenuAction(() => onCloseMany(rightPaths))}
              />
              <div className="tab-context-menu__separator" role="separator" />
              {menuTab.groupId ? (
                <>
                  <MenuButton
                    icon={<Pencil aria-hidden="true" size={14} />}
                    label="Rename group…"
                    onClick={() =>
                      runMenuAction(() =>
                        onRenameGroup(menuTab.groupId as string),
                      )
                    }
                  />
                  <MenuButton
                    label="Remove from group"
                    onClick={() =>
                      runMenuAction(() =>
                        onMoveToGroup(menuTab.path, null),
                      )
                    }
                  />
                </>
              ) : (
                <MenuButton
                  icon={<FolderPlus aria-hidden="true" size={14} />}
                  label="Create group…"
                  onClick={() =>
                    runMenuAction(() => onCreateGroup(menuTab.path))
                  }
                />
              )}
              {groups
                .filter((group) => group.id !== menuTab.groupId)
                .map((group) => (
                  <MenuButton
                    key={group.id}
                    label={`Move to ${group.name}`}
                    onClick={() =>
                      runMenuAction(() =>
                        onMoveToGroup(menuTab.path, group.id),
                      )
                    }
                  />
                ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuButton({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
    '[role="menuitem"]:not(:disabled)',
  )];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "ArrowDown"
      ? (current + 1) % items.length
      : event.key === "ArrowUp"
        ? (current - 1 + items.length) % items.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : -1;
  if (next >= 0) {
    event.preventDefault();
    items[next]?.focus();
  }
}
