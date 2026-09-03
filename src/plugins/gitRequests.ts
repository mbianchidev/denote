import type {
  PluginGitAuthMode,
  PluginGitCloneVaultRequest,
  PluginGitConflictResolution,
  PluginGitConflictStage,
  PluginGitDiffTarget,
  PluginGitHunk,
  PluginGitHunkLine,
  PluginGitHunkLineKind,
  PluginGitPullStrategy,
  PluginGitPushMode,
  PluginGitRequest,
  PluginGitRepositoryTarget,
  PluginGitScope,
  PluginGitSequencer,
  PluginGitStashAction,
} from "@denote/plugin-sdk";

const SCOPES: PluginGitScope[] = ["vault", "project"];
const SEQUENCERS: PluginGitSequencer[] = [
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
];
const CONFLICT_STAGES: PluginGitConflictStage[] = ["base", "ours", "theirs"];
const STASH_ACTIONS: PluginGitStashAction[] = [
  "push",
  "pop",
  "apply",
  "drop",
  "list",
];
const PULL_STRATEGIES: PluginGitPullStrategy[] = [
  "merge",
  "rebase",
  "fast-forward-only",
];
const PUSH_MODES: PluginGitPushMode[] = ["normal", "force-with-lease"];
const AUTH_MODES: PluginGitAuthMode[] = [
  "system",
  "public",
  "ssh-agent",
  "github-https",
];
const HUNK_LINE_KINDS: PluginGitHunkLineKind[] = [
  "context",
  "addition",
  "deletion",
];
const MAX_GITHUB_REPOSITORY_LIMIT = 200;

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rebuilds a Git request from only the fields its operation declares. Unknown
 * operations and undeclared fields are dropped, so the native transport never
 * receives plugin-controlled argument arrays.
 */
export function parsePluginGitRequest(value: unknown): PluginGitRequest {
  if (!isRecord(value) || typeof value.operation !== "string") {
    throw new Error("Plugin Git request must name an operation.");
  }

  if (value.operation === "cancel") {
    return {
      operation: "cancel",
      operationId: operationId(value, "operationId"),
    };
  }
  const scope = literal(value, "scope", SCOPES);
  switch (value.operation) {
    case "discover":
    case "status":
    case "list-conflicts":
    case "operation-state":
    case "list-branches":
    case "list-remotes":
      return { operation: value.operation, scope };
    case "initialize":
      return {
        operation: "initialize",
        scope,
        defaultBranch: text(value, "defaultBranch"),
      };
    case "stage":
    case "unstage":
    case "restore-from-upstream":
      return {
        operation: value.operation,
        scope,
        paths: textArray(value, "paths"),
      };
    case "stage-hunk":
    case "unstage-hunk":
      return {
        operation: value.operation,
        scope,
        path: text(value, "path"),
        hunk: hunk(value.hunk),
      };
    case "commit":
      return withOptional(
        { operation: "commit", scope, message: text(value, "message") },
        {
          amend: optionalFlag(value, "amend"),
          allowEmpty: optionalFlag(value, "allowEmpty"),
          authorName: optionalText(value, "authorName"),
          authorEmail: optionalText(value, "authorEmail"),
        },
      );
    case "list-history":
      return withOptional(
        {
          operation: "list-history",
          scope,
          maxCount: count(value, "maxCount", 1),
        },
        {
          skip: optionalCount(value, "skip", 0),
          ref: optionalText(value, "ref"),
          path: optionalText(value, "path"),
        },
      );
    case "diff":
      return withOptional(
        { operation: "diff", scope, target: diffTarget(value.target) },
        { paths: optionalTextArray(value, "paths") },
      );
    case "fetch":
      return withOptional(
        { operation: "fetch", scope, remote: text(value, "remote") },
        {
          prune: optionalFlag(value, "prune"),
          authMode: optionalLiteral(value, "authMode", AUTH_MODES),
        },
      );
    case "pull":
      return withOptional(
        {
          operation: "pull",
          scope,
          remote: text(value, "remote"),
          branch: text(value, "branch"),
          strategy: literal(value, "strategy", PULL_STRATEGIES),
        },
        { authMode: optionalLiteral(value, "authMode", AUTH_MODES) },
      );
    case "push":
      return withOptional(
        {
          operation: "push",
          scope,
          remote: text(value, "remote"),
          branch: text(value, "branch"),
        },
        {
          setUpstream: optionalFlag(value, "setUpstream"),
          mode: optionalLiteral(value, "mode", PUSH_MODES),
          authMode: optionalLiteral(value, "authMode", AUTH_MODES),
        },
      );
    case "add-remote":
    case "set-remote-url":
      return {
        operation: value.operation,
        scope,
        name: text(value, "name"),
        url: text(value, "url"),
      };
    case "remove-remote":
    case "checkout-branch":
      return { operation: value.operation, scope, name: text(value, "name") };
    case "create-branch":
      return withOptional(
        { operation: "create-branch", scope, name: text(value, "name") },
        {
          startPoint: optionalText(value, "startPoint"),
          checkout: optionalFlag(value, "checkout"),
        },
      );
    case "rename-branch":
      return {
        operation: "rename-branch",
        scope,
        name: text(value, "name"),
        newName: text(value, "newName"),
      };
    case "delete-branch":
      return withOptional(
        { operation: "delete-branch", scope, name: text(value, "name") },
        { force: optionalFlag(value, "force") },
      );
    case "rename-remote-branch":
      return withOptional(
        {
          operation: "rename-remote-branch",
          scope,
          remote: text(value, "remote"),
          name: text(value, "name"),
          newName: text(value, "newName"),
        },
        { authMode: optionalLiteral(value, "authMode", AUTH_MODES) },
      );
    case "delete-remote-branch":
      return withOptional(
        {
          operation: "delete-remote-branch",
          scope,
          remote: text(value, "remote"),
          name: text(value, "name"),
        },
        { authMode: optionalLiteral(value, "authMode", AUTH_MODES) },
      );
    case "stash":
      return withOptional(
        {
          operation: "stash",
          scope,
          action: literal(value, "action", STASH_ACTIONS),
        },
        {
          message: optionalText(value, "message"),
          includeUntracked: optionalFlag(value, "includeUntracked"),
          entry: optionalCount(value, "entry", 0),
        },
      );
    case "merge":
      return withOptional(
        { operation: "merge", scope, ref: text(value, "ref") },
        {
          fastForwardOnly: optionalFlag(value, "fastForwardOnly"),
          noCommit: optionalFlag(value, "noCommit"),
        },
      );
    case "rebase":
      return { operation: "rebase", scope, upstream: text(value, "upstream") };
    case "cherry-pick":
    case "revert":
      return {
        operation: value.operation,
        scope,
        commit: text(value, "commit"),
      };
    case "continue":
    case "skip":
    case "abort":
      return {
        operation: value.operation,
        scope,
        sequencer: literal(value, "sequencer", SEQUENCERS),
      };
    case "read-conflict-stage":
      return {
        operation: "read-conflict-stage",
        scope,
        path: text(value, "path"),
        stage: literal(value, "stage", CONFLICT_STAGES),
      };
    case "resolve-conflict":
      return {
        operation: "resolve-conflict",
        scope,
        path: text(value, "path"),
        resolution: conflictResolution(value.resolution),
      };
    case "clone":
      return withOptional(
        {
          operation: "clone",
          scope,
          url: text(value, "url"),
          directory: text(value, "directory"),
        },
        {
          branch: optionalText(value, "branch"),
          authMode: optionalLiteral(value, "authMode", AUTH_MODES),
        },
      );
    default:
      throw new Error(
        `Unsupported plugin Git operation: ${String(value.operation)}`,
      );
  }
}

