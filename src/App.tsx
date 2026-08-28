import type { MDXEditorMethods } from "@mdxeditor/editor";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
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
  Replace as ReplaceIcon,
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
import { ActionDialog } from "./components/ActionDialog";
import { FileTree } from "./components/FileTree";
import { HistoryDialog } from "./components/HistoryDialog";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { ReplaceDialog } from "./components/ReplaceDialog";
import { SearchPanel } from "./components/SearchPanel";
import { TableOfContents } from "./components/TableOfContents";
import { Tabs } from "./components/Tabs";
import { Welcome } from "./components/Welcome";
import { api, errorMessage } from "./lib/api";
import {
  calloutsToDirectives,
  extractHeadings,
  extractTags,
  recoverMarkdownLinkTarget,
  resolveInternalLink,
  slugifyHeading,
} from "./lib/markdown";
import { VaultSearchIndex } from "./lib/search";
import { isReplaceShortcut } from "./lib/shortcuts";
import {
  previewReplacements,
  type ReplaceApplySummary,
  type ReplacePreview,
  type ReplaceRequest,
} from "./lib/replace";
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

interface ActionDialogState {
  mode: "text" | "confirm";
  title: string;
  message: string;
  initialValue: string;
  confirmLabel: string;
  dangerous: boolean;
}

