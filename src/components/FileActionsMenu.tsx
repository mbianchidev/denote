import {
  Bookmark,
  BookmarkCheck,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FolderInput,
  FolderOpen,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { FileNode } from "../types";

const MENU_WIDTH = 224;
const MENU_HEIGHT = 356;

export interface FileActionHandlers {
  onDuplicate: (node: FileNode) => void;
  onBookmark: (node: FileNode) => void;
  onCopyPath: (node: FileNode) => void;
  onOpenHistory: (node: FileNode) => void;
  onOpenInNewTab: (node: FileNode) => void;
  onReveal: (node: FileNode) => void;
  onRename: (node: FileNode) => void;
  onMove: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
}

interface FileActionMenuItemsProps {
  node: FileNode;
  handlers: FileActionHandlers;
  onBeforeAction?: () => void;
}

export function FileActionMenuItems({
  node,
  handlers,
  onBeforeAction,
}: FileActionMenuItemsProps) {
  const run = (action: (node: FileNode) => void) => {
    onBeforeAction?.();
    action(node);
  };

  return (
    <>
      <MenuButton
        icon={<Copy aria-hidden="true" size={15} />}
        label="Duplicate"
        onClick={() => run(handlers.onDuplicate)}
      />
      <MenuButton
        icon={
          node.bookmarked ? (
            <BookmarkCheck aria-hidden="true" size={15} />
          ) : (
            <Bookmark aria-hidden="true" size={15} />
          )
        }
        label={node.bookmarked ? "Remove bookmark" : "Add bookmark"}
        onClick={() => run(handlers.onBookmark)}
      />
      <MenuButton
        icon={<ClipboardCopy aria-hidden="true" size={15} />}
        label="Copy path"
        onClick={() => run(handlers.onCopyPath)}
      />
      <MenuButton
        icon={<History aria-hidden="true" size={15} />}
        label="Open version history"
        onClick={() => run(handlers.onOpenHistory)}
      />
      <MenuButton
        icon={<ExternalLink aria-hidden="true" size={15} />}
        label="Open in new tab"
        onClick={() => run(handlers.onOpenInNewTab)}
      />
      <MenuButton
        icon={<FolderOpen aria-hidden="true" size={15} />}
        label="Reveal in folder"
        onClick={() => run(handlers.onReveal)}
      />
      <div className="file-action-menu__separator" role="separator" />
      <MenuButton
        icon={<Pencil aria-hidden="true" size={15} />}
        label="Rename"
        onClick={() => run(handlers.onRename)}
      />
      <MenuButton
        icon={<FolderInput aria-hidden="true" size={15} />}
        label="Move to folder…"
        onClick={() => run(handlers.onMove)}
      />
      <MenuButton
        className="file-action-menu__danger"
        icon={<Trash2 aria-hidden="true" size={15} />}
        label="Delete"
        onClick={() => run(handlers.onDelete)}
      />
    </>
  );
}

interface FileActionsDropdownProps {
  node: FileNode | null;
  disabled: boolean;
  handlers: FileActionHandlers;
}

export function FileActionsDropdown({
  node,
  disabled,
  handlers,
}: FileActionsDropdownProps) {
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (restoreFocus: boolean) => {
    setMenuPosition(null);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  useEffect(() => {
    setMenuPosition(null);
  }, [node?.path]);

  useEffect(() => {
    if (!menuPosition) {
      return;
    }
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeWithoutFocus = () => close(false);
    window.addEventListener("pointerdown", closeWithoutFocus);
    window.addEventListener("blur", closeWithoutFocus);
    return () => {
      window.removeEventListener("pointerdown", closeWithoutFocus);
      window.removeEventListener("blur", closeWithoutFocus);
    };
  }, [menuPosition]);

  const open = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    setMenuPosition({
      left: Math.max(
        4,
        Math.min(bounds.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 4),
      ),
      top: Math.max(
        4,
        Math.min(bounds.bottom + 4, window.innerHeight - MENU_HEIGHT - 4),
      ),
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label="More file actions"
        aria-haspopup="menu"
        aria-expanded={menuPosition !== null}
        disabled={disabled || !node}
        onClick={() => (menuPosition ? close(false) : open())}
      >
        <MoreHorizontal aria-hidden="true" size={17} />
      </button>
      {menuPosition && node
        ? createPortal(
            <div
              ref={menuRef}
              className="file-action-menu"
              role="menu"
              aria-label={`File actions for ${node.name}`}
              style={menuPosition as CSSProperties}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  close(true);
                } else {
                  moveMenuFocus(event);
                }
              }}
            >
              <FileActionMenuItems
                node={node}
                handlers={handlers}
                onBeforeAction={() => close(true)}
              />
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
  className,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  ];
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
