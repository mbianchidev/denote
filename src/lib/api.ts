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
  InstalledPlugin,
  PluginView,
  PluginBundleMetadata,
  ProjectConfiguration,
  RecoveryCodesResult,
  SaveOutcome,
  TabSessionState,
  TagColor,
  TrashItem,
  WelcomePagePreference,
  WorkspaceSnapshot,
} from "../types";
import type { MarkdownViewMode } from "./markdownView";
import type {
  PluginNetworkRequest,
  PluginNetworkResponse,
  PluginPermissionRequest,
  PluginProcessRequest,
  PluginProcessResult,
  PluginTextDocument,
} from "@denote/plugin-sdk";

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
  markProjectRoot: (path: string) =>
    invoke<ProjectConfiguration>("mark_project_root", { path }),
  unmarkProjectRoot: (projectRootId: string) =>
    invoke<ProjectConfiguration>("unmark_project_root", { projectRootId }),
  markProjectWorkspace: (path: string) =>
    invoke<ProjectConfiguration>("mark_project_workspace", { path }),
  unmarkProjectWorkspace: (projectWorkspaceId: string) =>
    invoke<ProjectConfiguration>("unmark_project_workspace", {
      projectWorkspaceId,
    }),
  dismissGitProjectSuggestion: () =>
    invoke<ProjectConfiguration>("dismiss_git_project_suggestion"),
  refreshProjectConfiguration: () =>
    invoke<ProjectConfiguration>("refresh_project_configuration"),
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
  resolveFilePath: (path: string) =>
    invoke<string>("resolve_file_path", { path }),
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
  duplicateFile: (path: string) =>
    invoke<FileNode>("duplicate_file", { path }),
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
  prepareExit: () => invoke<void>("prepare_exit"),
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
  setWelcomePagePath: (path: string | null) =>
    invoke<WelcomePagePreference>("set_welcome_page_path", { path }),
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
  listPlugins: () => invoke<PluginView[]>("list_plugins"),
  listPluginBundles: () =>
    invoke<PluginBundleMetadata[]>("list_plugin_bundles"),
  preparePluginEnable: (
    pluginId: string,
    approvedPermissions: PluginPermissionRequest[],
  ) =>
    invoke<InstalledPlugin>("prepare_plugin_enable", {
      pluginId,
      approvedPermissions,
    }),
  commitPluginEnable: (transactionId: string) =>
    invoke<void>("commit_plugin_enable", { transactionId }),
  rollbackPluginEnable: (transactionId: string, error?: string) =>
    invoke<void>("rollback_plugin_enable", {
      transactionId,
      error: error ?? null,
    }),
  recoverPluginTransactions: () =>
    invoke<void>("recover_plugin_transactions"),
  disablePlugin: (
    pluginId: string,
    clearData = false,
    clearCredentials = false,
  ) =>
    invoke<void>("disable_plugin", {
      pluginId,
      clearData,
      clearCredentials,
    }),
  readPluginEntrypoint: (pluginId: string) =>
    invoke<string>("read_plugin_entrypoint", { pluginId }),
  getPluginSettings: (pluginId: string) =>
    invoke<Record<string, unknown>>("get_plugin_settings", { pluginId }),
  setPluginSettings: (
    pluginId: string,
    settings: Record<string, unknown>,
  ) =>
    invoke<Record<string, unknown>>("set_plugin_settings", {
      pluginId,
      settings,
    }),
  importPluginSettings: (
    pluginId: string,
    sourceVersion: number,
    settings: Record<string, unknown>,
  ) =>
    invoke<Record<string, unknown>>("import_plugin_settings", {
      pluginId,
      sourceVersion,
      settings,
    }),
  pluginStorageGet: (pluginId: string, key: string) =>
    invoke<unknown | null>("plugin_storage_get", { pluginId, key }),
  pluginStorageSet: (pluginId: string, key: string, value: unknown) =>
    invoke<void>("plugin_storage_set", { pluginId, key, value }),
  pluginStorageDelete: (pluginId: string, key: string) =>
    invoke<void>("plugin_storage_delete", { pluginId, key }),
  pluginStorageClear: (pluginId: string) =>
    invoke<void>("plugin_storage_clear", { pluginId }),
  pluginSecretGet: (pluginId: string, key: string) =>
    invoke<string | null>("plugin_secret_get", { pluginId, key }),
  pluginSecretSet: (pluginId: string, key: string, value: string) =>
    invoke<void>("plugin_secret_set", { pluginId, key, value }),
  pluginSecretDelete: (pluginId: string, key: string) =>
    invoke<void>("plugin_secret_delete", { pluginId, key }),
  authorizePluginCapability: (
    pluginId: string,
    capability: string,
    workspaceScope?: string,
  ) =>
    invoke<void>("authorize_plugin_capability", {
      pluginId,
      capability,
      workspaceScope: workspaceScope ?? null,
    }),
  pluginWorkspaceRead: (
    pluginId: string,
    workspaceScope: string,
    path: string,
    writePermission = false,
  ) =>
    invoke<PluginTextDocument>("plugin_workspace_read", {
      pluginId,
      workspaceScope,
      path,
      writePermission,
    }),
  pluginWorkspaceWrite: (
    pluginId: string,
    workspaceScope: string,
    path: string,
    content: string,
    version: string,
  ) =>
    invoke<void>("plugin_workspace_write", {
      pluginId,
      workspaceScope,
      path,
      content,
      version,
    }),
  pluginNetworkRequest: (pluginId: string, request: PluginNetworkRequest) =>
    invoke<PluginNetworkResponse>("plugin_network_request", {
      pluginId,
      request,
    }),
  pluginClipboardRead: (pluginId: string) =>
    invoke<string>("plugin_clipboard_read", { pluginId }),
  pluginClipboardWrite: (pluginId: string, text: string) =>
    invoke<void>("plugin_clipboard_write", { pluginId, text }),
  pluginShowNotification: (
    pluginId: string,
    title: string,
    body?: string,
  ) =>
    invoke<void>("plugin_show_notification", {
      pluginId,
      title,
      body: body ?? null,
    }),
  pluginProcessRequest: (
    pluginId: string,
    request: PluginProcessRequest,
    projectId: string | null,
  ) =>
    invoke<PluginProcessResult>("plugin_process_request", {
      pluginId,
      request,
      projectId,
    }),
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
