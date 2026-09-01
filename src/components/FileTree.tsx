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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";
import type { FileNode, ProjectRoot, ProjectWorkspace } from "../types";
import {
  projectRootAtPath,
  projectWorkspaceAtPath,
  visibleWorkspaceRows,
} from "../lib/workspaceTree";
import {
  FileActionMenuItems,
  type FileActionHandlers,
} from "./FileActionsMenu";

const CONTEXT_MENU_WIDTH = 184;
const CONTEXT_MENU_COMPACT_HEIGHT = 174;
const CONTEXT_MENU_ENTRY_HEIGHT = 584;
const FILE_TREE_ROW_HEIGHT = 29;
const FILE_TREE_TOP_PADDING = 6;
const FILE_TREE_OVERSCAN = 6;
const FILE_TREE_FULL_RENDER_THRESHOLD = 32;
const FILE_TREE_FALLBACK_VIEWPORT_HEIGHT = FILE_TREE_ROW_HEIGHT * 12;

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
  projectWorkspaces?: ProjectWorkspace[];
  onMarkProject?: (path: string) => void;
  onUnmarkProject?: (projectRoot: ProjectRoot) => void;
  onMarkWorkspace?: (path: string) => void;
  onUnmarkWorkspace?: (projectWorkspace: ProjectWorkspace) => void;
  showDotfiles?: boolean;
  ignoredPaths?: ReadonlySet<string>;
}

