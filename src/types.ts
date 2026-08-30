import type { MarkdownViewMode } from "./lib/markdownView";

export type FileKind = "folder" | "markdown" | "text" | "image" | "file";
export type FileEncoding = "utf8" | "base64";
export type FileLineEnding = "lf" | "crlf" | "cr";

export interface FileNode {
  path: string;
  name: string;
  kind: FileKind;
  children: FileNode[];
  size: number;
  modifiedAt: number | null;
  bookmarked: boolean;
  pinned: boolean;
  position?: number | null;
}

export interface NoteStats {
  openCount: number;
  editCount: number;
  saveCount: number;
  lastOpenedAt: string | null;
  lastEditedAt: string | null;
  lastSavedAt: string | null;
  bookmarked: boolean;
}

export interface NoteDocument {
  path: string;
  content: string;
  contentHash: string;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
  stats: NoteStats;
}

export interface NoteListItem {
  path: string;
  title: string;
  lastOpenedAt: string | null;
  bookmarked: boolean;
}

export interface TrashItem {
  id: number;
  originalPath: string;
  deletedAt: string;
  isDirectory: boolean;
}

export interface KnownVault {
  id: number;
  name: string;
  path: string;
  lastOpenedAt: string;
  available: boolean;
  current: boolean;
  default: boolean;
}

export interface KnownVaultFile {
  vaultId: number;
  vaultName: string;
  path: string;
  fileName: string;
  current: boolean;
  default: boolean;
}

export interface KnownVaultFileBatch {
  files: KnownVaultFile[];
  skippedVaultCount: number;
  skippedEntryCount: number;
  truncated: boolean;
}

export interface TagColor {
  tag: string;
  color: string;
}

export interface TabGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface TabSessionTab {
  path: string;
  groupId: string | null;
}

export type PaneLayoutKind =
  | "single"
  | "horizontal"
  | "vertical"
  | "grid"
  | "left-stack"
  | "right-stack"
  | "top-stack"
  | "bottom-stack";

export interface PaneLayout {
  kind: PaneLayoutKind;
  sizes: number[];
}

export interface TabSessionPane {
  id: string;
  tabs: TabSessionTab[];
  groups: TabGroup[];
  activePath: string | null;
}

export interface TabSessionState {
  tabs: TabSessionTab[];
  groups: TabGroup[];
  activePath: string | null;
  panes?: TabSessionPane[];
  layout?: PaneLayout;
  focusedPaneId?: string | null;
}

export type EncryptionPhase = "encrypting" | "encrypted" | "decrypting";

export interface EncryptionStatus {
  enabled: boolean;
  unlocked: boolean;
  phase: EncryptionPhase | null;
  remainingRecoveryCodes: number;
}

export interface WelcomePagePreference {
  customPath: string | null;
  effectivePath: string | null;
}

export interface WorkspaceSnapshot {
  vaultPath: string;
  vaultName: string;
  default: boolean;
  tree: FileNode[];
  bookmarks: NoteListItem[];
  recent: NoteListItem[];
  trash: TrashItem[];
  tagColors: TagColor[];
  markdownViewMode: MarkdownViewMode | null;
  restoreTabs: boolean;
  tabSession: TabSessionState | null;
  welcomePage: WelcomePagePreference;
  fromCache: boolean;
  encryption: EncryptionStatus;
}

export interface EncryptionSetupResult {
  snapshot: WorkspaceSnapshot;
  recoveryCodes: string[];
}

export interface RecoveryCodesResult {
  remainingRecoveryCodes: number;
  recoveryCodes: string[];
}

export interface SaveOutcome {
  path: string;
  changed: boolean;
  savedAt: string;
  contentHash: string;
  historyCount: number;
  stats: NoteStats;
}

export interface HistoryRevision {
  id: number;
  createdAt: string;
  reason: string;
  preview: string;
  byteCount: number;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
}

export interface SearchDocument {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
  tags: string[];
  kind: Exclude<FileKind, "folder">;
  bookmarked: boolean;
  lastOpenedAt: string | null;
}

export interface DocumentBatch {
  documents: SearchDocument[];
  skippedCount: number;
  truncated: boolean;
}

export interface LinkRewriteBatch extends DocumentBatch {
  availablePaths: string[];
}

export interface MoveEntryResult {
  path: string;
  rewriteToken: string;
}

export interface SearchResult {
  document: SearchDocument;
  score: number;
  snippet: string;
  match: SearchMatch | null;
}

export interface SearchMatch {
  from: number;
  to: number;
}

export interface EditorSearchNavigation extends SearchMatch {
  request: number;
  text: string;
}

export interface EditorTab {
  path: string;
  title: string;
  kind: Exclude<FileKind, "folder">;
  content: string;
  savedContent: string;
  savedHash?: string;
  encoding: FileEncoding;
  lineEnding: FileLineEnding;
  placeholder: boolean;
  groupId: string | null;
  navigationHistory?: string[];
  navigationIndex?: number;
  stats?: NoteStats;
  imageDataUrl?: string;
  rawEditing: boolean;
  readOnly?: boolean;
  editorRevision: number;
  editRecorded: boolean;
  saveState: "saved" | "dirty" | "saving" | "error";
}

export type SidebarView = "files" | "search" | "bookmarks" | "recent" | "trash";

export interface WorkspacePane {
  id: string;
  tabs: EditorTab[];
  groups: TabGroup[];
  activePath: string | null;
}

export interface HeadingItem {
  depth: number;
  text: string;
  slug: string;
}
