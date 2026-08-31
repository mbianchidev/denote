import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderCheck,
  FolderInput,
  FolderPlus,
  FolderOpen,
  FolderX,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { FileNode, ProjectRoot } from "../types";
import { projectRootAtPath } from "../lib/workspaceTree";
import {
  FileActionMenuItems,
  type FileActionHandlers,
} from "./FileActionsMenu";

const CONTEXT_MENU_WIDTH = 184;
const CONTEXT_MENU_COMPACT_HEIGHT = 132;
const CONTEXT_MENU_ENTRY_HEIGHT = 542;

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: FileNode) => void;
  onToggleFolder: (path: string) => void;
  onCreate: (parentPath: string, directory: boolean) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onMove: (node: FileNode, targetParentPath: string) => void;
  onRequestMove: (node: FileNode) => void;
  fileActions?: FileActionHandlers;
  projectRoots?: ProjectRoot[];
  onMarkProject?: (path: string) => void;
  onUnmarkProject?: (projectRoot: ProjectRoot) => void;
}

export function FileTree({
  nodes,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onRequestMove,
  fileActions,
  projectRoots = [],
  onMarkProject,
  onUnmarkProject,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    parentPath: string;
    node: FileNode | null;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const contextOpener = useRef<HTMLElement | null>(null);
  const pointerDrag = useRef<{
    node: FileNode;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const suppressClickPath = useRef<string | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const contextProjectPath =
    contextMenu?.node?.kind === "folder"
      ? contextMenu.node.path
      : contextMenu?.node === null
        ? ""
        : null;
  const contextProjectRoot =
    contextProjectPath === null
      ? null
      : projectRootAtPath(projectRoots, contextProjectPath);

  const closeContextMenu = (restoreFocus: boolean) => {
    setContextMenu(null);
    const opener = contextOpener.current;
    contextOpener.current = null;
    if (restoreFocus) {
      opener?.focus();
    }
  };

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

  const openContextMenu = (
    event: MouseEvent,
    node: FileNode | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    contextOpener.current = event.currentTarget as HTMLElement;
    const menuHeight = node
      ? CONTEXT_MENU_ENTRY_HEIGHT
      : CONTEXT_MENU_COMPACT_HEIGHT;
    setContextMenu({
      x: Math.max(
        4,
        Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH),
      ),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuHeight)),
      parentPath: creationParent(node),
      node,
    });
  };

  const openKeyboardContextMenu = (
    event: KeyboardEvent<HTMLElement>,
    node: FileNode | null,
  ) => {
    if (
      !(
        (event.shiftKey && event.key === "F10") ||
        event.key === "ContextMenu"
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const opener = event.currentTarget;
    const bounds = opener.getBoundingClientRect();
    const menuHeight = node
      ? CONTEXT_MENU_ENTRY_HEIGHT
      : CONTEXT_MENU_COMPACT_HEIGHT;
    contextOpener.current = opener;
    setContextMenu({
      x: Math.max(
        4,
        Math.min(bounds.left + 18, window.innerWidth - CONTEXT_MENU_WIDTH),
      ),
      y: Math.max(
        4,
        Math.min(bounds.top + 18, window.innerHeight - menuHeight),
      ),
      parentPath: creationParent(node),
      node,
    });
  };

  const clearPointerDrag = () => {
    pointerDrag.current = null;
    setDraggedPath(null);
    setDropTargetPath(null);
  };

  const targetParentAtPointer = (event: PointerEvent): string | null => {
    const element = document.elementFromPoint?.(event.clientX, event.clientY);
    const folder = element?.closest<HTMLElement>("[data-folder-drop-path]");
    if (folder?.dataset.folderDropPath !== undefined) {
      return folder.dataset.folderDropPath;
    }
    if (element?.closest(".file-tree__row")) {
      return null;
    }
    return element?.closest(".file-tree") ? "" : null;
  };

  const startPointerDrag = (
    event: PointerEvent<HTMLButtonElement>,
    node: FileNode,
  ) => {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    pointerDrag.current = {
      node,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updatePointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (
      !drag.dragging &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
    ) {
      return;
    }
    event.preventDefault();
    drag.dragging = true;
    setDraggedPath(drag.node.path);
    const target = targetParentAtPointer(event);
    setDropTargetPath(
      target !== null && canMoveNode(drag.node, target) ? target : null,
    );
  };

  const finishPointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const target = targetParentAtPointer(event);
    if (drag.dragging) {
      suppressClickPath.current = drag.node.path;
      window.setTimeout(() => {
        if (suppressClickPath.current === drag.node.path) {
          suppressClickPath.current = null;
        }
      }, 0);
      if (target !== null && canMoveNode(drag.node, target)) {
        event.preventDefault();
        onMove(drag.node, target);
      }
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearPointerDrag();
  };

  return (
    <>
      <nav
        className="file-tree"
        aria-label="Vault files"
        data-drop-target={dropTargetPath === ""}
        tabIndex={nodes.length === 0 ? 0 : -1}
        onKeyDown={(event) => openKeyboardContextMenu(event, null)}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            openContextMenu(event, null);
          }
        }}
      >
        {nodes.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelect={onSelect}
            onToggleFolder={onToggleFolder}
            onContextMenu={openContextMenu}
            onKeyboardContextMenu={openKeyboardContextMenu}
            draggedPath={draggedPath}
            dropTargetPath={dropTargetPath}
            onPointerDown={startPointerDrag}
            onPointerMove={updatePointerDrag}
            onPointerUp={finishPointerDrag}
            onPointerCancel={clearPointerDrag}
            suppressClickPath={suppressClickPath}
          />
        ))}
      </nav>
      {contextMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="file-tree-context-menu"
              role="menu"
              aria-label="File actions"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeContextMenu(true);
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  closeContextMenu(true);
                } else {
                  moveMenuFocus(event);
                }
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeContextMenu(true);
                  onCreate(contextMenu.parentPath, false);
                }}
              >
                <FilePlus2 aria-hidden="true" size={15} />
                New file
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeContextMenu(true);
                  onCreate(contextMenu.parentPath, true);
                }}
              >
                <FolderPlus aria-hidden="true" size={15} />
                New folder
              </button>
              {contextProjectPath !== null &&
              onMarkProject &&
              onUnmarkProject ? (
                <>
                  <div className="file-tree-context-menu__separator" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeContextMenu(true);
                      if (contextProjectRoot) {
                        onUnmarkProject(contextProjectRoot);
                      } else {
                        onMarkProject(contextProjectPath);
                      }
                    }}
                  >
                    {contextProjectRoot ? (
                      <FolderX aria-hidden="true" size={15} />
                    ) : (
                      <FolderCheck aria-hidden="true" size={15} />
                    )}
                    {contextProjectRoot ? "Unmark project" : "Mark as project"}
                  </button>
                </>
              ) : null}
              {contextMenu.node ? (
                <>
                  <div className="file-tree-context-menu__separator" role="separator" />
                  {contextMenu.node.kind !== "folder" && fileActions ? (
                   <FileActionMenuItems
                     node={contextMenu.node}
                     handlers={fileActions}
                     onBeforeAction={() => closeContextMenu(true)}
                   />
                  ) : (
                   <>
                     <button
                       type="button"
                       role="menuitem"
                       onClick={() => {
                         closeContextMenu(true);
                         onRename(contextMenu.node as FileNode);
                       }}
                     >
                       <Pencil aria-hidden="true" size={15} />
                       Rename
                     </button>
                     <button
                       type="button"
                       role="menuitem"
                       onClick={() => {
                         closeContextMenu(true);
                         onRequestMove(contextMenu.node as FileNode);
                       }}
                     >
                       <FolderInput aria-hidden="true" size={15} />
                       Move to folder…
                     </button>
                     <button
                       type="button"
                       role="menuitem"
                       className="file-tree-context-menu__danger"
                       onClick={() => {
                         closeContextMenu(true);
                         onDelete(contextMenu.node as FileNode);
                       }}
                     >
                       <Trash2 aria-hidden="true" size={15} />
                       Delete
                     </button>
                   </>
                  )}
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface FileTreeNodeProps
  extends Omit<
    FileTreeProps,
    "nodes" | "onCreate" | "onRename" | "onDelete" | "onMove" | "onRequestMove"
  > {
  node: FileNode;
  depth: number;
  onContextMenu: (event: MouseEvent, node: FileNode) => void;
  onKeyboardContextMenu: (
    event: KeyboardEvent<HTMLElement>,
    node: FileNode,
  ) => void;
  draggedPath: string | null;
  dropTargetPath: string | null;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, node: FileNode) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  suppressClickPath: MutableRefObject<string | null>;
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
  onContextMenu,
  onKeyboardContextMenu,
  draggedPath,
  dropTargetPath,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  suppressClickPath,
}: FileTreeNodeProps) {
  const isFolder = node.kind === "folder";
  const expanded = isFolder && expandedPaths.has(node.path);
  const Icon = isFolder
    ? expanded
      ? FolderOpen
      : Folder
    : node.kind === "image"
      ? FileImage
      : FileText;
  const style = { "--tree-depth": depth } as CSSProperties;

  return (
    <div>
      <button
        type="button"
        data-selected={selectedPath === node.path}
        data-dragging={draggedPath === node.path}
        data-drop-target={isFolder && dropTargetPath === node.path}
        data-folder-drop-path={isFolder ? node.path : undefined}
        aria-current={selectedPath === node.path ? "true" : undefined}
        aria-expanded={isFolder ? expanded : undefined}
        className="file-tree__row"
        style={style}
        onContextMenu={(event) => onContextMenu(event, node)}
        onKeyDown={(event) => onKeyboardContextMenu(event, node)}
        onPointerDown={(event) => onPointerDown(event, node)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          if (suppressClickPath.current === node.path) {
            suppressClickPath.current = null;
            return;
          }
          onSelect(node);
          if (isFolder) {
            onToggleFolder(node.path);
          }
        }}
      >
        <span className="file-tree__chevron" aria-hidden="true">
          {isFolder ? (
            expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </span>
        <Icon
          className={`file-tree__icon file-tree__icon--${node.kind}`}
          aria-hidden="true"
          size={16}
          strokeWidth={1.8}
        />
        <span className="file-tree__name">{node.name}</span>
        {node.pinned || node.bookmarked ? (
          <span className="file-tree__markers">
            {node.pinned ? (
              <span className="file-tree__pin" aria-label="Pinned">
                <Pin aria-hidden="true" size={11} />
              </span>
            ) : null}
            {node.bookmarked ? (
              <span className="file-tree__bookmark" aria-label="Bookmarked">
                •
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {expanded
        ? node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggleFolder={onToggleFolder}
              onContextMenu={onContextMenu}
              onKeyboardContextMenu={onKeyboardContextMenu}
              draggedPath={draggedPath}
              dropTargetPath={dropTargetPath}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              suppressClickPath={suppressClickPath}
            />
          ))
        : null}
    </div>
  );
}

function creationParent(node: FileNode | null): string {
  if (!node) {
    return "";
  }
  return node.kind === "folder"
    ? node.path
    : node.path.split("/").slice(0, -1).join("/");
}

function canMoveNode(node: FileNode, targetParentPath: string): boolean {
  const currentParent = node.path.split("/").slice(0, -1).join("/");
  if (targetParentPath === currentParent) {
    return false;
  }
  return !(
    node.kind === "folder" &&
    (targetParentPath === node.path ||
      targetParentPath.startsWith(`${node.path}/`))
  );
}

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
    '[role="menuitem"]',
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