interface PendingAttachmentInsertion {
  source: string | null;
  settle: (succeeded: boolean) => void;
}

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
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [workspaceLocked, setWorkspaceLocked] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null,
  );
  const [historyRevisions, setHistoryRevisions] = useState<HistoryRevision[]>(
    [],
  );
  const editorRef = useRef<MDXEditorMethods>(null);
  const searchIndex = useRef(new VaultSearchIndex());
  const searchQueryRef = useRef(searchQuery);
  const rebuildRequest = useRef(0);
  const queryRequest = useRef(0);
  const tabsRef = useRef<EditorTab[]>([]);
  const saveTimers = useRef(new Map<string, number>());
  const saveQueues = useRef(new Map<string, Promise<boolean>>());
  const saveGenerations = useRef(new Map<string, number>());
  const editQueues = useRef(new Map<string, Promise<boolean>>());
  const attachmentUploads = useRef(new Set<Promise<boolean>>());
  const criticalOperations = useRef(new Set<Promise<void>>());
  const pendingAttachmentInsertions = useRef(
    new Map<string, Set<PendingAttachmentInsertion>>(),
  );
  const flushAllTabsRef = useRef<() => Promise<boolean>>(async () => true);
  const beginWorkspaceOperationRef = useRef<() => Promise<boolean>>(
    async () => true,
  );
  const indexTimer = useRef<number | null>(null);
  const pendingAnchor = useRef<string | null>(null);
  const activePathRef = useRef<string | null>(activePath);
  const vaultGeneration = useRef(0);
  const closingWindow = useRef(false);
  const workspaceLockedRef = useRef(false);
  const actionDialogResolver = useRef<((value: string | null) => void) | null>(
    null,
  );

  const commitTabs = useCallback(
    (updater: (current: EditorTab[]) => EditorTab[]) => {
      const next = updater(tabsRef.current);
      tabsRef.current = next;
      setTabs(next);
    },
    [],
  );
  const setWorkspaceLock = useCallback((locked: boolean) => {
    workspaceLockedRef.current = locked;
    setWorkspaceLocked(locked);
  }, []);
  const cancelPendingPath = useCallback((path: string) => {
    const timer = saveTimers.current.get(path);
    if (timer) {
      window.clearTimeout(timer);
    }
    saveTimers.current.delete(path);
    saveGenerations.current.set(
      path,
      (saveGenerations.current.get(path) ?? 0) + 1,
    );
    saveQueues.current.delete(path);
    editQueues.current.delete(path);
  }, []);
  const requestText = useCallback(
    (options: Omit<ActionDialogState, "mode" | "dangerous">) =>
      new Promise<string | null>((resolve) => {
        actionDialogResolver.current = resolve;
        setActionDialog({ ...options, mode: "text", dangerous: false });
      }),
    [],
  );
  const requestConfirmation = useCallback(
    (options: Omit<ActionDialogState, "mode" | "initialValue">) =>
      new Promise<boolean>((resolve) => {
        actionDialogResolver.current = (value) => resolve(value !== null);
        setActionDialog({ ...options, mode: "confirm", initialValue: "" });
      }),
    [],
  );
  const finishActionDialog = useCallback((value: string | null) => {
    const resolver = actionDialogResolver.current;
    actionDialogResolver.current = null;
    setActionDialog(null);
    resolver?.(value);
  }, []);

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
    async (generation = vaultGeneration.current) => {
      const request = ++rebuildRequest.current;
      setIndexing(true);
      try {
        const documents = await api.listSearchDocuments();
        if (
          generation !== vaultGeneration.current ||
          request !== rebuildRequest.current
        ) {
          return;
        }
        const nextIndex = new VaultSearchIndex();
        await nextIndex.rebuild(documents);
        if (
          generation !== vaultGeneration.current ||
          request !== rebuildRequest.current
        ) {
          return;
        }
        searchIndex.current = nextIndex;
        const query = searchQueryRef.current;
        const results = await nextIndex.query(query);
        if (
          generation === vaultGeneration.current &&
          request === rebuildRequest.current &&
          query === searchQueryRef.current
        ) {
          setSearchResults(results);
        }
      } catch (caught) {
        if (generation === vaultGeneration.current) {
          showError(caught);
        }
      } finally {
        if (
          generation === vaultGeneration.current &&
          request === rebuildRequest.current
        ) {
          setIndexing(false);
        }
      }
    },
    [showError],
  );

  const loadWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, resetTabs: boolean) => {
      if (indexTimer.current) {
        window.clearTimeout(indexTimer.current);
        indexTimer.current = null;
      }
      rebuildRequest.current += 1;
      queryRequest.current += 1;
      searchIndex.current = new VaultSearchIndex();
      setSearchResults([]);
      setIndexing(false);
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
        for (const path of saveGenerations.current.keys()) {
          saveGenerations.current.set(
            path,
            (saveGenerations.current.get(path) ?? 0) + 1,
          );
        }
        saveQueues.current.clear();
        editQueues.current.clear();
        commitTabs(() => []);
        setActivePath(null);
      }
      setStatus(`Opened ${snapshot.vaultName}`);
      await rebuildSearchIndex(vaultGeneration.current);
    },
    [commitTabs, rebuildSearchIndex],
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspace) {
      return;
    }
    const generation = vaultGeneration.current;
    try {
      const snapshot = await api.refreshVault();
      if (generation === vaultGeneration.current) {
        setWorkspace(snapshot);
      }
    } catch (caught) {
      if (generation === vaultGeneration.current) {
        showError(caught);
      }
    }
  }, [showError, workspace]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await api.getLastVault();
        if (!cancelled && snapshot) {
          vaultGeneration.current += 1;
          await loadWorkspace(snapshot, true);
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
    const request = ++queryRequest.current;
    void (async () => {
      const results = await searchIndex.current.query(searchQuery);
      if (!cancelled && request === queryRequest.current) {
        setSearchResults(results);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  const chooseVault = useCallback(async () => {
    if (workspaceLockedRef.current) {
      return;
    }
    setInitializing(true);
    try {
      if (!(await beginWorkspaceOperationRef.current())) {
        setStatus("Vault switch cancelled because a note could not be saved");
        return;
      }
      const snapshot = await api.chooseVault();
      if (snapshot) {
        vaultGeneration.current += 1;
        await loadWorkspace(snapshot, true);
      }
    } catch (caught) {
      showError(caught);
    } finally {
      setInitializing(false);
      setWorkspaceLock(false);
    }
  }, [loadWorkspace, setWorkspaceLock, showError]);

  const scheduleIndexRebuild = useCallback(() => {
    if (!workspace) {
      return;
    }
    if (indexTimer.current) {
      window.clearTimeout(indexTimer.current);
    }
    const generation = vaultGeneration.current;
    indexTimer.current = window.setTimeout(() => {
      void rebuildSearchIndex(generation);
    }, 900);
  }, [rebuildSearchIndex, workspace]);

  const saveTab = useCallback(
    (path: string, content: string, reason = "autosave"): Promise<boolean> => {
      if (!workspace) {
        return Promise.resolve(false);
      }
      commitTabs((current) =>
        current.map((tab) =>
          tab.path === path && tab.content === content
            ? { ...tab, saveState: "saving" }
            : tab,
        ),
      );
      const previous = saveQueues.current.get(path) ?? Promise.resolve(true);
      const generation = saveGenerations.current.get(path) ?? 0;
      const task = previous
        .catch(() => false)
        .then(async () => {
          if ((saveGenerations.current.get(path) ?? 0) !== generation) {
            return true;
          }
          try {
            const expectedHash = tabsRef.current.find(
              (tab) => tab.path === path,
            )?.savedHash;
            const outcome = await api.saveNote(
              path,
              content,
              reason,
              expectedHash,
            );
            if ((saveGenerations.current.get(path) ?? 0) !== generation) {
              return true;
            }
            commitTabs((current) =>
              current.map((tab) =>
                tab.path === path
                  ? {
                      ...tab,
                      savedContent: content,
                      savedHash: outcome.contentHash,
                      saveState:
                        tab.content === content ? "saved" : ("dirty" as const),
                      editRecorded:
                        tab.content === content ? false : tab.editRecorded,
                      stats: outcome.stats,
                    }
                  : tab,
              ),
            );
            setStatus(outcome.changed ? "Saved" : "No changes");
            scheduleIndexRebuild();
            return true;
          } catch (caught) {
            commitTabs((current) =>
              current.map((tab) =>
                tab.path === path
                  ? {
                      ...tab,
                      saveState:
                        tab.content === content ? "error" : ("dirty" as const),
                    }
                  : tab,
              ),
            );
            showError(caught);
            return false;
          }
        });
      saveQueues.current.set(path, task);
      void task.finally(() => {
        if (saveQueues.current.get(path) === task) {
          saveQueues.current.delete(path);
          editQueues.current.delete(path);
        }
      });
      return task;
    },
    [commitTabs, scheduleIndexRebuild, showError, workspace],
  );

  const flushTab = useCallback(
    async (path: string): Promise<boolean> => {
      const timer = saveTimers.current.get(path);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(path);
      }
      await editQueues.current.get(path);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const pending = saveQueues.current.get(path);
        if (pending) {
          await pending;
        }
        const tab = tabsRef.current.find((candidate) => candidate.path === path);
        if (!tab || tab.kind === "image" || tab.content === tab.savedContent) {
          return true;
        }
        if (!(await saveTab(path, tab.content, "flush"))) {
          return false;
        }
      }
      showError(`Unable to settle concurrent edits for ${path}. Try again.`);
      return false;
    },
    [saveTab, showError],
  );

  const flushAllTabs = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      for (const tab of [...tabsRef.current]) {
        if (!(await flushTab(tab.path))) {
          return false;
        }
      }
      if (
        tabsRef.current.every(
          (tab) => tab.kind === "image" || tab.content === tab.savedContent,
        )
      ) {
        return true;
      }
    }
    showError("Unable to settle concurrent workspace edits. Try again.");
    return false;
  }, [flushTab, showError]);
  flushAllTabsRef.current = flushAllTabs;

  const beginWorkspaceOperation = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const uploads = await Promise.all([...attachmentUploads.current]);
      if (uploads.some((succeeded) => !succeeded)) {
        return false;
      }
      setWorkspaceLock(true);
      if (attachmentUploads.current.size > 0) {
        setWorkspaceLock(false);
        continue;
      }
      if (await flushAllTabsRef.current()) {
        return true;
      }
      setWorkspaceLock(false);
      return false;
    }
    showError("Unable to settle attachment uploads. Try again.");
    return false;
  }, [setWorkspaceLock, showError]);
  beginWorkspaceOperationRef.current = beginWorkspaceOperation;

  const uploadAttachment = useCallback(
    (notePath: string, file: File): Promise<string> => {
      if (workspaceLockedRef.current) {
        return Promise.reject(new Error("Workspace is busy. Try the upload again."));
      }
      let resolveTracked: (succeeded: boolean) => void = () => {};
      const tracked = new Promise<boolean>((resolve) => {
        resolveTracked = resolve;
      });
      const insertion: PendingAttachmentInsertion = {
        source: null,
        settle: () => {},
      };
      const settle = (succeeded: boolean) => {
        const pending = pendingAttachmentInsertions.current.get(notePath);
        pending?.delete(insertion);
        if (pending?.size === 0) {
          pendingAttachmentInsertions.current.delete(notePath);
        }
        attachmentUploads.current.delete(tracked);
        window.clearTimeout(timeout);
        resolveTracked(succeeded);
      };
      insertion.settle = settle;
      const pending =
        pendingAttachmentInsertions.current.get(notePath) ?? new Set();
      pending.add(insertion);
      pendingAttachmentInsertions.current.set(notePath, pending);
      const timeout = window.setTimeout(() => {
        showError(`Image insertion timed out in ${notePath}.`);
        settle(false);
      }, 10_000);
      const operation = api
        .saveAttachment(notePath, file)
        .then((source) => {
          insertion.source = source;
          return source;
        })
        .catch((caught) => {
          showError(caught);
          settle(false);
          throw caught;
        });
      attachmentUploads.current.add(tracked);
      return operation;
    },
    [showError],
  );

  const completeSafeExit = useCallback(async () => {
    if (closingWindow.current) {
      return;
    }
    closingWindow.current = true;
    await Promise.all([...criticalOperations.current]);
    if (await beginWorkspaceOperationRef.current()) {
      try {
        await api.completeExit();
      } catch (caught) {
        closingWindow.current = false;
        setWorkspaceLock(false);
        showError(caught);
      }
    } else {
      closingWindow.current = false;
      setWorkspaceLock(false);
      setStatus("Close cancelled because a note could not be saved");
    }
  }, [setWorkspaceLock, showError]);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    const appWindow = getCurrentWindow();
    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await completeSafeExit();
      })
      .then((cleanup) => {
        unlistenClose = cleanup;
      })
      .catch(showError);
    void listen("denote://exit-requested", () => completeSafeExit())
      .then((cleanup) => {
        unlistenExit = cleanup;
      })
      .catch(showError);
    return () => {
      unlistenClose?.();
      unlistenExit?.();
    };
  }, [completeSafeExit, showError]);

  const openFile = useCallback(
    async (path: string, anchor?: string | null) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const existing = tabsRef.current.find((tab) => tab.path === path);
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
      const generation = vaultGeneration.current;
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
                imageDataUrl: await api.readImageDataUrl(path),
                editRecorded: false,
                saveState: "saved",
              }
            : await api.readNote(path).then((document) => ({
                path,
                title,
                kind: kind === "markdown" ? "markdown" : "text",
                content: document.content,
                savedContent: document.content,
                savedHash: document.contentHash,
                stats: document.stats,
                editRecorded: false,
                saveState: "saved" as const,
              }));
        if (generation !== vaultGeneration.current) {
          return;
        }
        pendingAnchor.current = anchor ?? null;
        commitTabs((current) =>
          current.some((candidate) => candidate.path === path)
            ? current
            : [...current, tab],
        );
        setActivePath(path);
        setSelectedPath(path);
        setStatus(`Opened ${title}`);
        void refreshWorkspace();
        scheduleIndexRebuild();
      } catch (caught) {
        if (generation === vaultGeneration.current) {
          showError(caught);
        }
      }
    },
    [
      commitTabs,
      refreshWorkspace,
      scheduleIndexRebuild,
      showError,
      workspace,
    ],
  );

  const changeActiveContent = useCallback(
    (content: string) => {
      const currentTab = tabsRef.current.find(
        (candidate) => candidate.path === activePath,
      );
      if (!currentTab || currentTab.kind === "image") {
        return;
      }
      const path = currentTab.path;
      const pendingInsertions = pendingAttachmentInsertions.current.get(path);
      if (workspaceLockedRef.current && !pendingInsertions) {
        return;
      }
      const shouldRecordEdit =
        content !== currentTab.savedContent && !currentTab.editRecorded;
      commitTabs((current) =>
        current.map((tab) =>
          tab.path === path
            ? {
                ...tab,
                content,
                saveState:
                  content === tab.savedContent ? "saved" : ("dirty" as const),
                editRecorded:
                  content === tab.savedContent
                    ? false
                    : tab.editRecorded || shouldRecordEdit,
              }
            : tab,
        ),
      );
      if (shouldRecordEdit) {
        const editTask = api
          .recordEdit(path)
          .then((stats) => {
            commitTabs((current) =>
              current.map((tab) =>
                tab.path === path ? { ...tab, stats } : tab,
              ),
            );
            return true;
          })
          .catch((caught) => {
            showError(caught);
            return false;
          });
        editQueues.current.set(path, editTask);
        void editTask.finally(() => {
          if (editQueues.current.get(path) === editTask) {
            editQueues.current.delete(path);
          }
          for (const insertion of [...(pendingInsertions ?? [])]) {
            if (insertion.source && content.includes(insertion.source)) {
              insertion.settle(true);
            }
          }
        });
      }
      const existingTimer = saveTimers.current.get(path);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      if (content === currentTab.savedContent) {
        saveTimers.current.delete(path);
        return;
      }
      const timer = window.setTimeout(() => {
        saveTimers.current.delete(path);
        void saveTab(path, content);
      }, 800);
      saveTimers.current.set(path, timer);
    },
    [activePath, commitTabs, saveTab, showError],
  );

  const closeTab = useCallback(
    async (path: string) => {
      if (workspaceLockedRef.current) {
        return;
      }
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        const currentTabs = tabsRef.current;
        const index = currentTabs.findIndex(
          (candidate) => candidate.path === path,
        );
        if (index < 0 || !(await flushTab(path))) {
          return;
        }
        const remaining = tabsRef.current.filter(
          (candidate) => candidate.path !== path,
        );
        commitTabs(() => remaining);
        cancelPendingPath(path);
        if (activePath === path) {
            const nextPath =
              remaining[Math.min(index, remaining.length - 1)]?.path ?? null;
            setActivePath(nextPath);
            window.setTimeout(() => {
              if (nextPath) {
                const nextTab = [...document.querySelectorAll<HTMLButtonElement>(
                  "[data-tab-path]",
                )].find((element) => element.dataset.tabPath === nextPath);
                nextTab?.focus();
              } else {
                document
                  .querySelector<HTMLButtonElement>(".file-tree__row")
                  ?.focus();
              }
            }, 0);
          }
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      activePath,
      cancelPendingPath,
      commitTabs,
      flushTab,
      setWorkspaceLock,
      beginWorkspaceOperation,
    ],
  );

  const refreshAndReindex = useCallback(async () => {
    if (!workspace) {
      return;
    }
    const generation = vaultGeneration.current;
    await refreshWorkspace();
    await rebuildSearchIndex(generation);
  }, [rebuildSearchIndex, refreshWorkspace, workspace]);

  const createEntry = useCallback(
    async (directory: boolean) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const parentPath =
        selectedNode?.kind === "folder"
          ? selectedNode.path
          : selectedPath?.split("/").slice(0, -1).join("/") || "";
      const suggested = directory ? "New folder" : "Untitled.md";
      const entered = await requestText({
        title: directory ? "Create folder" : "Create note",
        message: directory
          ? "Choose a name for the new folder."
          : "Choose a filename for the new Markdown note.",
        initialValue: suggested,
        confirmLabel: "Create",
      });
      if (!entered) {
        return;
      }
      const name =
        !directory && !/\.(?:md|markdown|txt)$/i.test(entered)
          ? `${entered}.md`
          : entered;
      try {
        const path = await api.createEntry(parentPath, name, directory);
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
      requestText,
      selectedNode,
      selectedPath,
      showError,
      workspace,
    ],
  );

  const renameSelected = useCallback(async () => {
    if (!workspace || !selectedNode || workspaceLockedRef.current) {
      return;
    }
    const newName = await requestText({
      title: "Rename item",
      message: `Choose a new name for ${selectedNode.name}.`,
      initialValue: selectedNode.name,
      confirmLabel: "Rename",
    });
    if (!newName || newName === selectedNode.name) {
      return;
    }
    try {
      if (!(await beginWorkspaceOperation())) {
        return;
      }
      const affectedTabs = tabsRef.current.filter(
        (tab) =>
          tab.path === selectedNode.path ||
          tab.path.startsWith(`${selectedNode.path}/`),
      );
      for (const tab of affectedTabs) {
        if (!(await flushTab(tab.path))) {
          setStatus("Rename cancelled because a note could not be saved");
          return;
        }
      }
      const newPath = await api.renameEntry(selectedNode.path, newName);
      const oldPath = selectedNode.path;
      const replacePrefix = (path: string) =>
        path === oldPath || path.startsWith(`${oldPath}/`)
          ? `${newPath}${path.slice(oldPath.length)}`
          : path;
      commitTabs((current) =>
        current.map((tab) => {
          const path = replacePrefix(tab.path);
          const renamedKind = kindFromPath(path);
          return {
            ...tab,
            path,
            title: path.split("/").slice(-1)[0] ?? path,
            kind:
              renamedKind && renamedKind !== "folder" ? renamedKind : tab.kind,
          };
        }),
      );
      setActivePath((current) => (current ? replacePrefix(current) : current));
      setSelectedPath(newPath);
      for (const tab of affectedTabs) {
        cancelPendingPath(tab.path);
      }
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    } finally {
      setWorkspaceLock(false);
    }
  }, [
    cancelPendingPath,
    beginWorkspaceOperation,
    commitTabs,
    flushTab,
    refreshAndReindex,
    requestText,
    selectedNode,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const trashSelected = useCallback(async () => {
    if (!workspace || !selectedNode || workspaceLockedRef.current) {
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Move to trash",
        message: `Move “${selectedNode.name}” to Denote Trash? It can be restored later.`,
        confirmLabel: "Move to trash",
        dangerous: true,
      }))
    ) {
      return;
    }
    try {
      if (!(await beginWorkspaceOperation())) {
        return;
      }
      const affectedTabs = tabsRef.current.filter(
        (tab) =>
          tab.path === selectedNode.path ||
          tab.path.startsWith(`${selectedNode.path}/`),
      );
      for (const tab of affectedTabs) {
        if (!(await flushTab(tab.path))) {
          setStatus("Trash cancelled because a note could not be saved");
          return;
        }
      }
      await api.trashEntry(selectedNode.path);
      const isAffected = (path: string) =>
        path === selectedNode.path ||
        path.startsWith(`${selectedNode.path}/`);
      commitTabs((current) => current.filter((tab) => !isAffected(tab.path)));
      for (const tab of affectedTabs) {
        cancelPendingPath(tab.path);
      }
      if (activePath && isAffected(activePath)) {
        setActivePath(null);
      }
      setSelectedPath(null);
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    } finally {
      setWorkspaceLock(false);
    }
  }, [
    activePath,
    beginWorkspaceOperation,
    cancelPendingPath,
    commitTabs,
    flushTab,
    refreshAndReindex,
    requestConfirmation,
    selectedNode,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const toggleBookmark = useCallback(async () => {
    if (
      !workspace ||
      !selectedNode ||
      selectedNode.kind === "folder" ||
      workspaceLockedRef.current
    ) {
      return;
    }
    try {
      await api.setBookmark(selectedNode.path, !selectedNode.bookmarked);
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    }
  }, [refreshAndReindex, selectedNode, showError, workspace]);

  const moveSelected = useCallback(
    async (direction: -1 | 1) => {
      if (!workspace || !selectedNode || workspaceLockedRef.current) {
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
        await api.setEntryOrder(reordered.map((node) => node.path));
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
        const restoredPath = await api.restoreTrashItem(itemId);
        await refreshAndReindex();
        setSidebarView("files");
        setSelectedPath(restoredPath);
      } catch (caught) {
        showError(caught);
      }
    },
    [refreshAndReindex, showError, workspace],
  );

  const emptyTrash = useCallback(async () => {
    if (
      !workspace ||
      workspace.trash.length === 0 ||
      workspaceLockedRef.current
    ) {
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Empty trash permanently",
        message:
          "Permanently delete every item in Denote Trash? This cannot be undone.",
        confirmLabel: "Empty trash",
        dangerous: true,
      }))
    ) {
      return;
    }
    try {
      if (!(await beginWorkspaceOperation())) {
        return;
      }
      const removed = await api.emptyTrash();
      await refreshAndReindex();
      setStatus(`Permanently deleted ${removed} trash item${removed === 1 ? "" : "s"}`);
    } catch (caught) {
      showError(caught);
    } finally {
      setWorkspaceLock(false);
    }
  }, [
    beginWorkspaceOperation,
    refreshAndReindex,
    requestConfirmation,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const openHistory = useCallback(async () => {
    if (!workspace || !activeTab || activeTab.kind === "image") {
      return;
    }
    if (workspaceLockedRef.current) {
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistoryRevisions(await api.listHistory(activeTab.path));
    } catch (caught) {
      showError(caught);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeTab, showError, workspace]);

  const previewReplace = useCallback(
    async (request: ReplaceRequest): Promise<ReplacePreview[]> => {
      if (!workspace) {
        throw new Error("Open a vault before previewing replacements.");
      }
      if (!(await beginWorkspaceOperation())) {
        throw new Error("Unable to save open notes before building the preview.");
      }
      try {
        if (request.scope === "current") {
          const tab = tabsRef.current.find(
            (candidate) => candidate.path === activePathRef.current,
          );
          if (!tab || tab.kind === "image") {
            throw new Error(
              "Open an editable note before previewing replacements.",
            );
          }
          return previewReplacements(
            [
              {
                path: tab.path,
                content: tab.content,
                contentHash: tab.savedHash,
              },
            ],
            request,
          );
        }
        const documents = await api.listSearchDocuments();
        return previewReplacements(
          documents
            .filter(
              (document) =>
                document.kind === "markdown" || document.kind === "text",
            )
            .map((document) => ({
              path: document.path,
              content: document.content,
              contentHash: document.contentHash,
            })),
          request,
        );
      } catch (caught) {
        throw new Error(errorMessage(caught));
      } finally {
        setWorkspaceLock(false);
      }
    },
    [beginWorkspaceOperation, setWorkspaceLock, showError, workspace],
  );

  const applyReplace = useCallback(
    async (
      request: ReplaceRequest,
      previews: ReplacePreview[],
    ): Promise<ReplaceApplySummary> => {
      const emptySummary: ReplaceApplySummary = {
        appliedFiles: 0,
        failedFiles: previews.length,
        replacedOccurrences: 0,
      };
      if (!workspace) {
        return emptySummary;
      }
      let resolveCriticalOperation: () => void = () => {};
      const criticalOperation = new Promise<void>((resolve) => {
        resolveCriticalOperation = resolve;
      });
      criticalOperations.current.add(criticalOperation);
      let appliedFiles = 0;
      let failedFiles = 0;
      let replacedOccurrences = 0;
      const applied = new Map<
        string,
        {
          content: string;
          contentHash: string;
          stats: EditorTab["stats"];
        }
      >();
      try {
        if (!(await beginWorkspaceOperation())) {
          return emptySummary;
        }
        const candidates =
          request.scope === "current"
            ? (() => {
                const previewPath = previews[0]?.path;
                const tab = tabsRef.current.find(
                  (candidate) => candidate.path === previewPath,
                );
                if (!tab || tab.kind === "image") {
                  return [];
                }
                return previewReplacements(
                  [
                    {
                      path: tab.path,
                      content: tab.content,
                      contentHash: tab.savedHash,
                    },
                  ],
                  request,
                );
              })()
            : previews;

        for (const preview of candidates) {
          try {
            const outcome = await api.saveNote(
              preview.path,
              preview.replacedContent,
              request.scope === "current"
                ? "replace in note"
                : "replace across vault",
              preview.contentHash,
            );
            let stats = outcome.stats;
            try {
              stats = await api.recordEdit(preview.path);
            } catch (caught) {
              showError(caught);
            }
            applied.set(preview.path, {
              content: preview.replacedContent,
              contentHash: outcome.contentHash,
              stats,
            });
            appliedFiles += 1;
            replacedOccurrences += preview.occurrences;
          } catch (caught) {
            failedFiles += 1;
            showError(caught);
          }
        }

        commitTabs((current) =>
          current.map((tab) => {
            const replacement = applied.get(tab.path);
            return replacement
              ? {
                  ...tab,
                  content: replacement.content,
                  savedContent: replacement.content,
                  savedHash: replacement.contentHash,
                  stats: replacement.stats,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab;
          }),
        );
        const activeReplacement = activePathRef.current
          ? applied.get(activePathRef.current)
          : undefined;
        if (activeReplacement && editorRef.current) {
          editorRef.current.setMarkdown(
            calloutsToDirectives(activeReplacement.content),
          );
        }
        await refreshAndReindex();
        setStatus(
          `Replaced ${replacedOccurrences} occurrence${
            replacedOccurrences === 1 ? "" : "s"
          } in ${appliedFiles} file${appliedFiles === 1 ? "" : "s"}`,
        );
        return { appliedFiles, failedFiles, replacedOccurrences };
      } finally {
        setWorkspaceLock(false);
        criticalOperations.current.delete(criticalOperation);
        resolveCriticalOperation();
      }
    },
    [
      beginWorkspaceOperation,
      commitTabs,
      refreshAndReindex,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  const reloadActiveTab = useCallback(async () => {
    if (!activeTab || workspaceLockedRef.current) {
      return;
    }
    if (
      activeTab.kind !== "image" &&
      activeTab.content !== activeTab.savedContent &&
      !(await requestConfirmation({
        title: "Reload from disk",
        message:
          "Discard the unsaved editor content and reload the current file from disk?",
        confirmLabel: "Reload",
        dangerous: true,
      }))
    ) {
      return;
    }
    setWorkspaceLock(true);
    const path = activeTab.path;
    try {
      const timer = saveTimers.current.get(path);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(path);
      }
      const pendingSave = saveQueues.current.get(path);
      if (pendingSave) {
        await pendingSave;
      }
      cancelPendingPath(path);
      if (activeTab.kind === "image") {
        const imageDataUrl = await api.readImageDataUrl(path);
        commitTabs((current) =>
          current.map((tab) =>
            tab.path === path ? { ...tab, imageDataUrl, saveState: "saved" } : tab,
          ),
        );
      } else {
        const document = await api.readNote(path);
        commitTabs((current) =>
          current.map((tab) =>
            tab.path === path
              ? {
                  ...tab,
                  content: document.content,
                  savedContent: document.content,
                  savedHash: document.contentHash,
                  stats: document.stats,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab,
          ),
        );
        if (activePathRef.current === path) {
          editorRef.current?.setMarkdown(calloutsToDirectives(document.content));
        }
      }
      setStatus("Reloaded from disk");
      scheduleIndexRebuild();
    } catch (caught) {
      showError(caught);
    } finally {
      setWorkspaceLock(false);
    }
  }, [
    activeTab,
    cancelPendingPath,
    commitTabs,
    requestConfirmation,
    scheduleIndexRebuild,
    setWorkspaceLock,
    showError,
  ]);

  const restoreRevision = useCallback(
    async (revisionId: number) => {
      if (!workspace || !activeTab || activeTab.kind === "image") {
        return;
      }
      if (workspaceLockedRef.current) {
        return;
      }
      const restorePath = activeTab.path;
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        if (!(await flushTab(restorePath))) {
          setStatus("Restore cancelled because the note could not be saved");
          return;
        }
        const document = await api.restoreRevision(restorePath, revisionId);
        commitTabs((current) =>
          current.map((tab) =>
            tab.path === restorePath
              ? {
                  ...tab,
                  content: document.content,
                  savedContent: document.content,
                  savedHash: document.contentHash,
                  stats: document.stats,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab,
          ),
        );
        if (activePathRef.current === restorePath) {
          editorRef.current?.setMarkdown(calloutsToDirectives(document.content));
        }
        setHistoryOpen(false);
        setStatus("Revision restored");
        scheduleIndexRebuild();
      } catch (caught) {
        showError(caught);
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      activeTab,
      beginWorkspaceOperation,
      commitTabs,
      flushTab,
      scheduleIndexRebuild,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  const openLink = useCallback(
    async (href: string, linkText = "") => {
      if (!activeTab || !href) {
        return;
      }
      try {
        const target =
          recoverMarkdownLinkTarget(activeTab.content, linkText, href) ?? href;
        if (/^(https?:|mailto:|tel:)/i.test(target)) {
          await openUrl(target);
          return;
        }
        if (target.startsWith("file://")) {
          await openPath(fileUrlToPath(target));
          return;
        }
        const resolved = resolveInternalLink(
          activeTab.path,
          target,
          allFiles
            .filter((node) => node.kind !== "folder")
            .map((node) => node.path),
        );
        if (!resolved) {
          showError(`Link target not found: ${target}`);
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
      if (
        workspaceLockedRef.current ||
        replaceOpen ||
        actionDialog !== null ||
        historyOpen
      ) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        setSidebarView("search");
        window.setTimeout(
          () => document.querySelector<HTMLInputElement>(".search-box input")?.focus(),
          0,
        );
      } else if (isReplaceShortcut(event, navigator.platform)) {
        event.preventDefault();
        setReplaceOpen(true);
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
      } else if (event.key === "Escape" && showOutline) {
        setShowOutline(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    actionDialog,
    activePath,
    activeTab,
    closeTab,
    historyOpen,
    replaceOpen,
    saveTab,
    showOutline,
    tabs,
  ]);

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
              <div className="sidebar-view__actions">
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  aria-label="Empty trash permanently"
                  title="Empty trash permanently"
                  disabled={workspace.trash.length === 0}
                  onClick={() => void emptyTrash()}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Refresh trash"
                  onClick={() => void refreshWorkspace()}
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
              </div>
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
      <section
        className="workspace-main"
        id="editor-workspace"
        tabIndex={-1}
        data-locked={workspaceLocked}
        aria-busy={workspaceLocked}
      >
        <header className="workspace-topbar">
          <Tabs
            tabs={tabs}
            activePath={activePath}
            disabled={workspaceLocked}
            onActivate={setActivePath}
            onClose={(path) => void closeTab(path)}
          />
          <div className="workspace-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Find and replace"
              title={`Find and replace (${
                navigator.platform.includes("Mac") ? "⌥⌘F" : "Ctrl+H"
              })`}
              disabled={workspaceLocked}
              onClick={() => setReplaceOpen(true)}
            >
              <ReplaceIcon aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Reload active file from disk"
              title="Reload active file from disk"
              disabled={!activeTab || workspaceLocked}
              onClick={() => void reloadActiveTab()}
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
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
              aria-label={`${
                showOutline && activeTab?.kind === "markdown" ? "Hide" : "Show"
              } outline`}
              title={`${
                showOutline && activeTab?.kind === "markdown" ? "Hide" : "Show"
              } outline`}
              aria-pressed={activeTab?.kind === "markdown" && showOutline}
              disabled={!activeTab || activeTab.kind !== "markdown"}
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
                    readOnly={workspaceLocked}
                    spellCheck
                    onChange={(event) =>
                      changeActiveContent(event.currentTarget.value)
                    }
                  />
                ) : (
                  <MarkdownEditor
                    key={activeTab.path}
                    ref={editorRef}
                    notePath={activeTab.path}
                    markdown={activeTab.content}
                    readOnly={workspaceLocked}
                    onChange={changeActiveContent}
                    onError={showError}
                    onLinkOpen={(href, text) => void openLink(href, text)}
                    onImageUpload={uploadAttachment}
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
        <footer className="status-bar">
          <span>{activeTab?.path ?? workspace.vaultPath}</span>
          <span className="status-bar__spacer" />
          {activeTab && activeTab.kind !== "image" ? (
            <>
              <span>{wordCount(activeTab.content)} words</span>
              <span>{activeTab.content.length} characters</span>
              <span>
                {activeTab.stats
                  ? `${activeTab.stats.openCount} opens · ${activeTab.stats.editCount} edits · ${activeTab.stats.saveCount} saves`
                  : "UTF-8"}
              </span>
              <span data-save-state={activeTab.saveState}>
                {activeTab.saveState}
              </span>
            </>
          ) : null}
          <span>{status}</span>
        </footer>
        <span className="sr-only" role="status" aria-live="polite">
          {status}
        </span>
      </section>
      <HistoryDialog
        open={historyOpen}
        title={activeTab?.title ?? "Note"}
        revisions={historyRevisions}
        loading={historyLoading}
        onClose={() => setHistoryOpen(false)}
        onRestore={(revisionId) => void restoreRevision(revisionId)}
      />
      <ReplaceDialog
        open={replaceOpen}
        currentPath={
          activeTab && activeTab.kind !== "image" ? activeTab.path : null
        }
        onClose={() => setReplaceOpen(false)}
        onPreview={previewReplace}
        onApply={applyReplace}
      />
      <ActionDialog
        open={actionDialog !== null}
        mode={actionDialog?.mode ?? "confirm"}
        title={actionDialog?.title ?? ""}
        message={actionDialog?.message ?? ""}
        initialValue={actionDialog?.initialValue ?? ""}
        confirmLabel={actionDialog?.confirmLabel ?? "Continue"}
        dangerous={actionDialog?.dangerous ?? false}
        onConfirm={(value) => finishActionDialog(value)}
        onCancel={() => finishActionDialog(null)}
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

function fileUrlToPath(value: string): string {
  const url = new URL(value);
  let path = decodeURIComponent(
    url.host ? `//${url.host}${url.pathname}` : url.pathname,
  );
  if (/^\/[a-z]:\//i.test(path)) {
    path = path.slice(1);
  }
  return path;
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
