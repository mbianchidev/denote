import type {
  PluginGitCloneVaultResult,
  PluginNetworkRequest,
  PluginProcessRequest,
} from "@denote/plugin-sdk";
import { api } from "../lib/api";
import type { WorkspaceSnapshot } from "../types";
import {
  parsePluginGitCleanupToken,
  parsePluginGitCloneVaultRequest,
  parsePluginGitHubListLimit,
  parsePluginGitInvocation,
  parsePluginGitRequest,
} from "./gitRequests";

export interface PluginActionLeaseScope {
  workspaceScope: string;
  projectId: string | null;
  projectIds?: string[];
  /**
   * The source-control action this lease was opened for, or `null` for a
   * command.
   *
   * Cloning and deleting a failed clone replace or destroy a folder, so the
   * host only performs them under the standardised action the user confirmed.
   * A command carries no action, and a differently named action is a different
   * confirmation, so neither can reach them.
   */
  sourceControlActionId: string | null;
  gitSigningPassphrase?: string;
}

export interface PluginActionHostSecrets {
  gitSigningPassphrase?: string;
}

/**
 * Signals the host renderer that a clone produced a new vault.
 *
 * The snapshot identifies a folder on disk, so it stops here: the renderer
 * opens the vault with it and the plugin only ever receives the outcome.
 */
export type PluginVaultClonedHandler = (
  snapshot: WorkspaceSnapshot,
) => void | Promise<void>;

export function privilegedHostOperation(operation: string): boolean {
  return (
    operation.startsWith("workspace.") ||
    operation.startsWith("network.") ||
    operation.startsWith("clipboard.") ||
    operation.startsWith("notifications.") ||
    operation.startsWith("process.") ||
    operation.startsWith("git.")
  );
}

export async function runHostOperation(
  pluginId: string,
  operation: string,
  key?: string,
  value?: unknown,
  actionScope?: PluginActionLeaseScope,
  operationId?: string,
  onVaultCloned?: PluginVaultClonedHandler,
): Promise<unknown> {
  switch (operation) {
    case "storage.get":
      return api.pluginStorageGet(pluginId, requireKey(key));
    case "storage.set":
      return api.pluginStorageSet(pluginId, requireKey(key), value);
    case "storage.delete":
      return api.pluginStorageDelete(pluginId, requireKey(key));
    case "storage.clear":
      return api.pluginStorageClear(pluginId);
    case "settings.get":
      return api.getPluginSettings(pluginId);
    case "secret.get":
      return api.pluginSecretGet(pluginId, requireKey(key));
    case "secret.set":
      if (typeof value !== "string") {
        throw new Error("Secret value must be a string.");
      }
      return api.pluginSecretSet(pluginId, requireKey(key), value);
    case "secret.delete":
      return api.pluginSecretDelete(pluginId, requireKey(key));
    case "workspace.read":
      return api.pluginWorkspaceRead(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
      );
    case "workspace.read-write":
      return api.pluginWorkspaceRead(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
        true,
      );
    case "workspace.write":
      return api.pluginWorkspaceWrite(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
        requireObjectValue(value, "content"),
        requireObjectValue(value, "version"),
      );
    case "network.request":
      return api.pluginNetworkRequest(pluginId, parseNetworkRequest(value));
    case "clipboard.read":
      return api.pluginClipboardRead(pluginId);
    case "clipboard.write":
      if (typeof value !== "string") {
        throw new Error("Plugin clipboard value must be text.");
      }
      return api.pluginClipboardWrite(pluginId, value);
    case "notifications.show":
      if (!isRecord(value) || typeof value.title !== "string") {
        throw new Error("Plugin notification requires a title.");
      }
      return api.pluginShowNotification(
        pluginId,
        value.title,
        typeof value.body === "string" ? value.body : undefined,
      );
    case "process.run":
      return api.pluginProcessRequest(
        pluginId,
        parseProcessRequest(value),
        requireActionScope(actionScope).projectId,
      );
    case "git.run": {
      const scope = requireActionScope(actionScope);
      const invocation = parsePluginGitInvocation(value);
      const projectId = gitProjectId(invocation.request, invocation.target, scope);
      const signingPassphrase = gitSigningPassphrase(
        invocation.request,
        scope,
      );
      // The request is the only thing a plugin contributes. A custom Git
      // executable lives in host-owned plugin settings, so nothing here can
      // name one.
      const resolvedOperationId = requireOperationId(operationId);
      return signingPassphrase
        ? api.pluginGitRequest(
            pluginId,
            invocation.request,
            scope.workspaceScope,
            projectId,
            resolvedOperationId,
            signingPassphrase,
          )
        : api.pluginGitRequest(
            pluginId,
            invocation.request,
            scope.workspaceScope,
            projectId,
            resolvedOperationId,
          );
    }

    function gitSigningPassphrase(
      request: ReturnType<typeof parsePluginGitRequest>,
      scope: PluginActionLeaseScope,
    ): string | null {
      const passphrase =
        request.operation === "commit" ? scope.gitSigningPassphrase : undefined;
      if (!passphrase) {
        return null;
      }
      if (
        passphrase.length > 4096 ||
        [...passphrase].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 0x20 || code === 0x7f;
        })
      ) {
        throw new Error(
          "The signing passphrase is too long or contains control characters.",
        );
      }
      return passphrase;
    }

    function gitProjectId(
      request: ReturnType<typeof parsePluginGitRequest>,
      target: { projectId: string | null } | null,
      scope: PluginActionLeaseScope,
    ): string | null {
      if (request.operation === "cancel") {
        return null;
      }
      if (request.scope === "vault") {
        if (target?.projectId) {
          throw new Error("A vault Git request cannot target a project repository.");
        }
        return null;
      }
      const projectId = target?.projectId ?? scope.projectId;
      if (!projectId) {
        throw new Error("A project Git request has no repository target.");
      }
      const permitted = new Set([
        ...(scope.projectIds ?? []),
        ...(scope.projectId ? [scope.projectId] : []),
      ]);
      if (!permitted.has(projectId)) {
        throw new Error(
          "The selected Git repository is no longer available in this vault.",
        );
      }
      return projectId;
    }
    case "git.list-github-repositories": {
      const scope = requireActionScope(actionScope);
      return api.pluginGithubListRepositories(
        pluginId,
        parsePluginGitHubListLimit(value),
        scope.workspaceScope,
        requireOperationId(operationId),
      );
    }
    case "git.clone-vault": {
      // A clone opens a native folder chooser and replaces the workspace, so
      // it is refused unless the host itself is running the standardised
      // clone action the user confirmed. Refusing here means no chooser is
      // ever opened and no native command is ever reached.
      const scope = requireSourceControlAction(actionScope, "clone");
      const response = await api.pluginGitCloneVault(
        pluginId,
        parsePluginGitCloneVaultRequest(value),
        scope.workspaceScope,
        requireOperationId(operationId),
      );
      if (response.snapshot) {
        // The host renderer owns the new vault. Awaiting it here means the
        // plugin is only told the clone succeeded once the workspace has
        // actually been handed over, so no action runs against a vault that
        // is not on screen yet.
        await onVaultCloned?.(response.snapshot);
      }
      // Only the outcome crosses back into the plugin: it carries a label, the
      // branch metadata, and an opaque clean-up token, never a path.
      return response.outcome satisfies PluginGitCloneVaultResult;
    }
    case "git.clean-failed-clone": {
      const scope = requireSourceControlAction(
        actionScope,
        "clean-failed-clone",
      );
      return api.pluginGitCleanFailedClone(
        pluginId,
        parsePluginGitCleanupToken(value),
        scope.workspaceScope,
      );
    }
    default:
      throw new Error(`Unsupported plugin host operation: ${operation}`);
  }
}

