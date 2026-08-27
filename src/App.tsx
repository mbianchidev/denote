import type { MDXEditorMethods } from "@mdxeditor/editor";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  History,
  ListTree,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityRail } from "./components/ActivityRail";
import { FileTree } from "./components/FileTree";
import { HistoryDialog } from "./components/HistoryDialog";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { SearchPanel } from "./components/SearchPanel";
import { TableOfContents } from "./components/TableOfContents";
import { Tabs } from "./components/Tabs";
import { Welcome } from "./components/Welcome";
import { api, errorMessage } from "./lib/api";
import {
  calloutsToDirectives,
  extractHeadings,
  extractTags,
  resolveInternalLink,
  slugifyHeading,
} from "./lib/markdown";
import { VaultSearchIndex } from "./lib/search";
import { applyTheme, getTheme, type Theme } from "./lib/theme";
import type {
  EditorTab,
  FileNode,
  HeadingItem,
  HistoryRevision,
  SearchResult,
  SidebarView,
  WorkspaceSnapshot,
} from "./types";

const DESIGN_CONTRACT = `<!--
THESIS: Denote is a quiet file-native workbench, not a dashboard of cards.
OWN-WORLD: Graphite workspace chrome, paper-like editor surface, fine dividers, and one moss accent.
STORY: Choose a folder, find a note, write in place, and recover every important change.
FIRST VIEWPORT: Narrow activity rail, ordered vault tree, tabbed writing canvas, and optional outline.
FORM: Familiar Obsidian structure with Typora-style rich editing; canon path chosen from the user brief.
-->`;

