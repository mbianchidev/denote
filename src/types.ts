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

export type EncryptionPhase = "encrypting" | "encrypted" | "decrypting";

export interface EncryptionStatus {
  enabled: boolean;
  unlocked: boolean;
  phase: EncryptionPhase | null;
  remainingRecoveryCodes: number;
}

export interface WorkspaceSnapshot {
  vaultPath: string;
  vaultName: string;
  tree: FileNode[];
  bookmarks: NoteListItem[];
  recent: NoteListItem[];
  trash: TrashItem[];
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

export interface SearchResult {
  document: SearchDocument;
  score: number;
  snippet: string;
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
  stats?: NoteStats;
  imageDataUrl?: string;
  rawEditing: boolean;
  editorRevision: number;
  editRecorded: boolean;
  saveState: "saved" | "dirty" | "saving" | "error";
}

export type SidebarView = "files" | "search" | "bookmarks" | "recent" | "trash";

export interface HeadingItem {
  depth: number;
  text: string;
  slug: string;
}
