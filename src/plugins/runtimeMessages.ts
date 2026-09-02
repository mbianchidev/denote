import type {
  PluginCapability,
  PluginNoteEvent,
  PluginProjectContext,
  PluginProjectContextChangeEvent,
  PluginSourceControlAction,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";

export interface PluginCommandContribution {
  pluginId: string;
  id: string;
  title: string;
}

export interface PluginSidebarContribution {
  pluginId: string;
  id: string;
  title: string;
  content: string;
}

export interface PluginStatusContribution {
  pluginId: string;
  id: string;
  text: string;
}

export interface PluginDecorationContribution {
  pluginId: string;
  id: string;
  pattern: string;
  style: "highlight" | "warning" | "muted";
  caseSensitive: boolean;
}

export interface PluginSourceControlContribution {
  pluginId: string;
  id: string;
  title: string;
  model: PluginSourceControlViewModel;
}

export interface PluginWorkerConnectMessage {
  type: "connect";
  moduleUrl: string;
  pluginId: string;
  expectedVersion: string;
  permissions: PluginCapability[];
}

export type PluginHostMessage =
  | {
      type: "activate";
      projectContext?: PluginProjectContext | null;
    }
  | { type: "run-command"; commandId: string; requestId: string }
  | {
      type: "run-source-control-action";
      providerId: string;
      action: PluginSourceControlAction;
      requestId: string;
    }
  | { type: "note-event"; event: PluginNoteEvent }
  | {
      type: "project-context-change";
      event: PluginProjectContextChangeEvent;
    }
  | { type: "deactivate"; requestId: string }
  | {
      type: "host-response";
      requestId: string;
      value?: unknown;
      error?: string;
    };

export type PluginRuntimeMessage =
  | { type: "ready" }
  | { type: "activated" }
  | { type: "deactivated"; requestId: string; error?: string }
  | { type: "activation-error"; error: string }
  | { type: "runtime-error"; error: string }
  | { type: "register-command"; id: string; title: string }
  | { type: "unregister-command"; id: string }
  | { type: "register-sidebar"; id: string; title: string; content: string }
  | { type: "unregister-sidebar"; id: string }
  | { type: "register-status"; id: string; text: string }
  | { type: "unregister-status"; id: string }
  | {
      type: "register-decoration";
      id: string;
      pattern: string;
      style: "highlight" | "warning" | "muted";
      caseSensitive: boolean;
    }
  | { type: "unregister-decoration"; id: string }
  | {
      type: "register-source-control";
      id: string;
      title: string;
      model: PluginSourceControlViewModel;
    }
  | {
      type: "update-source-control";
      id: string;
      model: PluginSourceControlViewModel;
    }
  | { type: "unregister-source-control"; id: string }
  | {
      type: "host-request";
      requestId: string;
      operation: string;
      actionId?: string;
      key?: string;
      value?: unknown;
      /** Caller-generated ID for a cancellable native operation. */
      operationId?: string;
    }
  | { type: "command-result"; requestId: string; error?: string }
  | {
      type: "source-control-action-result";
      requestId: string;
      error?: string;
    }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      details?: Record<string, unknown>;
    };