function App() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [showOutline, setShowOutline] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevisions, setHistoryRevisions] = useState<HistoryRevision[]>(
    [],
  );
  const editorRef = useRef<MDXEditorMethods>(null);
  const searchIndex = useRef(new VaultSearchIndex());
  const searchQueryRef = useRef(searchQuery);
  const saveTimers = useRef(new Map<string, number>());
  const indexTimer = useRef<number | null>(null);
  const pendingAnchor = useRef<string | null>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );
  const selectedNode = useMemo(
    () => (workspace ? findNode(workspace.tree, selectedPath) : null),
    [selectedPath, workspace],
  );
  const allFiles = useMemo(
    () => (workspace ? flattenNodes(workspace.tree) : []),
    [workspace],
  );
  const headings = useMemo(
    () =>
      activeTab && activeTab.kind === "markdown"
        ? extractHeadings(activeTab.content)
        : [],
    [activeTab],
  );
  const tags = useMemo(
    () =>
      activeTab && activeTab.kind !== "image"
        ? extractTags(activeTab.content)
        : [],
    [activeTab],
  );

  const showError = useCallback((value: unknown) => {
    const message = errorMessage(value);
    setError(message);
    setStatus("Action failed");
  }, []);

  const rebuildSearchIndex = useCallback(
    async (vaultPath: string, query = searchQueryRef.current) => {
      setIndexing(true);
      try {
        const documents = await api.listSearchDocuments(vaultPath);
        await searchIndex.current.rebuild(documents);
        setSearchResults(await searchIndex.current.query(query));
      } catch (caught) {
        showError(caught);
      } finally {
        setIndexing(false);
      }
    },
    [showError],
  );

  const loadWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, resetTabs: boolean) => {
      setWorkspace(snapshot);
      setSelectedPath(null);
      setExpandedPaths(
        new Set(
          snapshot.tree
            .filter((node) => node.kind === "folder")
            .slice(0, 8)
            .map((node) => node.path),
        ),
      );
      if (resetTabs) {
        for (const timer of saveTimers.current.values()) {
          window.clearTimeout(timer);
        }
        saveTimers.current.clear();
        setTabs([]);
        setActivePath(null);
      }
      setStatus(`Opened ${snapshot.vaultName}`);
      await rebuildSearchIndex(snapshot.vaultPath);
    },
    [rebuildSearchIndex],
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspace) {
      return;
    }
    try {
      const snapshot = await api.refreshVault(workspace.vaultPath);
      setWorkspace(snapshot);
    } catch (caught) {
      showError(caught);
    }
  }, [showError, workspace]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    let cancelled = false;
    void (async () => {
      try {
        const lastVault = await api.getLastVault();
        if (!cancelled && lastVault) {
          const snapshot = await api.openVault(lastVault);
          if (!cancelled) {
            await loadWorkspace(snapshot, true);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          showError(caught);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace, showError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const results = await searchIndex.current.query(searchQuery);
      if (!cancelled) {
        setSearchResults(results);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  const chooseVault = useCallback(async () => {
    setInitializing(true);
    try {
      const selected = await open({
        title: "Choose a Denote vault",
        directory: true,
        multiple: false,
        recursive: true,
        canCreateDirectories: true,
        fileAccessMode: "scoped",
      });
      if (selected) {
        const snapshot = await api.openVault(selected);
        await loadWorkspace(snapshot, true);
      }
    } catch (caught) {
      showError(caught);
    } finally {
      setInitializing(false);
    }
  }, [loadWorkspace, showError]);

  const scheduleIndexRebuild = useCallback(() => {
    if (!workspace) {
      return;
    }
    if (indexTimer.current) {
      window.clearTimeout(indexTimer.current);
    }
    indexTimer.current = window.setTimeout(() => {
      void rebuildSearchIndex(workspace.vaultPath);
    }, 900);
  }, [rebuildSearchIndex, workspace]);

  const saveTab = useCallback(
    async (path: string, content: string, reason = "autosave") => {
      if (!workspace) {
        return;
      }
      setTabs((current) =>
        current.map((tab) =>
          tab.path === path ? { ...tab, saveState: "saving" } : tab,
        ),
      );
      try {
        const outcome = await api.saveNote(
          workspace.vaultPath,
          path,
          content,
          reason,
        );
        setTabs((current) =>
          current.map((tab) =>
            tab.path === path
              ? {
                  ...tab,
                  savedContent: content,
                  saveState: "saved",
                  stats: outcome.stats,
                }
              : tab,
          ),
        );
        setStatus(outcome.changed ? "Saved" : "No changes");
        scheduleIndexRebuild();
      } catch (caught) {
        setTabs((current) =>
          current.map((tab) =>
            tab.path === path ? { ...tab, saveState: "error" } : tab,
          ),
        );
        showError(caught);
      }
    },
    [scheduleIndexRebuild, showError, workspace],
  );

  const openFile = useCallback(
    async (path: string, anchor?: string | null) => {
      if (!workspace) {
        return;
      }
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        pendingAnchor.current = anchor ?? null;
        setActivePath(path);
        setSelectedPath(path);
        return;
      }
      const node = findNode(workspace.tree, path);
      const kind = node?.kind ?? kindFromPath(path);
      if (!kind || kind === "folder") {
        showError(`Unable to find ${path}`);
        return;
      }
      const title = node?.name ?? path.split("/").slice(-1)[0] ?? path;
      setStatus(`Opening ${title}…`);
      try {
        const tab: EditorTab =
          kind === "image"
            ? {
                path,
                title,
                kind: "image",
                content: "",
                savedContent: "",
                imageDataUrl: await api.readImageDataUrl(
                  workspace.vaultPath,
                  path,
                ),
                saveState: "saved",
              }
            : await api.readNote(workspace.vaultPath, path).then((document) => ({
                path,
                title,
                kind: kind === "markdown" ? "markdown" : "text",
                content: document.content,
                savedContent: document.content,
                stats: document.stats,
                saveState: "saved" as const,
              }));
        pendingAnchor.current = anchor ?? null;
        setTabs((current) => [...current, tab]);
        setActivePath(path);
        setSelectedPath(path);
        setStatus(`Opened ${title}`);
        void refreshWorkspace();
      } catch (caught) {
        showError(caught);
      }
    },
    [refreshWorkspace, showError, tabs, workspace],
  );

  const changeActiveContent = useCallback(
    (content: string) => {
      if (!activeTab || activeTab.kind === "image") {
        return;
      }
      const path = activeTab.path;
      setTabs((current) =>
        current.map((tab) =>
          tab.path === path
            ? {
                ...tab,
                content,
                saveState:
                  content === tab.savedContent ? "saved" : ("dirty" as const),
              }
            : tab,
        ),
      );
      const existingTimer = saveTimers.current.get(path);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      if (content === activeTab.savedContent) {
        saveTimers.current.delete(path);
        return;
      }
      const timer = window.setTimeout(() => {
        saveTimers.current.delete(path);
        void saveTab(path, content);
      }, 800);
      saveTimers.current.set(path, timer);
    },
    [activeTab, saveTab],
  );

  const closeTab = useCallback(
    async (path: string) => {
      const tab = tabs.find((candidate) => candidate.path === path);
      if (!tab) {
        return;
      }
      const timer = saveTimers.current.get(path);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(path);
      }
      if (tab.saveState === "dirty" && tab.kind !== "image") {
        await saveTab(path, tab.content, "close");
      }
      const index = tabs.findIndex((candidate) => candidate.path === path);
      const remaining = tabs.filter((candidate) => candidate.path !== path);
      setTabs(remaining);
      if (activePath === path) {
        setActivePath(
          remaining[Math.min(index, remaining.length - 1)]?.path ?? null,
        );
      }
    },
    [activePath, saveTab, tabs],
  );

  const refreshAndReindex = useCallback(async () => {
    if (!workspace) {
      return;
    }
    await refreshWorkspace();
    await rebuildSearchIndex(workspace.vaultPath);
  }, [rebuildSearchIndex, refreshWorkspace, workspace]);

  const createEntry = useCallback(
    async (directory: boolean) => {
      if (!workspace) {
        return;
      }
      const parentPath =
        selectedNode?.kind === "folder"
          ? selectedNode.path
          : selectedPath?.split("/").slice(0, -1).join("/") || "";
      const suggested = directory ? "New folder" : "Untitled.md";
      const entered = window.prompt(
        directory ? "Folder name" : "Note name",
        suggested,
      );
      if (!entered) {
        return;
      }
      const name =
        !directory && !/\.(?:md|markdown|txt)$/i.test(entered)
          ? `${entered}.md`
          : entered;
      try {
        const path = await api.createEntry(
          workspace.vaultPath,
          parentPath,
          name,
          directory,
        );
        if (parentPath) {
          setExpandedPaths((current) => new Set(current).add(parentPath));
        }
        await refreshAndReindex();
        setSelectedPath(path);
        if (!directory) {
          await openFile(path);
        }
      } catch (caught) {
        showError(caught);
      }
    },
    [
      openFile,
      refreshAndReindex,
      selectedNode,
      selectedPath,
      showError,
      workspace,
    ],
  );

  const renameSelected = useCallback(async () => {
    if (!workspace || !selectedNode) {
      return;
    }
    const newName = window.prompt("Rename", selectedNode.name);
    if (!newName || newName === selectedNode.name) {
      return;
    }
    try {
      const newPath = await api.renameEntry(
        workspace.vaultPath,
        selectedNode.path,
        newName,
      );
      const oldPath = selectedNode.path;
      const replacePrefix = (path: string) =>
        path === oldPath || path.startsWith(`${oldPath}/`)
          ? `${newPath}${path.slice(oldPath.length)}`
          : path;
      setTabs((current) =>
        current.map((tab) => {
          const path = replacePrefix(tab.path);
          return {
            ...tab,
            path,
            title: path.split("/").slice(-1)[0] ?? path,
          };
        }),
      );
      setActivePath((current) => (current ? replacePrefix(current) : current));
      setSelectedPath(newPath);
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    }
  }, [refreshAndReindex, selectedNode, showError, workspace]);

  const trashSelected = useCallback(async () => {
    if (!workspace || !selectedNode) {
      return;
    }
    if (
      !window.confirm(
        `Move “${selectedNode.name}” to Denote Trash? It can be restored later.`,
      )
    ) {
      return;
    }
    try {
      const affectedTabs = tabs.filter(
        (tab) =>
          tab.path === selectedNode.path ||
          tab.path.startsWith(`${selectedNode.path}/`),
      );
      for (const tab of affectedTabs) {
        if (tab.saveState === "dirty" && tab.kind !== "image") {
          await saveTab(tab.path, tab.content, "before trash");
        }
      }
      await api.trashEntry(workspace.vaultPath, selectedNode.path);
      const isAffected = (path: string) =>
        path === selectedNode.path ||
        path.startsWith(`${selectedNode.path}/`);
      setTabs((current) => current.filter((tab) => !isAffected(tab.path)));
      if (activePath && isAffected(activePath)) {
        setActivePath(null);
      }
      setSelectedPath(null);
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    }
  }, [
    activePath,
    refreshAndReindex,
    saveTab,
    selectedNode,
    showError,
    tabs,
    workspace,
  ]);

  const toggleBookmark = useCallback(async () => {
    if (!workspace || !selectedNode || selectedNode.kind === "folder") {
      return;
    }
    try {
      await api.setBookmark(
        workspace.vaultPath,
        selectedNode.path,
        !selectedNode.bookmarked,
      );
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    }
  }, [refreshAndReindex, selectedNode, showError, workspace]);

  const moveSelected = useCallback(
    async (direction: -1 | 1) => {
      if (!workspace || !selectedNode) {
        return;
      }
      const siblings = findSiblings(workspace.tree, selectedNode.path);
      const index = siblings.findIndex((node) => node.path === selectedNode.path);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= siblings.length) {
        return;
      }
      const reordered = [...siblings];
      [reordered[index], reordered[destination]] = [
        reordered[destination],
        reordered[index],
      ];
      try {
        await api.setEntryOrder(
          workspace.vaultPath,
          reordered.map((node) => node.path),
        );
        await refreshWorkspace();
      } catch (caught) {
        showError(caught);
      }
    },
    [refreshWorkspace, selectedNode, showError, workspace],
  );

  const restoreTrash = useCallback(
    async (itemId: number) => {
      if (!workspace) {
        return;
      }
      try {
        const restoredPath = await api.restoreTrashItem(
          workspace.vaultPath,
          itemId,
        );
        await refreshAndReindex();
        setSidebarView("files");
        setSelectedPath(restoredPath);
      } catch (caught) {
        showError(caught);
      }
    },
    [refreshAndReindex, showError, workspace],
  );

  const openHistory = useCallback(async () => {
    if (!workspace || !activeTab || activeTab.kind === "image") {
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistoryRevisions(
        await api.listHistory(workspace.vaultPath, activeTab.path),
      );
    } catch (caught) {
      showError(caught);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeTab, showError, workspace]);

  const restoreRevision = useCallback(
    async (revisionId: number) => {
      if (!workspace || !activeTab || activeTab.kind === "image") {
        return;
      }
      try {
        const document = await api.restoreRevision(
          workspace.vaultPath,
          activeTab.path,
          revisionId,
        );
        setTabs((current) =>
          current.map((tab) =>
            tab.path === activeTab.path
              ? {
                  ...tab,
                  content: document.content,
                  savedContent: document.content,
                  stats: document.stats,
                  saveState: "saved",
                }
              : tab,
          ),
        );
        editorRef.current?.setMarkdown(calloutsToDirectives(document.content));
        setHistoryOpen(false);
        setStatus("Revision restored");
        scheduleIndexRebuild();
      } catch (caught) {
        showError(caught);
      }
    },
    [activeTab, scheduleIndexRebuild, showError, workspace],
  );

  const openLink = useCallback(
    async (href: string) => {
      if (!activeTab || !href) {
        return;
      }
      try {
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          await openUrl(href);
          return;
        }
        if (href.startsWith("file://")) {
          await openPath(decodeURIComponent(new URL(href).pathname));
          return;
        }
        const resolved = resolveInternalLink(
          activeTab.path,
          href,
          allFiles
            .filter((node) => node.kind !== "folder")
            .map((node) => node.path),
        );
        if (!resolved) {
          showError(`Link target not found: ${href}`);
          return;
        }
        await openFile(resolved.path, resolved.anchor);
      } catch (caught) {
        showError(caught);
      }
    },
    [activeTab, allFiles, openFile, showError],
  );

  const navigateToHeading = useCallback((heading: HeadingItem) => {
    const candidates = document.querySelectorAll<HTMLElement>(
      ".denote-editor-content h1, .denote-editor-content h2, .denote-editor-content h3, .denote-editor-content h4, .denote-editor-content h5, .denote-editor-content h6",
    );
    const target = [...candidates].find(
      (element) => slugifyHeading(element.textContent ?? "") === heading.slug,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!activePath || !pendingAnchor.current) {
      return;
    }
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    const timer = window.setTimeout(() => {
      navigateToHeading({ depth: 1, text: anchor, slug: slugifyHeading(anchor) });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activePath, navigateToHeading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        setSidebarView("search");
        window.setTimeout(
          () => document.querySelector<HTMLInputElement>(".search-box input")?.focus(),
          0,
        );
      } else if (modifier && event.key.toLocaleLowerCase() === "s" && activeTab) {
        event.preventDefault();
        if (activeTab.kind !== "image") {
          void saveTab(activeTab.path, activeTab.content, "manual save");
        }
      } else if (modifier && event.key.toLocaleLowerCase() === "w" && activePath) {
        event.preventDefault();
        void closeTab(activePath);
      } else if (event.ctrlKey && event.key === "Tab" && tabs.length > 1) {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.path === activePath);
        const direction = event.shiftKey ? -1 : 1;
        setActivePath(
          tabs[(index + direction + tabs.length) % tabs.length].path,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, activeTab, closeTab, saveTab, tabs]);

  if (!workspace) {
    return (
      <>
        <span
          hidden
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: DESIGN_CONTRACT }}
        />
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}
        <Welcome loading={initializing} onChooseVault={chooseVault} />
      </>
    );
  }

  return (
    <div className="app-shell">
      <span
        hidden
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: DESIGN_CONTRACT }}
      />
      <a className="skip-link" href="#editor-workspace">
        Skip to editor
      </a>
      <ActivityRail
        activeView={sidebarView}
        theme={theme}
        onViewChange={setSidebarView}
        onThemeToggle={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
      />
      <aside className="workspace-sidebar" aria-label="Vault sidebar">
        <header className="sidebar-header">
          <div>
            <span>Vault</span>
            <h1>{workspace.vaultName}</h1>
          </div>
          <button
            type="button"
            className="icon-button"
            title="Open another vault"
            aria-label="Open another vault"
            onClick={chooseVault}
          >
            <FolderOpen aria-hidden="true" size={17} />
          </button>
        </header>
        {sidebarView === "files" ? (
          <>
            <div className="sidebar-toolbar" aria-label="File actions">
              <button
                type="button"
                className="icon-button"
                title="New note"
                aria-label="New note"
                onClick={() => void createEntry(false)}
              >
                <FilePlus2 aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="New folder"
                aria-label="New folder"
                onClick={() => void createEntry(true)}
              >
                <FolderPlus aria-hidden="true" size={16} />
              </button>
              <span className="toolbar-spacer" />
              <button
                type="button"
                className="icon-button"
                title="Rename selected item"
                aria-label="Rename selected item"
                disabled={!selectedNode}
                onClick={() => void renameSelected()}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Move selected item up"
                aria-label="Move selected item up"
                disabled={!selectedNode}
                onClick={() => void moveSelected(-1)}
              >
                <ArrowUp aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Move selected item down"
                aria-label="Move selected item down"
                disabled={!selectedNode}
                onClick={() => void moveSelected(1)}
              >
                <ArrowDown aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={
                  selectedNode?.bookmarked ? "Remove bookmark" : "Add bookmark"
                }
                aria-label={
                  selectedNode?.bookmarked ? "Remove bookmark" : "Add bookmark"
                }
                disabled={!selectedNode || selectedNode.kind === "folder"}
                onClick={() => void toggleBookmark()}
              >
                {selectedNode?.bookmarked ? (
                  <BookmarkCheck aria-hidden="true" size={15} />
                ) : (
                  <Bookmark aria-hidden="true" size={15} />
                )}
              </button>
              <button
                type="button"
                className="icon-button icon-button--danger"
                title="Move selected item to trash"
                aria-label="Move selected item to trash"
                disabled={!selectedNode}
                onClick={() => void trashSelected()}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
            <FileTree
              nodes={workspace.tree}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={(node) => {
                setSelectedPath(node.path);
                if (node.kind !== "folder") {
                  void openFile(node.path);
                }
              }}
              onToggleFolder={(path) =>
                setExpandedPaths((current) => {
                  const next = new Set(current);
                  if (next.has(path)) {
                    next.delete(path);
                  } else {
                    next.add(path);
                  }
                  return next;
                })
              }
            />
          </>
        ) : sidebarView === "search" ? (
          <SearchPanel
            query={searchQuery}
            results={searchResults}
            searching={indexing}
            onQueryChange={setSearchQuery}
            onOpenResult={(path) => void openFile(path)}
          />
        ) : sidebarView === "bookmarks" ? (
          <SidebarNoteList
            title="Bookmarks"
            empty="Bookmark a note to keep it close."
            items={workspace.bookmarks}
            onOpen={(path) => void openFile(path)}
          />
        ) : sidebarView === "recent" ? (
          <SidebarNoteList
            title="Recently opened"
            empty="Opened notes appear here."
            items={workspace.recent}
            onOpen={(path) => void openFile(path)}
          />
        ) : (
          <div className="sidebar-view">
            <div className="sidebar-view__title">
              <h2>Trash</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh trash"
                onClick={() => void refreshWorkspace()}
              >
                <RefreshCw aria-hidden="true" size={15} />
              </button>
            </div>
            <div className="sidebar-list">
              {workspace.trash.length > 0 ? (
                workspace.trash.map((item) => (
                  <div className="trash-item" key={item.id}>
                    <div>
                      <strong>
                        {item.originalPath.split("/").slice(-1)[0]}
                      </strong>
                      <span>{item.originalPath}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Restore ${item.originalPath}`}
                      title="Restore"
                      onClick={() => void restoreTrash(item.id)}
                    >
                      <RotateCcw aria-hidden="true" size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="sidebar-empty">Trash is empty.</p>
              )}
            </div>
          </div>
        )}
      </aside>
      <section className="workspace-main" id="editor-workspace" tabIndex={-1}>
        <header className="workspace-topbar">
          <Tabs
            tabs={tabs}
            activePath={activePath}
            onActivate={setActivePath}
            onClose={(path) => void closeTab(path)}
          />
          <div className="workspace-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Open note history"
              title="History"
              disabled={!activeTab || activeTab.kind === "image"}
              onClick={() => void openHistory()}
            >
              <History aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${showOutline ? "Hide" : "Show"} outline`}
              title={`${showOutline ? "Hide" : "Show"} outline`}
              aria-pressed={showOutline}
              onClick={() => setShowOutline((current) => !current)}
            >
              <ListTree aria-hidden="true" size={16} />
            </button>
          </div>
        </header>
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}
        <div className="editor-layout">
          <main className="editor-pane">
            {activeTab ? (
              <>
                {activeTab.kind === "image" ? (
                  <figure className="image-viewer">
                    <img
                      src={activeTab.imageDataUrl}
                      alt={activeTab.title}
                    />
                    <figcaption>{activeTab.path}</figcaption>
                  </figure>
                ) : activeTab.kind === "text" ? (
                  <textarea
                    className="plain-text-editor"
                    aria-label={`Edit ${activeTab.title}`}
                    value={activeTab.content}
                    spellCheck
                    onChange={(event) =>
                      changeActiveContent(event.currentTarget.value)
                    }
                  />
                ) : (
                  <MarkdownEditor
                    key={activeTab.path}
                    ref={editorRef}
                    vaultPath={workspace.vaultPath}
                    notePath={activeTab.path}
                    markdown={activeTab.content}
                    onChange={changeActiveContent}
                    onError={showError}
                    onLinkOpen={(href) => void openLink(href)}
                  />
                )}
                {tags.length > 0 ? (
                  <div className="document-tags" aria-label="Document tags">
                    {tags.map((tag) => (
                      <button
                        type="button"
                        className="tag-chip"
                        key={tag}
                        onClick={() => {
                          setSidebarView("search");
                          setSearchQuery(`tag:${tag}`);
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="editor-empty">
                <div className="editor-empty__mark">D</div>
                <h2>Your vault is ready.</h2>
                <p>
                  Open a note from the sidebar or press{" "}
                  <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}P</kbd>{" "}
                  to search.
                </p>
              </div>
            )}
          </main>
          {showOutline && activeTab?.kind === "markdown" ? (
            <TableOfContents
              headings={headings}
              onNavigate={navigateToHeading}
            />
          ) : null}
        </div>
        <footer className="status-bar" aria-live="polite">
          <span>{activeTab?.path ?? workspace.vaultPath}</span>
          <span className="status-bar__spacer" />
          {activeTab && activeTab.kind !== "image" ? (
            <>
              <span>{wordCount(activeTab.content)} words</span>
              <span>{activeTab.content.length} characters</span>
              <span>
                {activeTab.stats
                  ? `${activeTab.stats.openCount} opens · ${activeTab.stats.saveCount} saves`
                  : "UTF-8"}
              </span>
              <span data-save-state={activeTab.saveState}>
                {activeTab.saveState}
              </span>
            </>
          ) : null}
          <span>{status}</span>
        </footer>
      </section>
      <HistoryDialog
        open={historyOpen}
        title={activeTab?.title ?? "Note"}
        revisions={historyRevisions}
        loading={historyLoading}
        onClose={() => setHistoryOpen(false)}
        onRestore={(revisionId) => void restoreRevision(revisionId)}
      />
    </div>
  );
}

interface SidebarNoteListProps {
  title: string;
  empty: string;
  items: WorkspaceSnapshot["recent"];
  onOpen: (path: string) => void;
}

function SidebarNoteList({
  title,
  empty,
  items,
  onOpen,
}: SidebarNoteListProps) {
  return (
    <div className="sidebar-view">
      <div className="sidebar-view__title">
        <h2>{title}</h2>
      </div>
      <div className="sidebar-list">
        {items.length > 0 ? (
          items.map((item) => (
            <button
              type="button"
              className="sidebar-note"
              key={item.path}
              onClick={() => onOpen(item.path)}
            >
              <strong>{item.title}</strong>
              <span>{item.path}</span>
              {item.lastOpenedAt ? (
                <time dateTime={item.lastOpenedAt}>
                  {formatRelativeDate(item.lastOpenedAt)}
                </time>
              ) : null}
            </button>
          ))
        ) : (
          <p className="sidebar-empty">{empty}</p>
        )}
      </div>
    </div>
  );
}

function flattenNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.kind === "folder" ? flattenNodes(node.children) : []),
  ]);
}

function findNode(nodes: FileNode[], path: string | null): FileNode | null {
  if (!path) {
    return null;
  }
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.kind === "folder") {
      const nested = findNode(node.children, path);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function findSiblings(nodes: FileNode[], path: string): FileNode[] {
  if (nodes.some((node) => node.path === path)) {
    return nodes;
  }
  for (const node of nodes) {
    if (node.kind === "folder") {
      const nested = findSiblings(node.children, path);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
}

function wordCount(content: string): number {
  if (!content.trim()) {
    return 0;
  }
  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return [...segmenter.segment(content)].filter((segment) => segment.isWordLike)
      .length;
  }
  return content.trim().split(/\s+/u).length;
}

function kindFromPath(path: string): FileNode["kind"] | null {
  const extension = path.split(".").slice(-1)[0]?.toLocaleLowerCase();
  if (extension === "md" || extension === "markdown") {
    return "markdown";
  }
  if (extension === "txt") {
    return "text";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(
      extension,
    )
  ) {
    return "image";
  }
  return null;
}

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  const difference = Date.now() - timestamp;
  if (difference < 60_000) {
    return "Just now";
  }
  if (difference < 3_600_000) {
    return `${Math.floor(difference / 60_000)}m ago`;
  }
  if (difference < 86_400_000) {
    return `${Math.floor(difference / 3_600_000)}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    timestamp,
  );
}

export default App;
