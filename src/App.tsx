import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  ChevronsUpDown,
  ClipboardCopy,
  Copy,
  ExternalLink as ExternalLinkIcon,
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
import {
  CommandPalette,
  type CommandPaletteCommand,
} from "./components/CommandPalette";
import { EncryptionDialog } from "./components/EncryptionDialog";
import { EditorSettingsDialog } from "./components/EditorSettingsDialog";
import { ExternalLinkDialog } from "./components/ExternalLinkDialog";
import { FileTree } from "./components/FileTree";
import { SidebarResizer } from "./components/SidebarResizer";
import { HistoryDialog } from "./components/HistoryDialog";
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
  allowExternalDomain,
  DEFAULT_EXTERNAL_DOMAIN_POLICY,
  externalDomain,
  getExternalDomainPolicy,
  isExternalDomainAllowed,
  saveExternalDomainPolicy,
  type ExternalDomainPolicy,
} from "./lib/externalDomains";
import {
  extractHeadings,
  extractTags,
  recoverMarkdownLinkTarget,
  resolveInternalLink,
  slugifyHeading,
} from "./lib/markdown";
import {
  computeLinkRewriteUpdates,
} from "./lib/linkRewriteWorker";
import {
  getMarkdownViewMode,
  saveMarkdownViewMode,
  type MarkdownViewMode,
} from "./lib/markdownView";
import { VaultSearchIndex } from "./lib/search";
import { sourceLanguageName } from "./lib/sourceLanguage";
import {
  applyTabSessionLayout,
  buildTabSessionState,
  MAX_TAB_SESSION_GROUPS,
  MAX_TAB_SESSION_TABS,
  moveTabInLayout,
  placeOpenedTab,
  rekeyTabNavigation,
  removeTabNavigationPaths,
  restoreTabHistoryTarget,
  tabHistoryTarget,
  tabsInVisualOrder,
} from "./lib/tabs";
import { resolveTagColor, type TagColorMap } from "./lib/tagColors";
import {
  editorZoomShortcut,
  isCommandPaletteShortcut,
  isNewFileShortcut,
  isNewTabShortcut,
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
  DEFAULT_EDITOR_FONT_SIZE,
  editorDisplaySettingsKey,
  getEditorDisplaySettings,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  normalizeEditorFontSize,
  saveEditorDisplaySettings,
  type EditorDisplaySettings,
} from "./lib/editorDisplay";
import {
  externalLinkTarget,
  hasUriScheme,
  isBlockedExternalScheme,
  isLocalFileUrl,
  isWebLink,
} from "./lib/links";
import type {
  EditorTab,
  FileNode,
  HeadingItem,
  HistoryRevision,
  KnownVaultFile,
  SearchResult,
  SidebarView,
  TabGroup,
  TabSessionState,
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

interface LinkRewriteSave {
  content: string;
  outcome: Awaited<ReturnType<typeof api.saveNote>>;
  encoding: EditorTab["encoding"];
  lineEnding: EditorTab["lineEnding"];
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [tabGroups, setTabGroups] = useState<TabGroup[]>([]);
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [externalDomainPolicy, setExternalDomainPolicy] =
    useState<ExternalDomainPolicy>(() => getExternalDomainPolicy());
  const [pendingExternalLink, setPendingExternalLink] = useState<{
    url: string;
    kind: "domain" | "protocol";
    subject: string;
    remainingUrls: string[];
    opened: number;
    failed: number;
  } | null>(null);
  const [activeWebLinkResult, setActiveWebLinkResult] = useState<{
    path: string;
    content: string;
    links: string[];
  } | null>(null);
  const linkExtractionGeneration = useRef(0);
  const [headingNavigation, setHeadingNavigation] = useState<{
    path: string;
    anchor: string;
  } | null>(null);
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
  const tabGroupsRef = useRef<TabGroup[]>([]);
  const tabSessionTimer = useRef<number | null>(null);
  const tabSessionWrite = useRef<Promise<boolean>>(Promise.resolve(true));
  const persistTabSessionRef = useRef<() => Promise<boolean>>(async () => true);
  const pendingTabSession = useRef<TabSessionState | null>(null);
  const restoringTabSession = useRef(false);
  const saveTimers = useRef(new Map<string, number>());
  const saveQueues = useRef(new Map<string, Promise<boolean>>());
  const saveGenerations = useRef(new Map<string, number>());
  const editQueues = useRef(new Map<string, Promise<boolean>>());
  const viewModeQueues = useRef(new Map<string, Promise<boolean>>());
  const viewModeWrites = useRef(new Set<Promise<boolean>>());
  const preferenceWrites = useRef(new Set<Promise<void>>());
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
  const pendingDefaultWelcome = useRef<string | null>(null);
  const pendingWorkspaceFile = useRef<{
    vaultPath: string;
    path: string;
  } | null>(null);
  const activePathRef = useRef<string | null>(activePath);
  const openFileRequest = useRef(0);
  const openFileQueue = useRef<Promise<void>>(Promise.resolve());
  const newTabSequence = useRef(0);
  const tabGroupSequence = useRef(0);
  const vaultGeneration = useRef(0);
  const closingWindow = useRef(false);
  const workspaceLockedRef = useRef(false);
  const workspaceLockTail = useRef<Promise<void>>(Promise.resolve());
  const workspaceLockRelease = useRef<(() => void) | null>(null);
  const actionDialogResolver = useRef<((value: string | null) => void) | null>(
    null,
  );
  const actionDialogReturnFocus = useRef<HTMLElement | null>(null);

  const commitTabs = useCallback(
    (updater: (current: EditorTab[]) => EditorTab[]) => {
      const next = updater(tabsRef.current);
      tabsRef.current = next;
      setTabs(next);
    },
    [],
  );
  const commitTabGroups = useCallback(
    (updater: (current: TabGroup[]) => TabGroup[]) => {
      const next = updater(tabGroupsRef.current);
      tabGroupsRef.current = next;
      setTabGroups(next);
    },
    [],
  );
  const setWorkspaceLock = useCallback((locked: boolean) => {
    workspaceLockedRef.current = locked;
    setWorkspaceLocked(locked);
    if (!locked) {
      const release = workspaceLockRelease.current;
      workspaceLockRelease.current = null;
      release?.();
    }
  }, []);
  const acquireWorkspaceLock = useCallback(async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = workspaceLockTail.current;
    workspaceLockTail.current = previous.then(() => gate);
    await previous;
    workspaceLockRelease.current = release;
    setWorkspaceLock(true);
  }, [setWorkspaceLock]);
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
        actionDialogReturnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        actionDialogResolver.current = resolve;
        setActionDialog({ ...options, mode: "text", dangerous: false });
      }),
    [],
  );
  const requestConfirmation = useCallback(
    (options: Omit<ActionDialogState, "mode" | "initialValue">) =>
      new Promise<boolean>((resolve) => {
        actionDialogReturnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        actionDialogResolver.current = (value) => resolve(value !== null);
        setActionDialog({ ...options, mode: "confirm", initialValue: "" });
      }),
    [],
  );
  const finishActionDialog = useCallback((value: string | null) => {
    const resolver = actionDialogResolver.current;
    const returnFocus = actionDialogReturnFocus.current;
    actionDialogResolver.current = null;
    actionDialogReturnFocus.current = null;
    setActionDialog(null);
    resolver?.(value);
    window.setTimeout(() => returnFocus?.focus(), 0);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );
  const activeFileTab = activeTab?.placeholder ? null : activeTab;
  const activeNode = useMemo(
    () => (workspace ? findNode(workspace.tree, activeFileTab?.path ?? null) : null),
    [activeFileTab?.path, workspace],
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
      activeFileTab &&
      activeFileTab.kind === "markdown" &&
      activeFileTab.encoding === "utf8"
        ? extractHeadings(activeFileTab.content)
        : [],
    [activeFileTab],
  );
  const tags = useMemo(
    () =>
      activeFileTab &&
      activeFileTab.encoding === "utf8" &&
      (activeFileTab.kind !== "image" || activeFileTab.rawEditing)
        ? extractTags(activeFileTab.content)
        : [],
    [activeFileTab],
  );
  const activeWebLinks =
    activeFileTab &&
    activeWebLinkResult?.path === activeFileTab.path &&
    activeWebLinkResult.content === activeFileTab.content
      ? activeWebLinkResult.links
      : [];
  useEffect(() => {
    const generation = ++linkExtractionGeneration.current;
    setActiveWebLinkResult(null);
    if (!activeFileTab || activeFileTab.encoding !== "utf8") {
      return;
    }

    let worker: Worker | null = null;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./workers/linkExtraction.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (
          event: MessageEvent<{ links?: string[]; error?: string }>,
        ) => {
          worker?.terminate();
          worker = null;
          if (generation !== linkExtractionGeneration.current) {
            return;
          }
          if (event.data.error) {
            console.error(
              `Unable to extract links from ${activeFileTab.path}: ${event.data.error}`,
            );
            return;
          }
          setActiveWebLinkResult({
            path: activeFileTab.path,
            content: activeFileTab.content,
            links: event.data.links ?? [],
          });
        };
        worker.onerror = (event) => {
          worker?.terminate();
          worker = null;
          if (generation !== linkExtractionGeneration.current) {
            return;
          }
          console.error(
            `Unable to extract links from ${activeFileTab.path}: ${event.message}`,
          );
        };
        worker.postMessage({ markdown: activeFileTab.content });
      } catch (caught) {
        console.error(
          `Unable to extract links from ${activeFileTab.path}:`,
          caught,
        );
      }
    }, 200);

    return () => {
      if (generation === linkExtractionGeneration.current) {
        linkExtractionGeneration.current += 1;
      }
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [
    activeFileTab?.content,
    activeFileTab?.encoding,
    activeFileTab?.path,
  ]);
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
        const normalized = {
          ...settings,
          fontSize: normalizeEditorFontSize(settings.fontSize),
        };
        saveEditorDisplaySettings(normalized);
        setEditorDisplaySettings(normalized);
        setStatus("Editor settings updated");
      } catch (caught) {
        showError(caught);
      }
    },
    [showError],
  );
  const updateEditorFontSize = useCallback(
    (fontSize: number) => {
      const normalized = normalizeEditorFontSize(fontSize);
      updateEditorDisplaySettings({
        ...editorDisplaySettings,
        fontSize: normalized,
      });
      setStatus(`Editor font size ${normalized}px`);
    },
    [editorDisplaySettings, updateEditorDisplaySettings],
  );
  const persistExternalDomainPolicy = useCallback(
    (policy: ExternalDomainPolicy) => {
      try {
        const saved = saveExternalDomainPolicy(policy);
        setExternalDomainPolicy(saved);
        return saved;
      } catch (caught) {
        showError(caught);
        return null;
      }
    },
    [showError],
  );
  const removeExternalDomain = useCallback(
    (domain: string) => {
      const next =
        domain === "*"
          ? { ...externalDomainPolicy, allowAll: false }
          : {
              ...externalDomainPolicy,
              domains: externalDomainPolicy.domains.filter(
                (candidate) => candidate !== domain,
              ),
            };
      if (persistExternalDomainPolicy(next)) {
        setStatus("External domain permissions updated");
      }
    },
    [externalDomainPolicy, persistExternalDomainPolicy],
  );
  const clearExternalDomains = useCallback(() => {
    if (persistExternalDomainPolicy(DEFAULT_EXTERNAL_DOMAIN_POLICY)) {
      setStatus("External domain permissions cleared");
    }
  }, [persistExternalDomainPolicy]);

  const updateRestoreTabs = useCallback(
    (enabled: boolean) => {
      const vaultPath = workspace?.vaultPath;
      if (!vaultPath || workspaceLockedRef.current) {
        return;
      }
      setWorkspace((current) =>
        current ? { ...current, restoreTabs: enabled } : current,
      );
      const generation = vaultGeneration.current;
      const queueKey = `${vaultPath}:restore-tabs`;
      const previous =
        viewModeQueues.current.get(queueKey) ?? Promise.resolve(true);
      const write = previous
        .then(() => api.setRestoreTabs(enabled))
        .then(() => true)
        .catch((caught) => {
          if (generation === vaultGeneration.current) {
            showError(caught);
          } else {
            console.error(
              `Unable to save tab restore settings for ${vaultPath}:`,
              caught,
            );
          }
          return false;
        });
      viewModeQueues.current.set(queueKey, write);
      const tracked = write.then(() => undefined);
      preferenceWrites.current.add(tracked);
      void write.finally(() => {
        preferenceWrites.current.delete(tracked);
        if (viewModeQueues.current.get(queueKey) === write) {
          viewModeQueues.current.delete(queueKey);
        }
      });
    },
    [showError, workspace?.vaultPath],
  );

  const queueVaultViewModeWrite = useCallback(
    (vaultPath: string, mode: MarkdownViewMode, generation: number) => {
      const previous =
        viewModeQueues.current.get(vaultPath) ?? Promise.resolve(true);
      const write = previous
        .then(() => api.setVaultMarkdownViewMode(mode))
        .then(() => true)
        .catch((caught) => {
          if (generation === vaultGeneration.current) {
            showError(caught);
          } else {
            console.error(
              `Unable to save the view mode for ${vaultPath}:`,
              caught,
            );
          }
          return false;
        });
      viewModeQueues.current.set(vaultPath, write);
      viewModeWrites.current.add(write);
      void write.finally(() => {
        viewModeWrites.current.delete(write);
        if (viewModeQueues.current.get(vaultPath) === write) {
          viewModeQueues.current.delete(vaultPath);
        }
      });
    },
    [showError],
  );

  const updateMarkdownViewMode = useCallback(
    (mode: MarkdownViewMode) => {
      const vaultPath = workspace?.vaultPath;
      if (!vaultPath) {
        return;
      }
      try {
        saveMarkdownViewMode(mode);
        setMarkdownViewMode(mode);
        setWorkspace((current) =>
          current ? { ...current, markdownViewMode: mode } : current,
        );
        queueVaultViewModeWrite(
          vaultPath,
          mode,
          vaultGeneration.current,
        );
      } catch (caught) {
        showError(caught);
      }
    },
    [queueVaultViewModeWrite, showError, workspace?.vaultPath],
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
      openFileRequest.current += 1;
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
        setCommandPaletteOpen(false);
        setPendingExternalLink(null);
        setHeadingNavigation(null);
      }
      if (resetTabs) {
        if (
          pendingWorkspaceFile.current &&
          pendingWorkspaceFile.current.vaultPath !== snapshot.vaultPath
        ) {
          pendingWorkspaceFile.current = null;
        }
        const welcome = findNode(snapshot.tree, "Welcome.md");
        const hasPendingWorkspaceFile =
          pendingWorkspaceFile.current?.vaultPath === snapshot.vaultPath;
        pendingTabSession.current =
          !hasPendingWorkspaceFile && snapshot.restoreTabs
            ? (snapshot.tabSession ?? null)
            : null;
        restoringTabSession.current = pendingTabSession.current !== null;
        pendingDefaultWelcome.current =
          !pendingWorkspaceFile.current &&
          snapshot.restoreTabs &&
          snapshot.tabSession === null &&
          snapshot.default &&
          welcome !== null &&
          welcome.kind !== "folder"
            ? "Welcome.md"
            : null;
      }
      setIndexing(false);
      const vaultViewMode =
        snapshot.markdownViewMode ?? getMarkdownViewMode();
      setMarkdownViewMode(vaultViewMode);
      setWorkspace({ ...snapshot, markdownViewMode: vaultViewMode });
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
        preferenceWrites.current.clear();
        if (tabSessionTimer.current) {
          window.clearTimeout(tabSessionTimer.current);
          tabSessionTimer.current = null;
        }
        commitTabs(() => []);
        commitTabGroups(() => []);
        setActivePath(null);
      }
      if (snapshot.markdownViewMode === null) {
        queueVaultViewModeWrite(
          snapshot.vaultPath,
          vaultViewMode,
          vaultGeneration.current,
        );
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
    [
      commitTabs,
      commitTabGroups,
      queueVaultViewModeWrite,
      rebuildSearchIndex,
      refreshCachedWorkspace,
    ],
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

  const activateTab = useCallback((path: string) => {
    openFileRequest.current += 1;
    activePathRef.current = path;
    setActivePath(path);
    const tab = tabsRef.current.find((candidate) => candidate.path === path);
    setSelectedPath(tab?.placeholder ? null : path);
  }, []);

  const createNewTab = useCallback(() => {
    if (tabsRef.current.length >= MAX_TAB_SESSION_TABS) {
      showError(`A vault can have up to ${MAX_TAB_SESSION_TABS} open tabs.`);
      return;
    }
    const path = `denote:new-tab:${++newTabSequence.current}`;
    const tab: EditorTab = {
      path,
      title: "New tab",
      kind: "text",
      content: "",
      savedContent: "",
      encoding: "utf8",
      lineEnding: "lf",
      placeholder: true,
      groupId: null,
      rawEditing: false,
      editorRevision: 0,
      editRecorded: false,
      saveState: "saved",
    };
    openFileRequest.current += 1;
    commitTabs((current) => [...current, tab]);
    activePathRef.current = path;
    setActivePath(path);
    setSelectedPath(null);
    setStatus("New tab");
  }, [commitTabs, showError]);

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
    await acquireWorkspaceLock();
    try {
      if (tabSessionTimer.current) {
        window.clearTimeout(tabSessionTimer.current);
        tabSessionTimer.current = null;
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const uploads = await Promise.all([...attachmentUploads.current]);
        if (uploads.some((succeeded) => !succeeded)) {
          setWorkspaceLock(false);
          return false;
        }
        const viewModes = await Promise.all([...viewModeWrites.current]);
        if (viewModes.some((saved) => !saved)) {
          setWorkspaceLock(false);
          return false;
        }
        await tabSessionWrite.current;
        await Promise.all([...preferenceWrites.current]);
        if (
          attachmentUploads.current.size > 0 ||
          viewModeWrites.current.size > 0 ||
          preferenceWrites.current.size > 0
        ) {
          continue;
        }
        if (await flushAllTabsRef.current()) {
          await persistTabSessionRef.current();
          await Promise.all([...preferenceWrites.current]);
          if (
            attachmentUploads.current.size > 0 ||
            viewModeWrites.current.size > 0 ||
            preferenceWrites.current.size > 0
          ) {
            continue;
          }
          return true;
        }
        setWorkspaceLock(false);
        return false;
      }
      setWorkspaceLock(false);
      showError("Unable to settle attachment uploads. Try again.");
      return false;
    } catch (caught) {
      setWorkspaceLock(false);
      throw caught;
    }
  }, [acquireWorkspaceLock, setWorkspaceLock, showError]);
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

  const readEditorTab = useCallback(
    async (
      path: string,
      kind: EditorTab["kind"],
      title: string,
    ): Promise<EditorTab> =>
      kind === "image"
        ? Promise.all([api.readNote(path), api.readImageDataUrl(path)]).then(
            ([document, imageDataUrl]) => ({
              path,
              title,
              kind: "image" as const,
              content: document.content,
              savedContent: document.content,
              savedHash: document.contentHash,
              encoding: document.encoding,
              lineEnding: document.lineEnding,
              placeholder: false,
              groupId: null,
              navigationHistory: [path],
              navigationIndex: 0,
              imageDataUrl,
              rawEditing: false,
              editorRevision: 0,
              stats: document.stats,
              editRecorded: false,
              saveState: "saved" as const,
            }),
          )
        : api.readNote(path).then((document) => ({
            path,
            title,
            kind,
            content: document.content,
            savedContent: document.content,
            savedHash: document.contentHash,
            encoding: document.encoding,
            lineEnding: document.lineEnding,
            placeholder: false,
            groupId: null,
            navigationHistory: [path],
            navigationIndex: 0,
            rawEditing: false,
            editorRevision: 0,
            stats: document.stats,
            editRecorded: false,
            saveState: "saved" as const,
          })),
    [],
  );

  const openFileNow = useCallback(
    async (
      path: string,
      anchor: string | null | undefined,
      request: number,
    ) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      if (request !== openFileRequest.current) {
        return;
      }
      const existing = tabsRef.current.find((tab) => tab.path === path);
      if (existing) {
        setHeadingNavigation(
          anchor ? { path, anchor } : null,
        );
        activateTab(path);
        return;
      }
      const replacePath = activePathRef.current;
      const node = findNode(workspace.tree, path);
      const kind = node?.kind ?? kindFromPath(path);
      if (kind === "folder") {
        showError(`Unable to find ${path}`);
        return;
      }
      const title = node?.name ?? path.split("/").slice(-1)[0] ?? path;
      const generation = vaultGeneration.current;
      setStatus(`Opening ${title}…`);
      let workspaceOperationStarted = false;
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        workspaceOperationStarted = true;
        if (request !== openFileRequest.current) {
          return;
        }
        const tab = await readEditorTab(path, kind, title);
        if (
          generation !== vaultGeneration.current ||
          request !== openFileRequest.current
        ) {
          return;
        }
        setHeadingNavigation(
          anchor ? { path, anchor } : null,
        );
        commitTabs((current) => placeOpenedTab(current, replacePath, tab));
        commitTabGroups((current) =>
          current.filter((group) =>
            tabsRef.current.some((candidate) => candidate.groupId === group.id),
          ),
        );
        if (replacePath) {
          cancelPendingPath(replacePath);
        }
        activePathRef.current = path;
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
      } finally {
        if (workspaceOperationStarted) {
          setWorkspaceLock(false);
        }
      }
    },
    [
      commitTabGroups,
      commitTabs,
      activateTab,
      beginWorkspaceOperation,
      cancelPendingPath,
      readEditorTab,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  const openFile = useCallback(
    (path: string, anchor?: string | null): Promise<void> => {
      const request = ++openFileRequest.current;
      const operation = openFileQueue.current.then(() =>
        openFileNow(path, anchor, request),
      );
      openFileQueue.current = operation;
      return operation;
    },
    [openFileNow],
  );

  const navigateTabHistory = useCallback(
    (direction: -1 | 1): Promise<void> => {
      const request = ++openFileRequest.current;
      const operation = openFileQueue.current.then(async () => {
        if (!workspace || workspaceLockedRef.current) {
          return;
        }
        const current = tabsRef.current.find(
          (tab) => tab.path === activePathRef.current,
        );
        if (!current || current.placeholder) {
          return;
        }
        const target = tabHistoryTarget(current, direction);
        if (!target || request !== openFileRequest.current) {
          return;
        }
        const node = findNode(workspace.tree, target.path);
        const kind = node?.kind ?? kindFromPath(target.path);
        if (kind === "folder") {
          return;
        }
        const title =
          node?.name ??
          target.path.split("/").slice(-1)[0] ??
          target.path;
        const generation = vaultGeneration.current;
        let workspaceOperationStarted = false;
        try {
          if (!(await beginWorkspaceOperation())) {
            return;
          }
          workspaceOperationStarted = true;
          if (request !== openFileRequest.current) {
            return;
          }
          const latestCurrent = tabsRef.current.find(
            (tab) => tab.path === current.path,
          );
          if (!latestCurrent) {
            return;
          }
          const existing = tabsRef.current.find(
            (tab) => tab.path === target.path,
          );
          const opened = restoreTabHistoryTarget(
            latestCurrent,
            existing ?? (await readEditorTab(target.path, kind, title)),
            target.index,
          );
          if (
            generation !== vaultGeneration.current ||
            request !== openFileRequest.current
          ) {
            return;
          }
          if (existing) {
            const displaced = placeOpenedTab(
              [existing],
              existing.path,
              latestCurrent,
            )[0];
            commitTabs((tabs) =>
              tabsInVisualOrder(
                tabs.map((tab) =>
                  tab.path === current.path
                    ? opened
                    : tab.path === existing.path
                      ? displaced
                      : tab,
                ),
              ),
            );
            cancelPendingPath(existing.path);
          } else {
            commitTabs((tabs) =>
              tabsInVisualOrder(
                tabs.map((tab) =>
                  tab.path === current.path ? opened : tab,
                ),
              ),
            );
          }
          cancelPendingPath(current.path);
          activePathRef.current = target.path;
          setActivePath(target.path);
          setSelectedPath(target.path);
          setStatus(`Opened ${title}`);
          setWorkspace((value) =>
            value
              ? withRecentlyOpened(
                  value,
                  target.path,
                  title,
                  opened.stats?.lastOpenedAt ?? null,
                )
              : value,
          );
          searchIndex.current.recordOpen(
            target.path,
            opened.stats?.lastOpenedAt ?? null,
          );
        } catch (caught) {
          if (generation === vaultGeneration.current) {
            showError(caught);
          }
        } finally {
          if (workspaceOperationStarted) {
            setWorkspaceLock(false);
          }
        }
      });
      openFileQueue.current = operation;
      return operation;
    },
    [
      beginWorkspaceOperation,
      cancelPendingPath,
      commitTabs,
      readEditorTab,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  useEffect(() => {
    const session = pendingTabSession.current;
    if (
      !session ||
      !workspace ||
      workspaceLocked ||
      (workspace.encryption.enabled && !workspace.encryption.unlocked)
    ) {
      return;
    }
    pendingTabSession.current = null;
    const generation = vaultGeneration.current;
    const request = ++openFileRequest.current;
    void (async () => {
      await acquireWorkspaceLock();
      try {
        const restored: EditorTab[] = [];
        for (const saved of session.tabs) {
          if (
            generation !== vaultGeneration.current ||
            request !== openFileRequest.current
          ) {
            return;
          }
          const node = findNode(workspace.tree, saved.path);
          const kind = node?.kind ?? kindFromPath(saved.path);
          if (kind === "folder") {
            continue;
          }
          const title =
            node?.name ?? saved.path.split("/").slice(-1)[0] ?? saved.path;
          try {
            restored.push({
              ...(await readEditorTab(saved.path, kind, title)),
              groupId: saved.groupId,
            });
          } catch (caught) {
            console.warn(`Unable to restore ${saved.path}:`, caught);
          }
        }
        if (
          generation !== vaultGeneration.current ||
          request !== openFileRequest.current
        ) {
          return;
        }
        const layout = applyTabSessionLayout(restored, session);
        commitTabs(() => layout.tabs);
        commitTabGroups(() => layout.groups);
        const activePath = layout.activePath;
        activePathRef.current = activePath;
        setActivePath(activePath);
        setSelectedPath(activePath);
        setStatus(
          `Restored ${restored.length} tab${restored.length === 1 ? "" : "s"}`,
        );
      } catch (caught) {
        showError(caught);
      } finally {
        restoringTabSession.current = false;
        setWorkspaceLock(false);
      }
    })();
  }, [
    acquireWorkspaceLock,
    commitTabGroups,
    commitTabs,
    readEditorTab,
    setWorkspaceLock,
    showError,
    workspace,
    workspaceLocked,
  ]);

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

  const closeTabs = useCallback(
    async (paths: string[]) => {
      const closing = new Set(paths);
      if (closing.size === 0 || workspaceLockedRef.current) {
        return;
      }
      openFileRequest.current += 1;
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        const currentTabs = tabsRef.current;
        const activeIndex = currentTabs.findIndex(
          (tab) => tab.path === activePathRef.current,
        );
        const remaining = currentTabs.filter((tab) => !closing.has(tab.path));
        commitTabs(() => remaining);
        for (const path of closing) {
          cancelPendingPath(path);
        }
        commitTabGroups((current) =>
          current.filter((group) =>
            remaining.some((tab) => tab.groupId === group.id),
          ),
        );
        if (
          activePathRef.current &&
          closing.has(activePathRef.current)
        ) {
          const nextPath =
            remaining[Math.min(Math.max(activeIndex, 0), remaining.length - 1)]
              ?.path ?? null;
          activePathRef.current = nextPath;
          setActivePath(nextPath);
          setSelectedPath(
            remaining.find((tab) => tab.path === nextPath)?.placeholder
              ? null
              : nextPath,
          );
          window.setTimeout(() => {
            if (nextPath) {
              document
                .querySelector<HTMLButtonElement>(
                  `[data-tab-path="${CSS.escape(nextPath)}"]`,
                )
                ?.focus();
            } else {
              document
                .querySelector<HTMLButtonElement>(".file-tree__row")
                ?.focus();
            }
          }, 0);
        }
      } catch (caught) {
        showError(caught);
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      beginWorkspaceOperation,
      cancelPendingPath,
      commitTabGroups,
      commitTabs,
      setWorkspaceLock,
      showError,
    ],
  );

  const closeTab = useCallback(
    async (path: string) => closeTabs([path]),
    [closeTabs],
  );

  const reorderTabs = useCallback(
    (sourcePath: string, targetPath: string) => {
      const sourceGroupId =
        tabsRef.current.find((tab) => tab.path === sourcePath)?.groupId ?? null;
      const targetGroupId =
        tabsRef.current.find((tab) => tab.path === targetPath)?.groupId ?? null;
      commitTabs((current) =>
        moveTabInLayout(current, sourcePath, targetPath),
      );
      commitTabGroups((current) =>
        current
          .map((group) =>
            sourceGroupId !== targetGroupId && group.id === targetGroupId
              ? { ...group, collapsed: false }
              : group,
          )
          .filter((group) =>
            tabsRef.current.some((tab) => tab.groupId === group.id),
          ),
      );
      setStatus("Reordered tabs");
    },
    [commitTabGroups, commitTabs],
  );

  const toggleTabGroup = useCallback(
    (groupId: string) => {
      commitTabGroups((current) =>
        current.map((group) =>
          group.id === groupId
            ? { ...group, collapsed: !group.collapsed }
            : group,
        ),
      );
    },
    [commitTabGroups],
  );

  const moveTabToGroup = useCallback(
    (path: string, groupId: string | null) => {
      commitTabs((current) => {
        const index = current.findIndex((tab) => tab.path === path);
        if (index < 0) {
          return current;
        }
        const target = { ...current[index], groupId };
        const remaining = current.filter((tab) => tab.path !== path);
        if (!groupId) {
          remaining.splice(Math.min(index, remaining.length), 0, target);
          return tabsInVisualOrder(remaining);
        }
        const lastGroupIndex = remaining.reduce(
          (last, tab, tabIndex) => (tab.groupId === groupId ? tabIndex : last),
          -1,
        );
        remaining.splice(
          lastGroupIndex >= 0 ? lastGroupIndex + 1 : remaining.length,
          0,
          target,
        );
        return tabsInVisualOrder(remaining);
      });
      commitTabGroups((current) =>
        current
          .map((group) =>
            group.id === groupId ? { ...group, collapsed: false } : group,
          )
          .filter((group) =>
            tabsRef.current.some((tab) => tab.groupId === group.id),
          ),
      );
    },
    [commitTabGroups, commitTabs],
  );

  const createTabGroup = useCallback(
    async (path: string) => {
      if (tabGroupsRef.current.length >= MAX_TAB_SESSION_GROUPS) {
        showError(
          `A vault can have up to ${MAX_TAB_SESSION_GROUPS} tab groups.`,
        );
        return;
      }
      const name = await requestText({
        title: "Create tab group",
        message: "Choose a name for the new tab group.",
        initialValue: "Group",
        confirmLabel: "Create",
      });
      if (!name) {
        return;
      }
      if ([...name].length > 64) {
        showError("Tab group names must be 64 characters or fewer.");
        return;
      }
      const groupId = `group-${Date.now()}-${++tabGroupSequence.current}`;
      commitTabGroups((current) => [
        ...current,
        { id: groupId, name, collapsed: false },
      ]);
      moveTabToGroup(path, groupId);
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-tab-path="${CSS.escape(path)}"]`,
          )
          ?.focus();
      }, 0);
    },
    [commitTabGroups, moveTabToGroup, requestText, showError],
  );

  const renameTabGroup = useCallback(
    async (groupId: string) => {
      const group = tabGroupsRef.current.find(
        (candidate) => candidate.id === groupId,
      );
      if (!group) {
        return;
      }
      const name = await requestText({
        title: "Rename tab group",
        message: "Choose a new name for this tab group.",
        initialValue: group.name,
        confirmLabel: "Rename",
      });
      if (!name) {
        return;
      }
      if ([...name].length > 64) {
        showError("Tab group names must be 64 characters or fewer.");
        return;
      }
      commitTabGroups((current) =>
        current.map((candidate) =>
          candidate.id === groupId ? { ...candidate, name } : candidate,
        ),
      );
    },
    [commitTabGroups, requestText, showError],
  );

  const persistTabSession = useCallback((): Promise<boolean> => {
    if (
      !workspace ||
      restoringTabSession.current ||
      (workspace.encryption.enabled && !workspace.encryption.unlocked)
    ) {
      return Promise.resolve(true);
    }
    const generation = vaultGeneration.current;
    const vaultPath = workspace.vaultPath;
    const session = buildTabSessionState(
      tabsRef.current,
      tabGroupsRef.current,
      activePathRef.current,
    );
    const write = tabSessionWrite.current
      .then(() => api.saveTabSession(session))
      .then(() => true)
      .catch((caught) => {
        if (
          generation === vaultGeneration.current &&
          workspace.vaultPath === vaultPath
        ) {
          showError(caught);
        } else {
          console.error(`Unable to save the tab session for ${vaultPath}:`, caught);
        }
        return false;
      });
    tabSessionWrite.current = write;
    return write;
  }, [showError, workspace]);
  persistTabSessionRef.current = persistTabSession;

  const tabLayoutKey = useMemo(
    () =>
      JSON.stringify({
        tabs: tabs.map(({ path, placeholder, groupId }) => ({
          path,
          placeholder,
          groupId,
        })),
        groups: tabGroups,
        activePath,
      }),
    [activePath, tabGroups, tabs],
  );

  useEffect(() => {
    if (!workspace || restoringTabSession.current) {
      return;
    }
    if (tabSessionTimer.current) {
      window.clearTimeout(tabSessionTimer.current);
    }
    tabSessionTimer.current = window.setTimeout(() => {
      tabSessionTimer.current = null;
      void persistTabSession();
    }, 400);
    return () => {
      if (tabSessionTimer.current) {
        window.clearTimeout(tabSessionTimer.current);
        tabSessionTimer.current = null;
      }
    };
  }, [persistTabSession, tabLayoutKey, workspace]);

  const refreshAndReindex = useCallback(async () => {
    if (!workspace) {
      return;
    }
    await refreshWorkspace(true);
  }, [refreshWorkspace, workspace]);

  const rewriteLinksForMove = useCallback(
    async (oldPath: string, newPath: string) => {
      const batch = await api.listLinkRewriteDocuments();
      const updates = new Map<string, LinkRewriteSave>();
      const failures: string[] = [];
      const rewrites = await computeLinkRewriteUpdates(
        batch.documents,
        oldPath,
        newPath,
        batch.availablePaths,
      );
      const documentsByPath = new Map(
        batch.documents.map((document) => [document.path, document]),
      );
      for (const rewrite of rewrites) {
        const document = documentsByPath.get(rewrite.path);
        if (!document) {
          failures.push(rewrite.path);
          continue;
        }
        try {
          const outcome = await api.saveNote(
            document.path,
            rewrite.content,
            document.encoding,
            document.lineEnding,
            "update links after move",
            document.contentHash,
          );
          updates.set(document.path, {
            content: rewrite.content,
            outcome,
            encoding: document.encoding,
            lineEnding: document.lineEnding,
          });
        } catch (caught) {
          console.error(
            `Unable to update links in ${document.path}:`,
            caught,
          );
          failures.push(document.path);
        }
      }
      return {
        updates,
        incomplete:
          batch.truncated ||
          batch.skippedCount > 0 ||
          failures.length > 0,
        skippedCount: batch.skippedCount,
        failedCount: failures.length,
      };
    },
    [],
  );

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

  const renameNode = useCallback(async (node: FileNode) => {
    if (!workspace || workspaceLockedRef.current) {
      return;
    }
    const newName = await requestText({
      title: "Rename item",
      message: `Choose a new name for ${node.name}.`,
      initialValue: node.name,
      confirmLabel: "Rename",
    });
    if (!newName || newName === node.name) {
      return;
    }
    openFileRequest.current += 1;
    try {
      if (!(await beginWorkspaceOperation())) {
        return;
      }
      const affectedTabs = tabsRef.current.filter(
        (tab) =>
          !tab.placeholder &&
          (tab.path === node.path || tab.path.startsWith(`${node.path}/`)),
      );
      for (const tab of affectedTabs) {
        if (!(await flushTab(tab.path))) {
          setStatus("Rename cancelled because a note could not be saved");
          return;
        }
      }
      const movedEntry = await api.renameEntry(node.path, newName);
      const newPath = movedEntry.path;
      const oldPath = node.path;
      const replacePrefix = (path: string) =>
        path === oldPath || path.startsWith(`${oldPath}/`)
          ? `${newPath}${path.slice(oldPath.length)}`
          : path;
      let linkUpdates = new Map<string, LinkRewriteSave>();
      let linksIncomplete = false;
      try {
        const rewritten = await rewriteLinksForMove(oldPath, newPath);
        linkUpdates = rewritten.updates;
        linksIncomplete = rewritten.incomplete;
        if (linksIncomplete) {
          showError(
            `Renamed ${node.name}, but some linked files could not be updated (${rewritten.failedCount} failed, ${rewritten.skippedCount} skipped).`,
          );
        }
      } catch (caught) {
        linksIncomplete = true;
        showError(caught);
      } finally {
        try {
          await api.finishLinkRewrite(movedEntry.rewriteToken);
        } catch (caught) {
          linksIncomplete = true;
          showError(caught);
        }
      }
      commitTabs((current) =>
        current.map((tab) => {
          if (tab.placeholder) {
            return tab;
          }
          const path = replacePrefix(tab.path);
          const renamedKind = kindFromPath(path);
          const update = linkUpdates.get(path);
          const moved = rekeyTabNavigation(tab, replacePrefix);
          return {
            ...moved,
            path,
            title: path.split("/").slice(-1)[0] ?? path,
            kind: renamedKind,
            content: update?.content ?? moved.content,
            savedContent: update?.content ?? moved.savedContent,
            savedHash: update?.outcome.contentHash ?? moved.savedHash,
            encoding: update?.encoding ?? moved.encoding,
            lineEnding: update?.lineEnding ?? moved.lineEnding,
            stats: update?.outcome.stats ?? moved.stats,
            editorRevision:
              moved.editorRevision + (update ? 1 : 0),
            editRecorded: update ? false : moved.editRecorded,
            saveState: update ? "saved" : moved.saveState,
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
      setActivePath((current) => {
        const next = current ? replacePrefix(current) : current;
        activePathRef.current = next;
        return next;
      });
      setSelectedPath(newPath);
      for (const tab of affectedTabs) {
        cancelPendingPath(tab.path);
      }
      await refreshAndReindex();
      if (!linksIncomplete && linkUpdates.size > 0) {
        setStatus(
          `Renamed ${node.name} and updated ${linkUpdates.size} linked file${
            linkUpdates.size === 1 ? "" : "s"
          }`,
        );
      }
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
    rewriteLinksForMove,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const renameSelected = useCallback(async () => {
    if (selectedNode) {
      await renameNode(selectedNode);
    }
  }, [renameNode, selectedNode]);

  const moveNode = useCallback(
    async (node: FileNode, targetParentPath: string) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const currentParent = node.path.split("/").slice(0, -1).join("/");
      if (targetParentPath === currentParent) {
        return;
      }
      try {
        openFileRequest.current += 1;
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        const affectedTabs = tabsRef.current.filter(
          (tab) =>
            !tab.placeholder &&
            (tab.path === node.path || tab.path.startsWith(`${node.path}/`)),
        );
        for (const tab of affectedTabs) {
          if (!(await flushTab(tab.path))) {
            setStatus("Move cancelled because a file could not be saved");
            return;
          }
        }
        const movedEntry = await api.moveEntry(node.path, targetParentPath);
        const newPath = movedEntry.path;
        const replacePrefix = (path: string) =>
          path === node.path || path.startsWith(`${node.path}/`)
            ? `${newPath}${path.slice(node.path.length)}`
            : path;
        let linkUpdates = new Map<string, LinkRewriteSave>();
        let linksIncomplete = false;
        try {
          const rewritten = await rewriteLinksForMove(node.path, newPath);
          linkUpdates = rewritten.updates;
          linksIncomplete = rewritten.incomplete;
          if (linksIncomplete) {
            showError(
              `Moved ${node.name}, but some linked files could not be updated (${rewritten.failedCount} failed, ${rewritten.skippedCount} skipped).`,
            );
          }
        } catch (caught) {
          linksIncomplete = true;
          showError(caught);
        } finally {
          try {
            await api.finishLinkRewrite(movedEntry.rewriteToken);
          } catch (caught) {
            linksIncomplete = true;
            showError(caught);
          }
        }
        commitTabs((current) =>
          current.map((tab) => {
            if (tab.placeholder) {
              return tab;
            }
            const path = replacePrefix(tab.path);
            const movedKind = kindFromPath(path);
            const update = linkUpdates.get(path);
            const moved = rekeyTabNavigation(tab, replacePrefix);
            return {
              ...moved,
              path,
              title: path.split("/").slice(-1)[0] ?? path,
              kind: movedKind,
              content: update?.content ?? moved.content,
              savedContent: update?.content ?? moved.savedContent,
              savedHash: update?.outcome.contentHash ?? moved.savedHash,
              encoding: update?.encoding ?? moved.encoding,
              lineEnding: update?.lineEnding ?? moved.lineEnding,
              stats: update?.outcome.stats ?? moved.stats,
              editorRevision:
                moved.editorRevision + (update ? 1 : 0),
              editRecorded: update ? false : moved.editRecorded,
              saveState: update ? "saved" : moved.saveState,
              rawEditing:
                movedKind === "image" && tab.kind === "image"
                  ? tab.rawEditing
                  : false,
              imageDataUrl:
                movedKind === "image" ? tab.imageDataUrl : undefined,
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
        setActivePath((current) => {
          const next = current ? replacePrefix(current) : current;
          activePathRef.current = next;
          return next;
        });
        setSelectedPath(newPath);
        for (const tab of affectedTabs) {
          cancelPendingPath(tab.path);
        }
        if (targetParentPath) {
          setExpandedPaths((current) => new Set(current).add(targetParentPath));
        }
        await refreshAndReindex();
        if (!linksIncomplete) {
          setStatus(
            linkUpdates.size > 0
              ? `Moved ${node.name} and updated ${linkUpdates.size} linked file${
                  linkUpdates.size === 1 ? "" : "s"
                }`
              : `Moved ${node.name}`,
          );
        }
      } catch (caught) {
        showError(caught);
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      beginWorkspaceOperation,
      cancelPendingPath,
      commitTabGroups,
      commitTabs,
      flushTab,
      refreshAndReindex,
      rewriteLinksForMove,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  const requestMoveNode = useCallback(
    async (node: FileNode) => {
      const currentParent = node.path.split("/").slice(0, -1).join("/");
      const entered = await requestText({
        title: "Move to folder",
        message:
          "Enter a vault-relative folder path. Use a single period for the vault root.",
        initialValue: currentParent || ".",
        confirmLabel: "Move",
      });
      if (!entered) {
        return;
      }
      const targetParentPath =
        entered === "." || entered === "/"
          ? ""
          : entered.replace(/^\/+|\/+$/g, "");
      await moveNode(node, targetParentPath);
    },
    [moveNode, requestText],
  );

  const trashNode = useCallback(async (node: FileNode) => {
    if (!workspace || workspaceLockedRef.current) {
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Move to trash",
        message: `Move “${node.name}” to Denote Trash? It can be restored later.`,
        confirmLabel: "Move to trash",
        dangerous: true,
      }))
    ) {
      return;
    }
    try {
      openFileRequest.current += 1;
      if (!(await beginWorkspaceOperation())) {
        return;
      }
      const affectedTabs = tabsRef.current.filter(
        (tab) =>
          !tab.placeholder &&
          (tab.path === node.path || tab.path.startsWith(`${node.path}/`)),
      );
      for (const tab of affectedTabs) {
        if (!(await flushTab(tab.path))) {
          setStatus("Trash cancelled because a note could not be saved");
          return;
        }
      }
      await api.trashEntry(node.path);
      const isAffected = (path: string) =>
        path === node.path || path.startsWith(`${node.path}/`);
      commitTabs((current) =>
        current
          .filter((tab) => !isAffected(tab.path))
          .map((tab) => removeTabNavigationPaths(tab, isAffected)),
      );
      commitTabGroups((current) =>
        current.filter((group) =>
          tabsRef.current.some((tab) => tab.groupId === group.id),
        ),
      );
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
    commitTabGroups,
    commitTabs,
    flushTab,
    refreshAndReindex,
    requestConfirmation,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const trashSelected = useCallback(async () => {
    if (selectedNode) {
      await trashNode(selectedNode);
    }
  }, [selectedNode, trashNode]);

  const toggleBookmarkForNode = useCallback(async (node: FileNode | null) => {
    if (
      !workspace ||
      !node ||
      node.kind === "folder" ||
      workspaceLockedRef.current
    ) {
      return;
    }
    try {
      await api.setBookmark(node.path, !node.bookmarked);
      await refreshAndReindex();
    } catch (caught) {
      showError(caught);
    }
  }, [refreshAndReindex, showError, workspace]);

  const toggleBookmark = useCallback(
    async () => toggleBookmarkForNode(selectedNode),
    [selectedNode, toggleBookmarkForNode],
  );

  const togglePinnedNode = useCallback(async (node: FileNode | null) => {
    if (!workspace || !node || workspaceLockedRef.current) {
      return;
    }
    try {
      const pinned = !node.pinned;
      await api.setEntryPinned(node.path, pinned);
      await refreshWorkspace();
      setStatus(pinned ? "Pinned to top of folder" : "Unpinned from folder");
    } catch (caught) {
      showError(caught);
    }
  }, [refreshWorkspace, showError, workspace]);

  const togglePinned = useCallback(
    async () => togglePinnedNode(selectedNode),
    [selectedNode, togglePinnedNode],
  );

  const moveNodeInOrder = useCallback(
    async (node: FileNode | null, direction: -1 | 1) => {
      if (!workspace || !node || workspaceLockedRef.current) {
        return;
      }
      const siblings = findSiblings(workspace.tree, node.path);
      const index = siblings.findIndex((candidate) => candidate.path === node.path);
      const destination = index + direction;
      if (
        index < 0 ||
        destination < 0 ||
        destination >= siblings.length ||
        siblings[destination].pinned !== node.pinned
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
    [refreshWorkspace, showError, workspace],
  );

  const moveSelected = useCallback(
    async (direction: -1 | 1) => moveNodeInOrder(selectedNode, direction),
    [moveNodeInOrder, selectedNode],
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
    if (!workspace || !activeFileTab) {
      return;
    }
    if (workspaceLockedRef.current) {
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistoryRevisions(await api.listHistory(activeFileTab.path));
    } catch (caught) {
      showError(caught);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeFileTab, showError, workspace]);

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
    if (!activeFileTab || workspaceLockedRef.current) {
      return;
    }
    if (
      activeFileTab.content !== activeFileTab.savedContent &&
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
    await acquireWorkspaceLock();
    const path = activeFileTab.path;
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
      if (activeFileTab.kind === "image") {
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
    activeFileTab,
    acquireWorkspaceLock,
    cancelPendingPath,
    commitTabs,
    requestConfirmation,
    scheduleIndexRebuild,
    setWorkspaceLock,
    showError,
  ]);

  const copyActiveFilePath = useCallback(async () => {
    if (!activeFileTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFilePath(activeFileTab.path);
      setStatus("Copied file path");
    } catch (caught) {
      showError(caught);
    }
  }, [activeFileTab, showError]);

  const copyActiveFileContent = useCallback(async () => {
    if (!activeFileTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFileContent(activeFileTab.content);
      setStatus("Copied file content");
    } catch (caught) {
      showError(caught);
    }
  }, [activeFileTab, showError]);

  const copyActiveFileForAttachment = useCallback(async () => {
    if (!activeFileTab || workspaceLockedRef.current) {
      return;
    }
    try {
      await api.copyFileForAttachment(
        activeFileTab.path,
        activeFileTab.content,
        activeFileTab.encoding,
        activeFileTab.lineEnding,
      );
      setStatus(
        workspace?.encryption.enabled
          ? "Copied temporary plaintext file for attachment"
          : "Copied file for attachment",
      );
    } catch (caught) {
      showError(caught);
    }
  }, [activeFileTab, showError, workspace?.encryption.enabled]);

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
      if (!workspace || !activeFileTab) {
        return;
      }
      if (workspaceLockedRef.current) {
        return;
      }
      const restorePath = activeFileTab.path;
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
        if (activeFileTab.kind === "image") {
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
      activeFileTab,
      beginWorkspaceOperation,
      commitTabs,
      flushTab,
      scheduleIndexRebuild,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  const openWebLinksWithPolicy = useCallback(
    async (
      urls: string[],
      policy: ExternalDomainPolicy,
      progress = { opened: 0, failed: 0 },
    ) => {
      let { opened, failed } = progress;
      for (let index = 0; index < urls.length; index += 1) {
        const url = externalLinkTarget(urls[index]);
        const domain = externalDomain(url);
        if (!domain) {
          failed += 1;
          continue;
        }
        if (!isExternalDomainAllowed(policy, domain)) {
          setPendingExternalLink({
            url,
            kind: "domain",
            subject: domain,
            remainingUrls: urls.slice(index + 1),
            opened,
            failed,
          });
          return;
        }
        try {
          await api.openExternalUri(url);
          opened += 1;
        } catch (caught) {
          failed += 1;
          console.error(`Unable to open ${url}:`, caught);
        }
      }
      if (failed > 0) {
        showError(
          `Opened ${opened} external link${
            opened === 1 ? "" : "s"
          }; ${failed} failed.`,
        );
      } else if (opened > 0) {
        setStatus(
          `Opened ${opened} external link${opened === 1 ? "" : "s"}`,
        );
      }
    },
    [showError],
  );

  const allowPendingExternalLink = useCallback(
    async (allowAll: boolean) => {
      const pending = pendingExternalLink;
      if (!pending) {
        return;
      }
      let policy = externalDomainPolicy;
      if (pending.kind === "domain") {
        const nextPolicy = allowAll
          ? { ...externalDomainPolicy, allowAll: true }
          : allowExternalDomain(externalDomainPolicy, pending.subject);
        const saved = persistExternalDomainPolicy(nextPolicy);
        if (!saved) {
          return;
        }
        policy = saved;
      }
      setPendingExternalLink(null);
      if (pending.kind === "domain") {
        await openWebLinksWithPolicy(
          [pending.url, ...pending.remainingUrls],
          policy,
          { opened: pending.opened, failed: pending.failed },
        );
        return;
      }
      try {
        await api.openExternalUri(pending.url);
      } catch (caught) {
        showError(caught);
      }
    },
    [
      externalDomainPolicy,
      pendingExternalLink,
      openWebLinksWithPolicy,
      persistExternalDomainPolicy,
      showError,
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
        const normalizedTarget = externalLinkTarget(target);
        if (/^file:/i.test(normalizedTarget)) {
          if (!isLocalFileUrl(normalizedTarget)) {
            showError("Remote file URLs are not allowed.");
            return;
          }
          await openPath(fileUrlToPath(normalizedTarget));
          return;
        }
        if (isWebLink(normalizedTarget)) {
          const domain = externalDomain(normalizedTarget);
          if (!domain) {
            showError(`Invalid external link: ${target}`);
            return;
          }
          if (!isExternalDomainAllowed(externalDomainPolicy, domain)) {
            setPendingExternalLink({
              url: normalizedTarget,
              kind: "domain",
              subject: domain,
              remainingUrls: [],
              opened: 0,
              failed: 0,
            });
            return;
          }
          await openWebLinksWithPolicy(
            [normalizedTarget],
            externalDomainPolicy,
          );
          return;
        }
        if (hasUriScheme(normalizedTarget)) {
          if (isBlockedExternalScheme(normalizedTarget)) {
            showError(
              `External protocol is not allowed: ${
                normalizedTarget.split(":", 1)[0]
              }`,
            );
            return;
          }
          const scheme = normalizedTarget.split(":", 1)[0];
          if (scheme === "mailto" || scheme === "tel") {
            await api.openExternalUri(normalizedTarget);
          } else {
            setPendingExternalLink({
              url: normalizedTarget,
              kind: "protocol",
              subject: scheme,
              remainingUrls: [],
              opened: 0,
              failed: 0,
            });
          }
          return;
        }
        const resolved = resolveInternalLink(
          activeTab.path,
          normalizedTarget,
          allFiles
            .filter((node) => node.kind !== "folder")
            .map((node) => node.path),
        );
        if (!resolved) {
          showError(`Link target not found: ${normalizedTarget}`);
          return;
        }
        await openFile(resolved.path, resolved.anchor);
      } catch (caught) {
        showError(caught);
      }
    },
    [
      activeTab,
      allFiles,
      externalDomainPolicy,
      openFile,
      openWebLinksWithPolicy,
      showError,
    ],
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

  const focusVaultSearch = useCallback(() => {
    setSidebarView("search");
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>(".search-box input")?.focus(),
      0,
    );
  }, []);

  useEffect(() => {
    if (!headingNavigation) {
      return;
    }
    if (activePath !== headingNavigation.path) {
      setHeadingNavigation(null);
      return;
    }
    const timer = window.setTimeout(() => {
      navigateToHeading({
        depth: 1,
        text: headingNavigation.anchor,
        slug: slugifyHeading(headingNavigation.anchor),
      });
      setHeadingNavigation((current) =>
        current === headingNavigation ? null : current,
      );
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activePath, headingNavigation, navigateToHeading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modalOpen =
        replaceOpen ||
        encryptionOpen ||
        editorSettingsOpen ||
        vaultSwitcherOpen ||
        commandPaletteOpen ||
        pendingExternalLink !== null ||
        actionDialog !== null ||
        historyOpen;
      const zoom = editorZoomShortcut(event, navigator.platform);
      const paletteShortcut = isCommandPaletteShortcut(
        event,
        navigator.platform,
      );
      if (zoom) {
        event.preventDefault();
        event.stopPropagation();
        updateEditorFontSize(
          zoom === "in"
            ? editorDisplaySettings.fontSize + 1
            : zoom === "out"
              ? editorDisplaySettings.fontSize - 1
              : DEFAULT_EDITOR_FONT_SIZE,
        );
        return;
      }
      if (paletteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (!workspaceLockedRef.current && !modalOpen) {
          setCommandPaletteOpen(true);
        }
        return;
      }
      if (
        workspaceLockedRef.current ||
        modalOpen
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
      } else if (isNewTabShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (!workspace) {
          showError("Open a vault before creating a tab.");
        } else if (
          workspace.encryption.enabled &&
          !workspace.encryption.unlocked
        ) {
          showError("Unlock the vault before creating a tab.");
        } else {
          createNewTab();
        }
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
        focusVaultSearch();
      } else if (isReplaceShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        setReplaceOpen(true);
      } else if (
        modifier &&
        event.key.toLocaleLowerCase() === "s" &&
        activeFileTab
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (activeFileTab.kind !== "image" || activeFileTab.rawEditing) {
          void saveTab(activeFileTab.path, activeFileTab.content, "manual save");
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
        activateTab(tabs[(index + direction + tabs.length) % tabs.length].path);
      } else if (event.key === "Escape" && showOutline) {
        setShowOutline(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    actionDialog,
    activePath,
    activeFileTab,
    activateTab,
    closeTab,
    createNewTab,
    createEntry,
    commandPaletteOpen,
    editorDisplaySettings.fontSize,
    editorSettingsOpen,
    encryptionOpen,
    focusVaultSearch,
    historyOpen,
    pendingExternalLink,
    replaceOpen,
    saveTab,
    showError,
    showOutline,
    tabs,
    updateEditorFontSize,
    vaultSwitcherOpen,
    workspace,
  ]);

  const macOS = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const commandKey = macOS ? "⌘" : "Ctrl+";
  const workspaceReady =
    workspace !== null &&
    (!workspace.encryption.enabled || workspace.encryption.unlocked);
  const orderedTabs = tabsInVisualOrder(tabs);
  const activeTabIndex = orderedTabs.findIndex(
    (tab) => tab.path === activePath,
  );
  const backHistoryTarget = activeTab ? tabHistoryTarget(activeTab, -1) : null;
  const forwardHistoryTarget = activeTab
    ? tabHistoryTarget(activeTab, 1)
    : null;
  const activeGroup = activeTab?.groupId
    ? tabGroups.find((group) => group.id === activeTab.groupId) ?? null
    : null;
  const activeSiblings =
    workspace && activeNode ? findSiblings(workspace.tree, activeNode.path) : [];
  const activeNodeIndex = activeNode
    ? activeSiblings.findIndex((node) => node.path === activeNode.path)
    : -1;
  const canMoveActiveUp =
    activeNodeIndex > 0 &&
    activeSiblings[activeNodeIndex - 1]?.pinned === activeNode?.pinned;
  const canMoveActiveDown =
    activeNodeIndex >= 0 &&
    activeNodeIndex < activeSiblings.length - 1 &&
    activeSiblings[activeNodeIndex + 1]?.pinned === activeNode?.pinned;
  const activeFileEditable =
    activeFileTab !== null &&
    (activeFileTab.kind !== "image" || activeFileTab.rawEditing);
  const commandPaletteCommands: CommandPaletteCommand[] = [
    {
      id: "file.find",
      title: "Find file across vaults",
      description: "Search known vaults by filename.",
      category: "Navigation",
      shortcut: `${commandKey}P`,
      kind: "file-search",
      keywords: ["open", "quick"],
    },
    {
      id: "navigation.back",
      title: "Go back in current tab",
      description: "Open the previous file visited in this tab.",
      category: "Navigation",
      disabled: backHistoryTarget === null,
      run: () => navigateTabHistory(-1),
    },
    {
      id: "navigation.forward",
      title: "Go forward in current tab",
      description: "Open the next file visited in this tab.",
      category: "Navigation",
      disabled: forwardHistoryTarget === null,
      run: () => navigateTabHistory(1),
    },
    {
      id: "vault.search",
      title: "Search current vault",
      description: "Search note contents, tags, names, and metadata.",
      category: "Navigation",
      shortcut: `${commandKey}F`,
      disabled: !workspaceReady,
      run: focusVaultSearch,
    },
    {
      id: "vault.switch",
      title: "Switch vault",
      description: "Choose from known vaults.",
      category: "Vault",
      shortcut: macOS ? "⇧⌘O" : "Ctrl+Shift+O",
      run: () => setVaultSwitcherOpen(true),
    },
    {
      id: "vault.open",
      title: "Open vault folder",
      description: "Add or open a local folder as a vault.",
      category: "Vault",
      run: chooseVault,
    },
    {
      id: "vault.refresh",
      title: "Refresh current vault",
      description: "Rescan files and rebuild search.",
      category: "Vault",
      disabled: !workspaceReady,
      run: refreshAndReindex,
    },
    {
      id: "view.files",
      title: "Show files",
      description: "Open the file-tree sidebar.",
      category: "View",
      disabled: !workspaceReady,
      run: () => setSidebarView("files"),
    },
    {
      id: "view.search",
      title: "Show vault search",
      description: "Open and focus the search sidebar.",
      category: "View",
      disabled: !workspaceReady,
      run: focusVaultSearch,
    },
    {
      id: "view.bookmarks",
      title: "Show bookmarks",
      description: "Open bookmarked files.",
      category: "View",
      disabled: !workspaceReady,
      run: () => setSidebarView("bookmarks"),
    },
    {
      id: "view.recent",
      title: "Show recent files",
      description: "Open recently viewed files.",
      category: "View",
      disabled: !workspaceReady,
      run: () => setSidebarView("recent"),
    },
    {
      id: "view.trash",
      title: "Show trash",
      description: "Open deleted files that can be restored.",
      category: "View",
      disabled: !workspaceReady,
      run: () => setSidebarView("trash"),
    },
    {
      id: "file.new",
      title: "Create new file",
      description: "Create a file beside the current selection.",
      category: "File",
      shortcut: `${commandKey}N`,
      disabled: !workspaceReady,
      run: () => createEntry(false),
    },
    {
      id: "folder.new",
      title: "Create new folder",
      description: "Create a folder beside the current selection.",
      category: "File",
      disabled: !workspaceReady,
      run: () => createEntry(true),
    },
    {
      id: "tab.new",
      title: "Create blank tab",
      description: "Open an empty slot for the next file.",
      category: "Tab",
      shortcut: `${commandKey}T`,
      disabled: !workspaceReady,
      run: createNewTab,
    },
    {
      id: "tab.close",
      title: "Close current tab",
      description: "Save and close the active tab.",
      category: "Tab",
      shortcut: `${commandKey}W`,
      disabled: activePath === null,
      run: () => (activePath ? closeTab(activePath) : undefined),
    },
    {
      id: "tab.next",
      title: "Switch to next tab",
      description: "Activate the next open tab.",
      category: "Tab",
      shortcut: "Ctrl+Tab",
      disabled: activeTabIndex < 0 || orderedTabs.length < 2,
      run: () => {
        if (activeTabIndex >= 0 && orderedTabs.length > 1) {
          activateTab(orderedTabs[(activeTabIndex + 1) % orderedTabs.length].path);
        }
      },
    },
    {
      id: "tab.previous",
      title: "Switch to previous tab",
      description: "Activate the previous open tab.",
      category: "Tab",
      shortcut: "Ctrl+Shift+Tab",
      disabled: activeTabIndex < 0 || orderedTabs.length < 2,
      run: () => {
        if (activeTabIndex >= 0 && orderedTabs.length > 1) {
          activateTab(
            orderedTabs[
              (activeTabIndex - 1 + orderedTabs.length) % orderedTabs.length
            ].path,
          );
        }
      },
    },
    {
      id: "tab.move-left",
      title: "Move current tab left",
      description: "Reorder the active tab one position left.",
      category: "Tab",
      shortcut: macOS ? "⌥⇧←" : "Alt+Shift+Left",
      disabled: activeTabIndex <= 0,
      run: () => {
        if (activePath && activeTabIndex > 0) {
          reorderTabs(activePath, orderedTabs[activeTabIndex - 1].path);
        }
      },
    },
    {
      id: "tab.move-right",
      title: "Move current tab right",
      description: "Reorder the active tab one position right.",
      category: "Tab",
      shortcut: macOS ? "⌥⇧→" : "Alt+Shift+Right",
      disabled:
        activeTabIndex < 0 || activeTabIndex >= orderedTabs.length - 1,
      run: () => {
        if (
          activePath &&
          activeTabIndex >= 0 &&
          activeTabIndex < orderedTabs.length - 1
        ) {
          reorderTabs(activePath, orderedTabs[activeTabIndex + 1].path);
        }
      },
    },
    {
      id: "tab.close-others",
      title: "Close other tabs",
      description: "Keep only the active tab.",
      category: "Tab",
      disabled: activePath === null || tabs.length < 2,
      run: () =>
        closeTabs(
          orderedTabs
            .filter((tab) => tab.path !== activePath)
            .map((tab) => tab.path),
        ),
    },
    {
      id: "tab.close-left",
      title: "Close tabs to the left",
      description: "Close every tab before the active tab.",
      category: "Tab",
      disabled: activeTabIndex <= 0,
      run: () =>
        closeTabs(
          orderedTabs.slice(0, Math.max(activeTabIndex, 0)).map((tab) => tab.path),
        ),
    },
    {
      id: "tab.close-right",
      title: "Close tabs to the right",
      description: "Close every tab after the active tab.",
      category: "Tab",
      disabled:
        activeTabIndex < 0 || activeTabIndex >= orderedTabs.length - 1,
      run: () =>
        closeTabs(orderedTabs.slice(activeTabIndex + 1).map((tab) => tab.path)),
    },
    {
      id: "tab.close-all",
      title: "Close all tabs",
      description: "Save and close every open tab.",
      category: "Tab",
      disabled: tabs.length === 0,
      run: () => closeTabs(orderedTabs.map((tab) => tab.path)),
    },
    {
      id: "tab.group-create",
      title: "Create group for current tab",
      description: "Create and name a collapsible tab group.",
      category: "Tab",
      disabled:
        activePath === null ||
        activeGroup !== null ||
        tabGroups.length >= MAX_TAB_SESSION_GROUPS,
      run: () => (activePath ? createTabGroup(activePath) : undefined),
    },
    {
      id: "tab.group-rename",
      title: "Rename current tab group",
      description: "Change the active tab group's name.",
      category: "Tab",
      disabled: activeGroup === null,
      run: () =>
        activeGroup ? renameTabGroup(activeGroup.id) : undefined,
    },
    {
      id: "tab.group-remove",
      title: "Remove current tab from group",
      description: "Keep the tab open outside its group.",
      category: "Tab",
      disabled: activePath === null || activeGroup === null,
      run: () => {
        if (activePath) {
          moveTabToGroup(activePath, null);
        }
      },
    },
    {
      id: "file.save",
      title: "Save current file",
      description: "Save active editor content immediately.",
      category: "File",
      shortcut: `${commandKey}S`,
      disabled: !activeFileEditable,
      run: () =>
        activeFileTab
          ? saveTab(activeFileTab.path, activeFileTab.content, "manual save")
          : undefined,
    },
    {
      id: "file.rename",
      title: "Rename current file",
      description: "Rename the active file in its folder.",
      category: "File",
      disabled: activeNode === null,
      run: () => (activeNode ? renameNode(activeNode) : undefined),
    },
    {
      id: "file.move",
      title: "Move current file to folder",
      description: "Move the active file elsewhere in this vault.",
      category: "File",
      disabled: activeNode === null,
      run: () => (activeNode ? requestMoveNode(activeNode) : undefined),
    },
    {
      id: "file.move-up",
      title: "Move current file up",
      description: "Change its custom order among sibling files.",
      category: "File",
      disabled: !canMoveActiveUp,
      run: () => moveNodeInOrder(activeNode, -1),
    },
    {
      id: "file.move-down",
      title: "Move current file down",
      description: "Change its custom order among sibling files.",
      category: "File",
      disabled: !canMoveActiveDown,
      run: () => moveNodeInOrder(activeNode, 1),
    },
    {
      id: "file.pin",
      title: activeNode?.pinned ? "Unpin current file" : "Pin current file",
      description: "Change whether the active file stays above its siblings.",
      category: "File",
      disabled: activeNode === null,
      run: () => togglePinnedNode(activeNode),
    },
    {
      id: "file.bookmark",
      title: activeNode?.bookmarked
        ? "Remove current file bookmark"
        : "Bookmark current file",
      description: "Change the active file's bookmark.",
      category: "File",
      disabled: activeNode === null || activeNode.kind === "folder",
      run: () => toggleBookmarkForNode(activeNode),
    },
    {
      id: "file.trash",
      title: "Move current file to trash",
      description: "Move the active file to Denote Trash.",
      category: "File",
      disabled: activeNode === null,
      run: () => (activeNode ? trashNode(activeNode) : undefined),
    },
    {
      id: "file.reload",
      title: "Reload current file from disk",
      description: "Discard editor state after confirmation if needed.",
      category: "File",
      disabled: activeFileTab === null,
      run: reloadActiveTab,
    },
    {
      id: "file.copy-content",
      title: "Copy current file content",
      description: "Copy the in-memory content to the clipboard.",
      category: "Clipboard",
      disabled: activeFileTab === null,
      run: copyActiveFileContent,
    },
    {
      id: "file.copy-attachment",
      title: "Copy current file for attachment",
      description: "Copy a native attachment-ready file.",
      category: "Clipboard",
      disabled: activeFileTab === null,
      run: copyActiveFileForAttachment,
    },
    {
      id: "file.copy-path",
      title: "Copy current file path",
      description: "Copy the absolute path to the clipboard.",
      category: "Clipboard",
      disabled: activeFileTab === null,
      run: copyActiveFilePath,
    },
    {
      id: "links.open-all",
      title: "Open all external links",
      description: "Open every unique web link in the current file.",
      category: "Navigation",
      disabled: activeWebLinks.length === 0,
      run: () =>
        openWebLinksWithPolicy(activeWebLinks, externalDomainPolicy),
    },
    {
      id: "file.history",
      title: "Open current file history",
      description: "View and restore saved revisions.",
      category: "File",
      disabled: activeFileTab === null,
      run: openHistory,
    },
    {
      id: "editor.replace",
      title: "Find and replace",
      description: "Replace text in the current file or vault.",
      category: "Editor",
      shortcut: macOS ? "⌥⌘F" : "Ctrl+H",
      disabled: !workspaceReady,
      run: () => setReplaceOpen(true),
    },
    {
      id: "editor.image-mode",
      title: activeFileTab?.rawEditing
        ? "Preview current image"
        : "Edit current image as raw file",
      description: "Switch between image preview and Base64 editing.",
      category: "Editor",
      disabled: activeFileTab?.kind !== "image",
      run: toggleRawEditing,
    },
    {
      id: "editor.outline",
      title: showOutline ? "Hide document outline" : "Show document outline",
      description: "Toggle the Markdown table of contents.",
      category: "View",
      disabled:
        activeFileTab?.kind !== "markdown" ||
        activeFileTab.encoding !== "utf8",
      run: () => setShowOutline((current) => !current),
    },
    {
      id: "editor.settings",
      title: "Open settings",
      description: "Change font size, guides, and session restore.",
      category: "Editor",
      disabled: !workspaceReady,
      run: () => setEditorSettingsOpen(true),
    },
    {
      id: "editor.zoom-in",
      title: "Increase editor text size",
      description: "Increase the persistent editor font size.",
      category: "Editor",
      shortcut: `${commandKey}+`,
      disabled: editorDisplaySettings.fontSize >= MAX_EDITOR_FONT_SIZE,
      run: () => updateEditorFontSize(editorDisplaySettings.fontSize + 1),
    },
    {
      id: "editor.zoom-out",
      title: "Decrease editor text size",
      description: "Decrease the persistent editor font size.",
      category: "Editor",
      shortcut: `${commandKey}−`,
      disabled: editorDisplaySettings.fontSize <= MIN_EDITOR_FONT_SIZE,
      run: () => updateEditorFontSize(editorDisplaySettings.fontSize - 1),
    },
    {
      id: "editor.zoom-reset",
      title: "Reset editor text size",
      description: `Return to ${DEFAULT_EDITOR_FONT_SIZE}px.`,
      category: "Editor",
      shortcut: `${commandKey}0`,
      disabled: editorDisplaySettings.fontSize === DEFAULT_EDITOR_FONT_SIZE,
      run: () => updateEditorFontSize(DEFAULT_EDITOR_FONT_SIZE),
    },
    {
      id: "vault.encryption",
      title: "Manage vault encryption",
      description: "Enable, lock, or change encryption settings.",
      category: "Vault",
      disabled: !workspaceReady,
      run: () => setEncryptionOpen(true),
    },
    {
      id: "vault.lock",
      title: "Lock encrypted vault",
      description: "Save, encrypt, and close the current vault content.",
      category: "Vault",
      disabled:
        workspace === null ||
        !workspace.encryption.enabled ||
        !workspace.encryption.unlocked,
      run: lockEncryptedVault,
    },
    {
      id: "trash.empty",
      title: "Empty trash permanently",
      description: "Permanently delete every item in Denote Trash.",
      category: "Vault",
      disabled: !workspaceReady || (workspace?.trash.length ?? 0) === 0,
      run: emptyTrash,
    },
    {
      id: "appearance.theme",
      title: `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
      description: "Change the application color theme.",
      category: "Appearance",
      run: () =>
        setTheme((current) => (current === "dark" ? "light" : "dark")),
    },
  ];

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
  const commandPalette = (
    <CommandPalette
      open={commandPaletteOpen}
      commands={commandPaletteCommands}
      onLoadFiles={api.listKnownVaultFiles}
      onOpenFile={openKnownVaultFile}
      onCommandError={showError}
      onClose={() => setCommandPaletteOpen(false)}
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
        {commandPalette}
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
        {commandPalette}
      </>
    );
  }

  return (
    <div
      className="app-shell"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--editor-font-size": `${editorDisplaySettings.fontSize}px`,
        } as CSSProperties
      }
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
              onRename={(node) => void renameNode(node)}
              onDelete={(node) => void trashNode(node)}
              onMove={(node, targetParentPath) =>
                void moveNode(node, targetParentPath)
              }
              onRequestMove={(node) => void requestMoveNode(node)}
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
            groups={tabGroups}
            activePath={activePath}
            disabled={workspaceLocked}
            onActivate={activateTab}
            onClose={(path) => void closeTab(path)}
            onCloseMany={(paths) => void closeTabs(paths)}
            onReorder={reorderTabs}
            onNewTab={createNewTab}
            onToggleGroup={toggleTabGroup}
            onCreateGroup={(path) => void createTabGroup(path)}
            onRenameGroup={(groupId) => void renameTabGroup(groupId)}
            onMoveToGroup={moveTabToGroup}
          />
          <div className="workspace-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Go back in current tab"
              title="Go back in current tab"
              disabled={backHistoryTarget === null || workspaceLocked}
              onClick={() => void navigateTabHistory(-1)}
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Go forward in current tab"
              title="Go forward in current tab"
              disabled={forwardHistoryTarget === null || workspaceLocked}
              onClick={() => void navigateTabHistory(1)}
            >
              <ArrowRight aria-hidden="true" size={16} />
            </button>
            {activeFileTab?.kind === "image" ? (
              <button
                type="button"
                className="icon-button"
                aria-label={
                  activeFileTab.rawEditing
                    ? "Preview image"
                    : "Edit image as raw file"
                }
                title={
                  activeFileTab.rawEditing
                    ? "Preview image"
                    : "Edit image as raw file"
                }
                aria-pressed={activeFileTab.rawEditing}
                disabled={workspaceLocked}
                onClick={toggleRawEditing}
              >
                {activeFileTab.rawEditing ? (
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
              disabled={!activeFileTab || workspaceLocked}
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
              disabled={!activeFileTab || workspaceLocked}
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
              disabled={!activeFileTab || workspaceLocked}
              onClick={() => void copyActiveFilePath()}
            >
              <Copy aria-hidden="true" size={16} />
            </button>
            {activeWebLinks.length > 0 ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Open all external links"
                title={`Open all ${activeWebLinks.length} external link${
                  activeWebLinks.length === 1 ? "" : "s"
                }`}
                disabled={workspaceLocked}
                onClick={() =>
                  void openWebLinksWithPolicy(
                    activeWebLinks,
                    externalDomainPolicy,
                  )
                }
              >
                <ExternalLinkIcon aria-hidden="true" size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              aria-label="Reload active file from disk"
              title="Reload active file from disk"
              disabled={!activeFileTab || workspaceLocked}
              onClick={() => void reloadActiveTab()}
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Open note history"
              title="History"
              disabled={!activeFileTab}
              onClick={() => void openHistory()}
            >
              <History aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Open settings"
              title="Settings"
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
                activeFileTab?.kind === "markdown" &&
                activeFileTab.encoding === "utf8"
                  ? "Hide"
                  : "Show"
              } outline`}
              title={`${
                showOutline &&
                activeFileTab?.kind === "markdown" &&
                activeFileTab.encoding === "utf8"
                  ? "Hide"
                  : "Show"
              } outline`}
              aria-pressed={
                activeFileTab?.kind === "markdown" &&
                activeFileTab.encoding === "utf8" &&
                showOutline
              }
              disabled={
                !activeFileTab ||
                activeFileTab.kind !== "markdown" ||
                activeFileTab.encoding !== "utf8"
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
            {activeTab?.placeholder ? (
              <div className="editor-empty">
                <div className="editor-empty__mark">+</div>
                <h2>New tab</h2>
                <p>Choose a file from the sidebar to open it in this tab.</p>
              </div>
            ) : activeFileTab ? (
              <>
                {activeFileTab.kind === "image" && !activeFileTab.rawEditing ? (
                  <figure className="image-viewer">
                    <img
                      src={activeFileTab.imageDataUrl}
                      alt={activeFileTab.title}
                    />
                    <figcaption>{activeFileTab.path}</figcaption>
                  </figure>
                ) : activeFileTab.kind === "markdown" &&
                  activeFileTab.encoding === "utf8" &&
                  !activeFileTab.path.toLocaleLowerCase().endsWith(".mdx") ? (
                  <MarkdownEditor
                    key={`${activeFileTab.path}:${activeFileTab.editorRevision}:${editorDisplayKey}`}
                    notePath={activeFileTab.path}
                    markdown={activeFileTab.content}
                    lineEnding={activeFileTab.lineEnding}
                    displaySettings={editorDisplaySettings}
                    preferredViewMode={markdownViewMode}
                    readOnly={workspaceLocked}
                    tagColors={tagColorMap}
                    onChange={changeActiveContent}
                    onError={showError}
                    onLinkOpen={(href, text) => void openLink(href, text)}
                    onViewModeChange={updateMarkdownViewMode}
                    onImageUpload={uploadAttachment}
                  />
                ) : (
                  <>
                    {activeFileTab.encoding === "base64" ? (
                      <div className="binary-editor-notice" role="note">
                        Binary file shown as reversible Base64. Invalid Base64
                        will not be saved.
                      </div>
                    ) : null}
                    <PlainTextEditor
                      key={`${activeFileTab.path}:${activeFileTab.editorRevision}`}
                      ariaLabel={`Edit ${activeFileTab.title}`}
                      value={activeFileTab.content}
                      readOnly={workspaceLocked}
                      spellCheck={
                        activeFileTab.encoding === "utf8" &&
                        sourceLanguageName(activeFileTab.path) === null
                      }
                      binary={activeFileTab.encoding === "base64"}
                      filePath={
                        activeFileTab.encoding === "utf8"
                          ? activeFileTab.path
                          : null
                      }
                      lineEnding={activeFileTab.lineEnding}
                      displaySettings={editorDisplaySettings}
                      onChange={changeActiveContent}
                      onError={showError}
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
          activeFileTab?.kind === "markdown" &&
          activeFileTab.encoding === "utf8" ? (
            <TableOfContents
              headings={headings}
              onNavigate={navigateToHeading}
            />
          ) : null}
        </div>
        <footer className="status-bar">
          <span>{activeFileTab?.path ?? activeTab?.title ?? workspace.vaultPath}</span>
          <span className="status-bar__spacer" />
          {activeFileTab ? (
            <>
              <span>
                {activeFileTab.encoding === "utf8"
                  ? wordCountLabel(activeFileTab.content)
                  : "Base64"}
              </span>
              <span>{activeFileTab.content.length} characters</span>
              <span>
                {activeFileTab.stats
                  ? `${activeFileTab.stats.openCount} opens · ${activeFileTab.stats.editCount} edits · ${activeFileTab.stats.saveCount} saves`
                  : "UTF-8"}
              </span>
              <span data-save-state={activeFileTab.saveState}>
                {activeFileTab.saveState}
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
        title={activeFileTab?.title ?? "Note"}
        revisions={historyRevisions}
        loading={historyLoading}
        onClose={() => setHistoryOpen(false)}
        onRestore={(revisionId) => void restoreRevision(revisionId)}
      />
      <ReplaceDialog
        open={replaceOpen}
        currentPath={
          activeFileTab &&
          (activeFileTab.kind !== "image" || activeFileTab.rawEditing)
            ? activeFileTab.path
            : null
        }
        onClose={() => setReplaceOpen(false)}
        onPreview={previewReplace}
        onApply={applyReplace}
      />
      <EditorSettingsDialog
        open={editorSettingsOpen}
        disabled={workspaceLocked}
        settings={editorDisplaySettings}
        restoreTabs={workspace.restoreTabs}
        externalDomains={externalDomainPolicy.domains}
        allowAllExternalDomains={externalDomainPolicy.allowAll}
        onChange={updateEditorDisplaySettings}
        onRestoreTabsChange={updateRestoreTabs}
        onRemoveExternalDomain={removeExternalDomain}
        onClearExternalDomains={clearExternalDomains}
        onClose={() => setEditorSettingsOpen(false)}
      />
      <ExternalLinkDialog
        open={pendingExternalLink !== null}
        kind={pendingExternalLink?.kind ?? "domain"}
        subject={pendingExternalLink?.subject ?? ""}
        url={pendingExternalLink?.url ?? ""}
        onAllow={() => void allowPendingExternalLink(false)}
        onAllowAll={() => void allowPendingExternalLink(true)}
        onCancel={() => setPendingExternalLink(null)}
      />
      {vaultSwitcherDialog}
      {commandPalette}
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