export function parsePluginGitInvocation(value: unknown): {
  request: PluginGitRequest;
  target: PluginGitRepositoryTarget | null;
} {
  if (isRecord(value) && "request" in value) {
    return {
      request: parsePluginGitRequest(value.request),
      target:
        value.target === null || value.target === undefined
          ? null
          : gitRepositoryTarget(value.target),
    };
  }
  return { request: parsePluginGitRequest(value), target: null };
}

function gitRepositoryTarget(value: unknown): PluginGitRepositoryTarget {
  if (
    !isRecord(value) ||
    (value.projectId !== null &&
      (typeof value.projectId !== "string" ||
        value.projectId.length === 0 ||
        value.projectId.length > 128))
  ) {
    throw new Error("Plugin Git repository target is invalid.");
  }
  return { projectId: value.projectId as string | null };
}

function diffTarget(value: unknown): PluginGitDiffTarget {
  if (!isRecord(value)) {
    throw new Error("Plugin Git diff requires a target.");
  }
  switch (value.kind) {
    case "worktree":
    case "index":
      return { kind: value.kind };
    case "commit":
      return { kind: "commit", commit: text(value, "commit") };
    case "range":
      return {
        kind: "range",
        fromCommit: text(value, "fromCommit"),
        toCommit: text(value, "toCommit"),
      };
    default:
      throw new Error("Plugin Git diff target is invalid.");
  }
}

/**
 * Rebuilds one hunk from only its declared fields, so nothing a plugin adds to
 * the payload can reach the native patch builder. Line content stays exactly as
 * given: the native transport is what decides whether it is safe to write.
 */
