import { invoke } from "@tauri-apps/api/core";
import type {
  HistoryRevision,
  NoteDocument,
  NoteStats,
  SaveOutcome,
  SearchDocument,
  WorkspaceSnapshot,
} from "../types";

export const api = {
  getLastVault: () => invoke<WorkspaceSnapshot | null>("get_last_vault"),
  chooseVault: () => invoke<WorkspaceSnapshot | null>("choose_vault"),
  refreshVault: () => invoke<WorkspaceSnapshot>("refresh_vault"),
  readNote: (path: string) => invoke<NoteDocument>("read_note", { path }),
  saveNote: (
    path: string,
    content: string,
    reason = "autosave",
    expectedHash?: string,
  ) =>
    invoke<SaveOutcome>("save_note", {
      path,
      content,
      reason,
      expectedHash: expectedHash ?? null,
    }),
  createEntry: (
    parentPath: string,
    name: string,
    directory: boolean,
  ) =>
    invoke<string>("create_entry", {
      parentPath,
      name,
      directory,
    }),
  renameEntry: (path: string, newName: string) =>
    invoke<string>("rename_entry", { path, newName }),
  trashEntry: (path: string) => invoke<void>("trash_entry", { path }),
  restoreTrashItem: (itemId: number) =>
    invoke<string>("restore_trash_item", { itemId }),
  emptyTrash: () => invoke<number>("empty_trash"),
  setBookmark: (path: string, bookmarked: boolean) =>
    invoke<void>("set_bookmark", { path, bookmarked }),
  recordEdit: (path: string) => invoke<NoteStats>("record_edit", { path }),
  setEntryOrder: (paths: string[]) =>
    invoke<void>("set_entry_order", { paths }),
  listHistory: (path: string) =>
    invoke<HistoryRevision[]>("list_history", { path }),
  restoreRevision: (path: string, revisionId: number) =>
    invoke<NoteDocument>("restore_revision", {
      path,
      revisionId,
    }),
  listSearchDocuments: () =>
    invoke<SearchDocument[]>("list_search_documents"),
  readImageDataUrl: (imageSource: string, notePath?: string) =>
    invoke<string>("read_image_data_url", {
      notePath: notePath ?? null,
      imageSource,
    }),
  saveAttachment: async (notePath: string, file: File) => {
    const data = Array.from(new Uint8Array(await file.arrayBuffer()));
    return invoke<string>("save_attachment", {
      notePath,
      fileName: file.name,
      data,
    });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred.";
}