function requireKey(key?: string): string {
  if (!key) {
    throw new Error("Plugin storage request is missing a key.");
  }
  return key;
}

function requireObjectValue(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string") {
    throw new Error(`Plugin action requires string ${key}.`);
  }
  return value[key];
}

function requireActionScope(
  scope?: PluginActionLeaseScope,
): PluginActionLeaseScope {
  if (!scope?.workspaceScope) {
    throw new Error("Workspace action lease has no vault scope.");
  }
  return scope;
}

/**
 * Requires the lease to belong to one exact source-control action.
 *
 * The host names the action, decides its confirmation, and prepares the
 * workspace for it, so binding the operation to that name is what stops a
 * plugin command, or an action the plugin invented, from reaching a folder
 * chooser or a deletion the user never approved.
 */
function requireSourceControlAction(
  scope: PluginActionLeaseScope | undefined,
  actionId: string,
): PluginActionLeaseScope {
  const resolved = requireActionScope(scope);
  if (resolved.sourceControlActionId !== actionId) {
    throw new Error(
      `Plugin host operation requires the "${actionId}" source-control action.`,
    );
  }
  return resolved;
}

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The runtime generates one operation ID per Git invocation so the plugin can
 * cancel it. A plugin never chooses it, and the native transport refuses
 * anything that is not a canonical UUID.
 */
function requireOperationId(operationId?: string): string {
  if (!operationId || !OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error("Plugin Git request is missing a valid operation ID.");
  }
  return operationId;
}

function parseNetworkRequest(value: unknown): PluginNetworkRequest {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Plugin network request requires a URL.");
  }
  if (
    value.method !== undefined &&
    !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(value.method))
  ) {
    throw new Error("Plugin network request method is invalid.");
  }
  return {
    url: value.url,
    method: value.method as PluginNetworkRequest["method"],
    headers: isStringRecord(value.headers) ? value.headers : undefined,
    body: typeof value.body === "string" ? value.body : undefined,
  };
}

function parseProcessRequest(value: unknown): PluginProcessRequest {
  if (
    !isRecord(value) ||
    typeof value.executable !== "string" ||
    !Array.isArray(value.arguments) ||
    value.arguments.some((argument) => typeof argument !== "string")
  ) {
    throw new Error("Plugin process request is invalid.");
  }
  return {
    executable: value.executable,
    arguments: value.arguments,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