function hunk(value: unknown): PluginGitHunk {
  if (!isRecord(value)) {
    throw new Error("Plugin Git hunk is invalid.");
  }
  const lines = value.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("Plugin Git hunk requires at least one line.");
  }
  return {
    oldStart: count(value, "oldStart", 0),
    oldLines: count(value, "oldLines", 0),
    newStart: count(value, "newStart", 0),
    newLines: count(value, "newLines", 0),
    lines: lines.map((line) => hunkLine(line)),
  };
}

function hunkLine(value: unknown): PluginGitHunkLine {
  if (!isRecord(value)) {
    throw new Error("Plugin Git hunk line is invalid.");
  }
  const noNewline = optionalFlag(value, "noNewlineAtEndOfFile");
  const line: PluginGitHunkLine = {
    kind: literal(value, "kind", HUNK_LINE_KINDS),
    content: text(value, "content"),
  };
  return noNewline === undefined
    ? line
    : { ...line, noNewlineAtEndOfFile: noNewline };
}

function conflictResolution(value: unknown): PluginGitConflictResolution {  if (!isRecord(value)) {
    throw new Error("Plugin Git conflict resolution is invalid.");
  }
  if (value.kind === "stage") {
    return { kind: "stage", stage: literal(value, "stage", CONFLICT_STAGES) };
  }
  if (value.kind === "content") {
    return { kind: "content", contentBase64: text(value, "contentBase64") };
  }
  throw new Error("Plugin Git conflict resolution is invalid.");
}

function withOptional<T extends object>(
  base: T,
  optional: Record<string, unknown>,
): T {
  for (const [key, entry] of Object.entries(optional)) {
    if (entry !== undefined) {
      (base as Record<string, unknown>)[key] = entry;
    }
  }
  return base;
}

function text(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") {
    throw new Error(`Plugin Git request requires string ${key}.`);
  }
  return value[key];
}

function optionalText(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return value[key] === undefined ? undefined : text(value, key);
}

/**
 * Cancellation names an operation the host runtime generated, so only a
 * canonical UUID can address one.
 */
function operationId(value: Record<string, unknown>, key: string): string {
  const entry = text(value, key);
  if (!OPERATION_ID_PATTERN.test(entry)) {
    throw new Error(`Plugin Git request ${key} must be a canonical UUID.`);
  }
  return entry;
}

function textArray(value: Record<string, unknown>, key: string): string[] {
  const entry = value[key];
  if (
    !Array.isArray(entry) ||
    entry.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Plugin Git request requires a ${key} string array.`);
  }
  return [...(entry as string[])];
}

function optionalTextArray(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined {
  return value[key] === undefined ? undefined : textArray(value, key);
}

function count(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
): number {
  const entry = value[key];
  if (
    typeof entry !== "number" ||
    !Number.isSafeInteger(entry) ||
    entry < minimum
  ) {
    throw new Error(`Plugin Git request requires integer ${key}.`);
  }
  return entry;
}

function optionalCount(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
): number | undefined {
  return value[key] === undefined ? undefined : count(value, key, minimum);
}

function optionalFlag(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const entry = value[key];
  if (entry === undefined) {
    return undefined;
  }
  if (typeof entry !== "boolean") {
    throw new Error(`Plugin Git request requires boolean ${key}.`);
  }
  return entry;
}

function literal<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: T[],
): T {
  const entry = value[key];
  if (typeof entry !== "string" || !allowed.includes(entry as T)) {
    throw new Error(
      `Plugin Git request ${key} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return entry as T;
}

function optionalLiteral<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: T[],
): T | undefined {
  return value[key] === undefined ? undefined : literal(value, key, allowed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds a clone request from only its declared fields. The destination is
 * never part of it: the host opens its own folder chooser, so a plugin cannot
 * name, guess, or influence where a clone lands.
 */
export function parsePluginGitCloneVaultRequest(
  value: unknown,
): PluginGitCloneVaultRequest {
  if (!isRecord(value)) {
    throw new Error("Plugin clone request is invalid.");
  }
  const branch = optionalText(value, "branch");
  const request: PluginGitCloneVaultRequest = {
    url: text(value, "url"),
    authMode: literal(value, "authMode", AUTH_MODES),
  };
  return branch === undefined ? request : { ...request, branch };
}

/** Bounded repository-listing request. */
export function parsePluginGitHubListLimit(value: unknown): number {
  if (!isRecord(value)) {
    throw new Error("Plugin repository listing is invalid.");
  }
  const limit = count(value, "limit", 1);
  if (limit > MAX_GITHUB_REPOSITORY_LIMIT) {
    throw new Error(
      `Plugin repository listing cannot exceed ${MAX_GITHUB_REPOSITORY_LIMIT} entries.`,
    );
  }
  return limit;
}

/**
 * A clean-up token is opaque and host-generated, so only a canonical UUID is
 * ever accepted back from a plugin.
 */
export function parsePluginGitCleanupToken(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("Plugin clean-up request is invalid.");
  }
  return operationId(value, "cleanupToken");
}
