import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  Pin,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { FileNode } from "../types";

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: FileNode) => void;
  onToggleFolder: (path: string) => void;
  onCreate: (parentPath: string, directory: boolean) => void;
}

export function FileTree({
  nodes,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
  onCreate,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    parentPath: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const contextOpener = useRef<HTMLElement | null>(null);

  const closeContextMenu = (restoreFocus: boolean) => {
    setContextMenu(null);
    const opener = contextOpener.current;
    contextOpener.current = null;
    if (restoreFocus) {
      window.setTimeout(() => opener?.focus(), 0);
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
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 184),
      y: Math.min(event.clientY, window.innerHeight - 92),
      parentPath: creationParent(node),
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
    contextOpener.current = opener;
    setContextMenu({
      x: Math.min(bounds.left + 18, window.innerWidth - 184),
      y: Math.min(bounds.top + 18, window.innerHeight - 92),
      parentPath: creationParent(node),
    });
  };

  return (
    <>
      <nav
        className="file-tree"
        aria-label="Vault files"
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
          />
        ))}
      </nav>
      {contextMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="file-tree-context-menu"
              role="menu"
              aria-label="File creation"
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
                  onCreate(contextMenu.parentPath, false);
                  closeContextMenu(false);
                }}
              >
                <FilePlus2 aria-hidden="true" size={15} />
                New file
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCreate(contextMenu.parentPath, true);
                  closeContextMenu(false);
                }}
              >
                <FolderPlus aria-hidden="true" size={15} />
                New folder
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface FileTreeNodeProps extends Omit<FileTreeProps, "nodes" | "onCreate"> {
  node: FileNode;
  depth: number;
  onContextMenu: (event: MouseEvent, node: FileNode) => void;
  onKeyboardContextMenu: (
    event: KeyboardEvent<HTMLElement>,
    node: FileNode,
  ) => void;
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
        aria-current={selectedPath === node.path ? "true" : undefined}
        aria-expanded={isFolder ? expanded : undefined}
        className="file-tree__row"
        style={style}
        onContextMenu={(event) => onContextMenu(event, node)}
        onKeyDown={(event) => onKeyboardContextMenu(event, node)}
        onClick={() => {
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
