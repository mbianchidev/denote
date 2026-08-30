import { invoke } from "@tauri-apps/api/core";
import type {
  HistoryRevision,
  FileEncoding,
  FileNode,
  FileLineEnding,
  DocumentBatch,
  EncryptionSetupResult,
  KnownVault,
  KnownVaultFileBatch,
  LinkRewriteBatch,
  MoveEntryResult,
  NoteDocument,
  NoteStats,
  RecoveryCodesResult,
  SaveOutcome,
  TabSessionState,
  TagColor,
  TrashItem,
  WorkspaceSnapshot,
} from "../types";
import type { MarkdownViewMode } from "./markdownView";

export const api = {
  getLastVault: () => invoke<WorkspaceSnapshot | null>("get_last_vault"),
  listKnownVaults: () => invoke<KnownVault[]>("list_known_vaults"),
  listKnownVaultFiles: () =>
    invoke<KnownVaultFileBatch>("list_known_vault_files"),
  openKnownVault: (vaultId: number) =>
    invoke<WorkspaceSnapshot>("open_known_vault", { vaultId }),
  deleteKnownVault: (vaultId: number, trashFiles: boolean) =>
    invoke<void>("delete_known_vault", { vaultId, trashFiles }),
  chooseVault: () => invoke<WorkspaceSnapshot | null>("choose_vault"),
  refreshVault: () => invoke<WorkspaceSnapshot>("refresh_vault"),
  enableVaultEncryption: (password: string) =>
    invoke<EncryptionSetupResult>("enable_vault_encryption", { password }),
  unlockVaultWithPassword: (password: string) =>
    invoke<WorkspaceSnapshot>("unlock_vault_with_password", { password }),
  unlockVaultWithRecoveryCode: (recoveryCode: string) =>
    invoke<WorkspaceSnapshot>("unlock_vault_with_recovery_code", {
      recoveryCode,
    }),
  lockVault: () => invoke<WorkspaceSnapshot>("lock_vault"),
  changeVaultPassword: (password: string) =>
    invoke<void>("change_vault_password", { password }),
  regenerateVaultRecoveryCodes: () =>
    invoke<RecoveryCodesResult>("regenerate_vault_recovery_codes"),
  disableVaultEncryption: () =>
    invoke<WorkspaceSnapshot>("disable_vault_encryption"),
  copyFilePath: (path: string) => invoke<void>("copy_file_path", { path }),
  copyFileContent: (content: string) =>
    invoke<void>("copy_file_content", { content }),
  openExternalUri: (uri: string) =>
    invoke<void>("open_external_uri", { uri }),
  copyFileForAttachment: (
    path: string,
    content: string,
    encoding: FileEncoding,
    lineEnding: FileLineEnding,
  ) =>
    invoke<void>("copy_file_for_attachment", {
      path,
      content,
      encoding,
      lineEnding,
    }),
  readNote: (path: string) => invoke<NoteDocument>("read_note", { path }),
  saveNote: (
    path: string,
    content: string,
    encoding: FileEncoding,
    lineEnding: FileLineEnding,
    reason = "autosave",
    expectedHash?: string,
  ) =>
    invoke<SaveOutcome>("save_note", {
      path,
      content,
      encoding,
      lineEnding,
      reason,
      expectedHash: expectedHash ?? null,
    }),
  createEntry: (
    parentPath: string,
    name: string,
    directory: boolean,
  ) =>
    invoke<FileNode>("create_entry", {
      parentPath,
      name,
      directory,
    }),
  renameEntry: (path: string, newName: string) =>
    invoke<MoveEntryResult>("rename_entry", { path, newName }),
  moveEntry: (path: string, targetParentPath: string) =>
    invoke<MoveEntryResult>("move_entry", { path, targetParentPath }),
  finishLinkRewrite: (rewriteToken: string) =>
    invoke<void>("finish_link_rewrite", { rewriteToken }),
  trashEntry: (path: string) => invoke<TrashItem>("trash_entry", { path }),
  restoreTrashItem: (itemId: number) =>
    invoke<FileNode>("restore_trash_item", { itemId }),
  emptyTrash: () => invoke<number>("empty_trash"),
  completeExit: () => invoke<void>("complete_exit"),
  setBookmark: (path: string, bookmarked: boolean) =>
    invoke<void>("set_bookmark", { path, bookmarked }),
  recordEdit: (path: string) => invoke<NoteStats>("record_edit", { path }),
  setEntryOrder: (paths: string[]) =>
    invoke<void>("set_entry_order", { paths }),
  setEntryPinned: (path: string, pinned: boolean) =>
    invoke<void>("set_entry_pinned", { path, pinned }),
  setTagColor: (tag: string, color: string) =>
    invoke<TagColor>("set_tag_color", { tag, color }),
  setVaultMarkdownViewMode: (mode: MarkdownViewMode) =>
    invoke<void>("set_vault_markdown_view_mode", { mode }),
  setRestoreTabs: (enabled: boolean) =>
    invoke<void>("set_restore_tabs", { enabled }),
  saveTabSession: (session: TabSessionState) =>
    invoke<void>("save_tab_session", { session }),
  listHistory: (path: string) =>
    invoke<HistoryRevision[]>("list_history", { path }),
  restoreRevision: (path: string, revisionId: number) =>
    invoke<NoteDocument>("restore_revision", {
      path,
      revisionId,
    }),
  listSearchDocuments: () =>
    invoke<DocumentBatch>("list_search_documents"),
  listEditableDocuments: () =>
    invoke<DocumentBatch>("list_editable_documents"),
  listLinkRewriteDocuments: () =>
    invoke<LinkRewriteBatch>("list_link_rewrite_documents"),
  readImageDataUrl: (imageSource: string, notePath?: string) =>
    invoke<string>("read_image_data_url", {
      notePath: notePath ?? null,
      imageSource,
    }),
  saveAttachment: async (notePath: string, file: File) => {
    const maxAttachmentBytes = 25 * 1024 * 1024;
    if (file.size > maxAttachmentBytes) {
      throw new Error("Attachment is larger than the 25 MB limit.");
    }
    const dataBase64 = await fileToBase64(file);
    return invoke<string>("save_attachment", {
      notePath,
      fileName: file.name,
      dataBase64,
    });
  },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Unable to encode ${file.name}.`));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred.";
}