export function isPluginRuntimeMessage(
  value: unknown,
): value is PluginRuntimeMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "ready":
    case "activated":
      return true;
    case "activation-error":
    case "runtime-error":
      return typeof value.error === "string";
    case "deactivated":
    case "command-result":
    case "source-control-action-result":
      return (
        typeof value.requestId === "string" &&
        (value.error === undefined || typeof value.error === "string")
      );
    case "register-command":
      return typeof value.id === "string" && typeof value.title === "string";
    case "unregister-command":
      return typeof value.id === "string";
    case "register-sidebar":
      return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.content === "string"
      );
    case "unregister-sidebar":
      return typeof value.id === "string";
    case "register-status":
      return typeof value.id === "string" && typeof value.text === "string";
    case "unregister-status":
      return typeof value.id === "string";
    case "register-decoration":
      return (
        typeof value.id === "string" &&
        typeof value.pattern === "string" &&
        ["highlight", "warning", "muted"].includes(String(value.style)) &&
        typeof value.caseSensitive === "boolean"
      );
    case "unregister-decoration":
      return typeof value.id === "string";
    case "register-source-control":
      return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        isPluginSourceControlViewModel(value.model)
      );
    case "update-source-control":
      return (
        typeof value.id === "string" &&
        isPluginSourceControlViewModel(value.model)
      );
    case "unregister-source-control":
      return typeof value.id === "string";
    case "host-request":
      return (
        typeof value.requestId === "string" &&
        typeof value.operation === "string" &&
        (value.key === undefined || typeof value.key === "string") &&
        (value.actionId === undefined || typeof value.actionId === "string") &&
        (value.operationId === undefined ||
          typeof value.operationId === "string")
      );
    case "log":
      return (
        ["debug", "info", "warn", "error"].includes(String(value.level)) &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

export function isPluginHostMessage(value: unknown): value is PluginHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "activate":
      return (
        value.projectContext === undefined ||
        value.projectContext === null ||
        isProjectContext(value.projectContext)
      );
    case "run-command":
      return (
        typeof value.commandId === "string" &&
        typeof value.requestId === "string"
      );
    case "run-source-control-action":
      return (
        typeof value.providerId === "string" &&
        typeof value.requestId === "string" &&
        isPluginSourceControlAction(value.action)
      );
    case "note-event":
      return (
        isRecord(value.event) &&
        typeof value.event.path === "string" &&
        ["opened", "changed", "saved", "closed"].includes(
          String(value.event.kind),
        )
      );
    case "project-context-change":
      return (
        isRecord(value.event) &&
        isNullableProjectContext(value.event.previous) &&
        isNullableProjectContext(value.event.current) &&
        typeof value.event.workspaceChanged === "boolean"
      );
    case "deactivate":
      return typeof value.requestId === "string";
    case "host-response":
      return (
        typeof value.requestId === "string" &&
        (value.error === undefined || typeof value.error === "string")
      );
    default:
      return false;
  }
}

export function isPluginSourceControlAction(
  value: unknown,
): value is PluginSourceControlAction {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.values === undefined ||
      (isRecord(value.values) &&
        Object.values(value.values).every(
          (entry) =>
            typeof entry === "string" ||
            typeof entry === "boolean" ||
            (typeof entry === "number" && Number.isFinite(entry)),
        )))
  );
}

export function isPluginSourceControlViewModel(
  value: unknown,
): value is PluginSourceControlViewModel {
  if (
    !isRecord(value) ||
    !isRepository(value.repository) ||
    !isArrayOf(value.resourceGroups, isResourceGroup) ||
    !isArrayOf(value.branches, isBranch) ||
    !isArrayOf(value.remotes, isRemote) ||
    !isArrayOf(value.history, isHistoryEntry) ||
    !isArrayOf(value.diffFiles, isDiffFile) ||
    !isArrayOf(value.conflicts, isConflict) ||
    !isRecovery(value.recovery) ||
    !isRecord(value.selectedView)
  ) {
    return false;
  }
  if (value.selectedTab === "changes") {
    return (
      value.selectedView.kind === "repository" ||
      ((value.selectedView.kind === "diff" ||
        value.selectedView.kind === "conflict") &&
        typeof value.selectedView.path === "string")
    );
  }
  if (value.selectedTab === "history") {
    return (
      value.selectedView.kind === "history" ||
      (value.selectedView.kind === "commit" &&
        typeof value.selectedView.commitId === "string") ||
      (value.selectedView.kind === "diff" &&
        typeof value.selectedView.path === "string" &&
        typeof value.selectedView.commitId === "string")
    );
  }
  return (
    value.selectedTab === "branches" &&
    (value.selectedView.kind === "branches" ||
      value.selectedView.kind === "remotes")
  );
}

