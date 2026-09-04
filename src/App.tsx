import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronsUpDown,
  ClipboardCopy,
  Copy,
  Eye,
  EyeOff,
  ExternalLink as ExternalLinkIcon,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
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
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  PluginProjectRepositoryContext,
  PluginSourceControlAction,
  PluginSourceControlDiffFile,
  PluginSourceControlDiffSource,
} from "@denote/plugin-sdk";
import { ActivityRail } from "./components/ActivityRail";
import { AboutDialog } from "./components/AboutDialog";
import { ActionDialog } from "./components/ActionDialog";
import {
  CommandPalette,
  type CommandPaletteCommand,
} from "./components/CommandPalette";
import { EncryptionDialog } from "./components/EncryptionDialog";
import { EditorSettingsDialog } from "./components/EditorSettingsDialog";
import { ErrorBanner } from "./components/ErrorBanner";
import { ExternalLinkDialog } from "./components/ExternalLinkDialog";
import { FileTree } from "./components/FileTree";
import { GitProjectSuggestion } from "./components/GitProjectSuggestion";
import {
  FileActionsDropdown,
  type FileActionHandlers,
} from "./components/FileActionsMenu";
import { OutlineResizer } from "./components/OutlineResizer";
import { PaneDockOverlay } from "./components/PaneDockOverlay";
import { PaneResizer } from "./components/PaneResizer";
import { SidebarResizer } from "./components/SidebarResizer";
import { HistoryDialog } from "./components/HistoryDialog";
import {
  MarkdownEditor,
  type MarkdownEditorDiagnostic,
} from "./components/MarkdownEditor";
import { PlainTextEditor } from "./components/PlainTextEditor";
import { ReplaceDialog } from "./components/ReplaceDialog";
import { SearchPanel } from "./components/SearchPanel";
import { SourceControlPanel } from "./components/SourceControlPanel";
import type { SourceControlActionHostOptions } from "./components/SourceControlPanel";
import { SourceControlDiffEditor } from "./components/SourceControlDiffEditor";
import { SourceOutline } from "./components/SourceOutline";
import { SourceLanguageStatus } from "./components/SourceLanguageStatus";
import { TableOfContents } from "./components/TableOfContents";
import { TagChip } from "./components/TagChip";
import { Tabs } from "./components/Tabs";
import { VaultUnlockScreen } from "./components/VaultUnlockScreen";
import { VaultSwitcherDialog } from "./components/VaultSwitcherDialog";
import { Welcome } from "./components/Welcome";
import { api, errorMessage } from "./lib/api";
import {
  appErrorsReducer,
  INITIAL_APP_ERRORS,
  markdownAppErrorForPath,
  visibleAppError,
} from "./lib/appErrors";
import { BUILD_INFO } from "./lib/buildInfo";
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
  markdownEditorSource,
  nextHeadingSlug,
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
import {
  createEmptySearchFilters,
  VaultSearchIndex,
  type SearchFilters,
  type SearchRequest,
} from "./lib/search";
import {
  resolveSourceLanguage,
  type SourceLanguageOverride,
} from "./lib/syntaxLanguages";
import {
  shouldPublishOutline,
  type StableOutlineSnapshot,
} from "./lib/outlineStability";
import { buildProjectCommands } from "./lib/projectCommands";
import { welcomePageTarget } from "./lib/welcomePage";
import {
  getShowDotfiles,
  saveShowDotfiles,
} from "./lib/fileVisibility";
import {
  applyGitignoreStatusUpdate,
  enqueueGitignoreStatusOperation,
  gitignoreRefreshScope,
  ignoredPathsAfterWorkspaceSnapshot,
  isGitignorePath,
  removeIgnoredPathsAtOrBelow,
} from "./lib/gitignoreStatus";
import {
  MAX_TAB_SESSION_GROUPS,
  MAX_TAB_SESSION_TABS,
  moveTabInLayout,
  placeOpenedTab,
  placeTabInGroup,
  rekeyTabNavigation,
  restoreTabHistoryTarget,
  tabHasUnsavedChanges,
  tabHistoryTarget,
  tabReferencedPaths,
  tabsReferencePath,
  tabsInVisualOrder,
} from "./lib/tabs";
import {
  addPane,
  applyPaneSessionState,
  buildPaneSessionState,
  closePane,
  createPaneWorkspace,
  dockTab,
  findPaneByGroup,
  findPaneByPath,
  focusedPaneOf,
  layoutsForPaneCount,
  MAX_PANES,
  movePaneTab,
  normalizePaneLayout,
  PANE_LAYOUT_LABELS,
  paneAccessibleLabel,
  paneAreas,
  paneGroupOffset,
  paneGroups,
  paneLayoutTracks,
  paneSeparators,
  paneTabs,
  prunePaneGroups,
  removePaneTabs,
  resizePaneLayout,
  setPaneActivePath,
  setPaneLayoutKind,
  updatePane,
  upgradeTabSession,
  type PaneDockPosition,
  type PaneWorkspaceState,
} from "./lib/panes";
import {
  paneDockTargetFromPoint,
  sameDockTarget,
  type PaneDockTarget,
} from "./lib/paneDocking";
import {
  applyWorkspaceBulkAction,
  closestAvailableProjectRoot,
  initialWorkspaceFolderPaths,
  insertWorkspaceNode,
  isDotEntry,
  projectConfigurationFields,
  projectRootLabel,
  removeProjectConfigurationAtOrBelow,
  removeWorkspacePath,
  workspaceBulkActionState,
  workspaceBulkExpansion,
  workspaceAncestorPaths,
  workspacePathMatches,
  withProjectConfiguration,
} from "./lib/workspaceTree";
import {
  usesProjectMarkdownSourceEditor,
  usesRichMarkdownEditor,
} from "./lib/editorRouting";
import { acquireWorkspaceLockAndDrainProjectMutations } from "./lib/workspaceOperation";
import { resolveTagColor, type TagColorMap } from "./lib/tagColors";
import {
  editorZoomShortcut,
  isClosePaneShortcut,
  isCommandPaletteShortcut,
  isNewFileShortcut,
  isNewTabShortcut,
  isReplaceShortcut,
  isSearchShortcut,
  isSettingsShortcut,
  isSplitPaneShortcut,
  paneFocusShortcut,
} from "./lib/shortcuts";
import {
  previewReplacements,
  type ReplaceApplySummary,
  type ReplacePreview,
  type ReplaceRequest,
} from "./lib/replace";
import { applyTheme, getTheme, type Theme } from "./lib/theme";
import { usePlugins } from "./plugins/usePlugins";
import { useAutomaticLocalCommits } from "./plugins/useAutomaticLocalCommits";
import { resolveCommitMessage } from "./plugins/commitMessages";
import type { PluginAutomaticLocalCommitContribution } from "./plugins/workerRuntime";
import { getOutlineWidth, saveOutlineWidth } from "./lib/outlineWidth";
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
import { markdownErrorSourceIdentity } from "./lib/markdownErrors";
import {
  sourceControlDiffPath,
  sourceControlDiffTitle,
  sourceControlPatch,
} from "./lib/sourceControlDiff";
import type {
  SourceEditorNavigation,
  SourceMinimapLine,
  SourceSymbol,
  SourceViewport,
} from "./lib/sourceOutline";
import type {
  EditorSearchNavigation,
  EditorTab,
  FileNode,
  GitignoreStatusUpdate,
  HeadingItem,
  HistoryRevision,
  KnownVaultFile,
  NoteDocument,
  PaneLayoutKind,
  ProjectConfiguration,
  ProjectRoot,
  ProjectWorkspace,
  SearchResult,
  SidebarView,
  TabGroup,
  TabSessionState,
  TagColor,
  WorkspacePane,
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
  completion: Promise<boolean>;
  source: string | null;
  settle: (succeeded: boolean) => void;
}

interface LinkRewriteSave {
  content: string;
  outcome: Awaited<ReturnType<typeof api.saveNote>>;
  encoding: EditorTab["encoding"];
  lineEnding: EditorTab["lineEnding"];
}

interface OutlineCacheEntry {
  ready: boolean;
  snapshot: StableOutlineSnapshot | null;
}

function outlineCacheKey(
  vaultPath: string,
  path: string,
  languageId: string | null,
): string {
  return `${vaultPath}\u0000${path}\u0000${languageId ?? "markdown"}`;
}

function sourceViewportCacheKey(
  vaultPath: string,
  paneId: string,
  path: string,
): string {
  return `${vaultPath}\u0000${paneId}\u0000${path}`;
}

const DOCK_POSITION_LABELS: Record<PaneDockPosition, string> = {
  center: "into the pane",
  "tab-strip": "into the pane",
  left: "to the left",
  right: "to the right",
  top: "above",
  bottom: "below",
};

const WORKSPACE_MUTATING_SOURCE_CONTROL_ACTIONS = new Set([
  "initialize",
  "stage",
  "unstage",
  "stage-all",
  "unstage-all",
  "restore-from-upstream",
  "restore-all-from-upstream",
  "stage-hunk",
  "unstage-hunk",
  "commit",
  "commit-and-push",
  "pull",
  "add-remote",
  "set-remote-url",
  "remove-remote",
  "create-branch",
  "switch-branch",
  "checkout-remote-branch",
  "rename-branch",
  "delete-branch",
  "rename-remote-branch",
  "delete-remote-branch",
  "branch-switch-commit",
  "branch-switch-stash",
  "stash",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "continue",
  "skip",
  "abort",
  "resolve-conflict",
  "resolve-conflict-stage",
  "clone",
]);

/**
 * Source-control actions that can replace what is on disk.
 *
 * A checkout, a merge, and everything that resumes one rewrite tracked files
 * underneath the editor. Every open note was already flushed before the action
 * started, so after one of these the workspace is read again and every open tab
 * is reloaded from disk: what the editor shows is then the branch the
 * repository is actually on, never a mixture of two.
 */
const WORKTREE_CHANGING_SOURCE_CONTROL_ACTIONS = new Set([
  "switch-branch",
  "checkout-remote-branch",
  "create-branch",
  "branch-switch-commit",
  "branch-switch-stash",
  "pull",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "continue",
  "skip",
  "abort",
  // Resolving a conflict writes the chosen content into the vault, so the
  // editor has to read that file again like any other checkout would.
  "resolve-conflict",
  "resolve-conflict-stage",
]);

/**
 * The four operations Denote runs, and the labels it uses for them.
 *
 * A confirmation is built from this map alone, so an action can only ever be
 * confirmed as one of the operations the host itself knows: a provider cannot
 * supply wording, and a value that is not one of these is confirmed in the
 * neutral wording below instead.
 */
const ADVANCED_OPERATION_LABELS: Record<string, string> = {
  merge: "merge",
  rebase: "rebase",
  "cherry-pick": "cherry-pick",
  revert: "revert",
};

const CONFLICT_SIDE_LABELS: Record<string, string> = {
  base: "the common ancestor",
  ours: "this branch's side",
  theirs: "the incoming side",
};

/** The typed operation an action names, or null when it names none. */
function advancedOperation(values: Record<string, unknown>): string | null {
  const operation = values.operation ?? values.sequencer;
  return typeof operation === "string" &&
    operation in ADVANCED_OPERATION_LABELS
    ? operation
    : null;
}

/**
 * Confirmations the host owns for source-control actions that reach a remote,
 * change where a remote points, or delete something.
 *
 * The exact remote, URL, and branch are always named, so a confirmation can
 * never be about a different repository than the one the user is looking at. A
 * plugin cannot suppress, reword, or pre-answer one: the host reads the action
 * it was given and decides.
 */