const EMPTY_IGNORED_PATHS = new Set<string>();

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
  projectWorkspaces = [],
  onMarkProject,
  onUnmarkProject,
  onMarkWorkspace,
  onUnmarkWorkspace,
  showDotfiles = true,
  ignoredPaths = EMPTY_IGNORED_PATHS,
}: FileTreeProps) {
  const navRef = useRef<HTMLElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const pendingScrollTop = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
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
  const rowElements = useRef(new Map<string, HTMLButtonElement>());
  const [focusedRowPath, setFocusedRowPath] = useState<string | null>(null);
  const [pendingFocusPath, setPendingFocusPath] = useState<string | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const rows = useMemo(
    () => visibleWorkspaceRows(nodes, expandedPaths, showDotfiles),
    [expandedPaths, nodes, showDotfiles],
  );
  const rowIndexByPath = useMemo(
    () => new Map(rows.map(({ node }, index) => [node.path, index])),
    [rows],
  );
  const virtualized = rows.length > FILE_TREE_FULL_RENDER_THRESHOLD;
  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : FILE_TREE_FALLBACK_VIEWPORT_HEIGHT;
  const maximumScrollTop = Math.max(
    0,
    FILE_TREE_TOP_PADDING +
      rows.length * FILE_TREE_ROW_HEIGHT -
      effectiveViewportHeight,
  );
  const effectiveScrollTop = Math.min(scrollTop, maximumScrollTop);
  const firstVisibleIndex = virtualized
    ? Math.floor(
        Math.max(0, effectiveScrollTop - FILE_TREE_TOP_PADDING) /
          FILE_TREE_ROW_HEIGHT,
      )
    : 0;
  const startIndex = virtualized
    ? Math.max(0, firstVisibleIndex - FILE_TREE_OVERSCAN)
    : 0;
  const endIndex = virtualized
    ? Math.min(
        rows.length,
        Math.ceil(
          Math.max(
            0,
            effectiveScrollTop -
              FILE_TREE_TOP_PADDING +
              effectiveViewportHeight,
          ) / FILE_TREE_ROW_HEIGHT,
        ) + FILE_TREE_OVERSCAN,
      )
    : rows.length;
  const renderedRowIndices = useMemo(() => {
    if (!virtualized) {
      return rows.map((_, index) => index);
    }
    const indices = new Set<number>();
    for (let index = startIndex; index < endIndex; index += 1) {
      indices.add(index);
    }
    const retainedPaths = new Set(
      [
        focusedRowPath,
        pendingFocusPath,
        draggedPath,
        contextMenu?.node?.path ?? null,
      ].filter((path): path is string => path !== null),
    );
    for (const path of retainedPaths) {
      const index = rowIndexByPath.get(path);
      if (index !== undefined) {
        indices.add(index);
      }
    }
    return [...indices].sort((left, right) => left - right);
  }, [
    contextMenu?.node?.path,
    draggedPath,
    endIndex,
    focusedRowPath,
    pendingFocusPath,
    rowIndexByPath,
    rows,
    startIndex,
    virtualized,
  ]);
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
  const contextExplicitProjectRoot =
    contextProjectRoot?.explicit === true ? contextProjectRoot : null;
  const contextProjectWorkspace =
    contextProjectPath === null
      ? null
      : projectWorkspaceAtPath(projectWorkspaces, contextProjectPath);
  const contextMenuNode = contextMenu?.node ?? null;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const measure = (height = nav.clientHeight) => {
      if (height > 0) {
        setViewportHeight(height);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !virtualized || selectedPath === null) {
      return;
    }
    const selectedIndex = rowIndexByPath.get(selectedPath);
    if (selectedIndex === undefined) {
      return;
    }
    const rowTop = FILE_TREE_TOP_PADDING + selectedIndex * FILE_TREE_ROW_HEIGHT;
    const rowBottom = rowTop + FILE_TREE_ROW_HEIGHT;
    let nextScrollTop = nav.scrollTop;
    if (rowTop < nav.scrollTop) {
      nextScrollTop = rowTop;
    } else if (rowBottom > nav.scrollTop + effectiveViewportHeight) {
      nextScrollTop = rowBottom - effectiveViewportHeight;
    }
    if (nextScrollTop !== nav.scrollTop) {
      nav.scrollTop = nextScrollTop;
      pendingScrollTop.current = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [
    effectiveViewportHeight,
    rowIndexByPath,
    selectedPath,
    virtualized,
  ]);

  useLayoutEffect(() => {
    if (pendingFocusPath === null) {
      return;
    }
    if (!rowIndexByPath.has(pendingFocusPath)) {
      setPendingFocusPath(null);
      return;
    }
    const row = rowElements.current.get(pendingFocusPath);
    if (!row) {
      return;
    }
    row.focus({ preventScroll: true });
    setPendingFocusPath(null);
  }, [pendingFocusPath, renderedRowIndices, rowIndexByPath]);

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

  const focusRowAtIndex = (rowIndex: number) => {
    const row = rows[rowIndex];
    const nav = navRef.current;
    if (!row || !nav) {
      return;
    }
    const rowTop = FILE_TREE_TOP_PADDING + rowIndex * FILE_TREE_ROW_HEIGHT;
    const rowBottom = rowTop + FILE_TREE_ROW_HEIGHT;
    let nextScrollTop = nav.scrollTop;
    if (virtualized) {
      if (rowTop < nav.scrollTop) {
        nextScrollTop = rowTop;
      } else if (rowBottom > nav.scrollTop + effectiveViewportHeight) {
        nextScrollTop = rowBottom - effectiveViewportHeight;
      }
      nextScrollTop = Math.max(0, Math.min(nextScrollTop, maximumScrollTop));
      if (nextScrollTop !== nav.scrollTop) {
        nav.scrollTop = nextScrollTop;
        pendingScrollTop.current = nextScrollTop;
        setScrollTop(nextScrollTop);
      }
    }
    setPendingFocusPath(row.node.path);
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    node: FileNode,
    rowIndex: number,
  ) => {
    openKeyboardContextMenu(event, node);
    if (event.defaultPrevented) {
      return;
    }
    const targetIndex =
      event.key === "ArrowDown"
        ? rowIndex + 1
        : event.key === "ArrowUp"
          ? rowIndex - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : event.key === "Tab" &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey
                ? rowIndex + (event.shiftKey ? -1 : 1)
                : -1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }
    const targetPath = rows[targetIndex].node.path;
    const mustMountTabTarget =
      event.key === "Tab" && !rowElements.current.has(targetPath);
    if (event.key !== "Tab" || mustMountTabTarget) {
      event.preventDefault();
      focusRowAtIndex(targetIndex);
    }
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

  const renderedTreeRows: ReactNode[] = [];
  let previousRowIndex = -1;
  for (const rowIndex of renderedRowIndices) {
    const gapSize = rowIndex - previousRowIndex - 1;
    if (virtualized && gapSize > 0) {
      renderedTreeRows.push(
        <div
          key={`spacer-${previousRowIndex + 1}`}
          aria-hidden="true"
          className="file-tree__spacer"
          style={{ height: gapSize * FILE_TREE_ROW_HEIGHT }}
        />,
      );
    }
    const { node, depth } = rows[rowIndex];
    renderedTreeRows.push(
      <FileTreeRow
        key={node.path}
        node={node}
        depth={depth}
        selectedPath={selectedPath}
        expandedPaths={expandedPaths}
        onSelect={onSelect}
        onToggleFolder={onToggleFolder}
        onContextMenu={openContextMenu}
        onKeyDown={(event) => handleRowKeyDown(event, node, rowIndex)}
        rowIndex={rowIndex}
        rowRef={(element) => {
          if (element) {
            rowElements.current.set(node.path, element);
          } else {
            rowElements.current.delete(node.path);
          }
        }}
        onFocus={() => setFocusedRowPath(node.path)}
        onBlur={() =>
          setFocusedRowPath((current) =>
            current === node.path ? null : current,
          )
        }
        draggedPath={draggedPath}
        dropTargetPath={dropTargetPath}
        onPointerDown={startPointerDrag}
        onPointerMove={updatePointerDrag}
        onPointerUp={finishPointerDrag}
        onPointerCancel={clearPointerDrag}
        suppressClickPath={suppressClickPath}
        ignoredPaths={ignoredPaths}
      />,
    );
    previousRowIndex = rowIndex;
  }
  const trailingGapSize = rows.length - previousRowIndex - 1;
  if (virtualized && trailingGapSize > 0) {
    renderedTreeRows.push(
      <div
        key={`spacer-${previousRowIndex + 1}`}
        aria-hidden="true"
        className="file-tree__spacer"
        style={{ height: trailingGapSize * FILE_TREE_ROW_HEIGHT }}
      />,
    );
  }

  return (
    <>
      <nav
        ref={navRef}
        className="file-tree"
        aria-label="Vault files"
        data-drop-target={dropTargetPath === ""}
        tabIndex={rows.length === 0 ? 0 : -1}
        onKeyDown={(event) => openKeyboardContextMenu(event, null)}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            openContextMenu(event, null);
          }
        }}
        onScroll={(event) => {
          pendingScrollTop.current = event.currentTarget.scrollTop;
          if (scrollFrame.current !== null) {
            return;
          }
          scrollFrame.current = requestAnimationFrame(() => {
            scrollFrame.current = null;
            setScrollTop(pendingScrollTop.current);
          });
        }}
      >
        {renderedTreeRows}
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
                      if (contextExplicitProjectRoot) {
                        onUnmarkProject(contextExplicitProjectRoot);
                      } else {
                        onMarkProject(contextProjectPath);
                      }
                    }}
                  >
                    {contextExplicitProjectRoot ? (
                      <FolderX aria-hidden="true" size={15} />
                    ) : (
                      <FolderCheck aria-hidden="true" size={15} />
                    )}
                    {contextExplicitProjectRoot
                      ? "Unmark project"
                      : "Mark as project"}
                  </button>
                </>
              ) : null}
              {contextProjectPath !== null &&
              onMarkWorkspace &&
              onUnmarkWorkspace ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeContextMenu(true);
                    if (contextProjectWorkspace) {
                      onUnmarkWorkspace(contextProjectWorkspace);
                    } else {
                      onMarkWorkspace(contextProjectPath);
                    }
                  }}
                >
                  {contextProjectWorkspace ? (
                    <FolderX aria-hidden="true" size={15} />
                  ) : (
                    <FolderCheck aria-hidden="true" size={15} />
                  )}
                  {contextProjectWorkspace
                    ? "Unmark workspace"
                    : "Mark as workspace"}
                </button>
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
                     {contextMenuNode?.kind === "folder" ? (
                       <button
                         type="button"
                         role="menuitem"
                         onClick={() => {
                           closeContextMenu(true);
                           onToggleFolder(contextMenuNode.path);
                         }}
                       >
                         {expandedPaths.has(contextMenuNode.path) ? (
                           <ChevronDown aria-hidden="true" size={15} />
                         ) : (
                           <ChevronRight aria-hidden="true" size={15} />
                         )}
                         {expandedPaths.has(contextMenuNode.path)
                           ? "Collapse folder"
                           : "Expand folder"}
                       </button>
                     ) : null}
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

