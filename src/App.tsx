import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  ChevronsUpDown,
  ClipboardCopy,
  Copy,
  FileCode2,
  FilePlus2,
  FolderPlus,
  History,
  Image as ImageIcon,
  ListTree,
  Pencil,
  Paperclip,
  Pin,
  PinOff,
  RefreshCw,
  Replace as ReplaceIcon,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ActivityRail } from "./components/ActivityRail";
import { ActionDialog } from "./components/ActionDialog";
import { EncryptionDialog } from "./components/EncryptionDialog";
import { EditorSettingsDialog } from "./components/EditorSettingsDialog";
import { FileTree } from "./components/FileTree";
import { SidebarResizer } from "./components/SidebarResizer";
import { HistoryDialog } from "./components/HistoryDialog";
import { GlobalSearchDialog } from "./components/GlobalSearchDialog";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { PlainTextEditor } from "./components/PlainTextEditor";
import { ReplaceDialog } from "./components/ReplaceDialog";
import { SearchPanel } from "./components/SearchPanel";
import { TableOfContents } from "./components/TableOfContents";
import { TagChip } from "./components/TagChip";
import { Tabs } from "./components/Tabs";
import { VaultUnlockScreen } from "./components/VaultUnlockScreen";
import { VaultSwitcherDialog } from "./components/VaultSwitcherDialog";
import { Welcome } from "./components/Welcome";
import { api, errorMessage } from "./lib/api";
import {
  extractHeadings,
  extractTags,
  recoverMarkdownLinkTarget,
  resolveInternalLink,
  slugifyHeading,
} from "./lib/markdown";
import {
  getMarkdownViewMode,
  saveMarkdownViewMode,
  type MarkdownViewMode,
} from "./lib/markdownView";
import { VaultSearchIndex } from "./lib/search";
import { resolveTagColor, type TagColorMap } from "./lib/tagColors";
import {
  isGlobalSearchShortcut,
  isNewFileShortcut,
  isReplaceShortcut,
  isSearchShortcut,
} from "./lib/shortcuts";
import {
  previewReplacements,
  type ReplaceApplySummary,
  type ReplacePreview,
  type ReplaceRequest,
} from "./lib/replace";
import { applyTheme, getTheme, type Theme } from "./lib/theme";
import { getSidebarWidth, saveSidebarWidth } from "./lib/sidebarWidth";
import {
  editorDisplaySettingsKey,
  getEditorDisplaySettings,
  saveEditorDisplaySettings,
  type EditorDisplaySettings,
} from "./lib/editorDisplay";
import {
  externalLinkTarget,
  hasUriScheme,
  isExternalLink,
} from "./lib/links";
import type {
  EditorTab,
  FileNode,
  HeadingItem,
  HistoryRevision,
  KnownVaultFile,
  SearchResult,
  SidebarView,
  TagColor,
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
  const [editorSettingsOpen, setEditorSettingsOpen] = useState(false);
  const [editorDisplaySettings, setEditorDisplaySettings] =
    useState<EditorDisplaySettings>(() => getEditorDisplaySettings());
  const [markdownViewMode, setMarkdownViewMode] =
    useState<MarkdownViewMode>(() => getMarkdownViewMode());
  const [encryptionOpen, setEncryptionOpen] = useState(false);
  const [vaultSwitcherOpen, setVaultSwitcherOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => getSidebarWidth());
  const [workspaceLocked, setWorkspaceLocked] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null,
  );
  const [historyRevisions, setHistoryRevisions] = useState<HistoryRevision[]>(
    [],
  );
  const searchIndex = useRef(new VaultSearchIndex());
  const searchIndexReady = useRef(false);
  const searchQueryRef = useRef(searchQuery);
  const rebuildRequest = useRef(0);
  const workspaceRefreshRequest = useRef(0);
  const queryRequest = useRef(0);
  const tabsRef = useRef<EditorTab[]>([]);
  const saveTimers = useRef(new Map<string, number>());
  const saveQueues = useRef(new Map<string, Promise<boolean>>());
  const saveGenerations = useRef(new Map<string, number>());
  const editQueues = useRef(new Map<string, Promise<boolean>>());
  const viewModeQueues = useRef(new Map<string, Promise<boolean>>());
  const viewModeWrites = useRef(new Set<Promise<boolean>>());
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
  const pendingDefaultWelcome = useRef<string | null>(null);
  const pendingWorkspaceFile = useRef<{
    vaultPath: string;
    path: string;
  } | null>(null);
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
  const selectedMoveAvailability = useMemo(() => {
    if (!workspace || !selectedNode) {
      return { up: false, down: false };
    }
    const siblings = findSiblings(workspace.tree, selectedNode.path);
    const index = siblings.findIndex((node) => node.path === selectedNode.path);
    return {
      up: index > 0 && siblings[index - 1].pinned === selectedNode.pinned,
      down:
        index >= 0 &&
        index < siblings.length - 1 &&
        siblings[index + 1].pinned === selectedNode.pinned,
    };
  }, [selectedNode, workspace]);
  const headings = useMemo(
    () =>
      activeTab &&
      activeTab.kind === "markdown" &&
      activeTab.encoding === "utf8"
        ? extractHeadings(activeTab.content)
        : [],
    [activeTab],
  );
  const tags = useMemo(
    () =>
      activeTab &&
      activeTab.encoding === "utf8" &&
      (activeTab.kind !== "image" || activeTab.rawEditing)
        ? extractTags(activeTab.content)
        : [],
    [activeTab],
  );
  const tagColorMap = useMemo<TagColorMap>(
    () =>
      Object.fromEntries(
        (workspace?.tagColors ?? []).map(({ tag, color }) => [tag, color]),
      ),
    [workspace?.tagColors],
  );
  const editorDisplayKey = editorDisplaySettingsKey(editorDisplaySettings);

  const showError = useCallback((value: unknown) => {
    const message = errorMessage(value);
    setError(message);
    setStatus("Action failed");
  }, []);

  const updateEditorDisplaySettings = useCallback(
    (settings: EditorDisplaySettings) => {
      try {
        saveEditorDisplaySettings(settings);
        setEditorDisplaySettings(settings);
        setStatus("Editor display settings updated");
      } catch (caught) {
        showError(caught);
      }
    },
    [showError],
  );

  const updateMarkdownViewMode = useCallback(
    (path: string, mode: MarkdownViewMode) => {
      try {
        saveMarkdownViewMode(mode);
        setMarkdownViewMode(mode);
        commitTabs((current) =>
          current.map((tab) => (tab.path === path ? { ...tab, viewMode: mode } : tab)),
        );
        const generation = vaultGeneration.current;
        const previous =
          viewModeQueues.current.get(path) ?? Promise.resolve(true);
        const write = previous
          .then(() => api.setNoteViewMode(path, mode))
          .then(() => true)
          .catch((caught) => {
            if (generation === vaultGeneration.current) {
              showError(caught);
            } else {
              console.error(`Unable to save the view mode for ${path}:`, caught);
            }
            return false;
          });
        viewModeQueues.current.set(path, write);
        viewModeWrites.current.add(write);
        void write.finally(() => {
          viewModeWrites.current.delete(write);
          if (viewModeQueues.current.get(path) === write) {
            viewModeQueues.current.delete(path);
          }
        });
      } catch (caught) {
        showError(caught);
      }
    },
    [commitTabs, showError],
  );

  const updateTagColor = useCallback(
    async (tag: string, color: string) => {
      const generation = vaultGeneration.current;
      try {
        const saved = await api.setTagColor(tag, color);
        if (generation !== vaultGeneration.current) {
          return;
        }
        setWorkspace((current) =>
          current
            ? {
                ...current,
                tagColors: upsertTagColor(current.tagColors, saved),
              }
            : current,
        );
        setStatus(`Updated #${saved.tag} color`);
      } catch (caught) {
        if (generation === vaultGeneration.current) {
          showError(caught);
        }
      }
    },
    [showError],
  );

  const rebuildSearchIndex = useCallback(
    async (generation = vaultGeneration.current) => {
      const request = ++rebuildRequest.current;
      searchIndexReady.current = false;
      setIndexing(true);
      try {
        const batch = await api.listSearchDocuments();
        if (
          generation !== vaultGeneration.current ||
          request !== rebuildRequest.current
        ) {
          return;
        }
        const nextIndex = new VaultSearchIndex();
        await nextIndex.rebuild(batch.documents);
        if (
          generation !== vaultGeneration.current ||
          request !== rebuildRequest.current
        ) {
          return;
        }
        searchIndex.current = nextIndex;
        searchIndexReady.current = true;
        const query = searchQueryRef.current;
        const results = await nextIndex.query(query);
        if (
          generation === vaultGeneration.current &&
          request === rebuildRequest.current &&
          query === searchQueryRef.current
        ) {
          setSearchResults(results);
          if (batch.skippedCount > 0 || batch.truncated) {
            setStatus(
              `Search skipped ${batch.skippedCount} file${
                batch.skippedCount === 1 ? "" : "s"
              }${batch.truncated ? " and stopped at the 64 MB index limit" : ""}`,
            );
          }
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

  const refreshCachedWorkspace = useCallback(
    async (generation: number) => {
      const request = ++workspaceRefreshRequest.current;
      try {
        const snapshot = await api.refreshVault();
        if (
          generation !== vaultGeneration.current ||
          request !== workspaceRefreshRequest.current
        ) {
          return;
        }
        setWorkspace(snapshot);
        await rebuildSearchIndex(generation);
      } catch (caught) {
        if (
          generation === vaultGeneration.current &&
          request === workspaceRefreshRequest.current
        ) {
          setIndexing(false);
          showError(caught);
        }
      }
    },
    [rebuildSearchIndex, showError],
  );

  const loadWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, resetTabs: boolean) => {
      const vaultLocked =
        snapshot.encryption.enabled && !snapshot.encryption.unlocked;
      if (indexTimer.current) {
        window.clearTimeout(indexTimer.current);
        indexTimer.current = null;
      }
      rebuildRequest.current += 1;
      workspaceRefreshRequest.current += 1;
      queryRequest.current += 1;
      searchIndex.current = new VaultSearchIndex();
      searchIndexReady.current = false;
      setSearchResults([]);
      if (resetTabs || vaultLocked) {
        setSearchQuery("");
        setHistoryOpen(false);
        setHistoryRevisions([]);
        setReplaceOpen(false);
        setEncryptionOpen(false);
        setEditorSettingsOpen(false);
        setVaultSwitcherOpen(false);
        setGlobalSearchOpen(false);
        pendingAnchor.current = null;
      }
      if (resetTabs) {
        if (
          pendingWorkspaceFile.current &&
          pendingWorkspaceFile.current.vaultPath !== snapshot.vaultPath
        ) {
          pendingWorkspaceFile.current = null;
        }
        const welcome = findNode(snapshot.tree, "Welcome.md");
        pendingDefaultWelcome.current =
          !pendingWorkspaceFile.current &&
          snapshot.default &&
          welcome !== null &&
          welcome.kind !== "folder"
            ? "Welcome.md"
            : null;
      }
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
      if (resetTabs || vaultLocked) {
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
        viewModeQueues.current.clear();
        viewModeWrites.current.clear();
        commitTabs(() => []);
        setActivePath(null);
      }
      if (vaultLocked) {
        setStatus(`${snapshot.vaultName} is locked`);
      } else {
        setStatus(`Opened ${snapshot.vaultName}`);
        const generation = vaultGeneration.current;
        if (snapshot.fromCache) {
          setIndexing(true);
          void refreshCachedWorkspace(generation);
        } else {
          void rebuildSearchIndex(generation);
        }
      }
    },
    [commitTabs, rebuildSearchIndex, refreshCachedWorkspace],
  );

  const refreshWorkspace = useCallback(async (reindex = false) => {
    if (!workspace) {
      return;
    }
    const generation = vaultGeneration.current;
    const request = ++workspaceRefreshRequest.current;
    try {
      const snapshot = await api.refreshVault();
      if (
        generation === vaultGeneration.current &&
        request === workspaceRefreshRequest.current
      ) {
        setWorkspace(snapshot);
        if (reindex || !searchIndexReady.current) {
          await rebuildSearchIndex(generation);
        }
      }
    } catch (caught) {
      if (
        generation === vaultGeneration.current &&
        request === workspaceRefreshRequest.current
      ) {
        setIndexing(false);
        showError(caught);
      }
    }
  }, [rebuildSearchIndex, showError, workspace]);

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
    setVaultSwitcherOpen(false);
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

  const switchKnownVault = useCallback(
    async (vaultId: number, filePath?: string) => {
      if (workspaceLockedRef.current) {
        throw new Error("Workspace is busy. Try switching vaults again.");
      }
      setInitializing(true);
      try {
        if (!(await beginWorkspaceOperationRef.current())) {
          throw new Error(
            "Vault switch cancelled because a note could not be saved.",
          );
        }
        const snapshot = await api.openKnownVault(vaultId);
        const pendingFile = filePath
          ? { vaultPath: snapshot.vaultPath, path: filePath }
          : null;
        if (pendingFile) {
          pendingWorkspaceFile.current = pendingFile;
        }
        vaultGeneration.current += 1;
        try {
          await loadWorkspace(snapshot, true);
        } catch (caught) {
          if (pendingWorkspaceFile.current === pendingFile) {
            pendingWorkspaceFile.current = null;
          }
          throw caught;
        }
      } finally {
        setInitializing(false);
        setWorkspaceLock(false);
      }
    },
    [loadWorkspace, setWorkspaceLock],
  );

  const deleteKnownVault = useCallback(
    async (vaultId: number, trashFiles: boolean) => {
      await api.deleteKnownVault(vaultId, trashFiles);
      setStatus(
        trashFiles
          ? "Moved vault folder to system Trash"
          : "Removed vault from recent list",
      );
    },
    [],
  );

  const applyEncryptionSnapshot = useCallback(
    async (snapshot: WorkspaceSnapshot, resetTabs: boolean) => {
      vaultGeneration.current += 1;
      await loadWorkspace(snapshot, resetTabs);
    },
    [loadWorkspace],
  );

  const enableVaultEncryption = useCallback(
    async (password: string): Promise<string[]> => {
      if (!(await beginWorkspaceOperationRef.current())) {
        throw new Error("Encryption cancelled because a file could not be saved.");
      }
      try {
        const result = await api.enableVaultEncryption(password);
        await applyEncryptionSnapshot(result.snapshot, false);
        setStatus("Vault encryption enabled");
        return result.recoveryCodes;
      } catch (caught) {
        try {
          const snapshot = await api.refreshVault();
          if (snapshot.encryption.enabled) {
            const lockedSnapshot = await api.lockVault();
            await applyEncryptionSnapshot(lockedSnapshot, true);
          }
        } catch (recoveryError) {
          console.error(
            "Unable to lock the vault after encryption failed:",
            recoveryError,
          );
        }
        showError(caught);
        throw caught;
      } finally {
        setWorkspaceLock(false);
      }
    },
    [applyEncryptionSnapshot, setWorkspaceLock, showError],
  );

  const lockEncryptedVault = useCallback(async () => {
    if (!(await beginWorkspaceOperationRef.current())) {
      throw new Error("Lock cancelled because a file could not be saved.");
    }
    try {
      const snapshot = await api.lockVault();
      setEncryptionOpen(false);
      await applyEncryptionSnapshot(snapshot, true);
    } finally {
      setWorkspaceLock(false);
    }
  }, [applyEncryptionSnapshot, setWorkspaceLock]);

  const unlockEncryptedVault = useCallback(
    async (credential: string, recovery: boolean) => {
      const snapshot = recovery
        ? await api.unlockVaultWithRecoveryCode(credential)
        : await api.unlockVaultWithPassword(credential);
      await applyEncryptionSnapshot(snapshot, true);
      setStatus(
        recovery
          ? "Vault unlocked; recovery code consumed"
          : "Vault unlocked",
      );
    },
    [applyEncryptionSnapshot],
  );

  const changeVaultPassword = useCallback(async (password: string) => {
    await api.changeVaultPassword(password);
    setStatus("Vault password changed");
  }, []);

  const regenerateRecoveryCodes = useCallback(async (): Promise<string[]> => {
    const result = await api.regenerateVaultRecoveryCodes();
    const snapshot = await api.refreshVault();
    setWorkspace(snapshot);
    setStatus("Recovery codes replaced");
    return result.recoveryCodes;
  }, []);

  const disableVaultEncryption = useCallback(async () => {
    if (!(await beginWorkspaceOperationRef.current())) {
      throw new Error("Decryption cancelled because a file could not be saved.");
    }
    try {
      const snapshot = await api.disableVaultEncryption();
      await applyEncryptionSnapshot(snapshot, false);
      setStatus("Vault decrypted; encryption disabled");
    } catch (caught) {
      try {
        const lockedSnapshot = await api.lockVault();
        await applyEncryptionSnapshot(lockedSnapshot, true);
      } catch (recoveryError) {
        console.error(
          "Unable to lock the vault after decryption failed:",
          recoveryError,
        );
      }
      showError(caught);
      throw caught;
    } finally {
      setWorkspaceLock(false);
    }
  }, [applyEncryptionSnapshot, setWorkspaceLock, showError]);

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
            const currentTab = tabsRef.current.find(
              (tab) => tab.path === path,
            );
            const outcome = await api.saveNote(
              path,
              content,
              currentTab?.encoding ?? "utf8",
              currentTab?.lineEnding ?? "lf",
              reason,
              currentTab?.savedHash,
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
            if (currentTab?.kind === "image") {
              try {
                const imageDataUrl = await api.readImageDataUrl(path);
                commitTabs((current) =>
                  current.map((tab) =>
                    tab.path === path ? { ...tab, imageDataUrl } : tab,
                  ),
                );
              } catch (caught) {
                showError(caught);
              }
            }
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
        if (!tab || tab.content === tab.savedContent) {
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
          (tab) => tab.content === tab.savedContent,
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
      const viewModes = await Promise.all([...viewModeWrites.current]);
      if (viewModes.some((saved) => !saved)) {
        return false;
      }
      setWorkspaceLock(true);
      if (
        attachmentUploads.current.size > 0 ||
        viewModeWrites.current.size > 0
      ) {
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
      if (kind === "folder") {
        showError(`Unable to find ${path}`);
        return;
      }
      const title = node?.name ?? path.split("/").slice(-1)[0] ?? path;
      const generation = vaultGeneration.current;
      setStatus(`Opening ${title}…`);
      try {
        const tab: EditorTab =
          kind === "image"
            ? await Promise.all([
                api.readNote(path),
                api.readImageDataUrl(path),
              ]).then(([document, imageDataUrl]) => ({
                path,
                title,
                kind: "image" as const,
                content: document.content,
                savedContent: document.content,
                savedHash: document.contentHash,
                encoding: document.encoding,
                lineEnding: document.lineEnding,
                viewMode: document.viewMode ?? markdownViewMode,
                imageDataUrl,
                rawEditing: false,
                editorRevision: 0,
                stats: document.stats,
                editRecorded: false,
                saveState: "saved" as const,
              }))
            : await api.readNote(path).then((document) => ({
                path,
                title,
                kind,
                content: document.content,
                savedContent: document.content,
                savedHash: document.contentHash,
                encoding: document.encoding,
                lineEnding: document.lineEnding,
                viewMode: document.viewMode ?? markdownViewMode,
                rawEditing: false,
                editorRevision: 0,
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
        setWorkspace((current) =>
          current
            ? withRecentlyOpened(
                current,
                path,
                title,
                tab.stats?.lastOpenedAt ?? null,
              )
            : current,
        );
        searchIndex.current.recordOpen(
          path,
          tab.stats?.lastOpenedAt ?? null,
        );
      } catch (caught) {
        if (generation === vaultGeneration.current) {
          showError(caught);
        }
      }
    },
    [
      commitTabs,
      showError,
      markdownViewMode,
      workspace,
    ],
  );

  const openKnownVaultFile = useCallback(
    async (file: KnownVaultFile) => {
      if (file.current && workspace) {
        if (workspace.encryption.enabled && !workspace.encryption.unlocked) {
          pendingWorkspaceFile.current = {
            vaultPath: workspace.vaultPath,
            path: file.path,
          };
          return;
        }
        await openFile(file.path);
        return;
      }
      await switchKnownVault(file.vaultId, file.path);
    },
    [openFile, switchKnownVault, workspace],
  );

  useEffect(() => {
    const pendingFile = pendingWorkspaceFile.current;
    if (
      pendingFile &&
      workspace &&
      !workspaceLocked &&
      pendingFile.vaultPath === workspace.vaultPath &&
      (!workspace.encryption.enabled || workspace.encryption.unlocked)
    ) {
      pendingWorkspaceFile.current = null;
      void openFile(pendingFile.path);
      return;
    }
    const welcomePath = pendingDefaultWelcome.current;
    if (
      !welcomePath ||
      !workspace ||
      (workspace.encryption.enabled && !workspace.encryption.unlocked)
    ) {
      return;
    }
    pendingDefaultWelcome.current = null;
    void openFile(welcomePath);
  }, [openFile, workspace, workspaceLocked]);

  const changeActiveContent = useCallback(
    (content: string) => {
      const currentTab = tabsRef.current.find(
        (candidate) => candidate.path === activePath,
      );
      if (
        !currentTab ||
        (currentTab.kind === "image" && !currentTab.rawEditing)
      ) {
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

  const reorderTabs = useCallback(
    (paths: string[]) => {
      commitTabs((current) => {
        const byPath = new Map(current.map((tab) => [tab.path, tab]));
        const ordered = paths
          .map((path) => byPath.get(path))
          .filter((tab): tab is EditorTab => tab !== undefined);
        const included = new Set(paths);
        return [
          ...ordered,
          ...current.filter((tab) => !included.has(tab.path)),
        ];
      });
      setStatus("Reordered tabs");
    },
    [commitTabs],
  );

  const refreshAndReindex = useCallback(async () => {
    if (!workspace) {
      return;
    }
    await refreshWorkspace(true);
  }, [refreshWorkspace, workspace]);

  const createEntry = useCallback(
    async (directory: boolean, parentOverride?: string) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const parentPath =
        parentOverride ??
        (selectedNode?.kind === "folder"
          ? selectedNode.path
          : selectedPath?.split("/").slice(0, -1).join("/") || "");
      const suggested = directory ? "New folder" : "Untitled.md";
      const entered = await requestText({
        title: directory ? "Create folder" : "Create file",
        message: directory
          ? "Choose a name for the new folder."
          : "Choose a filename. Files without an extension are created as Markdown.",
        initialValue: suggested,
        confirmLabel: "Create",
      });
      if (!entered) {
        return;
      }
      const name =
        !directory && !/\.[^./\\]+$/.test(entered)
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
            kind: renamedKind,
            rawEditing:
              renamedKind === "image" && tab.kind === "image"
                ? tab.rawEditing
                : false,
            imageDataUrl:
              renamedKind === "image" ? tab.imageDataUrl : undefined,
          };
        }),
      );
      for (const tab of affectedTabs) {
        const path = replacePrefix(tab.path);
        if (kindFromPath(path) === "image") {
          try {
            const imageDataUrl = await api.readImageDataUrl(path);
            commitTabs((current) =>
              current.map((candidate) =>
                candidate.path === path
                  ? { ...candidate, imageDataUrl }
                  : candidate,
              ),
            );
          } catch (caught) {
            commitTabs((current) =>
              current.map((candidate) =>
                candidate.path === path
                  ? { ...candidate, rawEditing: true }
                  : candidate,
              ),
            );
            showError(caught);
          }
        }
      }
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

  const togglePinned = useCallback(async () => {
    if (!workspace || !selectedNode || workspaceLockedRef.current) {
      return;
    }
    try {
      const pinned = !selectedNode.pinned;
      await api.setEntryPinned(selectedNode.path, pinned);
      await refreshWorkspace();
      setStatus(pinned ? "Pinned to top of folder" : "Unpinned from folder");
    } catch (caught) {
      showError(caught);
    }
  }, [refreshWorkspace, selectedNode, showError, workspace]);

  const moveSelected = useCallback(
    async (direction: -1 | 1) => {
      if (!workspace || !selectedNode || workspaceLockedRef.current) {
        return;
      }
      const siblings = findSiblings(workspace.tree, selectedNode.path);
      const index = siblings.findIndex((node) => node.path === selectedNode.path);
      const destination = index + direction;
      if (
        index < 0 ||
        destination < 0 ||
        destination >= siblings.length ||
        siblings[destination].pinned !== selectedNode.pinned
      ) {
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
        setStatus("Updated folder order");
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
    if (!workspace || !activeTab) {
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
          if (!tab || (tab.kind === "image" && !tab.rawEditing)) {
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
                encoding: tab.encoding,
                lineEnding: tab.lineEnding,
              },
            ],
            request,
          );
        }
        const batch = await api.listEditableDocuments();
        if (batch.truncated) {
          throw new Error(
            "Vault-wide replace exceeds the 256 MB preview limit. Use current-file replace or a smaller vault.",
          );
        }
        if (batch.skippedCount > 0) {
          throw new Error(
            `Vault-wide replace could not read ${batch.skippedCount} file${
              batch.skippedCount === 1 ? "" : "s"
            }. Fix access or file-size issues before replacing.`,
          );
        }
        return previewReplacements(
          batch.documents.map((document) => ({
              path: document.path,
              content: document.content,
              contentHash: document.contentHash,
              encoding: document.encoding,
              lineEnding: document.lineEnding,
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
                if (!tab || (tab.kind === "image" && !tab.rawEditing)) {
                  return [];
                }
                return previewReplacements(
                  [
                    {
                      path: tab.path,
                      content: tab.content,
                      contentHash: tab.savedHash,
                      encoding: tab.encoding,
                      lineEnding: tab.lineEnding,
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
              preview.encoding,
              preview.lineEnding,
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
                  editorRevision: tab.editorRevision + 1,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab;
          }),
        );
        for (const tab of tabsRef.current) {
          if (tab.kind === "image" && applied.has(tab.path)) {
            try {
              const imageDataUrl = await api.readImageDataUrl(tab.path);
              commitTabs((current) =>
                current.map((candidate) =>
                  candidate.path === tab.path
                    ? { ...candidate, imageDataUrl }
                    : candidate,
                ),
              );
            } catch (caught) {
              showError(caught);
            }
          }
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
        const [document, imageDataUrl] = await Promise.all([
          api.readNote(path),
          api.readImageDataUrl(path),
        ]);

        commitTabs((current) =>
          current.map((tab) =>
            tab.path === path
              ? {
                  ...tab,
                  content: document.content,
                  savedContent: document.content,
                  savedHash: document.contentHash,
                  encoding: document.encoding,
                  lineEnding: document.lineEnding,
                  imageDataUrl,
                  editorRevision: tab.editorRevision + 1,
                  editRecorded: false,
                  saveState: "saved",
                  stats: document.stats,
                }
              : tab,
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
                  encoding: document.encoding,
                  lineEnding: document.lineEnding,
                  stats: document.stats,
                  editorRevision: tab.editorRevision + 1,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab,
          ),
        );
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

  const copyActiveFilePath = useCallback(async () => {
    if (!activeTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFilePath(activeTab.path);
      setStatus("Copied file path");
    } catch (caught) {
      showError(caught);
    }
  }, [activeTab, showError]);

  const copyActiveFileContent = useCallback(async () => {
    if (!activeTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFileContent(activeTab.content);
      setStatus("Copied file content");
    } catch (caught) {
      showError(caught);
    }
  }, [activeTab, showError]);

  const copyActiveFileForAttachment = useCallback(async () => {
    if (!activeTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFileForAttachment(
        activeTab.path,
        activeTab.content,
        activeTab.encoding,
        activeTab.lineEnding,
      );
      setStatus(
        workspace?.encryption.enabled
          ? "Copied temporary plaintext file for attachment"
          : "Copied file for attachment",
      );
    } catch (caught) {
      showError(caught);
    }
  }, [activeTab, showError, workspace?.encryption.enabled]);

  const commitSidebarWidth = useCallback(
    (width: number) => {
      try {
        setSidebarWidth(saveSidebarWidth(width));
      } catch (caught) {
        showError(caught);
      }
    },
    [showError],
  );

  const toggleRawEditing = useCallback(() => {
    if (!activePathRef.current) {
      return;
    }
    commitTabs((current) =>
      current.map((tab) =>
        tab.path === activePathRef.current && tab.kind === "image"
          ? { ...tab, rawEditing: !tab.rawEditing }
          : tab,
      ),
    );
  }, [commitTabs]);

  const restoreRevision = useCallback(
    async (revisionId: number) => {
      if (!workspace || !activeTab) {
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
                  encoding: document.encoding,
                  lineEnding: document.lineEnding,
                  stats: document.stats,
                  editorRevision: tab.editorRevision + 1,
                  editRecorded: false,
                  saveState: "saved",
                }
              : tab,
          ),
        );
        if (activeTab.kind === "image") {
          const imageDataUrl = await api.readImageDataUrl(restorePath);
          commitTabs((current) =>
            current.map((tab) =>
              tab.path === restorePath ? { ...tab, imageDataUrl } : tab,
            ),
          );
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
        if (isExternalLink(target)) {
          await openUrl(externalLinkTarget(target));
          return;
        }
        if (target.startsWith("file://")) {
          await openPath(fileUrlToPath(target));
          return;
        }
        if (hasUriScheme(target)) {
          showError(`Unsupported link protocol: ${target.split(":", 1)[0]}`);
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
        encryptionOpen ||
        editorSettingsOpen ||
        vaultSwitcherOpen ||
        globalSearchOpen ||
        actionDialog !== null ||
        historyOpen
      ) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (
        modifier &&
        event.shiftKey &&
        event.key.toLocaleLowerCase() === "o"
      ) {
        event.preventDefault();
        event.stopPropagation();
        setVaultSwitcherOpen(true);
      } else if (isGlobalSearchShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        setGlobalSearchOpen(true);
      } else if (isNewFileShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (!workspace) {
          showError("Open a vault before creating a file.");
        } else if (workspace.encryption.enabled && !workspace.encryption.unlocked) {
          showError("Unlock the vault before creating a file.");
        } else {
          void createEntry(false);
        }
      } else if (isSearchShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        setSidebarView("search");
        window.setTimeout(
          () => document.querySelector<HTMLInputElement>(".search-box input")?.focus(),
          0,
        );
      } else if (isReplaceShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        setReplaceOpen(true);
      } else if (modifier && event.key.toLocaleLowerCase() === "s" && activeTab) {
        event.preventDefault();
        event.stopPropagation();
        if (activeTab.kind !== "image" || activeTab.rawEditing) {
          void saveTab(activeTab.path, activeTab.content, "manual save");
        }
      } else if (modifier && event.key.toLocaleLowerCase() === "w" && activePath) {
        event.preventDefault();
        event.stopPropagation();
        void closeTab(activePath);
      } else if (event.ctrlKey && event.key === "Tab" && tabs.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        const index = tabs.findIndex((tab) => tab.path === activePath);
        const direction = event.shiftKey ? -1 : 1;
        setActivePath(
          tabs[(index + direction + tabs.length) % tabs.length].path,
        );
      } else if (event.key === "Escape" && showOutline) {
        setShowOutline(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    actionDialog,
    activePath,
    activeTab,
    closeTab,
    createEntry,
    editorSettingsOpen,
    encryptionOpen,
    globalSearchOpen,
    historyOpen,
    replaceOpen,
    saveTab,
    showError,
    showOutline,
    tabs,
    vaultSwitcherOpen,
    workspace,
  ]);

  const vaultSwitcherDialog = (
    <VaultSwitcherDialog
      open={vaultSwitcherOpen}
      onLoad={api.listKnownVaults}
      onSwitch={switchKnownVault}
      onDelete={deleteKnownVault}
      onChooseFolder={() => void chooseVault()}
      onClose={() => setVaultSwitcherOpen(false)}
    />
  );
  const globalSearchDialog = (
    <GlobalSearchDialog
      open={globalSearchOpen}
      onLoad={api.listKnownVaultFiles}
      onOpen={openKnownVaultFile}
      onClose={() => setGlobalSearchOpen(false)}
    />
  );

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
        <Welcome
          loading={initializing}
          onChooseVault={chooseVault}
          onShowRecentVaults={() => setVaultSwitcherOpen(true)}
        />
        {vaultSwitcherDialog}
        {globalSearchDialog}
      </>
    );
  }

  if (workspace.encryption.enabled && !workspace.encryption.unlocked) {
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
        <VaultUnlockScreen
          vaultName={workspace.vaultName}
          theme={theme}
          onThemeToggle={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          onShowVaults={() => setVaultSwitcherOpen(true)}
          onUnlockWithPassword={(password) =>
            unlockEncryptedVault(password, false)
          }
          onUnlockWithRecoveryCode={(recoveryCode) =>
            unlockEncryptedVault(recoveryCode, true)
          }
        />
        {vaultSwitcherDialog}
        {globalSearchDialog}
      </>
    );
  }

  return (
    <div
      className="app-shell"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
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
          <div className="sidebar-header__actions">
            <button
              type="button"
              className="icon-button"
              title="Vault encryption"
              aria-label="Manage vault encryption"
              onClick={() => setEncryptionOpen(true)}
            >
              <ShieldCheck aria-hidden="true" size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={`Switch vault (${
                navigator.platform.includes("Mac") ? "⇧⌘O" : "Ctrl+Shift+O"
              })`}
              aria-label="Switch vault"
              aria-haspopup="dialog"
              aria-expanded={vaultSwitcherOpen}
              onClick={() => setVaultSwitcherOpen(true)}
            >
              <ChevronsUpDown aria-hidden="true" size={17} />
            </button>
          </div>
        </header>
        {sidebarView === "files" ? (
          <>
            <div className="sidebar-toolbar" aria-label="File actions">
              <button
                type="button"
                className="icon-button"
                title="New file"
                aria-label="New file"
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
                disabled={!selectedMoveAvailability.up}
                onClick={() => void moveSelected(-1)}
              >
                <ArrowUp aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Move selected item down"
                aria-label="Move selected item down"
                disabled={!selectedMoveAvailability.down}
                onClick={() => void moveSelected(1)}
              >
                <ArrowDown aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={
                  selectedNode?.pinned
                    ? "Unpin selected item"
                    : "Pin selected item to top of folder"
                }
                aria-label={
                  selectedNode?.pinned
                    ? "Unpin selected item"
                    : "Pin selected item to top of folder"
                }
                aria-pressed={selectedNode?.pinned ?? false}
                disabled={!selectedNode}
                onClick={() => void togglePinned()}
              >
                {selectedNode?.pinned ? (
                  <PinOff aria-hidden="true" size={15} />
                ) : (
                  <Pin aria-hidden="true" size={15} />
                )}
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
              onCreate={(parentPath, directory) =>
                void createEntry(directory, parentPath)
              }
            />
          </>
        ) : sidebarView === "search" ? (
          <SearchPanel
            query={searchQuery}
            results={searchResults}
            searching={indexing}
            tagColors={tagColorMap}
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
      <SidebarResizer
        width={sidebarWidth}
        onChange={setSidebarWidth}
        onCommit={commitSidebarWidth}
      />
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
            onReorder={reorderTabs}
          />
          <div className="workspace-actions">
            {activeTab?.kind === "image" ? (
              <button
                type="button"
                className="icon-button"
                aria-label={
                  activeTab.rawEditing
                    ? "Preview image"
                    : "Edit image as raw file"
                }
                title={
                  activeTab.rawEditing
                    ? "Preview image"
                    : "Edit image as raw file"
                }
                aria-pressed={activeTab.rawEditing}
                disabled={workspaceLocked}
                onClick={toggleRawEditing}
              >
                {activeTab.rawEditing ? (
                  <ImageIcon aria-hidden="true" size={16} />
                ) : (
                  <FileCode2 aria-hidden="true" size={16} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              aria-label="Copy active file content"
              title="Copy active file content"
              disabled={!activeTab || workspaceLocked}
              onClick={() => void copyActiveFileContent()}
            >
              <ClipboardCopy aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Copy active file for attachment"
              title={
                workspace.encryption.enabled
                  ? "Copy file for attachment using a temporary plaintext copy"
                  : "Copy active file for attachment"
              }
              disabled={!activeTab || workspaceLocked}
              onClick={() => void copyActiveFileForAttachment()}
            >
              <Paperclip aria-hidden="true" size={16} />
            </button>
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
              aria-label="Copy active file path"
              title="Copy active file path"
              disabled={!activeTab || workspaceLocked}
              onClick={() => void copyActiveFilePath()}
            >
              <Copy aria-hidden="true" size={16} />
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
              disabled={!activeTab}
              onClick={() => void openHistory()}
            >
              <History aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Open editor display settings"
              title="Editor display settings"
              aria-haspopup="dialog"
              aria-expanded={editorSettingsOpen}
              disabled={workspaceLocked}
              onClick={() => setEditorSettingsOpen(true)}
            >
              <Settings2 aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${
                showOutline &&
                activeTab?.kind === "markdown" &&
                activeTab.encoding === "utf8"
                  ? "Hide"
                  : "Show"
              } outline`}
              title={`${
                showOutline &&
                activeTab?.kind === "markdown" &&
                activeTab.encoding === "utf8"
                  ? "Hide"
                  : "Show"
              } outline`}
              aria-pressed={
                activeTab?.kind === "markdown" &&
                activeTab.encoding === "utf8" &&
                showOutline
              }
              disabled={
                !activeTab ||
                activeTab.kind !== "markdown" ||
                activeTab.encoding !== "utf8"
              }
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
                {activeTab.kind === "image" && !activeTab.rawEditing ? (
                  <figure className="image-viewer">
                    <img
                      src={activeTab.imageDataUrl}
                      alt={activeTab.title}
                    />
                    <figcaption>{activeTab.path}</figcaption>
                  </figure>
                ) : activeTab.kind === "markdown" &&
                  activeTab.encoding === "utf8" &&
                  !activeTab.path.toLocaleLowerCase().endsWith(".mdx") ? (
                  <MarkdownEditor
                    key={`${activeTab.path}:${activeTab.editorRevision}:${editorDisplayKey}`}
                    notePath={activeTab.path}
                    markdown={activeTab.content}
                    lineEnding={activeTab.lineEnding}
                    displaySettings={editorDisplaySettings}
                    preferredViewMode={activeTab.viewMode}
                    readOnly={workspaceLocked}
                    tagColors={tagColorMap}
                    onChange={changeActiveContent}
                    onError={showError}
                    onLinkOpen={(href, text) => void openLink(href, text)}
                    onViewModeChange={(mode) =>
                      updateMarkdownViewMode(activeTab.path, mode)
                    }
                    onImageUpload={uploadAttachment}
                  />
                ) : (
                  <>
                    {activeTab.encoding === "base64" ? (
                      <div className="binary-editor-notice" role="note">
                        Binary file shown as reversible Base64. Invalid Base64
                        will not be saved.
                      </div>
                    ) : null}
                    <PlainTextEditor
                      key={`${activeTab.path}:${activeTab.editorRevision}`}
                      ariaLabel={`Edit ${activeTab.title}`}
                      value={activeTab.content}
                      readOnly={workspaceLocked}
                      spellCheck={activeTab.encoding === "utf8"}
                      binary={activeTab.encoding === "base64"}
                      lineEnding={activeTab.lineEnding}
                      displaySettings={editorDisplaySettings}
                      onChange={changeActiveContent}
                    />
                  </>
                )}
                {tags.length > 0 ? (
                  <div className="document-tags" aria-label="Document tags">
                    {tags.map((tag) => (
                      <TagChip
                        tag={tag}
                        color={resolveTagColor(tag, tagColorMap)}
                        editable
                        key={tag}
                        onActivate={() => {
                          setSidebarView("search");
                          setSearchQuery(`tag:${tag}`);
                        }}
                        onColorChange={(changedTag, color) =>
                          void updateTagColor(changedTag, color)
                        }
                      />
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
                  <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}F</kbd>{" "}
                  to search.
                </p>
              </div>
            )}
          </main>
          {showOutline &&
          activeTab?.kind === "markdown" &&
          activeTab.encoding === "utf8" ? (
            <TableOfContents
              headings={headings}
              onNavigate={navigateToHeading}
            />
          ) : null}
        </div>
        <footer className="status-bar">
          <span>{activeTab?.path ?? workspace.vaultPath}</span>
          <span className="status-bar__spacer" />
          {activeTab ? (
            <>
              <span>
                {activeTab.encoding === "utf8"
                  ? wordCountLabel(activeTab.content)
                  : "Base64"}
              </span>
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
          activeTab &&
          (activeTab.kind !== "image" || activeTab.rawEditing)
            ? activeTab.path
            : null
        }
        onClose={() => setReplaceOpen(false)}
        onPreview={previewReplace}
        onApply={applyReplace}
      />
      <EditorSettingsDialog
        open={editorSettingsOpen}
        settings={editorDisplaySettings}
        onChange={updateEditorDisplaySettings}
        onClose={() => setEditorSettingsOpen(false)}
      />
      {vaultSwitcherDialog}
      {globalSearchDialog}
      <EncryptionDialog
        open={encryptionOpen}
        encryption={workspace.encryption}
        onClose={() => setEncryptionOpen(false)}
        onEnable={enableVaultEncryption}
        onLock={lockEncryptedVault}
        onChangePassword={changeVaultPassword}
        onRegenerateRecoveryCodes={regenerateRecoveryCodes}
        onDisable={disableVaultEncryption}
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

function upsertTagColor(colors: TagColor[], next: TagColor): TagColor[] {
  return [...colors.filter(({ tag }) => tag !== next.tag), next].sort(
    (left, right) => left.tag.localeCompare(right.tag),
  );
}

function withRecentlyOpened(
  workspace: WorkspaceSnapshot,
  path: string,
  title: string,
  lastOpenedAt: string | null,
): WorkspaceSnapshot {
  return {
    ...workspace,
    recent: [
      {
        path,
        title,
        lastOpenedAt,
        bookmarked: findNode(workspace.tree, path)?.bookmarked ?? false,
      },
      ...workspace.recent.filter((item) => item.path !== path),
    ].slice(0, 50),
  };
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

function wordCountLabel(content: string): string {
  if (content.length > 200_000) {
    return "word count paused";
  }
  if (!content.trim()) {
    return "0 words";
  }
  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const count = [...segmenter.segment(content)].filter(
      (segment) => segment.isWordLike,
    ).length;
    return `${count} words`;
  }
  return `${content.trim().split(/\s+/u).length} words`;
}

function kindFromPath(path: string): Exclude<FileNode["kind"], "folder"> {
  const extension = path.split(".").slice(-1)[0]?.toLocaleLowerCase();
  if (extension === "md" || extension === "markdown" || extension === "mdx") {
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
  return "file";
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
