import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { FileNode } from "../types";

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: FileNode) => void;
  onToggleFolder: (path: string) => void;
}

export function FileTree({
  nodes,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
}: FileTreeProps) {
  return (
    <div className="file-tree" role="tree" aria-label="Vault files">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={onSelect}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps extends Omit<FileTreeProps, "nodes"> {
  node: FileNode;
  depth: number;
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleFolder,
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
    <div role="none">
      <button
        type="button"
        role="treeitem"
        aria-selected={selectedPath === node.path}
        aria-expanded={isFolder ? expanded : undefined}
        className="file-tree__row"
        style={style}
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
        {node.bookmarked ? (
          <span className="file-tree__bookmark" aria-label="Bookmarked">
            •
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
            />
          ))
        : null}
    </div>
  );
}
