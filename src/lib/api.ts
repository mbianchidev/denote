import { invoke } from "@tauri-apps/api/core";
import type {
  HistoryRevision,
  NoteDocument,
  SaveOutcome,
  SearchDocument,
  WorkspaceSnapshot,
} from "../types";

export const api = {
  getLastVault: () => invoke<string | null>("get_last_vault"),
  openVault: (vaultPath: string) =>
    invoke<WorkspaceSnapshot>("open_vault", { vaultPath }),
  refreshVault: (vaultPath: string) =>
    invoke<WorkspaceSnapshot>("refresh_vault", { vaultPath }),
  readNote: (vaultPath: string, path: string) =>
    invoke<NoteDocument>("read_note", { vaultPath, path }),
  saveNote: (
    vaultPath: string,
    path: string,
    content: string,
    reason = "autosave",
  ) =>
    invoke<SaveOutcome>("save_note", {
      vaultPath,
      path,
      content,
      reason,
    }),
  createEntry: (
    vaultPath: string,
    parentPath: string,
    name: string,
    directory: boolean,
  ) =>
    invoke<string>("create_entry", {
      vaultPath,
      parentPath,
      name,
      directory,
    }),
  renameEntry: (vaultPath: string, path: string, newName: string) =>
    invoke<string>("rename_entry", { vaultPath, path, newName }),
  trashEntry: (vaultPath: string, path: string) =>
    invoke<void>("trash_entry", { vaultPath, path }),
  restoreTrashItem: (vaultPath: string, itemId: number) =>
    invoke<string>("restore_trash_item", { vaultPath, itemId }),
  setBookmark: (
    vaultPath: string,
    path: string,
    bookmarked: boolean,
  ) => invoke<void>("set_bookmark", { vaultPath, path, bookmarked }),
  setEntryOrder: (vaultPath: string, paths: string[]) =>
    invoke<void>("set_entry_order", { vaultPath, paths }),
  listHistory: (vaultPath: string, path: string) =>
    invoke<HistoryRevision[]>("list_history", { vaultPath, path }),
  restoreRevision: (
    vaultPath: string,
    path: string,
    revisionId: number,
  ) =>
    invoke<NoteDocument>("restore_revision", {
      vaultPath,
      path,
      revisionId,
    }),
  listSearchDocuments: (vaultPath: string) =>
    invoke<SearchDocument[]>("list_search_documents", { vaultPath }),
  readImageDataUrl: (
    vaultPath: string,
    imageSource: string,
    notePath?: string,
  ) =>
    invoke<string>("read_image_data_url", {
      vaultPath,
      notePath: notePath ?? null,
      imageSource,
    }),
  saveAttachment: async (
    vaultPath: string,
    notePath: string,
    file: File,
  ) => {
    const data = Array.from(new Uint8Array(await file.arrayBuffer()));
    return invoke<string>("save_attachment", {
      vaultPath,
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