function sourceControlConfirmation(
  action: PluginSourceControlAction,
  repositoryLabel = "",
): Omit<ActionDialogState, "mode" | "initialValue"> | null {
  const values = action.values ?? {};
  const value = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : "";
  const flag = (key: string) => values[key] === true;
  const remote = value("remote");
  const branch = value("branch");
  const name = value("name");
  const url = value("url");
  const path = value("path");
  const from = value("from");
  const newName = value("newName");
  const startPoint = value("startPoint");
  const remoteBranch = value("remoteBranch");
  const localName = value("localName");
  const leaving = from ? `"${from}"` : "the current branch";
  switch (action.id) {
    case "switch-branch":
      return {
        title: "Switch branches",
        message: `Switch from ${leaving} to "${branch}"? Denote saves open notes first, and the checkout can change, add, or remove files in this vault.`,
        confirmLabel: "Switch branch",
        dangerous: false,
      };
    case "create-branch":
      return {
        title: flag("checkout") ? "Create and switch" : "Create a branch",
        message: `Create "${name}" from ${startPoint ? `"${startPoint}"` : leaving}${
          flag("checkout")
            ? ", then switch to it? Denote saves open notes first, and the checkout can change, add, or remove files in this vault."
            : "? You stay on the branch you are on and nothing in this vault changes."
        }`,
        confirmLabel: flag("checkout") ? "Create and switch" : "Create branch",
        dangerous: false,
      };
    case "checkout-remote-branch":
      return {
        title: "Check out a remote branch",
        message: `Create the local branch "${localName}" from "${remoteBranch}" and switch to it from ${leaving}? Denote saves open notes first, and the checkout can change, add, or remove files in this vault.`,
        confirmLabel: "Check out",
        dangerous: false,
      };
    case "rename-branch":
      return {
        title: "Rename a branch",
        message: `Rename the local branch "${name}" to "${newName}"? Its commits stay exactly as they are, and any remote branch keeps its own name.`,
        confirmLabel: "Rename branch",
        dangerous: false,
      };
    case "delete-branch":
      return {
        title: "Delete a branch",
        message: `Delete the local branch "${name}"? Commits that exist only on it can become unreachable. Denote never deletes the branch you are on, and never deletes a remote branch.`,
        confirmLabel: "Delete branch",
        dangerous: true,
      };
    case "rename-remote-branch":
      return {
        title: "Rename a remote branch",
        message: `Rename the remote branch "${name}" to "${newName}"? Denote first creates the new remote branch, then removes the old one. If the second step fails, both names remain and Denote reports it.`,
        confirmLabel: "Rename remote branch",
        dangerous: true,
      };
    case "delete-remote-branch":
      return {
        title: "Delete a remote branch",
        message: `Delete the remote branch "${name}"? Other people may still be using it. Local branches and commits remain unchanged.`,
        confirmLabel: "Delete remote branch",
        dangerous: true,
      };
    case "branch-switch-commit":
    case "branch-switch-stash": {
      // The review can be holding a checkout or one of the four operations, so
      // the confirmation names whichever typed operation will actually run.
      const operation = advancedOperation(values);
      const preserving =
        action.id === "branch-switch-commit"
          ? {
              title: "Commit everything, then ",
              lead: `Commit every listed change on ${leaving}`,
              tail: "Denote commits exactly the files it listed and discards nothing.",
              label: "Commit and ",
            }
          : {
              title: "Stash everything, then ",
              lead: `Stash every listed change from ${leaving}`,
              tail: "The work is kept in the repository's stash; Denote never drops a stash for you.",
              label: "Stash and ",
            };
      if (!operation) {
        return {
          title: `${preserving.title}switch`,
          message: `${preserving.lead} and then switch to "${branch}"? ${preserving.tail}`,
          confirmLabel: `${preserving.label}switch`,
          dangerous: false,
        };
      }
      const named = ADVANCED_OPERATION_LABELS[operation];
      return {
        title: `${preserving.title}${named}`,
        message: `${preserving.lead} and then ${named} "${branch}"? ${preserving.tail}${
          operation === "rebase"
            ? ` The rebase then rewrites the commits on ${leaving}: they are recorded again with new identities.`
            : ""
        }`,
        confirmLabel: `${preserving.label}${named}`,
        dangerous: operation === "rebase",
      };
    }
    case "pull":
      return {
        title: "Pull from a remote",
        message: `Pull "${branch}" from "${remote}" into this vault? Denote saves open notes first, and the pull can change, add, or remove files in the vault.`,
        confirmLabel: "Pull",
        dangerous: false,
      };
    case "restore-from-upstream":
    case "restore-all-from-upstream":
      return {
        title: "Restore from the remote branch",
        message: `Replace ${
          action.id === "restore-all-from-upstream"
            ? "all tracked staged and working-tree changes"
            : `the staged and working-tree versions of "${path}"`
        }${
          repositoryLabel ? ` in ${repositoryLabel}` : ""
        } with the version on its current upstream branch? Local changes to ${
          action.id === "restore-all-from-upstream"
            ? "those tracked files"
            : "this tracked file"
        } will be lost. Untracked files are never removed.`,
        confirmLabel:
          action.id === "restore-all-from-upstream"
            ? "Restore tracked files"
            : "Restore file",
        dangerous: true,
      };
    case "push":
      return {
        title: "Push to a remote",
        message: `Push "${branch}" to "${remote}"? This publishes the commits on that branch to the remote.`,
        confirmLabel: "Push",
        dangerous: false,
      };
    case "commit-and-push":
      return {
        title: "Commit and push",
        message: `Commit the staged changes, then push "${branch}" to "${remote}"? If the commit succeeds but the push fails, the commit stays safely recorded locally.`,
        confirmLabel: "Commit and push",
        dangerous: false,
      };
    case "set-remote-url":
      return {
        title: "Change a remote URL",
        message: `Point the "${name}" remote at ${url}? Every later fetch, pull, and push for "${name}" will use that address instead.`,
        confirmLabel: "Change URL",
        dangerous: true,
      };
    case "remove-remote":
      return {
        title: "Remove a remote",
        message: `Remove the "${name}" remote? Its remote-tracking branches are removed with it. Your commits and files stay exactly as they are.`,
        confirmLabel: "Remove remote",
        dangerous: true,
      };
    case "clone":
      return {
        title: "Clone a repository",
        message: `Clone ${url}${branch ? ` on branch "${branch}"` : ""} into an empty folder you choose? Denote saves and closes the current vault, then opens the clone as a vault.`,
        confirmLabel: "Choose a folder",
        dangerous: false,
      };
    case "clean-failed-clone":
      return {
        title: "Delete the incomplete clone",
        message:
          "Permanently delete the folder that the failed clone left behind? Everything inside it is removed. Denote checks first that the folder is still that failed clone and nothing else.",
        confirmLabel: "Delete the folder",
        dangerous: true,
      };
    case "merge":
    case "rebase":
    case "cherry-pick":
    case "revert": {
      // The action ID is the operation, so the wording can never describe
      // something other than what will run.
      const operation = action.id;
      const target = operation === "merge" || operation === "rebase"
        ? `"${value("ref")}"`
        : `commit ${value("commitId")}`;
      // The review names the branch it was prepared on, so the confirmation
      // says which branch changes rather than "the current branch". The only
      // wording left for a missing name is the state that has no branch.
      const changing = from ? `"${from}"` : "the detached HEAD you are on";
      const rewrites = operation === "rebase";
      return {
        title: `Start a ${operation}`,
        message: rewrites
          ? `Rebase ${changing} onto ${target}? This rewrites the commits on ${changing}: they are recorded again with new identities, and anyone who already has them will see a different history. Denote saves open notes first, and the rebase can change, add, or remove files in this vault.`
          : `${operation === "merge" ? "Merge" : operation === "cherry-pick" ? "Cherry-pick" : "Revert"} ${target} into ${changing}? Denote saves open notes first, and the operation can change, add, or remove files in this vault. It may stop with conflicts for you to resolve.`,
        confirmLabel: `Start ${operation}`,
        dangerous: rewrites,
      };
    }
    case "continue":
    case "skip":
    case "abort": {
      const operation = advancedOperation(values);
      const named = operation
        ? `the ${ADVANCED_OPERATION_LABELS[operation]}`
        : "the operation in progress";
      if (action.id === "continue") {
        return {
          title: "Continue the operation",
          message: `Continue ${named}? Git records what you have staged and carries on. Denote saves open notes first, and the vault can change as it does.`,
          confirmLabel: "Continue",
          dangerous: false,
        };
      }
      if (action.id === "skip") {
        return {
          title: "Skip this step",
          message: `Skip this step of ${named}? The commit being replayed is dropped: its change is not recorded anywhere, and this cannot be undone from Denote.`,
          confirmLabel: "Skip the step",
          dangerous: true,
        };
      }
      return {
        title: "Abort the operation",
        message: `Abort ${named}? The repository goes back to the state it was in before the operation started, and every conflict resolution you have made in it is discarded.`,
        confirmLabel: "Abort",
        dangerous: true,
      };
    }
    case "resolve-conflict":
      return {
        title: "Mark the conflict resolved",
        message:
          "Write the merged result into the vault and stage it? The conflicted copy of that file is replaced by the result you reviewed. Every other conflicted file stays as it is.",
        confirmLabel: "Mark resolved",
        dangerous: false,
      };
    case "resolve-conflict-stage": {
      const side = value("side");
      const named =
        side in CONFLICT_SIDE_LABELS
          ? CONFLICT_SIDE_LABELS[side]
          : "the chosen side";
      return {
        title: "Resolve with one whole side",
        message: `Replace the conflicted file with ${named}, exactly as Git recorded it, and stage it? The other sides of that file are not kept in the vault.`,
        confirmLabel: "Use that side",
        dangerous: true,
      };
    }
    default:
      return null;
  }
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [activePluginSidebar, setActivePluginSidebar] = useState<string | null>(
    null,
  );
  const [activeSourceControlProvider, setActiveSourceControlProvider] =
    useState<{
      pluginId: string;
      providerId: string;
    } | null>(null);
  const showSidebarView = useCallback((view: SidebarView) => {
    setActiveSourceControlProvider(null);
    setActivePluginSidebar(null);
    setSidebarView(view);
  }, []);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [showDotfiles, setShowDotfiles] = useState(() => getShowDotfiles());
  const showDotfilesRef = useRef(showDotfiles);
  const [paneState, setPaneState] = useState<PaneWorkspaceState>(() =>
    createPaneWorkspace(),
  );
  const [dockTarget, setDockTarget] = useState<PaneDockTarget | null>(null);
  const [showOutline, setShowOutline] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLocation, setSearchLocation] = useState("*");
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(() =>
    createEmptySearchFilters(),
  );
  const [searchQueryFocusRequest, setSearchQueryFocusRequest] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchNavigation, setSearchNavigation] = useState<
    (EditorSearchNavigation & { path: string }) | null
  >(null);
  const [indexing, setIndexing] = useState(false);
  const [errors, dispatchErrors] = useReducer(
    appErrorsReducer,
    INITIAL_APP_ERRORS,
  );
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
  const [aboutOpen, setAboutOpen] = useState(false);
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
  const [activeDocumentAnalysis, setActiveDocumentAnalysis] = useState<{
    path: string;
    content: string;
    links: string[];
  } | null>(null);
  const outlineCache = useRef(new Map<string, OutlineCacheEntry>());
  const outlineGeneration = useRef(new Map<string, number>());
  const [, setOutlineRevision] = useState(0);
  const [sourceViewports, setSourceViewports] = useState<
    Record<string, SourceViewport>
  >({});
  const [sourceNavigation, setSourceNavigation] = useState<
    (SourceEditorNavigation & { path: string }) | null
  >(null);
  const sourceNavigationSequence = useRef(0);
  const errorSequence = useRef(0);
  const [headingNavigation, setHeadingNavigation] = useState<{
    path: string;
    anchor: string;
  } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => getSidebarWidth());
  const [outlineWidth, setOutlineWidth] = useState(() => getOutlineWidth());
  const [workspaceLocked, setWorkspaceLocked] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null,
  );
  const [historyRevisions, setHistoryRevisions] = useState<HistoryRevision[]>(
    [],
  );
  const [historyTarget, setHistoryTarget] = useState<{
    path: string;
    title: string;
  } | null>(null);
  const searchIndex = useRef(new VaultSearchIndex());
  const searchIndexReady = useRef(false);
  const searchRequestRef = useRef<SearchRequest>({
    query: searchQuery,
    location: searchLocation,
    filters: searchFilters,
  });
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
  /**
   * Opens the vault a host clone produced. It is held in a ref because the
   * plugin runtime is created before the workspace loader exists, and because
   * the snapshot must never travel any further than the host renderer.
   */
  const clonedVaultHandler = useRef<
    (snapshot: WorkspaceSnapshot) => Promise<void>
  >(async () => {});
  /** True once a source-control action has already swapped the workspace. */
  const clonedDuringAction = useRef(false);
  const indexTimer = useRef<number | null>(null);
  const pendingWelcomePage = useRef<string | null>(null);
  const pendingWorkspaceFile = useRef<{
    vaultPath: string;
    path: string;
  } | null>(null);
  const activePathRef = useRef<string | null>(null);
  const searchNavigationRequest = useRef(0);
  const paneStateRef = useRef<PaneWorkspaceState>(paneState);
  const openFileRequests = useRef(new Map<string, number>());
  const openFileQueue = useRef<Promise<void>>(Promise.resolve());
  const paneResizeBase = useRef<PaneWorkspaceState["layout"] | null>(null);
  const newTabSequence = useRef(0);
  const tabGroupSequence = useRef(0);
  const vaultGeneration = useRef(0);
  const workspaceVaultPathRef = useRef<string | null>(
    workspace?.vaultPath ?? null,
  );
  workspaceVaultPathRef.current = workspace?.vaultPath ?? null;
  const closingWindow = useRef(false);
  const workspaceLockedRef = useRef(false);
  const modalOpenRef = useRef(false);
  const commandPaletteCommandsRef = useRef<CommandPaletteCommand[]>([]);
  const previousActiveProjectId = useRef<string | null>(null);
  const projectConfigurationRevision = useRef(0);
  const projectConfigurationMutationTail = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const gitignoreStatusTail = useRef<Promise<void>>(Promise.resolve());
  const gitignoreSnapshotUpdates = useRef(
    new Map<number, GitignoreStatusUpdate[]>(),
  );
  const workspaceLockTail = useRef<Promise<void>>(Promise.resolve());
  const workspaceLockRelease = useRef<(() => void) | null>(null);
  const actionDialogResolver = useRef<((value: string | null) => void) | null>(
    null,
  );
  const actionDialogReturnFocus = useRef<HTMLElement | null>(null);

  const commitPaneState = useCallback(
    (updater: (current: PaneWorkspaceState) => PaneWorkspaceState) => {
      const updated = updater(paneStateRef.current);
      if (updated === paneStateRef.current) {
        return;
      }
      const panes =
        updated.panes.length > 0
          ? updated.panes.map(prunePaneGroups)
          : createPaneWorkspace().panes;
      const next: PaneWorkspaceState = {
        panes,
        layout: normalizePaneLayout(updated.layout, panes.length),
        focusedPaneId: panes.some((pane) => pane.id === updated.focusedPaneId)
          ? updated.focusedPaneId
          : panes[0].id,
      };
      paneStateRef.current = next;
      tabsRef.current = paneTabs(next.panes);
      tabGroupsRef.current = paneGroups(next.panes);
      activePathRef.current = focusedPaneOf(next).activePath;
      setPaneState(next);
    },
    [],
  );
  const commitPanes = useCallback(
    (updater: (current: WorkspacePane[]) => WorkspacePane[]) => {
      commitPaneState((current) => ({
        ...current,
        panes: updater(current.panes),
      }));
    },
    [commitPaneState],
  );
  const commitTabs = useCallback(
    (updater: (current: EditorTab[]) => EditorTab[]) => {
      commitPanes((panes) =>
        panes.map((pane) => {
          const tabs = updater(pane.tabs);
          const unchanged =
            tabs.length === pane.tabs.length &&
            tabs.every((tab, index) => tab === pane.tabs[index]);
          return unchanged ? pane : { ...pane, tabs };
        }),
      );
    },
    [commitPanes],
  );
  const nextOpenRequest = useCallback((paneId: string) => {
    const next = (openFileRequests.current.get(paneId) ?? 0) + 1;
    openFileRequests.current.set(paneId, next);
    return next;
  }, []);
  const openRequestCurrent = useCallback(
    (paneId: string, request: number) =>
      (openFileRequests.current.get(paneId) ?? 0) === request,
    [],
  );
  const invalidateOpenRequests = useCallback(() => {
    const paneIds = new Set([
      ...openFileRequests.current.keys(),
      ...paneStateRef.current.panes.map((pane) => pane.id),
    ]);
    for (const paneId of paneIds) {
      openFileRequests.current.set(
        paneId,
        (openFileRequests.current.get(paneId) ?? 0) + 1,
      );
    }
  }, []);
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

  const panes = paneState.panes;
  const paneLayout = paneState.layout;
  const focusedPaneId = paneState.focusedPaneId;
  const focusedPane = focusedPaneOf(paneState);
  const tabs = focusedPane.tabs;
  const tabGroups = focusedPane.groups;
  const activePath = focusedPane.activePath;
  useEffect(() => {
    setSearchNavigation((current) =>
      current?.path === activePath ? current : null,
    );
    setSourceNavigation((current) =>
      current?.path === activePath ? current : null,
    );
  }, [activePath]);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );
  const activeFileTab =
    activeTab?.placeholder || activeTab?.transient ? null : activeTab;
  const activeProject = useMemo(
    () =>
      closestAvailableProjectRoot(
        workspace?.projectRoots ?? [],
        activeFileTab?.path ?? null,
      ),
    [activeFileTab?.path, workspace?.projectRoots],
  );
  const vaultIsWorkspace =
    workspace?.projectWorkspaces.some(
      (projectWorkspace) =>
        projectWorkspace.available && projectWorkspace.rootPath === "",
    ) ?? false;
  const activeCodeContext = activeProject !== null || vaultIsWorkspace;
  const activeSourceOutlineAvailable =
    activeCodeContext &&
    activeFileTab !== null &&
    activeFileTab.encoding === "utf8" &&
    activeFileTab.kind !== "markdown" &&
    activeFileTab.kind !== "image";
  const activeSourceLanguageId = activeSourceOutlineAvailable
    ? (resolveSourceLanguage(
        activeFileTab.path,
        activeFileTab.languageOverride ?? null,
      ).language?.id ?? null)
    : null;
  const outlineAvailable =
    activeFileTab?.encoding === "utf8" &&
    (activeFileTab.kind === "markdown" || activeSourceOutlineAvailable);
  const outlineVisible = showOutline && outlineAvailable;
  useEffect(() => {
    const nextProjectId = activeProject?.id ?? null;
    if (nextProjectId === previousActiveProjectId.current) {
      return;
    }
    previousActiveProjectId.current = nextProjectId;
    setStatus(
      activeProject
        ? `Active project: ${activeProject.rootPath || "Vault root"}`
        : "No active project",
    );
  }, [activeProject]);
  const activeMarkdownSource =
    activeProject === null &&
    activeFileTab?.kind === "markdown" &&
    activeFileTab.encoding === "utf8"
      ? markdownErrorSourceIdentity(
          markdownEditorSource(activeFileTab.content),
        )
      : null;
  const visibleError = visibleAppError(
    errors,
    activePath,
    activeMarkdownSource,
  );
  const visibleErrorId = visibleError?.id ?? null;
  const dismissVisibleError = useCallback(() => {
    if (visibleErrorId !== null) {
      dispatchErrors({ type: "dismiss", id: visibleErrorId });
    }
  }, [visibleErrorId]);
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
  const folderExpansion = useMemo(
    () =>
      workspace
        ? workspaceBulkExpansion(workspace.tree, showDotfiles)
        : { folderPaths: [], excludedRootPaths: [], hiddenRootPaths: [] },
    [showDotfiles, workspace],
  );
  const folderBulkAction = useMemo(
    () => workspaceBulkActionState(folderExpansion, expandedPaths),
    [expandedPaths, folderExpansion],
  );
  const ignoredPaths = useMemo(
    () => new Set(workspace?.ignoredPaths ?? []),
    [workspace?.ignoredPaths],
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
  const tags = useMemo(
    () =>
      activeFileTab &&
      activeFileTab.encoding === "utf8" &&
      (activeFileTab.kind !== "image" || activeFileTab.rawEditing)
        ? extractTags(activeFileTab.content)
        : [],
    [activeFileTab],
  );
  const activeOutlineKey =
    workspace && activeFileTab
      ? outlineCacheKey(
          workspace.vaultPath,
          activeFileTab.path,
          activeFileTab.kind === "markdown" ? null : activeSourceLanguageId,
        )
      : null;
  const activeOutlineEntry = activeOutlineKey
    ? outlineCache.current.get(activeOutlineKey)
    : undefined;
  const stableOutline = activeOutlineEntry?.snapshot ?? null;
  const outlineLoading = activeOutlineEntry?.ready !== true;
  const analysisMatchesActiveFile =
    activeFileTab &&
    activeDocumentAnalysis?.path === activeFileTab.path &&
    activeDocumentAnalysis.content === activeFileTab.content;
  const headings =
    activeFileTab?.kind === "markdown"
      ? (stableOutline?.headings ?? [])
      : [];
  const sourceSymbols =
    activeSourceOutlineAvailable
      ? (stableOutline?.symbols ?? [])
      : [];
  const sourceMinimap =
    activeSourceOutlineAvailable
      ? (stableOutline?.minimap ?? [])
      : [];
  const activeWebLinks = analysisMatchesActiveFile
    ? activeDocumentAnalysis.links
    : [];
  useEffect(() => {
    if (
      !activeFileTab ||
      activeFileTab.encoding !== "utf8" ||
      !activeOutlineKey
    ) {
      return;
    }
    const generation = (outlineGeneration.current.get(activeOutlineKey) ?? 0) + 1;
    outlineGeneration.current.set(activeOutlineKey, generation);
    const currentEntry = outlineCache.current.get(activeOutlineKey);
    outlineCache.current.set(activeOutlineKey, {
      ready: currentEntry?.ready ?? false,
      snapshot: currentEntry?.snapshot ?? null,
    });
    setOutlineRevision((current) => current + 1);

    let worker: Worker | null = null;
    let settleTimer: number | null = null;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./workers/linkExtraction.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (
          event: MessageEvent<{
            links?: string[];
            headings?: HeadingItem[];
            symbols?: SourceSymbol[];
            minimap?: SourceMinimapLine[];
            incompleteHeading?: boolean;
            error?: string;
          }>,
        ) => {
          worker?.terminate();
          worker = null;
          if (outlineGeneration.current.get(activeOutlineKey) !== generation) {
            return;
          }
          if (event.data.error) {
            console.error(
              `Unable to analyze ${activeFileTab.path}: ${event.data.error}`,
            );
            const failedEntry = outlineCache.current.get(activeOutlineKey);
            outlineCache.current.set(activeOutlineKey, {
              ready: failedEntry?.ready ?? false,
              snapshot: failedEntry?.snapshot ?? null,
            });
            setOutlineRevision((current) => current + 1);
            return;
          }
          setActiveDocumentAnalysis({
            path: activeFileTab.path,
            content: activeFileTab.content,
            links: event.data.links ?? [],
          });
          const candidate: StableOutlineSnapshot = {
            headings: event.data.headings ?? [],
            symbols: event.data.symbols ?? [],
            minimap: event.data.minimap ?? [],
          };
          const publish = () => {
            if (outlineGeneration.current.get(activeOutlineKey) !== generation) {
              return;
            }
            outlineCache.current.set(activeOutlineKey, {
              ready: true,
              snapshot: candidate,
            });
            setOutlineRevision((current) => current + 1);
          };
          const previous =
            outlineCache.current.get(activeOutlineKey)?.snapshot ?? null;
          const incomplete = event.data.incompleteHeading === true;
          if (
            shouldPublishOutline(previous, candidate, {
              incomplete,
              settled: false,
            })
          ) {
            publish();
          } else if (!incomplete || previous === null) {
            settleTimer = window.setTimeout(publish, 400);
          } else {
            const pendingEntry = outlineCache.current.get(activeOutlineKey);
            outlineCache.current.set(activeOutlineKey, {
              ready: pendingEntry?.ready ?? false,
              snapshot: pendingEntry?.snapshot ?? null,
            });
            setOutlineRevision((current) => current + 1);
          }
        };
        worker.onerror = (event) => {
          worker?.terminate();
          worker = null;
          if (outlineGeneration.current.get(activeOutlineKey) !== generation) {
            return;
          }
          console.error(
            `Unable to analyze ${activeFileTab.path}: ${event.message}`,
          );
          const failedEntry = outlineCache.current.get(activeOutlineKey);
          outlineCache.current.set(activeOutlineKey, {
            ready: failedEntry?.ready ?? false,
            snapshot: failedEntry?.snapshot ?? null,
          });
          setOutlineRevision((current) => current + 1);
        };
        worker.postMessage({
          markdown: activeFileTab.content,
          languageId: activeSourceLanguageId,
          includeSourceOutline: activeSourceOutlineAvailable,
        });
      } catch (caught) {
        console.error(
          `Unable to analyze ${activeFileTab.path}:`,
          caught,
        );
      }
    }, 200);

    return () => {
      if (outlineGeneration.current.get(activeOutlineKey) === generation) {
        outlineGeneration.current.set(activeOutlineKey, generation + 1);
      }
      window.clearTimeout(timer);
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      worker?.terminate();
    };
  }, [
    activeFileTab?.content,
    activeFileTab?.encoding,
    activeFileTab?.path,
    activeOutlineKey,
    activeSourceOutlineAvailable,
    activeSourceLanguageId,
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
    dispatchErrors({
      type: "show-global",
      error: {
        id: ++errorSequence.current,
        message,
        kind: "generic",
      },
    });
    setStatus("Action failed");
  }, []);
  const toggleDotfileVisibility = useCallback(() => {
    const next = !showDotfilesRef.current;
    try {
      saveShowDotfiles(next);
      showDotfilesRef.current = next;
      setShowDotfiles(next);
      if (
        !next &&
        selectedPath?.split("/").some((segment) => isDotEntry(segment))
      ) {
        setSelectedPath(null);
      }
    } catch (caught) {
      showError(caught);
    }
  }, [selectedPath, showError]);
  const pluginProjectContext = useMemo(
    () =>
      activeProject
        ? {
            projectId: activeProject.id,
            rootPath: activeProject.rootPath,
          }
        : null,
    [activeProject?.id, activeProject?.rootPath],
  );
  const pluginRepositoryKey = (workspace?.projectRoots ?? [])
    .map(
      (project) =>
        `${project.id}\u0000${project.rootPath}\u0000${project.available}\u0000${project.gitRepository === true}`,
    )
    .join("\u0001");
  const pluginProjectRepositories = useMemo<PluginProjectRepositoryContext[]>(
    () => {
      if (!workspace) {
        return [];
      }
      const repositories: PluginProjectRepositoryContext[] = [];
      if (workspace.gitRepositoryRoot) {
        repositories.push({
          repositoryId: "vault",
          projectId: null,
          label: workspace.vaultName,
        });
      }
      for (const project of workspace.projectRoots) {
        if (
          project.available &&
          project.gitRepository &&
          project.rootPath.length > 0
        ) {
          repositories.push({
            repositoryId: `project:${project.id}`,
            projectId: project.id,
            label: projectRootLabel(project),
          });
        }
      }
      return repositories;
    },
    [
      pluginRepositoryKey,
      workspace?.gitRepositoryRoot,
      workspace?.vaultName,
    ],
  );
  const pluginController = usePlugins(
    showError,
    pluginProjectContext,
    workspace?.vaultPath ?? null,
    (snapshot) => clonedVaultHandler.current(snapshot),
    pluginProjectRepositories,
  );
  const pluginDecorationKey = pluginController.decorations
    .map(
      (decoration) =>
        `${decoration.id}:${decoration.pattern}:${decoration.style}:${decoration.caseSensitive}`,
    )
    .join("\u0000");
  const shutdownPlugins = pluginController.shutdown;
  const emitPluginNoteEvent = pluginController.emitNoteEvent;
  const invalidatePluginActions = pluginController.invalidateActionLeases;
  const runPluginSourceControlAction =
    pluginController.runSourceControlAction;
  const initiallyRefreshedProviders = useRef(new Set<string>());
  useEffect(() => {
    if (!workspace) {
      return;
    }
    const availableKeys = new Set(
      pluginController.sourceControlProviders.map(
        (provider) =>
          `${workspace.vaultPath}\u0000${provider.pluginId}\u0000${provider.id}`,
      ),
    );
    for (const key of initiallyRefreshedProviders.current) {
      if (key.startsWith(`${workspace.vaultPath}\u0000`) && !availableKeys.has(key)) {
        initiallyRefreshedProviders.current.delete(key);
      }
    }
    for (const provider of pluginController.sourceControlProviders) {
      if (!provider.model.repository.label.endsWith("refresh required")) {
        continue;
      }
      const key = `${workspace.vaultPath}\u0000${provider.pluginId}\u0000${provider.id}`;
      if (initiallyRefreshedProviders.current.has(key)) {
        continue;
      }
      initiallyRefreshedProviders.current.add(key);
      void runPluginSourceControlAction(
        provider.pluginId,
        provider.id,
        { id: "refresh" },
        workspace.vaultPath,
      ).catch(showError);
    }
  }, [
    pluginController.sourceControlProviders,
    runPluginSourceControlAction,
    showError,
    workspace,
  ]);
  useEffect(() => {
    invalidatePluginActions();
  }, [invalidatePluginActions, workspace?.vaultPath]);
  const previousPluginNotes = useRef(
    new Map<
      string,
      {
        content: string;
        saveState: EditorTab["saveState"];
      }
    >(),
  );
  useEffect(() => {
    const previous = previousPluginNotes.current;
    const current = new Map<
      string,
      {
        content: string;
        saveState: EditorTab["saveState"];
      }
    >();
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        if (tab.placeholder) {
          continue;
        }
        current.set(tab.path, {
          content: tab.content,
          saveState: tab.saveState,
        });
      }
    }
    for (const path of previous.keys()) {
      if (!current.has(path)) {
        emitPluginNoteEvent({ path, kind: "closed" });
      }
    }
    for (const [path, note] of current) {
      const prior = previous.get(path);
      if (!prior) {
        emitPluginNoteEvent({ path, kind: "opened" });
      } else {
        if (prior.content !== note.content) {
          emitPluginNoteEvent({ path, kind: "changed" });
        }
        if (prior.saveState === "saving" && note.saveState === "saved") {
          emitPluginNoteEvent({ path, kind: "saved" });
        }
      }
    }
    previousPluginNotes.current = current;
  }, [emitPluginNoteEvent, panes]);

  const showLinkError = useCallback((value: unknown) => {
    const message = errorMessage(value);
    dispatchErrors({
      type: "show-link",
      error: {
        id: ++errorSequence.current,
        message,
        kind: "link",
      },
    });
    setStatus("Link failed");
  }, []);

  const showMarkdownError = useCallback(
    (path: string, diagnostic: MarkdownEditorDiagnostic) => {
      if (!tabsReferencePath(tabsRef.current, path)) {
        return;
      }
      const location = diagnostic.location ?? undefined;
      dispatchErrors({
        type: "show-markdown",
        error: {
          id: ++errorSequence.current,
          message: location
            ? `Line ${location.line}, column ${location.column}: ${diagnostic.message}`
            : diagnostic.message,
          kind: "markdown",
          path,
          source: markdownErrorSourceIdentity(diagnostic.source),
          location,
          navigationRequest: 0,
        },
      });
      setStatus("Markdown error");
    },
    [],
  );

  const clearMarkdownError = useCallback((path: string) => {
    dispatchErrors({ type: "clear-markdown", path });
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
        const searchRequest = searchRequestRef.current;
        const results = await nextIndex.query(searchRequest);
        if (
          generation === vaultGeneration.current &&
          request === rebuildRequest.current &&
          searchRequest === searchRequestRef.current
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
      const ignoredUpdates: GitignoreStatusUpdate[] = [];
      gitignoreSnapshotUpdates.current.set(request, ignoredUpdates);
      const configurationRevision = projectConfigurationRevision.current;
      try {
        const snapshot = await api.refreshVault();
        if (
          generation !== vaultGeneration.current ||
          request !== workspaceRefreshRequest.current
        ) {
          return;
        }
        setWorkspace((current) => {
          const next =
            configurationRevision === projectConfigurationRevision.current
              ? snapshot
              : withProjectConfiguration(snapshot, current ?? snapshot);
          return {
            ...next,
            ignoredPaths: ignoredPathsAfterWorkspaceSnapshot(
              next.ignoredPaths,
              ignoredUpdates,
            ),
          };
        });
        await rebuildSearchIndex(generation);
      } catch (caught) {
        if (
          generation === vaultGeneration.current &&
          request === workspaceRefreshRequest.current
        ) {
          setIndexing(false);
          showError(caught);
        }
      } finally {
        gitignoreSnapshotUpdates.current.delete(request);
      }
    },
    [rebuildSearchIndex, showError],
  );

  const loadWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, resetTabs: boolean) => {
      if (resetTabs) {
        finishActionDialog(null);
      }
      invalidateOpenRequests();
      const vaultLocked =
        snapshot.encryption.enabled && !snapshot.encryption.unlocked;
      if (indexTimer.current) {
        window.clearTimeout(indexTimer.current);
        indexTimer.current = null;
      }
      rebuildRequest.current += 1;
      workspaceRefreshRequest.current += 1;
      gitignoreSnapshotUpdates.current.clear();
      queryRequest.current += 1;
      searchIndex.current = new VaultSearchIndex();
      searchIndexReady.current = false;
      setSearchResults([]);
      setSearchNavigation(null);
      if (resetTabs || vaultLocked) {
        dispatchErrors({ type: "clear-all" });
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
        const hasPendingWorkspaceFile =
          pendingWorkspaceFile.current?.vaultPath === snapshot.vaultPath;
        pendingTabSession.current =
          !hasPendingWorkspaceFile && snapshot.restoreTabs
            ? (snapshot.tabSession ?? null)
            : null;
        restoringTabSession.current = pendingTabSession.current !== null;
        pendingWelcomePage.current = welcomePageTarget(
          {
            effectivePath: snapshot.welcomePage.effectivePath,
            hasTabSession: snapshot.tabSession !== null,
          },
          hasPendingWorkspaceFile,
        );
      }
      setIndexing(false);
      const vaultViewMode =
        snapshot.markdownViewMode ?? getMarkdownViewMode();
      setMarkdownViewMode(vaultViewMode);
      setWorkspace({ ...snapshot, markdownViewMode: vaultViewMode });
      setSelectedPath(null);
      setExpandedPaths(
        new Set(
          initialWorkspaceFolderPaths(
            snapshot.tree,
            8,
            showDotfilesRef.current,
          ),
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
        commitPaneState(() => createPaneWorkspace());
        openFileRequests.current.clear();
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
      commitPaneState,
      finishActionDialog,
      invalidateOpenRequests,
      queueVaultViewModeWrite,
      rebuildSearchIndex,
      refreshCachedWorkspace,
    ],
  );

  const refreshWorkspace = useCallback(
    async (reindex = false): Promise<WorkspaceSnapshot | null> => {
      if (!workspace) {
        return null;
      }
      const generation = vaultGeneration.current;
      const request = ++workspaceRefreshRequest.current;
      const ignoredUpdates: GitignoreStatusUpdate[] = [];
      gitignoreSnapshotUpdates.current.set(request, ignoredUpdates);
      const configurationRevision = projectConfigurationRevision.current;
      let applied: WorkspaceSnapshot | null = null;
      try {
        const snapshot = await api.refreshVault();
        if (
          generation === vaultGeneration.current &&
          request === workspaceRefreshRequest.current
        ) {
          setWorkspace((current) => {
            const next =
              configurationRevision === projectConfigurationRevision.current
                ? snapshot
                : withProjectConfiguration(snapshot, current ?? snapshot);
            return {
              ...next,
              ignoredPaths: ignoredPathsAfterWorkspaceSnapshot(
                next.ignoredPaths,
                ignoredUpdates,
              ),
            };
          });
          // Only the file tree is reported back, and it is the same in either
          // branch of the updater above, so it is read from the snapshot
          // rather than from a state updater React may run later.
          applied = snapshot;
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
      } finally {
        gitignoreSnapshotUpdates.current.delete(request);
      }
      return applied;
    },
    [rebuildSearchIndex, showError, workspace],
  );

  const applyProjectConfiguration = useCallback(
    (
      configuration: ProjectConfiguration,
      expectedGeneration: number,
      expectedVaultPath: string,
    ) => {
      if (expectedGeneration !== vaultGeneration.current) {
        return;
      }
      setWorkspace((current) =>
        current?.vaultPath === expectedVaultPath
          ? withProjectConfiguration(current, configuration)
          : current,
      );
    },
    [],
  );

  const refreshIgnoredStatus = useCallback(
    async (
      expectedGeneration: number,
      expectedVaultPath: string,
      scopePaths: string[],
    ): Promise<boolean> => {
      const operation = async (): Promise<boolean> => {
        if (
          expectedGeneration !== vaultGeneration.current ||
          workspaceVaultPathRef.current !== expectedVaultPath
        ) {
          return false;
        }
        try {
          const update = await api.refreshGitignoreStatus(
            expectedVaultPath,
            scopePaths,
          );
          if (
            expectedGeneration !== vaultGeneration.current ||
            workspaceVaultPathRef.current !== expectedVaultPath ||
            !update.complete
          ) {
            return false;
          }
          for (const updates of gitignoreSnapshotUpdates.current.values()) {
            updates.push(update);
          }
          setWorkspace((current) =>
            current?.vaultPath === expectedVaultPath
              ? {
                  ...current,
                  ignoredPaths: applyGitignoreStatusUpdate(
                    current.ignoredPaths,
                    update,
                  ),
                }
              : current,
          );
          return true;
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspaceVaultPathRef.current === expectedVaultPath
          ) {
            console.error("Unable to refresh .gitignore status:", caught);
          }
          return false;
        }
      };
      const queued = enqueueGitignoreStatusOperation(
        gitignoreStatusTail.current,
        operation,
      );
      gitignoreStatusTail.current = queued.tail;
      return await queued.result;
    },
    [],
  );

  const enqueueProjectConfigurationMutation = useCallback(
    async (operation: () => Promise<void>) => {
      const queued = projectConfigurationMutationTail.current.then(operation);
      projectConfigurationMutationTail.current = queued.catch(() => {});
      await queued;
    },
    [],
  );

  const markProject = useCallback(
    async (path: string) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      await enqueueProjectConfigurationMutation(async () => {
        if (expectedGeneration !== vaultGeneration.current) {
          return;
        }
        try {
          const configuration = await api.markProjectRoot(
            expectedVaultPath,
            path,
          );
          applyProjectConfiguration(
            configuration,
            expectedGeneration,
            expectedVaultPath,
          );
          projectConfigurationRevision.current += 1;
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            [],
          );
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            setStatus(
              path === ""
                ? "Marked the vault root as a project"
                : `Marked ${path} as a project`,
            );
          }
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            showError(caught);
          } else {
            console.error(`Unable to mark project root ${path}:`, caught);
          }
        }
      });
    },
    [
      applyProjectConfiguration,
      enqueueProjectConfigurationMutation,
      refreshIgnoredStatus,
      showError,
      workspace,
    ],
  );

  const unmarkProject = useCallback(
    async (projectRoot: ProjectRoot) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      await enqueueProjectConfigurationMutation(async () => {
        if (expectedGeneration !== vaultGeneration.current) {
          return;
        }
        try {
          const configuration = await api.unmarkProjectRoot(
            expectedVaultPath,
            projectRoot.id,
          );
          applyProjectConfiguration(
            configuration,
            expectedGeneration,
            expectedVaultPath,
          );
          projectConfigurationRevision.current += 1;
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            [],
          );
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            setStatus(
              projectRoot.rootPath === ""
                ? "Unmarked the vault root project"
                : `Unmarked ${projectRoot.rootPath} as a project`,
            );
          }
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            showError(caught);
          } else {
            console.error(
              `Unable to unmark project root ${projectRoot.rootPath}:`,
              caught,
            );
          }
        }
      });
    },
    [
      applyProjectConfiguration,
      enqueueProjectConfigurationMutation,
      refreshIgnoredStatus,
      showError,
      workspace,
    ],
  );

  const unmarkAllProjects = useCallback(async () => {
    const explicitProjectRoots =
      workspace?.projectRoots.filter((projectRoot) => projectRoot.explicit) ?? [];
    if (
      !workspace ||
      workspaceLockedRef.current ||
      explicitProjectRoots.length === 0
    ) {
      return;
    }
    const expectedGeneration = vaultGeneration.current;
    const expectedVaultPath = workspace.vaultPath;
    await enqueueProjectConfigurationMutation(async () => {
      const failures: string[] = [];
      let authoritativeConfiguration = projectConfigurationFields(workspace);
      let changed = false;
      for (const projectRoot of explicitProjectRoots) {
        if (
          expectedGeneration !== vaultGeneration.current ||
          workspace.vaultPath !== expectedVaultPath
        ) {
          return;
        }
        try {
          authoritativeConfiguration = await api.unmarkProjectRoot(
            expectedVaultPath,
            projectRoot.id,
          );
          changed = true;
        } catch (caught) {
          failures.push(
            `${projectRoot.rootPath || "Vault root"}: ${errorMessage(caught)}`,
          );
        }
      }
      applyProjectConfiguration(
        authoritativeConfiguration,
        expectedGeneration,
        expectedVaultPath,
      );
      if (changed) {
        projectConfigurationRevision.current += 1;
        await refreshIgnoredStatus(
          expectedGeneration,
          expectedVaultPath,
          [],
        );
      }
      if (failures.length > 0) {
        showError(
          new Error(
            `Could not unmark ${failures.length} project root${
              failures.length === 1 ? "" : "s"
            }. ${failures.join(" ")}`,
          ),
        );
        return;
      }
      if (
        expectedGeneration === vaultGeneration.current &&
        workspace.vaultPath === expectedVaultPath
      ) {
        setStatus(
          `Unmarked ${explicitProjectRoots.length} project root${
            explicitProjectRoots.length === 1 ? "" : "s"
          }`,
        );
      }
    });
  }, [
    applyProjectConfiguration,
    enqueueProjectConfigurationMutation,
    refreshIgnoredStatus,
    showError,
    workspace,
  ]);

  const markWorkspace = useCallback(
    async (path: string) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      await enqueueProjectConfigurationMutation(async () => {
        if (expectedGeneration !== vaultGeneration.current) {
          return;
        }
        try {
          const configuration = await api.markProjectWorkspace(
            expectedVaultPath,
            path,
          );
          applyProjectConfiguration(
            configuration,
            expectedGeneration,
            expectedVaultPath,
          );
          projectConfigurationRevision.current += 1;
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            [],
          );
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            setStatus(
              path === ""
                ? "Marked the vault root as a workspace"
                : `Marked ${path} as a workspace`,
            );
          }
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            showError(caught);
          } else {
            console.error(`Unable to mark workspace root ${path}:`, caught);
          }
        }
      });
    },
    [
      applyProjectConfiguration,
      enqueueProjectConfigurationMutation,
      refreshIgnoredStatus,
      showError,
      workspace,
    ],
  );

  const unmarkWorkspace = useCallback(
    async (projectWorkspace: ProjectWorkspace) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      await enqueueProjectConfigurationMutation(async () => {
        if (expectedGeneration !== vaultGeneration.current) {
          return;
        }
        try {
          const configuration = await api.unmarkProjectWorkspace(
            expectedVaultPath,
            projectWorkspace.id,
          );
          applyProjectConfiguration(
            configuration,
            expectedGeneration,
            expectedVaultPath,
          );
          projectConfigurationRevision.current += 1;
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            [],
          );
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            setStatus(
              projectWorkspace.rootPath === ""
                ? "Unmarked the vault root workspace"
                : `Unmarked ${projectWorkspace.rootPath} as a workspace`,
            );
          }
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace.vaultPath === expectedVaultPath
          ) {
            showError(caught);
          } else {
            console.error(
              `Unable to unmark workspace root ${projectWorkspace.rootPath}:`,
              caught,
            );
          }
        }
      });
    },
    [
      applyProjectConfiguration,
      enqueueProjectConfigurationMutation,
      refreshIgnoredStatus,
      showError,
      workspace,
    ],
  );

  const unmarkAllWorkspaces = useCallback(async () => {
    if (
      !workspace ||
      workspaceLockedRef.current ||
      workspace.projectWorkspaces.length === 0
    ) {
      return;
    }
    const expectedGeneration = vaultGeneration.current;
    const expectedVaultPath = workspace.vaultPath;
    const projectWorkspaces = [...workspace.projectWorkspaces];
    await enqueueProjectConfigurationMutation(async () => {
      const failures: string[] = [];
      let authoritativeConfiguration = projectConfigurationFields(workspace);
      let changed = false;
      for (const projectWorkspace of projectWorkspaces) {
        if (
          expectedGeneration !== vaultGeneration.current ||
          workspace.vaultPath !== expectedVaultPath
        ) {
          return;
        }
        try {
          authoritativeConfiguration = await api.unmarkProjectWorkspace(
            expectedVaultPath,
            projectWorkspace.id,
          );
          changed = true;
        } catch (caught) {
          failures.push(
            `${projectWorkspace.rootPath || "Vault root"}: ${errorMessage(
              caught,
            )}`,
          );
        }
      }
      applyProjectConfiguration(
        authoritativeConfiguration,
        expectedGeneration,
        expectedVaultPath,
      );
      if (changed) {
        projectConfigurationRevision.current += 1;
        await refreshIgnoredStatus(
          expectedGeneration,
          expectedVaultPath,
          [],
        );
      }
      if (failures.length > 0) {
        showError(
          new Error(
            `Could not unmark ${failures.length} workspace root${
              failures.length === 1 ? "" : "s"
            }. ${failures.join(" ")}`,
          ),
        );
        return;
      }
      if (
        expectedGeneration === vaultGeneration.current &&
        workspace.vaultPath === expectedVaultPath
      ) {
        setStatus(
          `Unmarked ${projectWorkspaces.length} workspace root${
            projectWorkspaces.length === 1 ? "" : "s"
          }`,
        );
      }
    });
  }, [
    applyProjectConfiguration,
    enqueueProjectConfigurationMutation,
    refreshIgnoredStatus,
    showError,
    workspace,
  ]);

  const dismissGitProjectSuggestion = useCallback(async () => {
    if (!workspace || workspaceLockedRef.current) {
      return;
    }
    const expectedGeneration = vaultGeneration.current;
    const expectedVaultPath = workspace.vaultPath;
    await enqueueProjectConfigurationMutation(async () => {
      if (expectedGeneration !== vaultGeneration.current) {
        return;
      }
      try {
        const configuration =
          await api.dismissGitProjectSuggestion(expectedVaultPath);
        applyProjectConfiguration(
          configuration,
          expectedGeneration,
          expectedVaultPath,
        );
        projectConfigurationRevision.current += 1;
        if (
          expectedGeneration === vaultGeneration.current &&
          workspace.vaultPath === expectedVaultPath
        ) {
          setStatus("Dismissed the Git project suggestion");
        }
      } catch (caught) {
        if (
          expectedGeneration === vaultGeneration.current &&
          workspace.vaultPath === expectedVaultPath
        ) {
          showError(caught);
        } else {
          console.error(
            "Unable to dismiss the Git project suggestion:",
            caught,
          );
        }
      }
    });
  }, [
    applyProjectConfiguration,
    enqueueProjectConfigurationMutation,
    showError,
    workspace,
  ]);

  const refreshProjectConfiguration = useCallback(
    async (expectedGeneration: number, expectedVaultPath: string) => {
      await enqueueProjectConfigurationMutation(async () => {
        if (expectedGeneration !== vaultGeneration.current) {
          return;
        }
        try {
          const configuration =
            await api.refreshProjectConfiguration(expectedVaultPath);
          applyProjectConfiguration(
            configuration,
            expectedGeneration,
            expectedVaultPath,
          );
          projectConfigurationRevision.current += 1;
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            [],
          );
        } catch (caught) {
          if (
            expectedGeneration === vaultGeneration.current &&
            workspace?.vaultPath === expectedVaultPath
          ) {
            showError(caught);
          } else {
            console.error(
              "Unable to refresh project configuration:",
              caught,
            );
          }
        }
      });
    },
    [
      applyProjectConfiguration,
      enqueueProjectConfigurationMutation,
      refreshIgnoredStatus,
      showError,
      workspace?.vaultPath,
    ],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  const activateTab = useCallback(
    (path: string) => {
      const pane = findPaneByPath(paneStateRef.current.panes, path);
      if (!pane) {
        return;
      }
      nextOpenRequest(pane.id);
      commitPaneState((current) => ({
        ...current,
        focusedPaneId: pane.id,
        panes: setPaneActivePath(current.panes, pane.id, path),
      }));
      const tab = pane.tabs.find((candidate) => candidate.path === path);
      setSelectedPath(tab?.placeholder || tab?.transient ? null : path);
    },
    [commitPaneState, nextOpenRequest],
  );

  const focusPane = useCallback(
    (paneId: string) => {
      const current = paneStateRef.current;
      if (current.focusedPaneId === paneId) {
        return;
      }
      const pane = current.panes.find((candidate) => candidate.id === paneId);
      if (!pane) {
        return;
      }
      commitPaneState((state) => ({ ...state, focusedPaneId: paneId }));
      const active = pane.tabs.find((tab) => tab.path === pane.activePath);
      setSelectedPath(
        active && !active.placeholder && !active.transient ? active.path : null,
      );
    },
    [commitPaneState],
  );

  const focusPaneAtIndex = useCallback(
    (index: number) => {
      const pane = paneStateRef.current.panes[index];
      if (!pane) {
        return;
      }
      focusPane(pane.id);
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>(
            `[data-pane-id="${CSS.escape(pane.id)}"] .tab__activate, [data-pane-id="${CSS.escape(pane.id)}"] .tab-new`,
          )
          ?.focus();
      }, 0);
    },
    [focusPane],
  );

  const stepFocusedPane = useCallback(
    (direction: -1 | 1) => {
      const current = paneStateRef.current;
      if (current.panes.length < 2) {
        return;
      }
      const index = current.panes.findIndex(
        (pane) => pane.id === current.focusedPaneId,
      );
      focusPaneAtIndex(
        (index + direction + current.panes.length) % current.panes.length,
      );
    },
    [focusPaneAtIndex],
  );

  const addWorkspacePane = useCallback(() => {
    if (paneStateRef.current.panes.length >= MAX_PANES) {
      showError(`Denote supports up to ${MAX_PANES} panes.`);
      return;
    }
    commitPaneState((current) => addPane(current));
    setSelectedPath(null);
    setStatus(`Added pane ${paneStateRef.current.panes.length}`);
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          `[data-pane-id="${CSS.escape(paneStateRef.current.focusedPaneId)}"] .tab-new`,
        )
        ?.focus();
    }, 0);
  }, [commitPaneState, showError]);

  const closeWorkspacePane = useCallback(
    (paneId: string) => {
      const current = paneStateRef.current;
      if (current.panes.length <= 1) {
        return;
      }
      const closing = current.panes.find((pane) => pane.id === paneId);
      const moved = closing?.tabs.length ?? 0;
      commitPaneState((state) => closePane(state, paneId));
      setStatus(
        moved > 0
          ? `Closed pane and kept ${moved} tab${moved === 1 ? "" : "s"}`
          : "Closed pane",
      );
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>(
            `[data-pane-id="${CSS.escape(paneStateRef.current.focusedPaneId)}"] .tab__activate, [data-pane-id="${CSS.escape(paneStateRef.current.focusedPaneId)}"] .tab-new`,
          )
          ?.focus();
      }, 0);
    },
    [commitPaneState],
  );

  const changePaneLayout = useCallback(
    (kind: PaneLayoutKind) => {
      commitPaneState((current) => setPaneLayoutKind(current, kind));
      setStatus(`${PANE_LAYOUT_LABELS[kind]} layout`);
    },
    [commitPaneState],
  );

  const resizePane = useCallback(
    (groupIndex: number, index: number, delta: number) => {
      const base = paneResizeBase.current ?? paneStateRef.current.layout;
      paneResizeBase.current = base;
      commitPaneState((current) => ({
        ...current,
        layout: resizePaneLayout(
          base,
          current.panes.length,
          groupIndex,
          index,
          delta,
        ),
      }));
    },
    [commitPaneState],
  );

  const finishPaneResize = useCallback(() => {
    paneResizeBase.current = null;
  }, []);

  const createNewTab = useCallback(
    (targetPaneId?: string) => {
      if (tabsRef.current.length >= MAX_TAB_SESSION_TABS) {
        showError(`A vault can have up to ${MAX_TAB_SESSION_TABS} open tabs.`);
        return;
      }
      const paneId = targetPaneId ?? paneStateRef.current.focusedPaneId;
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
        readOnly: false,
        editorRevision: 0,
        editRecorded: false,
        saveState: "saved",
      };
      nextOpenRequest(paneId);
      commitPaneState((current) => ({
        ...current,
        focusedPaneId: paneId,
        panes: updatePane(current.panes, paneId, (pane) => ({
          ...pane,
          tabs: [...pane.tabs, tab],
          activePath: path,
        })),
      }));
      setSelectedPath(null);
      setStatus("New tab");
    },
    [commitPaneState, nextOpenRequest, showError],
  );

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
    const searchRequest: SearchRequest = {
      query: searchQuery,
      location: searchLocation,
      filters: searchFilters,
    };
    searchRequestRef.current = searchRequest;
    void (async () => {
      const index = searchIndex.current;
      const results = await index.query(searchRequest);
      if (
        !cancelled &&
        request === queryRequest.current &&
        searchRequest === searchRequestRef.current &&
        index === searchIndex.current
      ) {
        setSearchResults(results);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchFilters, searchLocation, searchQuery]);

  const chooseVault = useCallback(async () => {
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
      const expectedVaultPath = workspace.vaultPath;
      const expectedVaultGeneration = vaultGeneration.current;
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
            if (isGitignorePath(path)) {
              await refreshIgnoredStatus(
                expectedVaultGeneration,
                expectedVaultPath,
                gitignoreRefreshScope(path),
              );
            }
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
    [
      commitTabs,
      refreshIgnoredStatus,
      scheduleIndexRebuild,
      showError,
      workspace,
    ],
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
    await acquireWorkspaceLockAndDrainProjectMutations(
      acquireWorkspaceLock,
      () => projectConfigurationMutationTail.current,
    );
    await gitignoreStatusTail.current;
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

  const beginFileOpenOperation = useCallback(
    async (replacedPath: string | null): Promise<void> => {
      try {
        await acquireWorkspaceLockAndDrainProjectMutations(
          acquireWorkspaceLock,
          () => projectConfigurationMutationTail.current,
        );
        await gitignoreStatusTail.current;
        if (replacedPath) {
          await saveQueues.current.get(replacedPath);
        }
        const pendingInsertions = replacedPath
          ? pendingAttachmentInsertions.current.get(replacedPath)
          : null;
        if (pendingInsertions) {
          const uploads = await Promise.all(
            [...pendingInsertions].map(({ completion }) => completion),
          );
          if (uploads.some((succeeded) => !succeeded)) {
            throw new Error(
              `Unable to finish an attachment insertion in ${replacedPath}.`,
            );
          }
        }
      } catch (caught) {
        setWorkspaceLock(false);
        throw caught;
      }
    },
    [acquireWorkspaceLock, setWorkspaceLock],
  );

  const beginEntryMutation = useCallback(
    async (
      expectedGeneration: number,
      isAffected: (path: string) => boolean,
    ): Promise<boolean> => {
      await acquireWorkspaceLockAndDrainProjectMutations(
        acquireWorkspaceLock,
        () => projectConfigurationMutationTail.current,
      );
      await gitignoreStatusTail.current;
      try {
        if (expectedGeneration !== vaultGeneration.current) {
          setWorkspaceLock(false);
          return false;
        }
        if (
          [...pendingAttachmentInsertions.current.keys()].some(isAffected)
        ) {
          const uploads = await Promise.all([...attachmentUploads.current]);
          if (uploads.some((succeeded) => !succeeded)) {
            setWorkspaceLock(false);
            return false;
          }
        }
        for (const tab of tabsRef.current) {
          if (
            !tab.placeholder &&
            isAffected(tab.path) &&
            !(await flushTab(tab.path))
          ) {
            setWorkspaceLock(false);
            return false;
          }
        }
        if (expectedGeneration !== vaultGeneration.current) {
          setWorkspaceLock(false);
          return false;
        }
        return true;
      } catch (caught) {
        setWorkspaceLock(false);
        throw caught;
      }
    },
    [acquireWorkspaceLock, flushTab, setWorkspaceLock],
  );

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
        completion: tracked,
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
        await api.prepareExit();
        await shutdownPlugins();
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
  }, [setWorkspaceLock, showError, shutdownPlugins]);

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
              readOnly: false,
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
            readOnly: false,
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
      paneId: string,
      request: number,
      transientErrors: boolean,
    ) => {
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      if (!openRequestCurrent(paneId, request)) {
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
      const targetPane = paneStateRef.current.panes.find(
        (pane) => pane.id === paneId,
      );
      if (!targetPane) {
        return;
      }
      const replacePath = targetPane.activePath;
      const node = findNode(workspace.tree, path);
      const kind = node?.kind ?? kindFromPath(path);
      const reportError = transientErrors ? showLinkError : showError;
      if (kind === "folder") {
        reportError(`Unable to find ${path}`);
        return;
      }
      const title = node?.name ?? path.split("/").slice(-1)[0] ?? path;
      const generation = vaultGeneration.current;
      setStatus(`Opening ${title}…`);
      let workspaceOperationStarted = false;
      try {
        await beginFileOpenOperation(replacePath);
        workspaceOperationStarted = true;
        if (!openRequestCurrent(paneId, request)) {
          return;
        }
        const tab = await readEditorTab(path, kind, title);
        if (
          generation !== vaultGeneration.current ||
          !openRequestCurrent(paneId, request)
        ) {
          return;
        }
        setHeadingNavigation(
          anchor ? { path, anchor } : null,
        );
        const latestPane = paneStateRef.current.panes.find(
          (pane) => pane.id === paneId,
        );
        const replacedTab = latestPane?.tabs.find(
          (candidate) => candidate.path === replacePath,
        );
        const placementAddsTab =
          replacedTab === undefined || tabHasUnsavedChanges(replacedTab);
        if (
          placementAddsTab &&
          tabsRef.current.length >= MAX_TAB_SESSION_TABS
        ) {
          reportError(
            `Close a tab before opening ${title}; the ${MAX_TAB_SESSION_TABS}-tab limit is reached.`,
          );
          return;
        }
        const shouldCancelReplacedPath =
          replacedTab !== undefined && !tabHasUnsavedChanges(replacedTab);
        commitPaneState((current) => ({
          ...current,
          focusedPaneId: paneId,
          panes: updatePane(current.panes, paneId, (pane) => ({
            ...pane,
            tabs: placeOpenedTab(pane.tabs, replacePath, tab),
            activePath: path,
          })),
        }));
        dispatchErrors({
          type: "retain-markdown-paths",
          paths: tabReferencedPaths(tabsRef.current),
        });
        if (replacePath && shouldCancelReplacedPath) {
          cancelPendingPath(replacePath);
        }
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
          reportError(caught);
        }
      } finally {
        if (workspaceOperationStarted) {
          setWorkspaceLock(false);
        }
      }
    },
    [
      activateTab,
      beginFileOpenOperation,
      cancelPendingPath,
      commitPaneState,
      openRequestCurrent,
      readEditorTab,
      setWorkspaceLock,
      showError,
      showLinkError,
      workspace,
    ],
  );

  const openFileInPane = useCallback(
    (
      path: string,
      paneId: string,
      anchor?: string | null,
      transientErrors = false,
    ): Promise<void> => {
      const request = nextOpenRequest(paneId);
      const operation = openFileQueue.current.then(() =>
        openFileNow(path, anchor, paneId, request, transientErrors),
      );
      openFileQueue.current = operation;
      return operation;
    },
    [nextOpenRequest, openFileNow],
  );

  const openFile = useCallback(
    (
      path: string,
      anchor?: string | null,
      transientErrors = false,
    ): Promise<void> =>
      openFileInPane(
        path,
        paneStateRef.current.focusedPaneId,
        anchor,
        transientErrors,
      ),
    [openFileInPane],
  );

  const openSearchResult = useCallback(
    async (result: SearchResult) => {
      await openFile(result.document.path);
      if (
        activePathRef.current !== result.document.path ||
        result.match === null
      ) {
        setSearchNavigation(null);
        return;
      }
      setSearchNavigation({
        path: result.document.path,
        request: ++searchNavigationRequest.current,
        from: result.match.from,
        to: result.match.to,
        text: result.document.content.slice(result.match.from, result.match.to),
      });
    },
    [openFile],
  );

  const openFileInNewTab = useCallback(
    async (path: string) => {
      const existing = tabsRef.current.find((tab) => tab.path === path);
      if (existing) {
        activateTab(path);
        setStatus(`${existing.title} is already open`);
        return;
      }
      createNewTab();
      await openFile(path);
    },
    [activateTab, createNewTab, openFile],
  );

  const navigateTabHistory = useCallback(
    (direction: -1 | 1): Promise<void> => {
      const paneId = paneStateRef.current.focusedPaneId;
      const request = nextOpenRequest(paneId);
      const operation = openFileQueue.current.then(async () => {
        if (!workspace || workspaceLockedRef.current) {
          return;
        }
        const pane = paneStateRef.current.panes.find(
          (candidate) => candidate.id === paneId,
        );
        const current = pane?.tabs.find(
          (tab) => tab.path === pane.activePath,
        );
        if (!pane || !current || current.placeholder) {
          return;
        }
        if (
          tabHasUnsavedChanges(current) ||
          pendingAttachmentInsertions.current.has(current.path)
        ) {
          setStatus("Wait for the current file to finish saving before navigating");
          return;
        }
        const target = tabHistoryTarget(current, direction);
        if (!target || !openRequestCurrent(paneId, request)) {
          return;
        }
        const otherPane = findPaneByPath(
          paneStateRef.current.panes,
          target.path,
        );
        if (otherPane && otherPane.id !== paneId) {
          activateTab(target.path);
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
          await beginFileOpenOperation(current.path);
          workspaceOperationStarted = true;
          if (!openRequestCurrent(paneId, request)) {
            return;
          }
          const latestPane = paneStateRef.current.panes.find(
            (candidate) => candidate.id === paneId,
          );
          const latestCurrent = latestPane?.tabs.find(
            (tab) => tab.path === current.path,
          );
          if (!latestPane || !latestCurrent) {
            return;
          }
          if (tabHasUnsavedChanges(latestCurrent)) {
            setStatus("Wait for the current file to finish saving before navigating");
            return;
          }
          const existing = latestPane.tabs.find(
            (tab) => tab.path === target.path,
          );
          const opened = restoreTabHistoryTarget(
            latestCurrent,
            existing ?? (await readEditorTab(target.path, kind, title)),
            target.index,
          );
          if (
            generation !== vaultGeneration.current ||
            !openRequestCurrent(paneId, request)
          ) {
            return;
          }
          const displaced = existing
            ? placeOpenedTab(
                [existing],
                existing.path,
                latestCurrent,
                false,
              )[0]
            : null;
          commitPaneState((state) => ({
            ...state,
            focusedPaneId: paneId,
            panes: updatePane(state.panes, paneId, (candidate) => ({
              ...candidate,
              tabs: tabsInVisualOrder(
                candidate.tabs.map((tab) =>
                  tab.path === current.path
                    ? opened
                    : displaced && existing && tab.path === existing.path
                      ? displaced
                      : tab,
                ),
              ),
              activePath: target.path,
            })),
          }));
          if (!existing) {
            cancelPendingPath(current.path);
          }
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
      activateTab,
      beginFileOpenOperation,
      cancelPendingPath,
      commitPaneState,
      nextOpenRequest,
      openRequestCurrent,
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
    const upgraded = upgradeTabSession(session);
    const requests = new Map(
      upgraded.panes.map((pane) => [pane.id, nextOpenRequest(pane.id)]),
    );
    const stale = () =>
      generation !== vaultGeneration.current ||
      [...requests].some(([paneId, request]) => !openRequestCurrent(paneId, request));
    void (async () => {
      await acquireWorkspaceLock();
      try {
        const restored: EditorTab[] = [];
        const seen = new Set<string>();
        for (const saved of upgraded.panes.flatMap((pane) => pane.tabs)) {
          if (stale()) {
            return;
          }
          if (seen.has(saved.path)) {
            continue;
          }
          seen.add(saved.path);
          const node = findNode(workspace.tree, saved.path);
          const kind = node?.kind ?? kindFromPath(saved.path);
          if (kind === "folder") {
            continue;
          }
          const title =
            node?.name ?? saved.path.split("/").slice(-1)[0] ?? saved.path;
          try {
            restored.push(await readEditorTab(saved.path, kind, title));
          } catch (caught) {
            console.warn(`Unable to restore ${saved.path}:`, caught);
          }
        }
        if (stale()) {
          return;
        }
        const restoredState = applyPaneSessionState(restored, session);
        commitPaneState(() => restoredState);
        const activePath = focusedPaneOf(restoredState).activePath;
        setSelectedPath(activePath);
        setStatus(
          `Restored ${restored.length} tab${restored.length === 1 ? "" : "s"}` +
            (restoredState.panes.length > 1
              ? ` in ${restoredState.panes.length} panes`
              : ""),
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
    commitPaneState,
    nextOpenRequest,
    openRequestCurrent,
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
    const welcomePath = pendingWelcomePage.current;
    if (
      !welcomePath ||
      !workspace ||
      (workspace.encryption.enabled && !workspace.encryption.unlocked)
    ) {
      return;
    }
    pendingWelcomePage.current = null;
    void openFile(welcomePath);
  }, [openFile, workspace, workspaceLocked]);

  const changeTabContent = useCallback(
    (path: string, content: string) => {
      const currentTab = tabsRef.current.find(
        (candidate) => candidate.path === path,
      );
      if (
        !currentTab ||
        currentTab.readOnly ||
        (currentTab.kind === "image" && !currentTab.rawEditing)
      ) {
        return;
      }
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
        });
      }
      for (const insertion of [...(pendingInsertions ?? [])]) {
        if (insertion.source && content.includes(insertion.source)) {
          insertion.settle(true);
        }
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
    [commitTabs, saveTab, showError],
  );

  const updateTabLanguageOverride = useCallback(
    (path: string, languageOverride: SourceLanguageOverride) => {
      commitTabs((current) =>
        current.map((tab) =>
          tab.path === path ? { ...tab, languageOverride } : tab,
        ),
      );
    },
    [commitTabs],
  );

  const closeTabs = useCallback(
    async (paths: string[]) => {
      const closing = new Set(paths);
      if (closing.size === 0 || workspaceLockedRef.current) {
        return;
      }
      invalidateOpenRequests();
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        const closedActivePath =
          activePathRef.current && closing.has(activePathRef.current)
            ? activePathRef.current
            : null;
        commitPaneState((current) => ({
          ...current,
          panes: removePaneTabs(
            current.panes,
            (path) => closing.has(path),
            false,
          ).panes,
        }));
        dispatchErrors({
          type: "retain-markdown-paths",
          paths: tabReferencedPaths(tabsRef.current),
        });
        for (const path of closing) {
          cancelPendingPath(path);
        }
        if (closedActivePath) {
          const nextPath = activePathRef.current;
          setSelectedPath(
            tabsRef.current.find((tab) => tab.path === nextPath)?.placeholder
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
      commitPaneState,
      invalidateOpenRequests,
      setWorkspaceLock,
      showError,
    ],
  );

  const closeTab = useCallback(
    async (path: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.path === path);
      const detail = tab?.sourceControlDiff;
      if (!detail) {
        await closeTabs([path]);
        return;
      }
      commitPaneState((current) => ({
        ...current,
        panes: removePaneTabs(
          current.panes,
          (candidate) => candidate === path,
          false,
        ).panes,
      }));
      setSelectedPath(null);
      try {
        await runPluginSourceControlAction(
          detail.pluginId,
          detail.providerId,
          {
            id: detail.source.kind === "commit" ? "close-commit" : "close-diff",
          },
          workspace?.vaultPath ?? "",
        );
      } catch (caught) {
        showError(caught);
      }
    },
    [
      closeTabs,
      commitPaneState,
      pluginController,
      showError,
      workspace?.vaultPath,
    ],
  );

  const moveTabToPane = useCallback(
    (path: string, paneId: string, beforePath: string | null = null) => {
      const current = paneStateRef.current;
      const source = findPaneByPath(current.panes, path);
      const targetIndex = current.panes.findIndex(
        (pane) => pane.id === paneId,
      );
      if (!source || targetIndex < 0 || source.id === paneId) {
        return;
      }
      nextOpenRequest(source.id);
      nextOpenRequest(paneId);
      commitPaneState((state) => ({
        ...state,
        focusedPaneId: paneId,
        panes: movePaneTab(state.panes, path, paneId, beforePath),
      }));
      const title =
        tabsRef.current.find((tab) => tab.path === path)?.title ?? path;
      setStatus(`Moved ${title} to pane ${targetIndex + 1}`);
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-tab-path="${CSS.escape(path)}"]`,
          )
          ?.focus();
      }, 0);
    },
    [commitPaneState, nextOpenRequest],
  );

  const dockTabAtTarget = useCallback(
    (path: string, target: PaneDockTarget) => {
      const current = paneStateRef.current;
      const source = findPaneByPath(current.panes, path);
      if (!source) {
        return;
      }
      const next = dockTab(current, path, target.paneId, target.position);
      if (next === current) {
        if (
          target.position !== "center" &&
          source.tabs.length > 1 &&
          current.panes.length >= MAX_PANES
        ) {
          showError(`Denote supports up to ${MAX_PANES} panes.`);
        }
        return;
      }
      const title =
        tabsRef.current.find((tab) => tab.path === path)?.title ?? path;
      nextOpenRequest(source.id);
      nextOpenRequest(target.paneId);
      commitPaneState(() => next);
      const paneNumber =
        next.panes.findIndex((pane) => pane.id === next.focusedPaneId) + 1;
      setStatus(
        target.position === "center" || target.position === "tab-strip"
          ? `Moved ${title} to pane ${paneNumber}`
          : `Docked ${title} ${DOCK_POSITION_LABELS[target.position]} as pane ${paneNumber}`,
      );
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-tab-path="${CSS.escape(path)}"]`,
          )
          ?.focus();
      }, 0);
    },
    [commitPaneState, nextOpenRequest, showError],
  );

  const handleTabDragStart = useCallback(() => {
    setDockTarget(null);
  }, []);

  const handleTabDragMove = useCallback(
    (_path: string, clientX: number, clientY: number) => {
      const next = paneDockTargetFromPoint(clientX, clientY);
      setDockTarget((current) =>
        sameDockTarget(current, next) ? current : next,
      );
    },
    [],
  );

  const handleTabDragEnd = useCallback(
    (path: string, clientX: number, clientY: number) => {
      const target = paneDockTargetFromPoint(clientX, clientY);
      setDockTarget(null);
      if (!target) {
        return false;
      }
      dockTabAtTarget(path, target);
      return true;
    },
    [dockTabAtTarget],
  );

  const handleTabDragCancel = useCallback(() => {
    setDockTarget(null);
  }, []);

  const reorderTabs = useCallback(
    (sourcePath: string, targetPath: string) => {
      const panes = paneStateRef.current.panes;
      const source = findPaneByPath(panes, sourcePath);
      const target = findPaneByPath(panes, targetPath);
      if (!source || !target) {
        return;
      }
      if (source.id !== target.id) {
        moveTabToPane(sourcePath, target.id, targetPath);
        return;
      }
      const sourceGroupId =
        source.tabs.find((tab) => tab.path === sourcePath)?.groupId ?? null;
      const targetGroupId =
        source.tabs.find((tab) => tab.path === targetPath)?.groupId ?? null;
      commitPanes((current) =>
        updatePane(current, source.id, (pane) => ({
          ...pane,
          tabs: moveTabInLayout(pane.tabs, sourcePath, targetPath),
          groups: pane.groups.map((group) =>
            sourceGroupId !== targetGroupId && group.id === targetGroupId
              ? { ...group, collapsed: false }
              : group,
          ),
        })),
      );
      setStatus("Reordered tabs");
    },
    [commitPanes, moveTabToPane],
  );

  const toggleTabGroup = useCallback(
    (groupId: string) => {
      const pane = findPaneByGroup(paneStateRef.current.panes, groupId);
      if (!pane) {
        return;
      }
      commitPanes((current) =>
        updatePane(current, pane.id, (candidate) => ({
          ...candidate,
          groups: candidate.groups.map((group) =>
            group.id === groupId
              ? { ...group, collapsed: !group.collapsed }
              : group,
          ),
        })),
      );
    },
    [commitPanes],
  );

  const moveTabToGroup = useCallback(
    (path: string, groupId: string | null) => {
      const pane = findPaneByPath(paneStateRef.current.panes, path);
      if (!pane) {
        return;
      }
      commitPanes((current) =>
        updatePane(current, pane.id, (candidate) => ({
          ...candidate,
          tabs: placeTabInGroup(candidate.tabs, path, groupId),
          groups: candidate.groups.map((group) =>
            group.id === groupId ? { ...group, collapsed: false } : group,
          ),
        })),
      );
    },
    [commitPanes],
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
      const pane = findPaneByPath(paneStateRef.current.panes, path);
      if (!pane) {
        return;
      }
      const groupId = `group-${Date.now()}-${++tabGroupSequence.current}`;
      commitPanes((current) =>
        updatePane(current, pane.id, (candidate) => ({
          ...candidate,
          tabs: placeTabInGroup(candidate.tabs, path, groupId),
          groups: [...candidate.groups, { id: groupId, name, collapsed: false }],
        })),
      );
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-tab-path="${CSS.escape(path)}"]`,
          )
          ?.focus();
      }, 0);
    },
    [commitPanes, requestText, showError],
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
      commitPanes((current) =>
        current.map((pane) => ({
          ...pane,
          groups: pane.groups.map((candidate) =>
            candidate.id === groupId ? { ...candidate, name } : candidate,
          ),
        })),
      );
    },
    [commitPanes, requestText, showError],
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
    const session = buildPaneSessionState(paneStateRef.current);
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
        panes: panes.map((pane) => ({
          id: pane.id,
          tabs: pane.tabs.map(({ path, placeholder, groupId }) => ({
            path,
            placeholder,
            groupId,
          })),
          groups: pane.groups,
          activePath: pane.activePath,
        })),
        layout: paneLayout,
        focusedPaneId,
      }),
    [focusedPaneId, paneLayout, panes],
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
      return null;
    }
    return refreshWorkspace(true);
  }, [refreshWorkspace, workspace]);

  /**
   * Puts every open tab back in step with the working tree after Git replaced
   * what is on disk.
   *
   * Open notes were flushed before the action started, so nothing here can
   * lose an edit: every tab is read again from disk. Pane layout, tab order,
   * groups, and each tab's language and view choices are untouched, so only
   * the bytes change. A tab whose file the checkout removed is closed and
   * named, and a tab whose content really changed is given a new editor
   * revision, because an editor history built on the previous branch could
   * otherwise write those bytes back.
   */
  const reloadOpenTabsFromDisk = useCallback(
    async (snapshot: WorkspaceSnapshot | null): Promise<void> => {
      const open = [...tabsRef.current];
      if (open.length === 0) {
        return;
      }
      const reloaded = new Map<
        string,
        { document: NoteDocument; imageDataUrl?: string }
      >();
      const disappeared = new Set<string>();
      for (const tab of open) {
        // A placeholder tab has a synthetic path rather than a vault path, so
        // there is nothing on disk to reload and nothing that can disappear.
        if (
          tab.placeholder ||
          tab.transient ||
          reloaded.has(tab.path) ||
          disappeared.has(tab.path)
        ) {
          continue;
        }
        if (snapshot && !findNode(snapshot.tree, tab.path)) {
          disappeared.add(tab.path);
          continue;
        }
        cancelPendingPath(tab.path);
        try {
          const document = await api.readNote(tab.path);
          const imageDataUrl =
            tab.kind === "image"
              ? await api.readImageDataUrl(tab.path)
              : undefined;
          reloaded.set(
            tab.path,
            imageDataUrl === undefined
              ? { document }
              : { document, imageDataUrl },
          );
        } catch {
          disappeared.add(tab.path);
        }
      }
      let removedPaths: string[] = [];
      commitPaneState((current) => {
        const removal = removePaneTabs(current.panes, (path) =>
          disappeared.has(path),
        );
        removedPaths = removal.removedPaths;
        return {
          ...current,
          panes: removal.panes.map((pane) => ({
            ...pane,
            tabs: pane.tabs.map((tab) => {
              const update = reloaded.get(tab.path);
              if (!update) {
                return tab;
              }
              const changed = update.document.content !== tab.savedContent;
              return {
                ...tab,
                content: update.document.content,
                savedContent: update.document.content,
                savedHash: update.document.contentHash,
                encoding: update.document.encoding,
                lineEnding: update.document.lineEnding,
                stats: update.document.stats,
                ...(update.imageDataUrl === undefined
                  ? {}
                  : { imageDataUrl: update.imageDataUrl }),
                editorRevision: changed
                  ? tab.editorRevision + 1
                  : tab.editorRevision,
                editRecorded: false,
                saveState: "saved" as const,
              };
            }),
          })),
        };
      });
      for (const path of removedPaths) {
        cancelPendingPath(path);
        dispatchErrors({ type: "remove-markdown-prefix", path });
      }
      if (removedPaths.length > 0) {
        setSelectedPath((current) =>
          current !== null && disappeared.has(current) ? null : current,
        );
        setStatus(
          `Closed ${removedPaths.length} tab${
            removedPaths.length === 1 ? "" : "s"
          } whose file is not on this branch: ${removedPaths.join(", ")}`,
        );
      }
    },
    [cancelPendingPath, commitPaneState],
  );

  const runSourceControlAction = useCallback(
    async (
      pluginId: string,
      providerId: string,
      action: PluginSourceControlAction,
      repositoryLabel = "",
      hostOptions?: SourceControlActionHostOptions,
    ) => {
      if (!workspace) {
        return;
      }
      const confirmation = sourceControlConfirmation(action, repositoryLabel);
      if (confirmation && !(await requestConfirmation(confirmation))) {
        return;
      }
      const mutatesWorkspace = WORKSPACE_MUTATING_SOURCE_CONTROL_ACTIONS.has(
        action.id,
      );
      let workspaceOperationStarted = false;
      clonedDuringAction.current = false;
      try {
        if (mutatesWorkspace) {
          if (!(await beginWorkspaceOperation())) {
            return;
          }
          workspaceOperationStarted = true;
        }
        if (hostOptions) {
          await runPluginSourceControlAction(
            pluginId,
            providerId,
            action,
            workspace.vaultPath,
            hostOptions,
          );
        } else {
          await runPluginSourceControlAction(
            pluginId,
            providerId,
            action,
            workspace.vaultPath,
          );
        }
        // A clone already replaced the workspace, so refreshing the vault the
        // action started in would read a vault that is no longer open.
        if (mutatesWorkspace && !clonedDuringAction.current) {
          const snapshot = await refreshAndReindex();
          if (WORKTREE_CHANGING_SOURCE_CONTROL_ACTIONS.has(action.id)) {
            await reloadOpenTabsFromDisk(snapshot);
            await refreshIgnoredStatus(
              vaultGeneration.current,
              workspace.vaultPath,
              [],
            );
          }
        }
      } catch (caught) {
        showError(caught);
      } finally {
        clonedDuringAction.current = false;
        if (workspaceOperationStarted) {
          setWorkspaceLock(false);
        }
      }
    },
    [
      beginWorkspaceOperation,
      runPluginSourceControlAction,
      refreshAndReindex,
      refreshIgnoredStatus,
      reloadOpenTabsFromDisk,
      requestConfirmation,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  /**
   * Opens one file a source control surface named, in the editor.
   *
   * This never goes through the provider: the path is repository-relative, so
   * the host resolves it inside the repository the provider is scoped to, and
   * then opens it with the ordinary file-open flow. Nothing absolute is built
   * or shown, a path that tries to leave the vault is refused, and a file that
   * is not in the vault any more is reported instead of silently doing
   * nothing.
   */
  const openSourceControlFile = useCallback(
    (repositoryPath: string, repositoryId: string) => {
      if (!workspace) {
        return;
      }
      const repositoryRoot =
        repositoryId === "vault"
          ? ""
          : (workspace.projectRoots.find(
              (project) => `project:${project.id}` === repositoryId,
            )?.rootPath ??
            activeProject?.rootPath ??
            "");
      const vaultPath =
        repositoryRoot === null
          ? null
          : vaultRelativePath(repositoryRoot, repositoryPath);
      if (!vaultPath) {
        showError(
          `Denote cannot open ${repositoryPath} because it is not inside this vault.`,
        );
        return;
      }
      const node = findNode(workspace.tree, vaultPath);
      if (!node || node.kind === "folder") {
        showError(
          `Denote could not open ${vaultPath} because it is no longer in this vault. Refresh the repository to read it again.`,
        );
        return;
      }
      void openFile(vaultPath);
    },
    [activeProject?.rootPath, openFile, showError, workspace],
  );

  const openSourceControlDiff = useCallback(
    (
      pluginId: string,
      providerId: string,
      repositoryId: string,
      repositoryLabel: string,
      repositoryPath: string,
      files: PluginSourceControlDiffFile[],
      source: PluginSourceControlDiffSource,
    ) => {
      if (files.length === 0) {
        return;
      }
      const title = sourceControlDiffTitle(repositoryPath, source.kind);
      const path = sourceControlDiffPath(repositoryId, title, source);
      const content = sourceControlPatch(files);
      const tab: EditorTab = {
        path,
        title,
        kind: "text",
        content,
        savedContent: content,
        encoding: "utf8",
        lineEnding: "lf",
        placeholder: false,
        groupId: null,
        navigationHistory: [path],
        navigationIndex: 0,
        rawEditing: false,
        readOnly: true,
        editorRevision: 0,
        editRecorded: false,
        saveState: "saved",
        transient: "diff",
        sourceControlDiff: {
          pluginId,
          providerId,
          repositoryId,
          repositoryLabel,
          repositoryPath,
          files,
          source,
        },
      };
      commitPaneState((current) => {
        const existingPane = findPaneByPath(current.panes, path);
        const targetPane = existingPane ?? focusedPaneOf(current);
        return {
          ...current,
          focusedPaneId: targetPane.id,
          panes: updatePane(current.panes, targetPane.id, (pane) => {
            const existing = pane.tabs.find(
              (candidate) => candidate.path === path,
            );
            return {
              ...pane,
              tabs: existing
                ? pane.tabs.map((candidate) =>
                    candidate.path === path
                      ? {
                          ...candidate,
                          ...tab,
                          groupId: candidate.groupId,
                          navigationHistory: candidate.navigationHistory,
                          navigationIndex: candidate.navigationIndex,
                          editorRevision: candidate.editorRevision + 1,
                        }
                      : candidate,
                  )
                : placeOpenedTab(pane.tabs, pane.activePath, tab),
              activePath: path,
            };
          }),
        };
      });
      setSelectedPath(null);
      setStatus(`Opened ${title}`);
    },
    [commitPaneState],
  );

  useEffect(() => {
    if (!workspace) {
      return;
    }
    for (const provider of pluginController.sourceControlProviders) {
      const model = provider.model;
      if (
        model.selectedView.kind === "diff" &&
        model.diffSource &&
        model.diffFiles.length > 0
      ) {
        openSourceControlDiff(
          provider.pluginId,
          provider.id,
          model.repository.repositoryId,
          model.repository.label,
          model.selectedView.path,
          model.diffFiles,
          model.diffSource,
        );
        continue;
      }
      if (model.commitDetail && model.commitDetail.files.length > 0) {
        openSourceControlDiff(
          provider.pluginId,
          provider.id,
          model.repository.repositoryId,
          model.repository.label,
          model.commitDetail.commit.shortId,
          model.commitDetail.files,
          {
            kind: "commit",
            commitId: model.commitDetail.commit.id,
          },
        );
      }
    }
  }, [
    openSourceControlDiff,
    pluginController.sourceControlProviders,
    workspace?.vaultPath,
  ]);

  /**
   * Opens a cloned repository as the active vault.
   *
   * The clone action already holds the workspace lock, so nothing is flushed
   * again here. An encrypted clone arrives locked, and `loadWorkspace` shows
   * the password and recovery screen before any content, so no note from
   * either vault is ever displayed for a vault that is not unlocked.
   */
  const openClonedVault = useCallback(
    async (snapshot: WorkspaceSnapshot) => {
      clonedDuringAction.current = true;
      setVaultSwitcherOpen(false);
      vaultGeneration.current += 1;
      await loadWorkspace(snapshot, true);
      setStatus(
        snapshot.encryption.enabled && !snapshot.encryption.unlocked
          ? "Cloned repository opened; unlock the vault to see its notes"
          : "Cloned repository opened as the active vault",
      );
    },
    [loadWorkspace],
  );
  clonedVaultHandler.current = openClonedVault;

  const runAutomaticLocalCommit = useCallback(
    async (schedule: PluginAutomaticLocalCommitContribution) => {
      if (!workspace) {
        return;
      }
      const vaultPath = workspace.vaultPath;
      const projectId = activeProject?.id ?? null;
      // Saves, uploads, and preference writes are drained first, so the commit
      // sees the same tree the user is looking at rather than a half-written
      // one. The lock is always released, whatever the outcome is.
      if (!(await beginWorkspaceOperation())) {
        setStatus("Automatic commit skipped because a note could not be saved");
        return;
      }
      try {
        const outcome = await api.pluginAutomaticCommit(
          schedule.pluginId,
          {
            scheduleId: schedule.id,
            message: resolveCommitMessage(schedule.message, schedule.message),
            includePatterns: schedule.includePatterns,
            excludePatterns: schedule.excludePatterns,
            authorName: schedule.authorName,
            authorEmail: schedule.authorEmail,
          },
          vaultPath,
          projectId,
          crypto.randomUUID(),
        );
        if (outcome.status === "committed") {
          await refreshAndReindex();
          setStatus(
            outcome.commitId
              ? `Automatic commit ${outcome.commitId.slice(0, 7)}`
              : "Automatic commit created",
          );
        } else if (outcome.status === "unchanged") {
          setStatus("Automatic commit: no changes");
        } else {
          setStatus(`Automatic commit skipped: ${outcome.message}`);
        }
      } catch (caught) {
        showError(caught);
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      activeProject?.id,
      beginWorkspaceOperation,
      refreshAndReindex,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

  useAutomaticLocalCommits({
    schedules: pluginController.automaticLocalCommits,
    // A locked or maintaining vault holds no timer at all, so unlocking starts
    // a fresh interval instead of firing a backlog.
    enabled:
      workspace !== null &&
      (!workspace.encryption.enabled || workspace.encryption.unlocked) &&
      (workspace.encryption.phase === null ||
        workspace.encryption.phase === "encrypted"),
    workspaceIdentity: workspace?.vaultPath ?? null,
    projectId: activeProject?.id ?? null,
    canRun: () => !workspaceLockedRef.current && !closingWindow.current,
    run: runAutomaticLocalCommit,
    onError: showError,
  });

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
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
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
      if (
        expectedGeneration !== vaultGeneration.current ||
        workspace.vaultPath !== expectedVaultPath
      ) {
        return;
      }
      const name =
        !directory && !/\.[^./\\]+$/.test(entered)
          ? `${entered}.md`
          : entered;
      let createdNode: FileNode | null = null;
      let mutationStarted = false;
      try {
        if (
          !(await beginEntryMutation(expectedGeneration, () => false))
        ) {
          return;
        }
        mutationStarted = true;
        createdNode = await api.createEntry(parentPath, name, directory);
        setWorkspace((current) =>
          current?.vaultPath === expectedVaultPath
            ? {
                ...current,
                tree: insertWorkspaceNode(current.tree, createdNode!),
              }
            : current,
        );
        if (directory) {
          await refreshProjectConfiguration(
            expectedGeneration,
            expectedVaultPath,
          );
        } else {
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            isGitignorePath(createdNode.path)
              ? gitignoreRefreshScope(createdNode.path)
              : [createdNode.path],
          );
        }
        if (parentPath) {
          setExpandedPaths((current) => new Set(current).add(parentPath));
        }
        setSelectedPath(createdNode.path);
        setStatus(`Created ${createdNode.name}`);
      } catch (caught) {
        showError(caught);
      } finally {
        if (mutationStarted) {
          setWorkspaceLock(false);
        }
      }
      if (createdNode) {
        scheduleIndexRebuild();
        if (!directory) {
          await openFile(createdNode.path);
        }
      }
    },
    [
      beginEntryMutation,
      openFile,
      requestText,
      refreshProjectConfiguration,
      refreshIgnoredStatus,
      scheduleIndexRebuild,
      selectedNode,
      selectedPath,
      setWorkspaceLock,
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
    invalidateOpenRequests();
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
      dispatchErrors({
        type: "rekey-markdown-prefix",
        oldPath,
        newPath,
      });
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
      commitPanes((current) =>
        current.map((pane) => ({
          ...pane,
          activePath: pane.activePath ? replacePrefix(pane.activePath) : null,
        })),
      );
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
    commitPanes,
    commitTabs,
    flushTab,
    invalidateOpenRequests,
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
        invalidateOpenRequests();
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
        dispatchErrors({
          type: "rekey-markdown-prefix",
          oldPath: node.path,
          newPath,
        });
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
        commitPanes((current) =>
          current.map((pane) => ({
            ...pane,
            activePath: pane.activePath ? replacePrefix(pane.activePath) : null,
          })),
        );
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
      commitPanes,
      commitTabs,
      flushTab,
      invalidateOpenRequests,
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
    const expectedGeneration = vaultGeneration.current;
    const expectedVaultPath = workspace.vaultPath;
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
    if (
      expectedGeneration !== vaultGeneration.current ||
      workspace.vaultPath !== expectedVaultPath
    ) {
      return;
    }
    const isAffected = (path: string) =>
      workspacePathMatches(path, node.path);
    let mutationStarted = false;
    let trashed = false;
    try {
      invalidateOpenRequests();
      if (!(await beginEntryMutation(expectedGeneration, isAffected))) {
        return;
      }
      mutationStarted = true;
      const trashItem = await api.trashEntry(node.path);
      const activeWasAffected =
        activePathRef.current !== null && isAffected(activePathRef.current);
      let removedPaths: string[] = [];
      commitPaneState((current) => {
        const removal = removePaneTabs(current.panes, isAffected);
        removedPaths = removal.removedPaths;
        return { ...current, panes: removal.panes };
      });
      dispatchErrors({
        type: "remove-markdown-prefix",
        path: node.path,
      });
      for (const path of removedPaths) {
        cancelPendingPath(path);
      }
      if (activeWasAffected) {
        const nextPath = activePathRef.current;
        setSelectedPath(
          tabsRef.current.find((tab) => tab.path === nextPath)?.placeholder
            ? null
            : nextPath,
        );
      } else if (selectedPath && isAffected(selectedPath)) {
        setSelectedPath(null);
      }
      setExpandedPaths(
        (current) =>
          new Set([...current].filter((path) => !isAffected(path))),
      );
      setWorkspace((current) =>
        current?.vaultPath === expectedVaultPath
          ? (() => {
              const tree = removeWorkspacePath(current.tree, node.path);
              const customPath =
                current.welcomePage.customPath &&
                isAffected(current.welcomePage.customPath)
                  ? null
                  : current.welcomePage.customPath;
              const projectConfiguration =
                removeProjectConfigurationAtOrBelow(
                  projectConfigurationFields(current),
                  node.path,
                );
              return {
                ...current,
                tree,
                welcomePage: {
                  customPath,
                  effectivePath:
                    customPath ??
                    defaultWelcomePagePath(tree, current.default),
                },
                bookmarks: current.bookmarks.filter(
                  (item) => !isAffected(item.path),
                ),
                recent: current.recent.filter(
                  (item) => !isAffected(item.path),
                ),
                ignoredPaths: removeIgnoredPathsAtOrBelow(
                  current.ignoredPaths,
                  node.path,
                ),
                ...projectConfiguration,
                trash: [
                  trashItem,
                  ...current.trash.filter((item) => item.id !== trashItem.id),
                ],
              };
            })()
          : current,
      );
      projectConfigurationRevision.current += 1;
      searchIndex.current.removePaths(isAffected);
      setSearchResults((current) =>
        current.filter((result) => !isAffected(result.document.path)),
      );
      setStatus(`Moved ${node.name} to Denote Trash`);
      if (isGitignorePath(node.path)) {
        await refreshIgnoredStatus(
          expectedGeneration,
          expectedVaultPath,
          gitignoreRefreshScope(node.path),
        );
      }
      trashed = true;
    } catch (caught) {
      showError(caught);
    } finally {
      if (mutationStarted) {
        setWorkspaceLock(false);
      }
    }
    if (trashed) {
      scheduleIndexRebuild();
    }
  }, [
    beginEntryMutation,
    cancelPendingPath,
    commitPaneState,
    invalidateOpenRequests,
    requestConfirmation,
    refreshIgnoredStatus,
    scheduleIndexRebuild,
    selectedPath,
    setWorkspaceLock,
    showError,
    workspace,
  ]);

  const trashSelected = useCallback(async () => {
    if (selectedNode) {
      await trashNode(selectedNode);
    }
  }, [selectedNode, trashNode]);

  const duplicateNode = useCallback(
    async (node: FileNode) => {
      if (
        !workspace ||
        node.kind === "folder" ||
        workspaceLockedRef.current
      ) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      let mutationStarted = false;
      let duplicated = false;
      try {
        if (
          !(await beginEntryMutation(
            expectedGeneration,
            (path) => path === node.path,
          ))
        ) {
          return;
        }
        mutationStarted = true;
        const duplicate = await api.duplicateFile(node.path);
        setWorkspace((current) =>
          current?.vaultPath === expectedVaultPath
            ? {
                ...current,
                tree: insertWorkspaceNode(current.tree, duplicate),
              }
            : current,
        );
        await refreshIgnoredStatus(
          expectedGeneration,
          expectedVaultPath,
          isGitignorePath(duplicate.path)
            ? gitignoreRefreshScope(duplicate.path)
            : [duplicate.path],
        );
        setExpandedPaths((current) => {
          const next = new Set(current);
          for (const path of workspaceAncestorPaths(duplicate.path)) {
            next.add(path);
          }
          return next;
        });
        setSelectedPath(duplicate.path);
        setStatus(`Duplicated ${node.name} as ${duplicate.name}`);
        duplicated = true;
      } catch (caught) {
        showError(caught);
      } finally {
        if (mutationStarted) {
          setWorkspaceLock(false);
        }
      }
      if (duplicated) {
        scheduleIndexRebuild();
      }
    },
    [
      beginEntryMutation,
      refreshIgnoredStatus,
      scheduleIndexRebuild,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

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

  const setWelcomePageForNode = useCallback(
    async (node: FileNode | null) => {
      if (
        !workspace ||
        workspaceLockedRef.current ||
        (node !== null && node.kind !== "markdown")
      ) {
        return;
      }
      const vaultPath = workspace.vaultPath;
      const generation = vaultGeneration.current;
      let workspaceOperationStarted = false;
      try {
        if (!(await beginWorkspaceOperation())) {
          return;
        }
        workspaceOperationStarted = true;
        const welcomePage = await api.setWelcomePagePath(node?.path ?? null);
        if (generation !== vaultGeneration.current) {
          return;
        }
        setWorkspace((current) =>
          current?.vaultPath === vaultPath
            ? { ...current, welcomePage }
            : current,
        );
        setStatus(
          node
            ? `${node.name} is the vault welcome page`
            : welcomePage.effectivePath
              ? `Using ${welcomePage.effectivePath} as the vault welcome page`
              : "Vault welcome page cleared",
        );
      } catch (caught) {
        showError(caught);
      } finally {
        if (workspaceOperationStarted) {
          setWorkspaceLock(false);
        }
      }
    },
    [
      beginWorkspaceOperation,
      setWorkspaceLock,
      showError,
      workspace,
    ],
  );

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
      if (!workspace || workspaceLockedRef.current) {
        return;
      }
      const expectedGeneration = vaultGeneration.current;
      const expectedVaultPath = workspace.vaultPath;
      let mutationStarted = false;
      let restored = false;
      try {
        if (
          !(await beginEntryMutation(expectedGeneration, () => false))
        ) {
          return;
        }
        mutationStarted = true;
        const restoredNode = await api.restoreTrashItem(itemId);
        setWorkspace((current) =>
          current?.vaultPath === expectedVaultPath
            ? {
                ...current,
                tree: insertWorkspaceNode(current.tree, restoredNode),
                trash: current.trash.filter((item) => item.id !== itemId),
              }
            : current,
        );
        if (restoredNode.kind === "folder") {
          await refreshProjectConfiguration(
            expectedGeneration,
            expectedVaultPath,
          );
        } else {
          await refreshIgnoredStatus(
            expectedGeneration,
            expectedVaultPath,
            isGitignorePath(restoredNode.path)
              ? gitignoreRefreshScope(restoredNode.path)
              : [restoredNode.path],
          );
        }
        setExpandedPaths((current) => {
          const next = new Set(current);
          for (const path of workspaceAncestorPaths(restoredNode.path)) {
            next.add(path);
          }
          return next;
        });
        showSidebarView("files");
        setSelectedPath(restoredNode.path);
        setStatus(`Restored ${restoredNode.name}`);
        restored = true;
      } catch (caught) {
        showError(caught);
      } finally {
        if (mutationStarted) {
          setWorkspaceLock(false);
        }
      }
      if (restored) {
        scheduleIndexRebuild();
      }
    },
    [
      beginEntryMutation,
      refreshProjectConfiguration,
      refreshIgnoredStatus,
      scheduleIndexRebuild,
      setWorkspaceLock,
      showError,
      workspace,
    ],
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

  const openHistoryForNode = useCallback(async (node: FileNode | null) => {
    if (!workspace || !node || node.kind === "folder") {
      return;
    }
    if (workspaceLockedRef.current) {
      return;
    }
    setHistoryTarget({ path: node.path, title: node.name });
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistoryRevisions(await api.listHistory(node.path));
    } catch (caught) {
      showError(caught);
    } finally {
      setHistoryLoading(false);
    }
  }, [showError, workspace]);

  const openHistory = useCallback(
    async () => openHistoryForNode(activeNode),
    [activeNode, openHistoryForNode],
  );

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
        if (applied.size > 0) {
          setSearchNavigation(null);
        }
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

  const copyNodePath = useCallback(
    async (node: FileNode) => {
      if (node.kind === "folder" || workspaceLockedRef.current) {
        return;
      }
      try {
        await api.copyFilePath(node.path);
        setStatus("Copied file path");
      } catch (caught) {
        showError(caught);
      }
    },
    [showError],
  );

  const revealNode = useCallback(
    async (node: FileNode) => {
      if (node.kind === "folder" || workspaceLockedRef.current) {
        return;
      }
      try {
        const absolutePath = await api.resolveFilePath(node.path);
        await revealItemInDir(absolutePath);
        setStatus(`Revealed ${node.name}`);
      } catch (caught) {
        showError(caught);
      }
    },
    [showError],
  );

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

  const commitOutlineWidth = useCallback(
    (width: number) => {
      try {
        setOutlineWidth(saveOutlineWidth(width));
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

  const toggleReadMode = useCallback(() => {
    const path = activePathRef.current;
    if (!path) {
      return;
    }
    commitTabs((current) =>
      current.map((tab) =>
        tab.path === path ? { ...tab, readOnly: !tab.readOnly } : tab,
      ),
    );
    const nextReadOnly =
      tabsRef.current.find((tab) => tab.path === path)?.readOnly ?? false;
    setStatus(nextReadOnly ? "Read mode" : "Write mode");
  }, [commitTabs]);

  const restoreRevision = useCallback(
    async (revisionId: number) => {
      if (!workspace || !historyTarget) {
        return;
      }
      if (workspaceLockedRef.current) {
        return;
      }
      const restorePath = historyTarget.path;
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
        if (findNode(workspace.tree, restorePath)?.kind === "image") {
          const imageDataUrl = await api.readImageDataUrl(restorePath);
          commitTabs((current) =>
            current.map((tab) =>
              tab.path === restorePath ? { ...tab, imageDataUrl } : tab,
            ),
          );
        }
        setHistoryOpen(false);
        setHistoryTarget(null);
        setStatus("Revision restored");
        scheduleIndexRebuild();
      } catch (caught) {
        showError(caught);
      } finally {
        setWorkspaceLock(false);
      }
    },
    [
      beginWorkspaceOperation,
      commitTabs,
      flushTab,
      historyTarget,
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
        showLinkError(
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
    [showLinkError],
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
        showLinkError(caught);
      }
    },
    [
      externalDomainPolicy,
      pendingExternalLink,
      openWebLinksWithPolicy,
      persistExternalDomainPolicy,
      showLinkError,
    ],
  );

  const openLinkFromTab = useCallback(
    async (sourceTab: EditorTab | null, href: string, linkText = "") => {
      if (!sourceTab || !href) {
        return;
      }
      const sourcePane = findPaneByPath(
        paneStateRef.current.panes,
        sourceTab.path,
      );
      try {
        const target =
          recoverMarkdownLinkTarget(sourceTab.content, linkText, href) ?? href;
        const normalizedTarget = externalLinkTarget(target);
        if (/^file:/i.test(normalizedTarget)) {
          if (!isLocalFileUrl(normalizedTarget)) {
            showLinkError("Remote file URLs are not allowed.");
            return;
          }
          await openPath(fileUrlToPath(normalizedTarget));
          return;
        }
        if (isWebLink(normalizedTarget)) {
          const domain = externalDomain(normalizedTarget);
          if (!domain) {
            showLinkError(`Invalid external link: ${target}`);
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
            showLinkError(
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
          sourceTab.path,
          normalizedTarget,
          allFiles
            .filter((node) => node.kind !== "folder")
            .map((node) => node.path),
        );
        if (!resolved) {
          showLinkError(`Link target not found: ${normalizedTarget}`);
          return;
        }
        await openFileInPane(
          resolved.path,
          sourcePane?.id ?? paneStateRef.current.focusedPaneId,
          resolved.anchor,
          true,
        );
      } catch (caught) {
        showLinkError(caught);
      }
    },
    [
      allFiles,
      externalDomainPolicy,
      openFileInPane,
      openWebLinksWithPolicy,
      showLinkError,
    ],
  );

  const revealHeading = useCallback(
    (anchor: string): boolean => {
      const slug = slugifyHeading(anchor);
      const sourceEditorElement = document.querySelector<HTMLElement>(
        '.workspace-pane[data-focused="true"] .mdxeditor-source-editor .cm-editor',
      );
      const sourceView = sourceEditorElement
        ? EditorView.findFromDOM(sourceEditorElement)
        : null;
      if (
        sourceView &&
        activeFileTab?.kind === "markdown" &&
        activeFileTab.encoding === "utf8"
      ) {
        const range = sourceHeadingRange(sourceView, slug);
        if (!range) {
          return false;
        }
        sourceView.dispatch({
          selection: { anchor: range.from, head: range.to },
          effects: EditorView.scrollIntoView(range.from, { y: "center" }),
        });
        sourceView.focus();
        return true;
      }
      const focusedPaneSelector = '.workspace-pane[data-focused="true"]';
      const candidates = document.querySelectorAll<HTMLElement>(
        [1, 2, 3, 4, 5, 6]
          .map(
            (depth) =>
              `${focusedPaneSelector} .denote-editor-content h${depth}`,
          )
          .join(", "),
      );
      const target = [...candidates].find(
        (element) =>
          element.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style
            .display !== "none" &&
          (element.id === slug ||
            slugifyHeading(element.textContent ?? "") === slug),
      );
      if (target) {
        const previousTabIndex = target.getAttribute("tabindex");
        target.tabIndex = -1;
        target.classList.add("denote-heading-target");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.focus({ preventScroll: true });
        window.setTimeout(() => {
          target.classList.remove("denote-heading-target");
          if (previousTabIndex === null) {
            target.removeAttribute("tabindex");
          } else {
            target.setAttribute("tabindex", previousTabIndex);
          }
        }, 1_600);
        return true;
      }
      return false;
    },
    [activeFileTab],
  );

  const navigateToHeading = useCallback((heading: HeadingItem) => {
    if (activePath) {
      setHeadingNavigation({ path: activePath, anchor: heading.slug });
    }
  }, [activePath]);

  const navigateToSourceLine = useCallback(
    (line: number) => {
      if (activePath) {
        setSourceNavigation({
          path: activePath,
          request: ++sourceNavigationSequence.current,
          line,
        });
      }
    },
    [activePath],
  );

  const navigateToSourceProgress = useCallback(
    (progress: number) => {
      if (activePath) {
        setSourceNavigation({
          path: activePath,
          request: ++sourceNavigationSequence.current,
          progress,
        });
      }
    },
    [activePath],
  );

  const focusVaultSearch = useCallback(() => {
    setSearchLocation(activeFileTab?.path ?? "*");
    showSidebarView("search");
    setSearchQueryFocusRequest((current) => current + 1);
  }, [activeFileTab?.path, showSidebarView]);

  const navigateToEditorError = useCallback(() => {
    if (activePath) {
      dispatchErrors({ type: "navigate-markdown", path: activePath });
    }
  }, [activePath]);

  useEffect(() => {
    if (!headingNavigation) {
      return;
    }
    if (activePath !== headingNavigation.path) {
      setHeadingNavigation(null);
      return;
    }
    let attempt = 0;
    let timer = 0;
    const navigate = () => {
      if (revealHeading(headingNavigation.anchor)) {
        setHeadingNavigation((current) =>
          current === headingNavigation ? null : current,
        );
        return;
      }
      if (attempt >= 200) {
        setHeadingNavigation((current) =>
          current === headingNavigation ? null : current,
        );
        showLinkError(`Heading not found: #${headingNavigation.anchor}`);
        return;
      }
      attempt += 1;
      timer = window.setTimeout(navigate, 50);
    };
    timer = window.setTimeout(navigate, 0);
    return () => window.clearTimeout(timer);
  }, [activePath, headingNavigation, revealHeading, showLinkError]);

  const modalOpen =
    replaceOpen ||
    encryptionOpen ||
    editorSettingsOpen ||
    vaultSwitcherOpen ||
    commandPaletteOpen ||
    aboutOpen ||
    pendingExternalLink !== null ||
    actionDialog !== null ||
    historyOpen;
  modalOpenRef.current = modalOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const zoom = editorZoomShortcut(event, navigator.platform);
      const paletteShortcut = isCommandPaletteShortcut(
        event,
        navigator.platform,
      );
      const settingsShortcut = isSettingsShortcut(event, navigator.platform);
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
      if (settingsShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (
          !workspaceLockedRef.current &&
          !modalOpen &&
          workspace !== null &&
          (!workspace.encryption.enabled || workspace.encryption.unlocked)
        ) {
          setEditorSettingsOpen(true);
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
      const paneShortcut = paneFocusShortcut(event, navigator.platform);
      if (
        modifier &&
        event.shiftKey &&
        event.key.toLocaleLowerCase() === "o"
      ) {
        event.preventDefault();
        event.stopPropagation();
        setVaultSwitcherOpen(true);
      } else if (isSplitPaneShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        addWorkspacePane();
      } else if (isClosePaneShortcut(event, navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        closeWorkspacePane(paneStateRef.current.focusedPaneId);
      } else if (paneShortcut) {
        const canRunPaneShortcut =
          paneShortcut.kind === "index"
            ? paneShortcut.index < paneStateRef.current.panes.length
            : paneStateRef.current.panes.length > 1;
        if (!canRunPaneShortcut) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (paneShortcut.kind === "index") {
          focusPaneAtIndex(paneShortcut.index);
        } else {
          stepFocusedPane(paneShortcut.direction);
        }
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
    activePath,
    activeFileTab,
    activateTab,
    addWorkspacePane,
    closeTab,
    closeWorkspacePane,
    createNewTab,
    focusPaneAtIndex,
    stepFocusedPane,
    createEntry,
    editorDisplaySettings.fontSize,
    focusVaultSearch,
    modalOpen,
    saveTab,
    showError,
    showOutline,
    tabs,
    updateEditorFontSize,
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
    !activeFileTab.readOnly &&
    (activeFileTab.kind !== "image" || activeFileTab.rawEditing);
  const focusedPaneIndex = panes.findIndex(
    (pane) => pane.id === focusedPaneId,
  );
  const paneAreaList = paneAreas(paneLayout.kind, panes.length);
  const paneSeparatorList = paneSeparators(paneLayout.kind, panes.length);
  const paneTracks = paneLayoutTracks(
    paneLayout,
    panes.length,
    "var(--pane-gap)",
  );
  const splitPaneShortcut = macOS ? "⌘\\" : "Ctrl+\\";
  const selectedDirectory =
    selectedNode?.kind === "folder" ? selectedNode : null;
  const projectCommands = buildProjectCommands({
    workspaceReady,
    workspaceLocked,
    projectRoots: workspace?.projectRoots ?? [],
    projectWorkspaces: workspace?.projectWorkspaces ?? [],
    selectedDirectoryPath: selectedDirectory?.path ?? null,
    onMarkProject: markProject,
    onUnmarkProject: unmarkProject,
    onUnmarkAllProjects: unmarkAllProjects,
    onMarkWorkspace: markWorkspace,
    onUnmarkWorkspace: unmarkWorkspace,
    onUnmarkAllWorkspaces: unmarkAllWorkspaces,
  });
  const fileActionHandlers: FileActionHandlers = {
    welcomePage: workspace?.welcomePage ?? {
      customPath: null,
      effectivePath: null,
    },
    onDuplicate: (node) => void duplicateNode(node),
    onBookmark: (node) => void toggleBookmarkForNode(node),
    onCopyPath: (node) => void copyNodePath(node),
    onOpenHistory: (node) => void openHistoryForNode(node),
    onOpenInNewTab: (node) => void openFileInNewTab(node.path),
    onReveal: (node) => void revealNode(node),
    onSetWelcomePage: (node) => void setWelcomePageForNode(node),
    onRename: (node) => void renameNode(node),
    onMove: (node) => void requestMoveNode(node),
    onDelete: (node) => void trashNode(node),
  };
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
      title: "Search current file",
      description: "Open search with the active file selected as its location.",
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
      run: () => {
        void refreshAndReindex();
      },
    },
    ...projectCommands,
    {
      id: "view.files",
      title: "Show files",
      description: "Open the file-tree sidebar.",
      category: "View",
      disabled: !workspaceReady,
      run: () => showSidebarView("files"),
    },
    {
      id: "view.search",
      title: "Show vault search",
      description: "Open and focus the search sidebar.",
      category: "View",
      disabled: !workspaceReady,
      run: () => showSidebarView("search"),
    },
    {
      id: "view.bookmarks",
      title: "Show bookmarks",
      description: "Open bookmarked files.",
      category: "View",
      disabled: !workspaceReady,
      run: () => showSidebarView("bookmarks"),
    },
    {
      id: "view.recent",
      title: "Show recent files",
      description: "Open recently viewed files.",
      category: "View",
      disabled: !workspaceReady,
      run: () => showSidebarView("recent"),
    },
    {
      id: "view.trash",
      title: "Show trash",
      description: "Open deleted files that can be restored.",
      category: "View",
      disabled: !workspaceReady,
      run: () => showSidebarView("trash"),
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
      run: () => createNewTab(),
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
      id: "pane.split",
      title: "Split editor into a new pane",
      description: "Open another pane beside the focused pane.",
      category: "Pane",
      shortcut: splitPaneShortcut,
      disabled: !workspaceReady || panes.length >= MAX_PANES,
      run: addWorkspacePane,
    },
    {
      id: "pane.close",
      title: "Close focused pane",
      description: "Keep its tabs by moving them into a neighbouring pane.",
      category: "Pane",
      shortcut: macOS ? "⇧⌘\\" : "Ctrl+Shift+\\",
      disabled: panes.length < 2,
      run: () => closeWorkspacePane(focusedPaneId),
    },
    {
      id: "pane.focus-next",
      title: "Focus next pane",
      description: "Move keyboard focus to the next editor pane.",
      category: "Pane",
      shortcut: "F6",
      disabled: panes.length < 2,
      run: () => stepFocusedPane(1),
    },
    {
      id: "pane.focus-previous",
      title: "Focus previous pane",
      description: "Move keyboard focus to the previous editor pane.",
      category: "Pane",
      shortcut: "Shift+F6",
      disabled: panes.length < 2,
      run: () => stepFocusedPane(-1),
    },
    {
      id: "pane.move-tab",
      title: "Move current tab to the next pane",
      description: "Keep unsaved edits and continue in another pane.",
      category: "Pane",
      disabled: activePath === null || panes.length < 2,
      run: () => {
        const target = panes[(focusedPaneIndex + 1) % panes.length];
        if (activePath && target) {
          moveTabToPane(activePath, target.id);
        }
      },
    },
    ...layoutsForPaneCount(panes.length)
      .filter((kind) => kind !== paneLayout.kind)
      .map((kind) => ({
        id: `pane.layout.${kind}`,
        title: `Use the ${PANE_LAYOUT_LABELS[kind].toLocaleLowerCase()} layout`,
        description: `Arrange ${panes.length} panes as ${PANE_LAYOUT_LABELS[kind].toLocaleLowerCase()}.`,
        category: "Pane",
        run: () => changePaneLayout(kind),
      })),
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
      id: "file.open-new-tab",
      title: "Open current file in a new tab",
      description: "Keep the current tab and open this file separately.",
      category: "File",
      disabled: activeFileTab === null,
      run: () =>
        activeFileTab ? openFileInNewTab(activeFileTab.path) : undefined,
    },
    {
      id: "file.duplicate",
      title: "Duplicate current file",
      description: "Create a non-conflicting copy beside the current file.",
      category: "File",
      disabled: activeNode === null || activeNode.kind === "folder",
      run: () => (activeNode ? duplicateNode(activeNode) : undefined),
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
      id: "file.reveal",
      title: "Reveal current file in folder",
      description: "Show the current file in the operating system file manager.",
      category: "File",
      disabled: activeNode === null || activeNode.kind === "folder",
      run: () => (activeNode ? revealNode(activeNode) : undefined),
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
      shortcut: macOS ? "⌘H" : "Ctrl+H",
      disabled: !workspaceReady,
      run: () => setReplaceOpen(true),
    },
    {
      id: "editor.read-mode",
      title: activeFileTab?.readOnly ? "Switch to write mode" : "Switch to read mode",
      description: activeFileTab?.readOnly
        ? "Enable editing for the current file."
        : "Prevent edits in the current file.",
      category: "Editor",
      disabled: activeFileTab === null,
      run: toggleReadMode,
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
      description: "Toggle headings, source symbols, and document navigation.",
      category: "View",
      disabled: !outlineAvailable,
      run: () => setShowOutline((current) => !current),
    },
    {
      id: "editor.settings",
      title: "Open settings",
      description: "Change font size, guides, and session restore.",
      category: "Editor",
      shortcut: `${commandKey},`,
      disabled: !workspaceReady,
      run: () => setEditorSettingsOpen(true),
    },
    {
      id: "app.about",
      title: "About Denote",
      description: "Show the artifact version and Git commit.",
      category: "Application",
      run: () => setAboutOpen(true),
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
  commandPaletteCommands.push(
    ...pluginController.commands.map((command) => ({
      id: command.id,
      title: command.title,
      description: `Run command from ${command.pluginId}.`,
      category: "Plugins",
      disabled: workspace === null,
      run: () =>
        pluginController.runCommand(
          command.pluginId,
          command.id,
          workspace?.vaultPath ?? "",
        ),
    })),
  );
  commandPaletteCommandsRef.current = commandPaletteCommands;

  useEffect(() => {
    let disposed = false;
    let unlistenMenu: (() => void) | undefined;
    void listen<string>("denote://menu-command", (event) => {
      if (event.payload === "window.close") {
        void getCurrentWindow().close().catch(showError);
        return;
      }
      if (workspaceLockedRef.current || modalOpenRef.current) {
        return;
      }
      if (event.payload === "command-palette.open") {
        setCommandPaletteOpen(true);
        return;
      }
      const command = commandPaletteCommandsRef.current.find(
        (candidate) => candidate.id === event.payload,
      );
      if (!command?.run || command.disabled) {
        return;
      }
      try {
        void Promise.resolve(command.run()).catch(showError);
      } catch (caught) {
        showError(caught);
      }
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlistenMenu = cleanup;
        }
      })
      .catch((caught) => {
        if (!disposed) {
          showError(caught);
        }
      });
    return () => {
      disposed = true;
      unlistenMenu?.();
    };
  }, [showError]);

  const gitSourceControlContribution =
    pluginController.sourceControlProviders.find(
      (provider) => provider.model.remoteAccess.cloneAvailable,
    ) ?? null;
  const vaultSwitcherDialog = (
    <VaultSwitcherDialog
      open={vaultSwitcherOpen}
      onLoad={api.listKnownVaults}
      onSwitch={switchKnownVault}
      onDelete={deleteKnownVault}
      onChooseFolder={() => void chooseVault()}
      clone={
        workspace && gitSourceControlContribution
          ? {
              remoteAccess: gitSourceControlContribution.model.remoteAccess,
              busy: gitSourceControlContribution.model.repository.busy,
              onAction: (action) => {
                void runSourceControlAction(
                  gitSourceControlContribution.pluginId,
                  gitSourceControlContribution.id,
                  action,
                );
              },
            }
          : undefined
      }
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
  const aboutDialog = (
    <AboutDialog
      open={aboutOpen}
      buildInfo={BUILD_INFO}
      onClose={() => setAboutOpen(false)}
    />
  );
  const errorBanner = (
    <ErrorBanner
      key={visibleErrorId ?? "empty"}
      message={visibleError?.message ?? null}
      transient={visibleError?.kind === "link"}
      onDismiss={dismissVisibleError}
      onNavigate={
        visibleError?.kind === "markdown" &&
        visibleError.location &&
        visibleError.path === activePath
          ? navigateToEditorError
          : undefined
      }
    />
  );
  const activePluginSidebarView =
    pluginController.sidebarViews.find(
      (view) => view.id === activePluginSidebar,
    ) ?? null;
  const activeSourceControlContribution =
    pluginController.sourceControlProviders.find(
      (provider) =>
        provider.pluginId === activeSourceControlProvider?.pluginId &&
        provider.id === activeSourceControlProvider.providerId,
    ) ?? null;
  const activeSourceControlAction = useCallback(
    (
      action: PluginSourceControlAction,
      hostOptions?: SourceControlActionHostOptions,
    ) => {
      if (!activeSourceControlContribution) {
        return;
      }
      void runSourceControlAction(
        activeSourceControlContribution.pluginId,
        activeSourceControlContribution.id,
        action,
        activeSourceControlContribution.model.repository.label,
        hostOptions,
      );
    },
    [
      activeSourceControlContribution?.id,
      activeSourceControlContribution?.model.repository.label,
      activeSourceControlContribution?.pluginId,
      runSourceControlAction,
    ],
  );
  const activeSourceControlFileOpen = useCallback(
    (path: string) => {
      if (!activeSourceControlContribution) {
        return;
      }
      openSourceControlFile(
        path,
        activeSourceControlContribution.model.repository.repositoryId,
      );
    },
    [
      activeSourceControlContribution?.model.repository.repositoryId,
      openSourceControlFile,
    ],
  );

  useEffect(() => {
    if (activeSourceControlProvider && !activeSourceControlContribution) {
      setActiveSourceControlProvider(null);
      setActivePluginSidebar(null);
      setSidebarView("files");
    }
  }, [activeSourceControlContribution, activeSourceControlProvider]);

  if (!workspace) {
    return (
      <>
        <span
          hidden
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: DESIGN_CONTRACT }}
        />
        {errorBanner}
        <Welcome
          loading={initializing}
          onChooseVault={chooseVault}
          onShowRecentVaults={() => setVaultSwitcherOpen(true)}
        />
        {vaultSwitcherDialog}
        {commandPalette}
        {aboutDialog}
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
        {errorBanner}
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
        {aboutDialog}
      </>
    );
  }

  const renderPaneSurface = (
    pane: WorkspacePane,
    paneProject: ProjectRoot | null,
  ) => {
    const paneTab = pane.tabs.find((tab) => tab.path === pane.activePath) ?? null;
    if (paneTab?.placeholder) {
      return (
        <div className="editor-empty">
          <div className="editor-empty__mark">+</div>
          <h2>New tab</h2>
          <p>Choose a file from the sidebar to open it in this tab.</p>
        </div>
      );
    }
    if (paneTab?.transient === "diff" && paneTab.sourceControlDiff) {
      const detail = paneTab.sourceControlDiff;
      const provider =
        pluginController.sourceControlProviders.find(
          (candidate) =>
            candidate.pluginId === detail.pluginId &&
            candidate.id === detail.providerId,
        ) ?? null;
      const providerSource = provider?.model.diffSource ?? null;
      const actionsAvailable =
        provider?.model.repository.repositoryId === detail.repositoryId &&
        detail.source.kind !== "commit" &&
        providerSource?.kind === detail.source.kind;
      return (
        <SourceControlDiffEditor
          tab={paneTab}
          theme={theme}
          actionsAvailable={actionsAvailable}
          onAction={(action) => {
            if (!provider) {
              return;
            }
            void runSourceControlAction(
              provider.pluginId,
              provider.id,
              action,
              detail.repositoryLabel,
            );
          }}
          onOpenFile={(path) =>
            openSourceControlFile(path, detail.repositoryId)
          }
        />
      );
    }
    if (!paneTab) {
      return (
        <div className="editor-empty">
          <div className="editor-empty__mark">D</div>
          <h2>
            {panes.length > 1 ? "This pane is empty." : "Your vault is ready."}
          </h2>
          <p>
            Open a note from the sidebar or press{" "}
            <kbd>{macOS ? "⌘" : "Ctrl"}F</kbd> to search.
          </p>
        </div>
      );
    }
    const paneReadOnly = workspaceLocked || (paneTab.readOnly ?? false);
    const paneDisplaySettings =
      paneProject && !editorDisplaySettings.showLineNumbers
        ? { ...editorDisplaySettings, showLineNumbers: true }
        : editorDisplaySettings;
    const paneUsesRichMarkdown = usesRichMarkdownEditor(paneTab, paneProject);
    const paneMarkdownError =
      paneUsesRichMarkdown
        ? markdownAppErrorForPath(
            errors,
            paneTab.path,
            markdownErrorSourceIdentity(markdownEditorSource(paneTab.content)),
          )
        : null;
    const paneUsesProjectMarkdownSource =
      usesProjectMarkdownSourceEditor(paneTab, paneProject);
    const paneCodeContext = paneProject !== null || vaultIsWorkspace;
    const paneSourceOutlineAvailable =
      paneCodeContext &&
      paneTab.encoding === "utf8" &&
      paneTab.kind !== "markdown" &&
      paneTab.kind !== "image";
    const paneSourceLanguage =
      paneTab.encoding === "utf8"
        ? resolveSourceLanguage(
            paneTab.path,
            paneTab.languageOverride ?? null,
          ).language
        : null;
    return (
      <>
        {paneTab.kind === "image" && !paneTab.rawEditing ? (
          <figure className="image-viewer">
            <img src={paneTab.imageDataUrl} alt={paneTab.title} />
            <figcaption>{paneTab.path}</figcaption>
          </figure>
        ) : paneUsesRichMarkdown ? (
          <MarkdownEditor
            key={`${paneTab.path}:${paneTab.editorRevision}:${editorDisplayKey}:${pluginDecorationKey}`}
            notePath={paneTab.path}
            markdown={paneTab.content}
            lineEnding={paneTab.lineEnding}
            displaySettings={paneDisplaySettings}
            pluginDecorations={pluginController.decorations}
            preferredViewMode={markdownViewMode}
            readOnly={paneReadOnly}
            errorLocation={paneMarkdownError?.location}
            errorNavigationRequest={paneMarkdownError?.navigationRequest ?? 0}
            searchNavigation={
              pane.id === focusedPaneId &&
              searchNavigation?.path === paneTab.path
                ? searchNavigation
                : undefined
            }
            tagColors={tagColorMap}
            onChange={(content) => changeTabContent(paneTab.path, content)}
            onError={showError}
            onMarkdownError={(diagnostic) =>
              showMarkdownError(paneTab.path, diagnostic)
            }
            onMarkdownErrorCleared={() => clearMarkdownError(paneTab.path)}
            onLinkOpen={(href, text) =>
              void openLinkFromTab(paneTab, href, text)
            }
            onViewModeChange={updateMarkdownViewMode}
            onImageUpload={uploadAttachment}
          />
        ) : (
          <>
            {paneUsesProjectMarkdownSource ? (
              <div className="code-workspace-source-notice" role="note">
                Code workspace source mode. Markdown syntax is edited exactly as
                stored on disk.
              </div>
            ) : null}
            {paneTab.encoding === "base64" ? (
              <div className="binary-editor-notice" role="note">
                Binary file shown as reversible Base64. Invalid Base64 will not
                be saved.
              </div>
            ) : null}
            <PlainTextEditor
              key={`${paneTab.path}:${paneTab.editorRevision}`}
              ariaLabel={`${paneTab.readOnly ? "Read" : "Edit"} ${paneTab.title}`}
              value={paneTab.content}
              readOnly={paneReadOnly}
              spellCheck={
                paneTab.encoding === "utf8" &&
                paneSourceLanguage === null
              }
              binary={paneTab.encoding === "base64"}
              filePath={paneTab.encoding === "utf8" ? paneTab.path : null}
              lineEnding={paneTab.lineEnding}
              displaySettings={paneDisplaySettings}
              languageOverride={paneTab.languageOverride}
              projectMode={paneCodeContext}
              markdownSource={paneUsesProjectMarkdownSource}
              errorLocation={
                paneUsesProjectMarkdownSource
                  ? paneMarkdownError?.location
                  : undefined
              }
              errorNavigationRequest={
                paneUsesProjectMarkdownSource
                  ? (paneMarkdownError?.navigationRequest ?? 0)
                  : 0
              }
              pluginDecorations={pluginController.decorations}
              searchNavigation={
                pane.id === focusedPaneId &&
                searchNavigation?.path === paneTab.path
                  ? searchNavigation
                  : undefined
              }
              sourceNavigation={
                pane.id === focusedPaneId &&
                sourceNavigation?.path === paneTab.path
                  ? sourceNavigation
                  : undefined
              }
              onChange={(content) => changeTabContent(paneTab.path, content)}
              onViewportChange={
                pane.id === focusedPaneId &&
                paneSourceOutlineAvailable &&
                outlineVisible
                  ? (viewport) => {
                      const key = sourceViewportCacheKey(
                        workspace.vaultPath,
                        pane.id,
                        paneTab.path,
                      );
                      setSourceViewports((current) => {
                        const existing = current[key];
                        if (
                          existing?.firstLine === viewport.firstLine &&
                          existing.lastLine === viewport.lastLine &&
                          existing.totalLines === viewport.totalLines &&
                          existing.progress === viewport.progress
                        ) {
                          return current;
                        }
                        return { ...current, [key]: viewport };
                      });
                    }
                  : undefined
              }
              onError={showError}
            />
          </>
        )}
        {pane.id === focusedPaneId && tags.length > 0 ? (
          <div className="document-tags" aria-label="Document tags">
            {tags.map((tag) => (
              <TagChip
                tag={tag}
                color={resolveTagColor(tag, tagColorMap)}
                editable
                key={tag}
                onActivate={() => {
                  showSidebarView("search");
                  setSearchLocation("*");
                  setSearchQuery("");
                  setSearchFilters({
                    ...createEmptySearchFilters(),
                    tags: [tag],
                  });
                }}
                onColorChange={(changedTag, color) =>
                  void updateTagColor(changedTag, color)
                }
              />
            ))}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div
      className="app-shell"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--outline-width": `${outlineWidth}px`,
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
        activePluginView={activePluginSidebarView?.id ?? null}
        activeSourceControlProvider={activeSourceControlProvider}
        pluginViews={pluginController.sidebarViews}
        sourceControlProviders={pluginController.sourceControlProviders}
        theme={theme}
        onViewChange={(view) => {
          showSidebarView(view);
        }}
        onPluginViewChange={(viewId) => {
          setActiveSourceControlProvider(null);
          setActivePluginSidebar(viewId);
        }}
        onSourceControlProviderChange={(pluginId, providerId) => {
          setActivePluginSidebar(null);
          setActiveSourceControlProvider({ pluginId, providerId });
        }}
        onAbout={() => setAboutOpen(true)}
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
        {activeSourceControlContribution ? (
          <SourceControlPanel
            key={`${activeSourceControlContribution.pluginId}:${activeSourceControlContribution.id}`}
            title={activeSourceControlContribution.title}
            model={activeSourceControlContribution.model}
            onAction={activeSourceControlAction}
            onOpenFile={activeSourceControlFileOpen}
          />
        ) : activePluginSidebarView ? (
          <div className="sidebar-view plugin-sidebar-view">
            <div className="sidebar-view__title">
              <h2>{activePluginSidebarView.title}</h2>
            </div>
            <div className="plugin-sidebar-view__content">
              {activePluginSidebarView.content}
            </div>
          </div>
        ) : sidebarView === "files" ? (
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
              <button
                type="button"
                className="icon-button"
                title={
                  folderBulkAction.action === "collapse"
                    ? "Collapse all folders"
                    : "Expand all folders"
                }
                aria-label={
                  folderBulkAction.action === "collapse"
                    ? "Collapse all folders"
                    : "Expand all folders"
                }
                disabled={folderBulkAction.disabled}
                onClick={() =>
                  setExpandedPaths((current) =>
                    applyWorkspaceBulkAction(folderExpansion, current),
                  )
                }
              >
                {folderBulkAction.action === "collapse" ? (
                  <Folder aria-hidden="true" size={16} />
                ) : (
                  <FolderOpen aria-hidden="true" size={16} />
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                title={
                  showDotfiles
                    ? "Hide dotfiles and folders"
                    : "Show dotfiles and folders"
                }
                aria-label="Show dotfiles and folders"
                aria-pressed={showDotfiles}
                onClick={toggleDotfileVisibility}
              >
                {showDotfiles ? (
                  <Eye aria-hidden="true" size={16} />
                ) : (
                  <EyeOff aria-hidden="true" size={16} />
                )}
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
              showDotfiles={showDotfiles}
              ignoredPaths={ignoredPaths}
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
              fileActions={fileActionHandlers}
              projectRoots={workspace.projectRoots}
              projectWorkspaces={workspace.projectWorkspaces}
              onMarkProject={(path) => void markProject(path)}
              onUnmarkProject={(projectRoot) => void unmarkProject(projectRoot)}
              onMarkWorkspace={(path) => void markWorkspace(path)}
              onUnmarkWorkspace={(projectWorkspace) =>
                void unmarkWorkspace(projectWorkspace)
              }
            />
          </>
        ) : sidebarView === "search" ? (
          <SearchPanel
            query={searchQuery}
            location={searchLocation}
            filters={searchFilters}
            focusQueryRequest={searchQueryFocusRequest}
            results={searchResults}
            searching={indexing}
            tagColors={tagColorMap}
            onQueryChange={setSearchQuery}
            onLocationChange={setSearchLocation}
            onFiltersChange={setSearchFilters}
            onOpenResult={(result) => void openSearchResult(result)}
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
      <main
        className="workspace-main"
        id="editor-workspace"
        tabIndex={-1}
        data-locked={workspaceLocked}
        aria-busy={workspaceLocked}
      >
        <header className="workspace-topbar">
          <span className="workspace-topbar__spacer" />
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
                navigator.platform.includes("Mac") ? "⌘H" : "Ctrl+H"
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
              aria-label={
                activeFileTab?.readOnly ? "Switch to write mode" : "Switch to read mode"
              }
              title={
                activeFileTab?.readOnly ? "Switch to write mode" : "Switch to read mode"
              }
              aria-pressed={activeFileTab?.readOnly ?? false}
              disabled={!activeFileTab || workspaceLocked}
              onClick={toggleReadMode}
            >
              {activeFileTab?.readOnly ? (
                <Pencil aria-hidden="true" size={16} />
              ) : (
                <BookOpen aria-hidden="true" size={16} />
              )}
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
              aria-label={`${outlineVisible ? "Hide" : "Show"} outline`}
              title={`${outlineVisible ? "Hide" : "Show"} outline`}
              aria-pressed={outlineVisible}
              disabled={!outlineAvailable}
              onClick={() => setShowOutline((current) => !current)}
            >
              <ListTree aria-hidden="true" size={16} />
            </button>
            <FileActionsDropdown
              node={activeNode}
              disabled={workspaceLocked}
              handlers={fileActionHandlers}
            />
          </div>
        </header>
        {errorBanner}
        {workspace.suggestGitProject && !workspaceLocked ? (
          <GitProjectSuggestion
            onAccept={() => markProject("")}
            onDecline={dismissGitProjectSuggestion}
          />
        ) : null}
        <div className="editor-layout">
          <div
            className="pane-grid"
            data-layout={paneLayout.kind}
            data-pane-count={panes.length}
            style={{
              gridTemplateColumns: paneTracks.columns,
              gridTemplateRows: paneTracks.rows,
            }}
          >
            {panes.map((pane, index) => {
              const area = paneAreaList[index];
              const focused = pane.id === focusedPaneId;
              const paneActiveTab =
                pane.tabs.find((tab) => tab.path === pane.activePath) ?? null;
              const paneProject = closestAvailableProjectRoot(
                workspace.projectRoots,
                paneActiveTab?.placeholder ? null : (paneActiveTab?.path ?? null),
              );
              return (
                <section
                  key={pane.id}
                  className="workspace-pane"
                  role="group"
                  aria-label={paneAccessibleLabel(panes, pane.id)}
                  data-pane-id={pane.id}
                  data-focused={focused}
                  style={{
                    gridColumn: `${area.columnStart} / ${area.columnEnd}`,
                    gridRow: `${area.rowStart} / ${area.rowEnd}`,
                  }}
                  onFocusCapture={() => focusPane(pane.id)}
                  onPointerDownCapture={() => focusPane(pane.id)}
                >
                  <div className="workspace-pane__header">
                    <Tabs
                      tabs={pane.tabs}
                      groups={pane.groups}
                      activePath={pane.activePath}
                      disabled={workspaceLocked}
                      label={`Open files in pane ${index + 1}`}
                      paneTargets={panes
                        .filter((candidate) => candidate.id !== pane.id)
                        .map((candidate) => ({
                          id: candidate.id,
                          label: `pane ${
                            panes.findIndex(
                              (entry) => entry.id === candidate.id,
                            ) + 1
                          }`,
                        }))}
                      onActivate={activateTab}
                      onClose={(path) => void closeTab(path)}
                      onCloseMany={(paths) => void closeTabs(paths)}
                      onReorder={reorderTabs}
                      onNewTab={() => createNewTab(pane.id)}
                      onToggleGroup={toggleTabGroup}
                      onCreateGroup={(path) => void createTabGroup(path)}
                      onRenameGroup={(groupId) => void renameTabGroup(groupId)}
                      onMoveToGroup={moveTabToGroup}
                      onMoveToPane={moveTabToPane}
                      onDragStart={handleTabDragStart}
                      onDragMove={handleTabDragMove}
                      onDragEnd={handleTabDragEnd}
                      onDragCancel={handleTabDragCancel}
                    />
                    {panes.length > 1 ? (
                      <button
                        type="button"
                        className="icon-button pane-close"
                        aria-label={`Close pane ${index + 1}`}
                        title={`Close pane ${index + 1}`}
                        disabled={workspaceLocked}
                        onClick={() => closeWorkspacePane(pane.id)}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </div>
                  <div className="editor-pane">
                    {renderPaneSurface(
                      pane,
                      focused ? activeProject : paneProject,
                    )}
                    {dockTarget?.paneId === pane.id ? (
                      <PaneDockOverlay position={dockTarget.position} />
                    ) : null}
                  </div>
                </section>
              );
            })}
            {paneSeparatorList.map((separator) => (
              <PaneResizer
                key={`${separator.groupIndex}:${separator.index}:${separator.axis}`}
                label={`Resize panes ${
                  separator.axis === "x" ? "horizontally" : "vertically"
                } (${separator.index + 1})`}
                orientation={
                  separator.axis === "x" ? "vertical" : "horizontal"
                }
                value={
                  paneLayout.sizes[
                    paneGroupOffset(
                      paneLayout.kind,
                      panes.length,
                      separator.groupIndex,
                    ) + separator.index
                  ] ?? 0.5
                }
                disabled={workspaceLocked}
                style={{
                  gridColumn: `${separator.columnStart} / ${separator.columnEnd}`,
                  gridRow: `${separator.rowStart} / ${separator.rowEnd}`,
                }}
                onResize={(delta) =>
                  resizePane(separator.groupIndex, separator.index, delta)
                }
                onResizeEnd={finishPaneResize}
              />
            ))}
          </div>
          {outlineVisible ? (
            <OutlineResizer
              width={outlineWidth}
              disabled={workspaceLocked}
              onChange={setOutlineWidth}
              onCommit={commitOutlineWidth}
            />
          ) : null}
          {outlineVisible && activeFileTab?.kind === "markdown" ? (
            <TableOfContents
              headings={headings}
              loading={outlineLoading}
              onNavigate={navigateToHeading}
            />
          ) : outlineVisible && activeSourceOutlineAvailable ? (
            <SourceOutline
              symbols={sourceSymbols}
              minimap={sourceMinimap}
              loading={outlineLoading}
              viewport={
                activeFileTab
                  ? (sourceViewports[
                      sourceViewportCacheKey(
                        workspace.vaultPath,
                        focusedPaneId,
                        activeFileTab.path,
                      )
                    ] ?? null)
                  : null
              }
              onNavigateLine={navigateToSourceLine}
              onNavigateProgress={navigateToSourceProgress}
            />
          ) : null}
        </div>
        <footer className="status-bar">
          <span>{activeFileTab?.path ?? activeTab?.title ?? workspace.vaultPath}</span>
          <span className="status-bar__spacer" />
          {activeProject ? (
            <span
              className="status-bar__project"
              title={`Active project: ${
                activeProject.rootPath || "Vault root"
              }`}
              aria-label={`Active project: ${
                activeProject.rootPath || "Vault root"
              }`}
            >
              Project: {projectRootLabel(activeProject)}
            </span>
          ) : null}
          {activeFileTab &&
          activeFileTab.encoding === "utf8" &&
          activeFileTab.kind !== "image" &&
          !usesRichMarkdownEditor(activeFileTab, activeProject) ? (
            <SourceLanguageStatus
              path={activeFileTab.path}
              override={activeFileTab.languageOverride ?? null}
              onChange={(languageOverride) =>
                updateTabLanguageOverride(activeFileTab.path, languageOverride)
              }
            />
          ) : null}
          {panes.length > 1 ? (
            <span>{`Pane ${focusedPaneIndex + 1} of ${panes.length}`}</span>
          ) : null}
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
          {pluginController.statusItems.map((item) => (
            <span key={item.id} title={item.pluginId}>
              {item.text}
            </span>
          ))}
          <span>{status}</span>
        </footer>
        <span className="sr-only" role="status" aria-live="polite">
          {status}
        </span>
      </main>
      <HistoryDialog
        open={historyOpen}
        title={historyTarget?.title ?? "Note"}
        revisions={historyRevisions}
        loading={historyLoading}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryTarget(null);
        }}
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
        plugins={pluginController.plugins}
        pluginBundles={pluginController.bundles}
        pluginDevelopmentSupported={pluginController.developmentSupported}
        activeProject={activeProject}
        pluginsLoading={pluginController.loading}
        busyPluginIds={pluginController.busyPluginIds}
        onChange={updateEditorDisplaySettings}
        onRestoreTabsChange={updateRestoreTabs}
        onRemoveExternalDomain={removeExternalDomain}
        onClearExternalDomains={clearExternalDomains}
        onEnablePlugin={pluginController.enable}
        onDisablePlugin={pluginController.disable}
        onDisableAllPlugins={pluginController.disableAll}
        onUpdateAllPlugins={pluginController.updateAll}
        onLoadDevelopmentPlugin={pluginController.loadDevelopmentPlugin}
        onClearPluginData={pluginController.clearData}
        onClearPluginCredentials={pluginController.clearCredentials}
        onUpdatePluginSettings={pluginController.updateSettings}
        onImportPluginSettings={pluginController.importSettings}
        onInspectPluginTools={api.getPluginToolStatuses}
        onPickPluginExecutable={api.choosePluginExecutable}
        onPluginError={showError}
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
      {aboutDialog}
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
  const flattened: FileNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    flattened.push(node);
    if (node.kind === "folder") {
      const children = node.children;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
    }
  }
  return flattened;
}

/**
 * Resolves one repository-relative path to a vault-relative one.
 *
 * A vault-scoped repository is the vault itself, and a project-scoped one is a
 * folder inside it, so the project's own root is the only prefix that is ever
 * added. Anything absolute, anything with a drive letter, and any `..` segment
 * is refused rather than normalized, so a path a provider supplies can only
 * ever name something inside the open vault.
 */
function vaultRelativePath(
  projectRoot: string,
  repositoryPath: string,
): string | null {
  const trimmed = repositoryPath.trim();
  if (
    !trimmed ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return null;
  }
  const segments = trimmed.split(/[\\/]/);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  const path = segments.filter(Boolean).join("/");
  if (!path) {
    return null;
  }
  const root = projectRoot.split(/[\\/]/).filter(Boolean).join("/");
  return root ? `${root}/${path}` : path;
}

function findNode(nodes: FileNode[], path: string | null): FileNode | null {  if (!path) {
    return null;
  }
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.path === path) {
      return node;
    }
    if (node.kind === "folder") {
      const children = node.children;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
    }
  }
  return null;
}

function defaultWelcomePagePath(
  tree: FileNode[],
  defaultVault: boolean,
): string | null {
  if (findNode(tree, ".denote.md")?.kind === "markdown") {
    return ".denote.md";
  }
  if (defaultVault && findNode(tree, "Welcome.md")?.kind === "markdown") {
    return "Welcome.md";
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

function sourceHeadingRange(
  view: EditorView,
  targetSlug: string,
): { from: number; to: number } | null {
  forceParsing(view, view.state.doc.length, 20);
  const ranges: Array<{ from: number; to: number }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (/^(?:ATXHeading|SetextHeading)/.test(node.name)) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  const usedSlugs = new Set<string>();
  for (const range of ranges) {
    const heading = extractHeadings(
      view.state.doc.sliceString(range.from, range.to),
    )[0];
    if (
      heading &&
      nextHeadingSlug(heading.text, usedSlugs) === targetSlug
    ) {
      return range;
    }
  }
  return null;
}