interface FileTreeRowProps
  extends Omit<
    FileTreeProps,
    "nodes" | "onCreate" | "onRename" | "onDelete" | "onMove" | "onRequestMove"
  > {
  node: FileNode;
  depth: number;
  onContextMenu: (event: MouseEvent, node: FileNode) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  rowIndex: number;
  rowRef: RefCallback<HTMLButtonElement>;
  onFocus: () => void;
  onBlur: () => void;
  draggedPath: string | null;
  dropTargetPath: string | null;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, node: FileNode) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  suppressClickPath: MutableRefObject<string | null>;
}

function FileTreeRow({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
  onContextMenu,
  onKeyDown,
  rowIndex,
  rowRef,
  onFocus,
  onBlur,
  draggedPath,
  dropTargetPath,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  suppressClickPath,
  ignoredPaths,
}: FileTreeRowProps) {
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
  const ignored = ignoredPaths?.has(node.path) ?? false;

  return (
    <button
      ref={rowRef}
      type="button"
      data-tree-row-index={rowIndex}
      data-tree-row-path={node.path}
      data-selected={selectedPath === node.path}
      data-dragging={draggedPath === node.path}
      data-drop-target={isFolder && dropTargetPath === node.path}
      data-ignored={ignored ? "true" : undefined}
      data-folder-drop-path={isFolder ? node.path : undefined}
      aria-current={selectedPath === node.path ? "true" : undefined}
      aria-expanded={isFolder ? expanded : undefined}
      className="file-tree__row"
      style={style}
      onContextMenu={(event) => onContextMenu(event, node)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
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
      {ignored ? (
        <span className="sr-only">, Ignored by .gitignore</span>
      ) : null}
      {node.pinned || node.bookmarked ? (
        <span className="file-tree__markers">
          {node.pinned ? (
            <span className="file-tree__pin">
              <Pin aria-hidden="true" size={11} />
              <span className="sr-only">, Pinned</span>
            </span>
          ) : null}
          {node.bookmarked ? (
            <span className="file-tree__bookmark">
              <span aria-hidden="true">•</span>
              <span className="sr-only">, Bookmarked</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
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