function isRepository(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repositoryId === "string" &&
    typeof value.label === "string" &&
    typeof value.initialized === "boolean" &&
    isNullableString(value.branch) &&
    isNullableString(value.upstream) &&
    isNonNegativeInteger(value.ahead) &&
    isNonNegativeInteger(value.behind) &&
    (value.latestCommit === null || isCommitSummary(value.latestCommit)) &&
    typeof value.busy === "boolean" &&
    (value.busyMessage === undefined || typeof value.busyMessage === "string") &&
    (value.activeOperationId === undefined ||
      typeof value.activeOperationId === "string")
  );
}

function isCommitSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["id", "shortId", "summary", "authorName", "authoredAt"].every(
      (key) => typeof value[key] === "string",
    )
  );
}

function isResourceGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    ["staged", "unstaged", "untracked", "conflicted", "ignored"].includes(
      value.kind,
    ) &&
    typeof value.label === "string" &&
    isArrayOf(value.resources, isResource)
  );
}

function isResource(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    isResourceStatus(value.status) &&
    isNonNegativeInteger(value.additions) &&
    isNonNegativeInteger(value.deletions) &&
    typeof value.binary === "boolean"
  );
}

function isBranch(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.current === "boolean" &&
    typeof value.remote === "boolean" &&
    isNullableString(value.upstream) &&
    isNonNegativeInteger(value.ahead) &&
    isNonNegativeInteger(value.behind)
  );
}

function isRemote(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isNullableString(value.fetchUrl) &&
    isNullableString(value.pushUrl)
  );
}

function isHistoryEntry(value: unknown): boolean {
  return (
    isCommitSummary(value) &&
    isRecord(value) &&
    isArrayOf(value.parentIds, isString) &&
    isArrayOf(value.refs, isString)
  );
}

function isDiffFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    isNullableString(value.previousPath) &&
    isResourceStatus(value.status) &&
    isNonNegativeInteger(value.additions) &&
    isNonNegativeInteger(value.deletions) &&
    typeof value.binary === "boolean" &&
    isArrayOf(value.hunks, isDiffHunk)
  );
}

function isDiffHunk(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.header === "string" &&
    isNonNegativeInteger(value.oldStart) &&
    isNonNegativeInteger(value.oldLines) &&
    isNonNegativeInteger(value.newStart) &&
    isNonNegativeInteger(value.newLines) &&
    isArrayOf(value.lines, isDiffLine)
  );
}

function isDiffLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    ["context", "addition", "deletion"].includes(value.kind) &&
    isNullableNonNegativeInteger(value.oldLineNumber) &&
    isNullableNonNegativeInteger(value.newLineNumber) &&
    typeof value.content === "string"
  );
}

function isConflict(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    isResourceStatus(value.status) &&
    typeof value.oursLabel === "string" &&
    typeof value.theirsLabel === "string" &&
    isNullableString(value.baseLabel)
  );
}

function isRecovery(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.state === "idle") {
    return true;
  }
  if (
    (value.state !== "running" && value.state !== "failed") ||
    typeof value.operationId !== "string" ||
    typeof value.message !== "string"
  ) {
    return false;
  }
  return (
    value.state === "running" ||
    ((value.retryActionId === undefined ||
      typeof value.retryActionId === "string") &&
      (value.dismissActionId === undefined ||
        typeof value.dismissActionId === "string"))
  );
}

function isResourceStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    [
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "type-changed",
      "unmerged",
      "unknown",
    ].includes(value)
  );
}

function isProjectContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    typeof value.rootPath === "string"
  );
}

function isNullableProjectContext(value: unknown): boolean {
  return value === null || isProjectContext(value);
}

function isArrayOf(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isString(value: unknown): boolean {
  return typeof value === "string";
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function isNullableNonNegativeInteger(value: unknown): boolean {
    return value === null || isNonNegativeInteger(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
