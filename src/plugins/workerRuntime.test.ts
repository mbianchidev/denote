import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../plugins/catalog.json";
import {
  assertValidPluginCatalogEntry,
  type PluginGitResult,
  type PluginEmojiPicker,
  type PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import type { PluginView } from "../types";
import { api } from "../lib/api";
import { PluginWorkerRuntime } from "./workerRuntime";

vi.mock("../lib/api", () => ({
  api: {
    readPluginEntrypoint: vi.fn(),
    getPluginSettings: vi.fn(),
    pluginStorageGet: vi.fn(),
    pluginStorageSet: vi.fn(),
    pluginStorageDelete: vi.fn(),
    pluginStorageClear: vi.fn(),
    pluginSecretGet: vi.fn(),
    pluginSecretSet: vi.fn(),
    pluginSecretDelete: vi.fn(),
    pluginProcessRequest: vi.fn(),
    pluginGitRequest: vi.fn(),
    pluginGithubListRepositories: vi.fn(),
    pluginGitCloneVault: vi.fn(),
    pluginGitCleanFailedClone: vi.fn(),
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const catalogValue: unknown = catalogJson[0];
assertValidPluginCatalogEntry(catalogValue);
const catalog = catalogValue;
const GIT_OPERATION_ID = "11111111-2222-4333-8444-555555555555";
const GIT_CANCEL_ID = "99999999-8888-4777-8666-555555555555";
const emojiPicker: PluginEmojiPicker = {
  id: "denote.reference.emoji",
  title: "Insert emoji",
  entries: [{
    id: "wave", name: "Waving hand", unicode: "\u{1f44b}", category: "People",
    keywords: ["hello"], shortcodes: ["wave"], variants: [],
  }],
  shortcodes: true,
  settingsKeys: { recents: "recents", favorites: "favorites", tone: "tone" },
};
/** Two synthetic vaults. Neither path may ever reach a plugin worker. */
const VAULT_ALPHA = "/synthetic/vault-alpha";
const VAULT_BETA = "/synthetic/vault-beta";
const sourceControlModel: PluginSourceControlViewModel = {
  selectedTab: "changes",
  selectedView: { kind: "repository" },
  repository: {
    repositoryId: "repo-1",
    label: "Synthetic repository",
    initialized: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    latestCommit: null,
    busy: false,
  },
  resourceGroups: [],
  branches: [],
  remotes: [],
  history: [],
  historyPage: {
    pageIndex: 0,
    pageSize: 20,
    hasPrevious: false,
    hasNext: false,
    loading: false,
    error: null,
  },
  commitDetail: null,
  diffFiles: [],
  diffSource: null,
  conflicts: [],
  conflictDetail: null,
  operationProgress: null,
  operationPlan: null,
  recovery: { state: "idle" },
  pendingBranchSwitch: null,
  remoteAccess: {
    authMode: "public" as const,
    cloneAvailable: true,
    githubAvailable: false,
    repositories: [],
    cleanup: null,
    review: null,
  },
};

class FakePort extends EventTarget {
  peer: FakePort | null = null;
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor() {
    super();
    // The real pluginWorker.ts installs an `onmessage` handler rather than a
    // listener, so a delivered message has to reach both.
    this.addEventListener("message", (event: Event) => {
      this.onmessage?.(event as MessageEvent<unknown>);
    });
  }

  postMessage(message: unknown) {
    this.messages.push(message);
    queueMicrotask(() => {
      this.peer?.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }

  start() {}

  close() {
    this.closed = true;
  }
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static completeCommands = true;
  static commandIdOnActivate = "denote.reference.ping";
  static completeSourceControlActions = true;
  static sourceControlModelOnActivate: PluginSourceControlViewModel | null = null;
  static sourceControlProviderIdOnActivate = "denote.reference.git";
  static automaticCommitOnActivate: Record<string, unknown> | null = null;
  static emojiPickerOnActivate: PluginEmojiPicker | null = null;
  static sourceControlActionResultType:
    | "source-control-action-result"
    | "command-result" = "source-control-action-result";
  static failActivationAfterSourceControl = false;
  terminated = false;
  runtimePort: FakePort | null = null;
  received: unknown[] = [];
  connectMessage: unknown = null;

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    if (!isRecord(message) || message.type !== "connect") {
      return;
    }
    this.connectMessage = message;
    const port = transfer?.[0];
    if (!(port instanceof FakePort)) {
      throw new Error("Missing runtime port.");
    }
    this.runtimePort = port;
    port.addEventListener("message", (event: Event) => {
      const data = (event as MessageEvent<unknown>).data;
      this.received.push(data);
      if (!isRecord(data)) {
        return;
      }
      if (data.type === "activate") {
        port.postMessage({
          type: "register-command",
          id: FakeWorker.commandIdOnActivate,
          title: "Reference command",
        });
        if (FakeWorker.sourceControlModelOnActivate) {
          port.postMessage({
            type: "register-source-control",
            id: FakeWorker.sourceControlProviderIdOnActivate,
            title: "Git",
            model: FakeWorker.sourceControlModelOnActivate,
          });
        }
        if (FakeWorker.automaticCommitOnActivate) {
          port.postMessage({
            type: "register-automatic-local-commit",
            schedule: FakeWorker.automaticCommitOnActivate,
          });
        }
        if (FakeWorker.emojiPickerOnActivate) {
          port.postMessage({ type: "register-emoji-picker", picker: FakeWorker.emojiPickerOnActivate });
        }
        if (FakeWorker.failActivationAfterSourceControl) {
          port.postMessage({
            type: "activation-error",
            error: "Synthetic activation failure",
          });
          return;
        }
        port.postMessage({ type: "activated" });
      } else if (
        data.type === "run-command" &&
        typeof data.requestId === "string" &&
        FakeWorker.completeCommands
      ) {
        port.postMessage({
          type: "command-result",
          requestId: data.requestId,
        });
      } else if (
        data.type === "run-source-control-action" &&
        typeof data.requestId === "string" &&
        FakeWorker.completeSourceControlActions
      ) {
        port.postMessage({
          type: FakeWorker.sourceControlActionResultType,
          requestId: data.requestId,
        });
      } else if (
        data.type === "deactivate" &&
        typeof data.requestId === "string"
      ) {
        port.postMessage({
          type: "deactivated",
          requestId: data.requestId,
        });
      }
    });
    queueMicrotask(() => port.postMessage({ type: "ready" }));
  }

  terminate() {
    this.terminated = true;
  }
}

interface PluginWorkerScope {
  onmessage:
    | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
    | null;
}

/**
 * Runs the real `pluginWorker.ts` module behind the runtime's `Worker`
 * interface, so an end-to-end test exercises the host runtime, the message
 * port protocol, and the worker's own dispatch instead of a canned double.
 */
class BridgedWorker extends EventTarget {
  static scope: PluginWorkerScope | null = null;
  static instances: BridgedWorker[] = [];
  terminated = false;
  runtimePort: FakePort | null = null;
  received: unknown[] = [];

  constructor() {
    super();
    BridgedWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    const port = transfer?.[0];
    if (!(port instanceof FakePort)) {
      throw new Error("Missing runtime port.");
    }
    this.runtimePort = port;
    port.addEventListener("message", (event: Event) => {
      this.received.push((event as MessageEvent<unknown>).data);
    });
    void BridgedWorker.scope?.onmessage?.({ data: message, ports: [port] });
  }

  terminate() {
    this.terminated = true;
  }
}

async function bridgeRealPluginWorker(): Promise<void> {
  // Vite rewrites the runtime's `new URL("./pluginWorker.ts", import.meta.url)`
  // to resolve against `self.location`, so the stubbed worker scope has to
  // carry one.
  const scope: Record<string, unknown> & PluginWorkerScope = {
    onmessage: null,
    location: globalThis.location,
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("./pluginWorker");
  BridgedWorker.scope = scope;
  vi.stubGlobal("Worker", BridgedWorker);
}

/**
 * Distinct canonical UUIDs. The host refuses a Git operation ID that is not
 * one, and concurrent actions must not share a request ID.
 */
function sequentialUuids(): () => string {
  let issued = 0;
  return () => {
    issued += 1;
    return `00000000-0000-4000-8000-${String(issued).padStart(12, "0")}`;
  };
}

function plugin(): PluginView {
  return {
    catalog,
    status: "installing",
    enabled: false,
    error: null,
    approvedPermissions: catalog.manifest.permissions,
    settings: {},
    hasCredentials: false,
  };
}

function pluginWithProjectContext(): PluginView {
  return {
    ...plugin(),
    approvedPermissions: [
      ...catalog.manifest.permissions,
      { capability: "project-context" },
    ],
  };
}

function pluginWithSourceControl(projectContext = false): PluginView {
  return {
    ...plugin(),
    approvedPermissions: [
      ...catalog.manifest.permissions,
      { capability: "source-control" },
      ...(projectContext ? [{ capability: "project-context" } as const] : []),
    ],
  };
}

function pluginWithSourceControlId(pluginId: string): PluginView {
  const source = pluginWithSourceControl();
  return {
    ...source,
    catalog: {
      ...source.catalog,
      manifest: { ...source.catalog.manifest, id: pluginId },
    },
  };
}

function pluginWithAutomaticCommit(): PluginView {
  return {
    ...plugin(),
    approvedPermissions: [
      ...catalog.manifest.permissions,
      { capability: "automatic-local-commit" },
      { capability: "git" },
    ],
  };
}

function pluginWithEmojiPicker(): PluginView {
  const source = plugin();
  return {
    ...source,
    approvedPermissions: [...source.approvedPermissions, { capability: "emoji-picker" }],
    catalog: {
      ...source.catalog,
      manifest: {
        ...source.catalog.manifest,
        settings: {
          version: 1,
          properties: {
            recents: { title: "Recents", type: "string", default: "[]" },
            favorites: { title: "Favorites", type: "string", default: "[]" },
            tone: { title: "Tone", type: "number", default: 0, minimum: 0, maximum: 5 },
          },
        },
      },
    },
  };
}

function pluginWithGit(): PluginView {
  return {
    ...plugin(),
    approvedPermissions: [
      ...catalog.manifest.permissions,
      { capability: "source-control" },
      { capability: "git" },
    ],
  };
}

function pluginWithGitAndProjectContext(): PluginView {
  const source = pluginWithGit();
  return {
    ...source,
    approvedPermissions: [
      ...source.approvedPermissions,
      { capability: "project-context" },
    ],
  };
}

describe("PluginWorkerRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    BridgedWorker.instances = [];
    BridgedWorker.scope = null;
    FakeWorker.completeCommands = true;
    FakeWorker.commandIdOnActivate = "denote.reference.ping";
    FakeWorker.completeSourceControlActions = true;
    FakeWorker.sourceControlModelOnActivate = null;
    FakeWorker.sourceControlProviderIdOnActivate = "denote.reference.git";
    FakeWorker.automaticCommitOnActivate = null;
    FakeWorker.emojiPickerOnActivate = null;
    FakeWorker.sourceControlActionResultType = "source-control-action-result";
    FakeWorker.failActivationAfterSourceControl = false;
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-id") });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(
      "export default {};",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers emoji data transactionally and removes it immediately when stopping", async () => {
    const changed = vi.fn();
    FakeWorker.emojiPickerOnActivate = emojiPicker;
    const runtime = new PluginWorkerRuntime(
      vi.fn(), vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, changed,
    );
    await runtime.start(pluginWithEmojiPicker());
    expect(changed).toHaveBeenLastCalledWith([{ ...emojiPicker, pluginId: "denote.reference" }]);
    expect(runtime.getEmojiPicker("denote.reference", emojiPicker.id).entries).toEqual(emojiPicker.entries);
    const stop = runtime.stop("denote.reference");
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(() => runtime.getEmojiPicker("denote.reference", emojiPicker.id)).toThrow();
    await stop;
    await runtime.start(pluginWithEmojiPicker());
    expect(changed).toHaveBeenLastCalledWith([{ ...emojiPicker, pluginId: "denote.reference" }]);
    FakeWorker.instances[0].runtimePort?.postMessage({ type: "runtime-error", error: "Late old worker" });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(runtime.isRunning("denote.reference")).toBe(true);
    FakeWorker.instances[1].runtimePort?.postMessage({ type: "runtime-error", error: "Synthetic crash" });
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith([]));
  });

  it("discards staged emoji data on activation failure", async () => {
    const changed = vi.fn();
    FakeWorker.emojiPickerOnActivate = emojiPicker;
    FakeWorker.failActivationAfterSourceControl = true;
    const runtime = new PluginWorkerRuntime(
      vi.fn(), vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, changed,
    );
    await expect(runtime.start(pluginWithEmojiPicker())).rejects.toThrow();
    expect(changed.mock.calls.every(([pickers]) => pickers.length === 0)).toBe(true);
  });

  it("refuses emoji registration without permission, declared settings or unique identity", async () => {
    for (const source of [plugin(), {
      ...plugin(), approvedPermissions: [...catalog.manifest.permissions, { capability: "emoji-picker" } as const],
    }]) {
      FakeWorker.emojiPickerOnActivate = emojiPicker;
      const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
      await expect(runtime.start(source)).rejects.toThrow();
    }
    const errors = vi.fn();
    const runtime = new PluginWorkerRuntime(vi.fn(), errors);
    await runtime.start(pluginWithEmojiPicker());
    FakeWorker.instances[FakeWorker.instances.length - 1]?.runtimePort?.postMessage({
      type: "register-emoji-picker", picker: emojiPicker,
    });
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(runtime.isRunning("denote.reference")).toBe(false);
  });

  it("registers and disposes emoji data through the actual isolated worker capability", async () => {
    await bridgeRealPluginWorker();
    const source = pluginWithEmojiPicker();
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(`
      export default {
        manifest: ${JSON.stringify(source.catalog.manifest)},
        activate(context) {
          if (context.capabilities.workspaceWrite || context.capabilities.network) throw Error("Unexpected access");
          context.subscriptions.add(context.capabilities.emojiPicker.register(${JSON.stringify(emojiPicker)}));
        },
      };
    `);
    const changed = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(), vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, changed,
    );
    await runtime.start(source);
    expect(changed).toHaveBeenLastCalledWith([{ ...emojiPicker, pluginId: "denote.reference" }]);
    expect(BridgedWorker.instances[0].received).toEqual([{ type: "activate" }]);
    await runtime.stop("denote.reference");
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it("loads code only when started and publishes commands after activation", async () => {
    const onCommandsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(onCommandsChanged, vi.fn());

    expect(api.readPluginEntrypoint).not.toHaveBeenCalled();
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    expect(api.readPluginEntrypoint).toHaveBeenCalledWith("denote.reference");
    expect(worker.connectMessage).toEqual({
      type: "connect",
      moduleUrl: expect.stringMatching(/^data:text\/javascript;base64,/),
      pluginId: "denote.reference",
      expectedVersion: catalog.manifest.version,
      permissions: catalog.manifest.permissions.map(
        (permission) => permission.capability,
      ),
    });
    expect(onCommandsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.ping",
        title: "Reference command",
      },
    ]);
    await runtime.runCommand(
      "denote.reference",
      "denote.reference.ping",
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    expect(worker.runtimePort?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command-result",
          requestId: "request-id",
        }),
      ]),
    );
  });

  it("starts an installed version under its recorded manifest", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    const installed = plugin();
    installed.runtimeManifest = {
      ...installed.catalog.manifest,
      version: "0.0.9",
    };

    await runtime.start(installed);

    expect(FakeWorker.instances[0].connectMessage).toMatchObject({
      pluginId: "denote.reference",
      expectedVersion: "0.0.9",
    });
  });

  it("stages, updates, dispatches, and removes source control contributions", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    const onSourceControlChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      onSourceControlChanged,
    );

    await runtime.start(pluginWithSourceControl());
    const worker = FakeWorker.instances[0];
    expect(onSourceControlChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.git",
        title: "Git",
        model: sourceControlModel,
      },
    ]);

    const updatedModel: PluginSourceControlViewModel = {
      ...sourceControlModel,
      repository: {
        ...sourceControlModel.repository,
        busy: true,
        busyMessage: "Refreshing",
        activeOperationId: GIT_OPERATION_ID,
      },
    };
    worker.runtimePort?.postMessage({
      type: "update-source-control",
      id: "denote.reference.git",
      model: updatedModel,
    });
    await vi.waitFor(() => {
      expect(onSourceControlChanged).toHaveBeenLastCalledWith([
        expect.objectContaining({ model: updatedModel }),
      ]);
    });

    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh", values: { force: true } },
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    expect(worker.received).toContainEqual({
      type: "run-source-control-action",
      providerId: "denote.reference.git",
      action: { id: "refresh", values: { force: true } },
      requestId: "request-id",
    });

    // The cancel control returns the provider's own operation ID to it.
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "cancel-operation", values: { operationId: GIT_OPERATION_ID } },
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    expect(worker.received).toContainEqual({
      type: "run-source-control-action",
      providerId: "denote.reference.git",
      action: {
        id: "cancel-operation",
        values: { operationId: GIT_OPERATION_ID },
      },
      requestId: "request-id",
    });

    await runtime.stop("denote.reference");
    expect(onSourceControlChanged).toHaveBeenLastCalledWith([]);
  });

  it("stages, replaces, and removes automatic local commit schedules", async () => {
    FakeWorker.automaticCommitOnActivate = {
      id: "denote.reference.nightly",
      intervalMinutes: 15,
      message: "Synthetic automatic commit",
      includePatterns: ["notes"],
      excludePatterns: ["notes/drafts"],
      authorName: null,
      authorEmail: null,
    };
    const onAutomaticCommitsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      onAutomaticCommitsChanged,
    );

    await runtime.start(pluginWithAutomaticCommit());
    const worker = FakeWorker.instances[0];
    expect(onAutomaticCommitsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.nightly",
        intervalMinutes: 15,
        message: "Synthetic automatic commit",
        includePatterns: ["notes"],
        excludePatterns: ["notes/drafts"],
        authorName: null,
        authorEmail: null,
      },
    ]);

    worker.runtimePort?.postMessage({
      type: "update-automatic-local-commit",
      schedule: {
        id: "denote.reference.nightly",
        intervalMinutes: 30,
        message: "Synthetic automatic commit",
        includePatterns: [],
        excludePatterns: [],
        authorName: "Synthetic Author",
        authorEmail: "synthetic@example.invalid",
      },
    });
    await vi.waitFor(() => {
      expect(onAutomaticCommitsChanged).toHaveBeenLastCalledWith([
        expect.objectContaining({
          intervalMinutes: 30,
          includePatterns: [],
          authorName: "Synthetic Author",
        }),
      ]);
    });

    worker.runtimePort?.postMessage({
      type: "unregister-automatic-local-commit",
      id: "denote.reference.nightly",
    });
    await vi.waitFor(() => {
      expect(onAutomaticCommitsChanged).toHaveBeenLastCalledWith([]);
    });
    expect(worker.terminated).toBe(false);
  });

  it("removes automatic local commit schedules when a plugin is disabled", async () => {
    FakeWorker.automaticCommitOnActivate = {
      id: "denote.reference.nightly",
      intervalMinutes: 5,
      message: "Synthetic automatic commit",
      includePatterns: [],
      excludePatterns: [],
      authorName: null,
      authorEmail: null,
    };
    const onAutomaticCommitsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      onAutomaticCommitsChanged,
    );
    await runtime.start(pluginWithAutomaticCommit());
    expect(onAutomaticCommitsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "denote.reference.nightly" }),
    ]);

    await runtime.stop("denote.reference");

    expect(onAutomaticCommitsChanged).toHaveBeenLastCalledWith([]);
  });

  it("rolls back staged automatic local commit schedules when activation fails", async () => {
    FakeWorker.automaticCommitOnActivate = {
      id: "denote.reference.nightly",
      intervalMinutes: 5,
      message: "Synthetic automatic commit",
      includePatterns: [],
      excludePatterns: [],
      authorName: null,
      authorEmail: null,
    };
    FakeWorker.failActivationAfterSourceControl = true;
    const onAutomaticCommitsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      onAutomaticCommitsChanged,
    );

    await expect(runtime.start(pluginWithAutomaticCommit())).rejects.toThrow(
      "Synthetic activation failure",
    );

    expect(
      onAutomaticCommitsChanged.mock.calls.some(
        ([schedules]) => Array.isArray(schedules) && schedules.length > 0,
      ),
    ).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("terminates automatic local commit registrations without permission", async () => {
    FakeWorker.automaticCommitOnActivate = {
      id: "denote.reference.nightly",
      intervalMinutes: 5,
      message: "Synthetic automatic commit",
      includePatterns: [],
      excludePatterns: [],
      authorName: null,
      authorEmail: null,
    };
    const onError = vi.fn();
    const onAutomaticCommitsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      onError,
      undefined,
      undefined,
      undefined,
      undefined,
      onAutomaticCommitsChanged,
    );

    await runtime.start(plugin()).catch(() => {});

    await vi.waitFor(() => {
      expect(FakeWorker.instances[0].terminated).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        "denote.reference",
        expect.objectContaining({
          message: expect.stringMatching(/automatic local commit/i),
        }),
      );
    });
    expect(
      onAutomaticCommitsChanged.mock.calls.every(
        ([schedules]) => Array.isArray(schedules) && schedules.length === 0,
      ),
    ).toBe(true);
  });

  it("terminates an automatic local commit update for an unknown schedule", async () => {
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      onError,
      undefined,
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
    await runtime.start(pluginWithAutomaticCommit());
    const worker = FakeWorker.instances[0];

    worker.runtimePort?.postMessage({
      type: "update-automatic-local-commit",
      schedule: {
        id: "denote.reference.nightly",
        intervalMinutes: 5,
        message: "Synthetic automatic commit",
        includePatterns: [],
        excludePatterns: [],
        authorName: null,
        authorEmail: null,
      },
    });

    await vi.waitFor(() => {
      expect(worker.terminated).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        "denote.reference",
        expect.objectContaining({
          message: expect.stringMatching(/automatic local commit/i),
        }),
      );
    });
  });

  it("registers and disposes real automatic local commit schedules", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");
    const pluginModule = dataModuleUrl(`
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          const settings = await context.settings.getAll();
          const registration = context.capabilities.automaticLocalCommit.register({
            id: "denote.reference.nightly",
            intervalMinutes: settings.intervalMinutes,
            message: "Synthetic automatic commit",
            includePatterns: ["notes/"],
          });
          registration.update({
            intervalMinutes: 45,
            message: "Synthetic automatic commit",
            excludePatterns: ["notes/drafts"],
          });
          context.subscriptions.add(registration);
          try {
            context.capabilities.automaticLocalCommit.register({
              id: "denote.reference.invalid",
              intervalMinutes: 0,
              message: "Synthetic automatic commit",
            });
          } catch (error) {
            context.logger.warn(error.message);
          }
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["automatic-local-commit"],
      },
      ports: [port],
    });
    await vi.waitFor(() =>
      expect(port.messages).toContainEqual({ type: "ready" }),
    );
    port.onmessage?.(
      new MessageEvent("message", { data: { type: "activate" } }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual(
        expect.objectContaining({ type: "host-request", operation: "settings.get" }),
      );
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "host-response",
          requestId: "request-id",
          value: { intervalMinutes: 20 },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "register-automatic-local-commit",
        schedule: {
          id: "denote.reference.nightly",
          intervalMinutes: 20,
          message: "Synthetic automatic commit",
          // A trailing slash is normalized away, so a prefix always names a
          // path segment.
          includePatterns: ["notes"],
          excludePatterns: [],
          authorName: null,
          authorEmail: null,
        },
      });
      expect(port.messages).toContainEqual({
        type: "update-automatic-local-commit",
        schedule: {
          id: "denote.reference.nightly",
          intervalMinutes: 45,
          message: "Synthetic automatic commit",
          includePatterns: [],
          excludePatterns: ["notes/drafts"],
          authorName: null,
          authorEmail: null,
        },
      });
      expect(port.messages).toContainEqual({ type: "activated" });
    });
    // A zero interval is refused inside the worker, so an unusable schedule
    // never reaches the host at all.
    expect(port.messages).toContainEqual(
      expect.objectContaining({
        type: "log",
        level: "warn",
        message: expect.stringMatching(/interval must be a whole number/i),
      }),
    );
    expect(
      port.messages.filter(
        (message) =>
          isRecord(message) &&
          message.type === "register-automatic-local-commit",
      ),
    ).toHaveLength(1);

    port.onmessage?.(
      new MessageEvent("message", {
        data: { type: "deactivate", requestId: "deactivate-automatic-commit" },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "unregister-automatic-local-commit",
        id: "denote.reference.nightly",
      });
    });
  });

  it("rolls back staged source control contributions when activation fails", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.failActivationAfterSourceControl = true;
    const onSourceControlChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      onSourceControlChanged,
    );

    await expect(runtime.start(pluginWithSourceControl())).rejects.toThrow(
      "Synthetic activation failure",
    );

    expect(
      onSourceControlChanged.mock.calls.some(
        ([providers]) => Array.isArray(providers) && providers.length > 0,
      ),
    ).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("terminates duplicate source control registrations", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      onError,
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
    await runtime.start(pluginWithSourceControl());
    const worker = FakeWorker.instances[0];

    worker.runtimePort?.postMessage({
      type: "register-source-control",
      id: "denote.reference.git",
      title: "Duplicate",
      model: sourceControlModel,
    });

    await vi.waitFor(() => {
      expect(worker.terminated).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        "denote.reference",
        expect.objectContaining({
          message: expect.stringMatching(/duplicate source control/i),
        }),
      );
    });
  });

  it("rejects source control provider IDs that collide across plugins", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.commandIdOnActivate = "denote.reference.git.ping";
    FakeWorker.sourceControlProviderIdOnActivate =
      "denote.reference.git.provider";
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      onError,
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
    await runtime.start(pluginWithSourceControlId("denote.reference"));

    await runtime
      .start(pluginWithSourceControlId("denote.reference.git"))
      .catch(() => {});

    await vi.waitFor(() => {
      expect(FakeWorker.instances[1]?.terminated).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        "denote.reference.git",
        expect.objectContaining({
          message: expect.stringMatching(/duplicate source control/i),
        }),
      );
    });
  });

  it("rejects mismatched source control action result types", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.sourceControlActionResultType = "command-result";
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      onError,
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
    await runtime.start(pluginWithSourceControl());

    await expect(
      runtime.runSourceControlAction(
        "denote.reference",
        "denote.reference.git",
        { id: "refresh" },
        { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
      ),
    ).rejects.toThrow();

    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      "denote.reference",
      expect.objectContaining({
        message: expect.stringMatching(/unexpected command-result/i),
      }),
    );
  });

  it("expires source control action leases when project identity changes", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.completeSourceControlActions = false;
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    await runtime.start(pluginWithSourceControl(true));
    const worker = FakeWorker.instances[0];

    const action = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      { workspaceScope: "/vault", projectId: "project-alpha", sourceControlActionId: null },
    );
    runtime.setProjectContext({
      projectId: "project-beta",
      rootPath: "code/beta",
    });
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "source-control-host-request",
      actionId: "request-id",
      operation: "process.run",
      value: { executable: "/usr/bin/printf", arguments: [] },
    });

    await vi.waitFor(() => {
      expect(worker.received).toContainEqual({
        type: "host-response",
        requestId: "source-control-host-request",
        error: "Plugin action capability lease is invalid or expired.",
      });
    });
    expect(api.pluginProcessRequest).not.toHaveBeenCalled();
    worker.runtimePort?.postMessage({
      type: "source-control-action-result",
      requestId: "request-id",
    });
    await action;
  });

  it("carries the captured project ID through process requests after a same-ID root move", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    await runtime.start(pluginWithProjectContext());
    const worker = FakeWorker.instances[0];
    FakeWorker.completeCommands = false;

    const command = runtime.runCommand(
      "denote.reference",
      "denote.reference.ping",
      { workspaceScope: "/vault", projectId: "project-alpha", sourceControlActionId: null },
    );
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "moved/alpha",
    });
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "process-request",
      actionId: "request-id",
      operation: "process.run",
      value: { executable: "/usr/bin/printf", arguments: ["hello"] },
    });

    await vi.waitFor(() => {
      expect(api.pluginProcessRequest).toHaveBeenCalledWith(
        "denote.reference",
        { executable: "/usr/bin/printf", arguments: ["hello"] },
        "project-alpha",
      );
    });
    worker.runtimePort?.postMessage({
      type: "command-result",
      requestId: "request-id",
    });
    await command;
  });

  it("keeps process-only commands unscoped across project changes", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];
    FakeWorker.completeCommands = false;

    const command = runtime.runCommand(
      "denote.reference",
      "denote.reference.ping",
      { workspaceScope: "/vault", projectId: "project-alpha", sourceControlActionId: null },
    );
    runtime.setProjectContext({
      projectId: "project-beta",
      rootPath: "code/beta",
    });
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "process-request",
      actionId: "request-id",
      operation: "process.run",
      value: { executable: "/usr/bin/printf", arguments: [] },
    });

    await vi.waitFor(() => {
      expect(api.pluginProcessRequest).toHaveBeenCalledWith(
        "denote.reference",
        { executable: "/usr/bin/printf", arguments: [] },
        null,
      );
    });
    worker.runtimePort?.postMessage({
      type: "command-result",
      requestId: "request-id",
    });
    await command;
  });

  it("invalidates a project-scoped command when project identity changes", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    await runtime.start(pluginWithProjectContext());
    const worker = FakeWorker.instances[0];
    FakeWorker.completeCommands = false;

    const command = runtime.runCommand(
      "denote.reference",
      "denote.reference.ping",
      { workspaceScope: "/vault", projectId: "project-alpha", sourceControlActionId: null },
    );
    runtime.setProjectContext({
      projectId: "project-beta",
      rootPath: "code/beta",
    });
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "process-request",
      actionId: "request-id",
      operation: "process.run",
      value: { executable: "/usr/bin/printf", arguments: [] },
    });

    await vi.waitFor(() => {
      expect(worker.received).toContainEqual({
        type: "host-response",
        requestId: "process-request",
        error: "Plugin action capability lease is invalid or expired.",
      });
    });
    expect(api.pluginProcessRequest).not.toHaveBeenCalled();
    worker.runtimePort?.postMessage({
      type: "command-result",
      requestId: "request-id",
    });
    await command;
  });

  it("provides action-scoped capabilities to real pluginWorker.ts commands", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const pluginModule = dataModuleUrl(`
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          context.capabilities.commands.register({
            id: "denote.reference.read",
            title: "Read note",
            async run(action) {
              await action.capabilities.workspaceRead.readText("note.md");
            },
          });
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["commands", "workspace-read"],
      },
      ports: [port],
    });
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "ready" });
    });
    expect(workerScope.onmessage).toBeNull();
    expect(workerScope.fetch).toBeUndefined();
    expect(workerScope.Worker).toBeUndefined();

    port.onmessage?.(
      new MessageEvent("message", { data: { type: "activate" } }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "activated" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "run-command",
          commandId: "denote.reference.read",
          requestId: "action-id",
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual(
        expect.objectContaining({
          type: "host-request",
          operation: "workspace.read",
          actionId: "action-id",
        }),
      );
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "host-response",
          requestId: "request-id",
          value: { content: "note", version: "version" },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "command-result",
        requestId: "action-id",
      });
    });
  });

  it("registers, updates, runs, and disposes real source control providers", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const updatedModel: PluginSourceControlViewModel = {
      ...sourceControlModel,
      repository: {
        ...sourceControlModel.repository,
        label: "Updated repository",
      },
    };
    const pluginModule = dataModuleUrl(`
      let registration;
      const initialModel = ${JSON.stringify(sourceControlModel)};
      const updatedModel = ${JSON.stringify(updatedModel)};
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          registration = context.capabilities.sourceControl.register({
            id: "denote.reference.git",
            title: "Git",
            initialModel,
            async runAction(action, userAction) {
              await userAction.capabilities.workspaceRead.readText("note.md");
              registration.update(updatedModel);
            },
          });
          context.subscriptions.add(registration);
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["source-control", "workspace-read"],
      },
      ports: [port],
    });
    await vi.waitFor(() => expect(port.messages).toContainEqual({ type: "ready" }));
    port.onmessage?.(
      new MessageEvent("message", { data: { type: "activate" } }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "register-source-control",
        id: "denote.reference.git",
        title: "Git",
        model: sourceControlModel,
      });
      expect(port.messages).toContainEqual({ type: "activated" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "run-source-control-action",
          providerId: "denote.reference.git",
          action: { id: "stage", values: { path: "note.md" } },
          requestId: "source-action-id",
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual(
        expect.objectContaining({
          type: "host-request",
          operation: "workspace.read",
          actionId: "source-action-id",
        }),
      );
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "host-response",
          requestId: "request-id",
          value: { content: "synthetic", version: "version-1" },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "update-source-control",
        id: "denote.reference.git",
        model: updatedModel,
      });
      expect(port.messages).toContainEqual({
        type: "source-control-action-result",
        requestId: "source-action-id",
      });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: { type: "deactivate", requestId: "deactivate-source-control" },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "unregister-source-control",
        id: "denote.reference.git",
      });
    });
  });

  it("rejects duplicate source control provider IDs in the plugin worker", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");
    const pluginModule = dataModuleUrl(`
      const model = ${JSON.stringify(sourceControlModel)};
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        activate(context) {
          const provider = {
            id: "denote.reference.git",
            title: "Git",
            initialModel: model,
            runAction() {},
          };
          context.capabilities.sourceControl.register(provider);
          context.capabilities.sourceControl.register(provider);
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["source-control"],
      },
      ports: [port],
    });
    await vi.waitFor(() => expect(port.messages).toContainEqual({ type: "ready" }));
    port.onmessage?.(
      new MessageEvent("message", { data: { type: "activate" } }),
    );

    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "activation-error",
        error:
          "Source control provider denote.reference.git is already registered.",
      });
    });
  });

  it("provides current project context during activation and manages subscriptions", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const pluginModule = dataModuleUrl(`
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          const projects = context.capabilities.projectContext;
          context.logger.info("activation-project", { current: projects.getCurrent() });
          let once;
          once = projects.subscribe((event) => {
            context.logger.info("project-once", { current: event.current });
            once.dispose();
          });
          projects.subscribe((event) => {
            context.logger.info("project-retained", {
              previous: event.previous,
              current: event.current,
            });
          });
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["project-context"],
      },
      ports: [port],
    });
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "ready" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "activate",
          projectContext: {
            projectId: "project-alpha",
            rootPath: "code/alpha",
          },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "log",
        level: "info",
        message: "activation-project",
        details: {
          current: {
            projectId: "project-alpha",
            rootPath: "code/alpha",
          },
        },
      });
      expect(port.messages).toContainEqual({ type: "activated" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "project-context-change",
          event: {
            previous: {
              projectId: "project-alpha",
              rootPath: "code/alpha",
            },
            current: {
              projectId: "project-beta",
              rootPath: "code/beta",
            },
            workspaceChanged: false,
          },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(
        port.messages.filter(
          (message) =>
            isRecord(message) && message.message === "project-once",
        ),
      ).toHaveLength(1);
      expect(
        port.messages.filter(
          (message) =>
            isRecord(message) && message.message === "project-retained",
        ),
      ).toHaveLength(1);
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "project-context-change",
          event: {
            previous: {
              projectId: "project-beta",
              rootPath: "code/beta",
            },
            current: null,
            workspaceChanged: false,
          },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(
        port.messages.filter(
          (message) =>
            isRecord(message) && message.message === "project-retained",
        ),
      ).toHaveLength(2);
      expect(
        port.messages.filter(
          (message) =>
            isRecord(message) && message.message === "project-once",
        ),
      ).toHaveLength(1);
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: { type: "deactivate", requestId: "deactivate-project" },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "deactivated",
        requestId: "deactivate-project",
      });
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "project-context-change",
          event: {
            previous: null,
            current: {
              projectId: "project-gamma",
              rootPath: "code/gamma",
            },
            workspaceChanged: false,
          },
        },
      }),
    );
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(
      port.messages.filter(
        (message) =>
          isRecord(message) && message.message === "project-retained",
      ),
    ).toHaveLength(2);
  });

  it("serializes project changes before commands while host responses bypass the queue", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const pluginModule = dataModuleUrl(`
      let projectChangeComplete = false;
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          context.capabilities.projectContext.subscribe(async () => {
            await context.storage.get("project-change-gate");
            projectChangeComplete = true;
          });
          context.capabilities.commands.register({
            id: "denote.reference.after-project-change",
            title: "Run after project change",
            run() {
              context.logger.info("command-order", { projectChangeComplete });
            },
          });
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["commands", "project-context"],
      },
      ports: [port],
    });
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "ready" });
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: { type: "activate", projectContext: null },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "activated" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "project-context-change",
          event: {
            previous: null,
            current: {
              projectId: "project-alpha",
              rootPath: "code/alpha",
            },
            workspaceChanged: false,
          },
        },
      }),
    );
    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "run-command",
          commandId: "denote.reference.after-project-change",
          requestId: "ordered-command",
        },
      }),
    );

    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "host-request",
        requestId: "request-id",
        operation: "storage.get",
        key: "project-change-gate",
        value: undefined,
        actionId: undefined,
      });
    });
    expect(port.messages).not.toContainEqual({
      type: "command-result",
      requestId: "ordered-command",
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "host-response",
          requestId: "request-id",
          value: null,
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "log",
        level: "info",
        message: "command-order",
        details: { projectChangeComplete: true },
      });
      expect(port.messages).toContainEqual({
        type: "command-result",
        requestId: "ordered-command",
      });
    });
  });

  it("reports project context listener failures through runtime errors", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const pluginModule = dataModuleUrl(`
      export default {
        manifest: { id: "denote.reference", version: "0.1.0" },
        async activate(context) {
          context.capabilities.projectContext.subscribe(() => {
            throw new Error("Synthetic project listener failure");
          });
        },
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["project-context"],
      },
      ports: [port],
    });
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "ready" });
    });
    port.onmessage?.(
      new MessageEvent("message", {
        data: { type: "activate", projectContext: null },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "activated" });
    });

    port.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "project-context-change",
          event: {
            previous: null,
            current: {
              projectId: "project-failure",
              rootPath: "synthetic",
            },
            workspaceChanged: false,
          },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({
        type: "runtime-error",
        error: "Synthetic project listener failure",
      });
    });
  });

  it("rejects a plugin module whose manifest does not match the catalog", async () => {
    const workerScope: Record<string, unknown> & {
      onmessage:
        | ((event: { data: unknown; ports: FakePort[] }) => Promise<void>)
        | null;
    } = { onmessage: null };
    vi.stubGlobal("self", workerScope);
    vi.resetModules();
    await import("./pluginWorker");

    const pluginModule = dataModuleUrl(`
      export default {
        manifest: { id: "denote.reference", version: "9.9.9" },
        async activate() {},
      };
    `);
    const port = new FakePort();

    await workerScope.onmessage?.({
      data: {
        type: "connect",
        moduleUrl: pluginModule,
        pluginId: "denote.reference",
        expectedVersion: "0.1.0",
        permissions: ["commands"],
      },
      ports: [port],
    });
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual({ type: "ready" });
    });

    port.onmessage?.(
      new MessageEvent("message", { data: { type: "activate" } }),
    );
    await vi.waitFor(() => {
      expect(port.messages).toContainEqual(
        expect.objectContaining({ type: "activation-error" }),
      );
    });
  });

  it("terminates the worker and removes contributions on disable", async () => {
    const onCommandsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(onCommandsChanged, vi.fn());
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    await runtime.stop("denote.reference");

    expect(worker.terminated).toBe(true);
    expect(onCommandsChanged).toHaveBeenLastCalledWith([]);
  });

  it("serializes concurrent stop requests", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    await Promise.all([
      runtime.stop("denote.reference"),
      runtime.stop("denote.reference"),
    ]);

    expect(
      worker.received.filter(
        (message) => isRecord(message) && message.type === "deactivate",
      ),
    ).toHaveLength(1);
  });

  it("publishes sidebar contributions and forwards note events", async () => {
    const onSidebarViewsChanged = vi.fn();
    const onStatusItemsChanged = vi.fn();
    const onDecorationsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      onSidebarViewsChanged,
      onStatusItemsChanged,
      onDecorationsChanged,
    );
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    worker.runtimePort?.postMessage({
      type: "register-sidebar",
      id: "denote.reference.status",
      title: "Plugin reference",
      content: "Active",
    });
    worker.runtimePort?.postMessage({
      type: "register-status",
      id: "denote.reference.active",
      text: "Reference active",
    });
    worker.runtimePort?.postMessage({
      type: "register-decoration",
      id: "denote.reference.marker",
      pattern: "reference",
      style: "highlight",
      caseSensitive: false,
    });
    runtime.broadcastNoteEvent({
      path: "note.md",
      kind: "opened",
    });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(onSidebarViewsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.status",
        title: "Plugin reference",
        content: "Active",
      },
    ]);
    expect(onStatusItemsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.active",
        text: "Reference active",
      },
    ]);
    expect(onDecorationsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.marker",
        pattern: "reference",
        style: "highlight",
        caseSensitive: false,
      },
    ]);
    expect(worker.received).toEqual(
      expect.arrayContaining([
        {
          type: "note-event",
          event: { path: "note.md", kind: "opened" },
        },
      ]),
    );
  });

  it("retains, deduplicates, and delivers only approved project context", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    await runtime.start(pluginWithProjectContext());
    const authorized = FakeWorker.instances[0];

    expect(authorized.received).toContainEqual({
      type: "activate",
      projectContext: {
        projectId: "project-alpha",
        rootPath: "code/alpha",
      },
    });

    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/renamed-alpha",
    });
    runtime.setProjectContext(null);
    runtime.setProjectContext({
      projectId: "project-beta",
      rootPath: "code/beta",
    });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(
      authorized.received.filter(
        (message) =>
          isRecord(message) && message.type === "project-context-change",
      ),
    ).toEqual([
      {
        type: "project-context-change",
        event: {
          previous: {
            projectId: "project-alpha",
            rootPath: "code/alpha",
          },
          current: {
            projectId: "project-alpha",
            rootPath: "code/renamed-alpha",
          },
          workspaceChanged: false,
        },
      },
      {
        type: "project-context-change",
        event: {
          previous: {
            projectId: "project-alpha",
            rootPath: "code/renamed-alpha",
          },
          current: null,
          workspaceChanged: false,
        },
      },
      {
        type: "project-context-change",
        event: {
          previous: null,
          current: {
            projectId: "project-beta",
            rootPath: "code/beta",
          },
          workspaceChanged: false,
        },
      },
    ]);
  });

  it("replaces a refreshed vault model the moment the host switches vaults", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bridgeRealPluginWorker();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(sequentialUuids()) });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(vaultProviderModule());
    vi.mocked(api.pluginGitRequest).mockImplementation((_pluginId, _request, _scope, _projectId, operationId) =>
      Promise.resolve(gitResult(operationId, false)),
    );
    const onSourceControlChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      onSourceControlChanged,
    );
    // Two vaults, neither of which has a project open, so the project context
    // is null on both sides of the switch.
    runtime.setWorkspaceIdentity(VAULT_ALPHA);
    runtime.setProjectContext(null);

    await runtime.start(pluginWithGitAndProjectContext());
    const worker = BridgedWorker.instances[0];
    const scope = { workspaceScope: VAULT_ALPHA, projectId: null, sourceControlActionId: null };
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      scope,
    );
    expect(publishedModel(onSourceControlChanged).repository).toMatchObject({
      label: "Vault",
      branch: "main",
      initialized: true,
    });
    expect(
      publishedModel(onSourceControlChanged).resourceGroups,
    ).toHaveLength(1);

    runtime.setWorkspaceIdentity(VAULT_BETA);

    await vi.waitFor(() => {
      expect(publishedModel(onSourceControlChanged).repository).toMatchObject({
        label: "Vault · refresh required",
        branch: null,
        initialized: false,
      });
    });
    // Nothing the previous vault produced is still on screen.
    expect(publishedModel(onSourceControlChanged).resourceGroups).toEqual([]);
    expect(workerLogs(worker, "workspace-changed")).toHaveLength(1);
    expect(workerLogs(worker, "project-changed")).toHaveLength(0);

    // Neither vault path ever crossed into the worker.
    const delivered = JSON.stringify(worker.received);
    expect(delivered).not.toContain(VAULT_ALPHA);
    expect(delivered).not.toContain(VAULT_BETA);

    // A lease bought against the previous vault buys nothing in the new one.
    const staleActionIds = dispatchedActionIds(worker);
    expect(staleActionIds).toHaveLength(1);
    for (const actionId of staleActionIds) {
      worker.runtimePort?.postMessage({
        type: "host-request",
        requestId: `stale-${actionId}`,
        actionId,
        operation: "git.run",
        operationId: "00000000-0000-4000-8000-000000009999",
        value: { operation: "status", scope: "vault" },
      });
    }
    await vi.waitFor(() => {
      for (const actionId of staleActionIds) {
        expect(worker.received).toContainEqual({
          type: "host-response",
          requestId: `stale-${actionId}`,
          error: "Plugin action capability lease is invalid or expired.",
        });
      }
    });
  });

  it("reports a workspace change to a plugin whose project context never changed", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setWorkspaceIdentity(VAULT_ALPHA);
    await runtime.start(pluginWithProjectContext());
    const authorized = FakeWorker.instances[0];

    runtime.setWorkspaceIdentity(VAULT_ALPHA);
    runtime.setWorkspaceIdentity(VAULT_BETA);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(
      authorized.received.filter(
        (message) =>
          isRecord(message) && message.type === "project-context-change",
      ),
    ).toEqual([
      {
        type: "project-context-change",
        event: { previous: null, current: null, workspaceChanged: true },
      },
    ]);
    expect(JSON.stringify(authorized.received)).not.toContain(VAULT_BETA);
  });

  it("does not expose a workspace change to workers without approval", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setWorkspaceIdentity(VAULT_ALPHA);
    await runtime.start(plugin());
    const unauthorized = FakeWorker.instances[0];

    runtime.setWorkspaceIdentity(VAULT_BETA);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(
      unauthorized.received.some(
        (message) =>
          isRecord(message) && message.type === "project-context-change",
      ),
    ).toBe(false);
  });

  it("invalidates leases held by a plugin that never asked for project context", async () => {
    await bridgeRealPluginWorker();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(sequentialUuids()) });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(vaultProviderModule());
    const status = deferred<PluginGitResult>();
    vi.mocked(api.pluginGitRequest).mockImplementation(() => status.promise);
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
    runtime.setWorkspaceIdentity(VAULT_ALPHA);
    // No project-context permission, so the plugin is never told anything
    // about the switch. Its lease still has to stop working.
    await runtime.start(pluginWithGit());
    const worker = BridgedWorker.instances[0];
    const action = trackSettled(
      runtime.runSourceControlAction(
        "denote.reference",
        "denote.reference.git",
        { id: "refresh" },
        { workspaceScope: VAULT_ALPHA, projectId: null, sourceControlActionId: null },
      ),
    );
    await vi.waitFor(() => {
      expect(dispatchedActionIds(worker)).toHaveLength(1);
    });

    runtime.setWorkspaceIdentity(VAULT_BETA);

    const [actionId] = dispatchedActionIds(worker);
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: `stale-${actionId}`,
      actionId,
      operation: "git.run",
      operationId: "00000000-0000-4000-8000-000000009999",
      value: { operation: "status", scope: "vault" },
    });
    await vi.waitFor(() => {
      expect(worker.received).toContainEqual({
        type: "host-response",
        requestId: `stale-${actionId}`,
        error: "Plugin action capability lease is invalid or expired.",
      });
    });
    expect(action.settled()).toBe(false);
    status.resolve(gitResult("00000000-0000-4000-8000-000000009999", false));
  });

  it("does not expose project context to workers without approval", async () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    runtime.setProjectContext({
      projectId: "project-private",
      rootPath: "private/root",
    });
    await runtime.start(plugin());
    const unauthorized = FakeWorker.instances[0];

    expect(unauthorized.received).toContainEqual({ type: "activate" });
    expect(
      unauthorized.received.some(
        (message) =>
          isRecord(message) &&
          ("projectContext" in message ||
            message.type === "project-context-change"),
      ),
    ).toBe(false);

    runtime.setProjectContext(null);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(
      unauthorized.received.some(
        (message) =>
          isRecord(message) && message.type === "project-context-change",
      ),
    ).toBe(false);
  });

  it("rejects absolute project roots before runtime delivery", () => {
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());

    expect(() =>
      runtime.setProjectContext({
        projectId: "project-invalid",
        rootPath: "/Users/example/vault/code",
      }),
    ).toThrow(/vault-relative root path/i);
  });

  it("cancels a pending start before worker construction", async () => {
    let finishRead!: (value: string) => void;
    vi.mocked(api.readPluginEntrypoint).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());

    const starting = runtime.start(plugin());
    const stopping = runtime.stop("denote.reference");
    finishRead("export default {};");

    await expect(starting).rejects.toThrow(/start was cancelled/i);
    await stopping;
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("terminates unauthorized command registrations", async () => {
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(vi.fn(), onError);
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    worker.runtimePort?.postMessage({
      type: "register-command",
      id: "other.command",
      title: "Unauthorized",
    });
    await vi.waitFor(() => {
      expect(worker.terminated).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        "denote.reference",
        expect.objectContaining({
          message: expect.stringMatching(/unauthorized command/i),
        }),
      );
    });
  });

  it("runs Git requests only inside a live source control action lease", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.completeSourceControlActions = false;
    vi.mocked(api.pluginGitRequest).mockResolvedValue({
      operationId: GIT_OPERATION_ID,
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
    });
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    await runtime.start(pluginWithGit());
    const worker = FakeWorker.instances[0];

    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "unleased-git-request",
      operation: "git.run",
      operationId: GIT_OPERATION_ID,
      value: { operation: "status", scope: "vault" },
    });
    await vi.waitFor(() => {
      expect(worker.received).toContainEqual({
        type: "host-response",
        requestId: "unleased-git-request",
        error: "Plugin action capability lease is invalid or expired.",
      });
    });
    expect(api.pluginGitRequest).not.toHaveBeenCalled();

    const action = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "leased-git-request",
      actionId: "request-id",
      operation: "git.run",
      operationId: GIT_OPERATION_ID,
      value: { operation: "status", scope: "vault" },
    });

    await vi.waitFor(() => {
      // The executable is host-owned, read from persisted plugin settings, so
      // the invocation carries the request, scope, and operation ID only.
      expect(api.pluginGitRequest).toHaveBeenCalledWith(
        "denote.reference",
        { operation: "status", scope: "vault" },
        "/vault",
        null,
        GIT_OPERATION_ID,
      );
    });
    worker.runtimePort?.postMessage({
      type: "source-control-action-result",
      requestId: "request-id",
    });
    await action;
  });

  it("cancels a running Git operation from a concurrent source control action", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.completeSourceControlActions = false;
    let nextRequestId = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `request-${++nextRequestId}`),
    });
    vi.mocked(api.pluginGitRequest).mockResolvedValue({
      operationId: GIT_OPERATION_ID,
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: true,
    });
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    await runtime.start(pluginWithGit());
    const worker = FakeWorker.instances[0];

    const running = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "push" },
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    const cancelling = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "cancel" },
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
    worker.runtimePort?.postMessage({
      type: "host-request",
      requestId: "cancel-git-request",
      actionId: "request-2",
      operation: "git.run",
      operationId: GIT_CANCEL_ID,
      value: { operation: "cancel", operationId: GIT_OPERATION_ID },
    });

    await vi.waitFor(() => {
      expect(api.pluginGitRequest).toHaveBeenCalledWith(
        "denote.reference",
        { operation: "cancel", operationId: GIT_OPERATION_ID },
        "/vault",
        null,
        GIT_CANCEL_ID,
      );
    });

    worker.runtimePort?.postMessage({
      type: "source-control-action-result",
      requestId: "request-2",
    });
    await cancelling;
    worker.runtimePort?.postMessage({
      type: "source-control-action-result",
      requestId: "request-1",
    });
    await running;
  });

  it("gives source control actions a bounded long lease while commands stay at 30 seconds", async () => {
    FakeWorker.sourceControlModelOnActivate = sourceControlModel;
    FakeWorker.completeSourceControlActions = false;
    FakeWorker.completeCommands = false;
    let nextRequestId = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `request-${++nextRequestId}`),
    });
    const runtime = new PluginWorkerRuntime(vi.fn(), vi.fn());
    await runtime.start(pluginWithGit());

    vi.useFakeTimers();
    try {
      const command = trackSettled(
        runtime.runCommand("denote.reference", "denote.reference.ping", {
          workspaceScope: "/vault",
          projectId: null,
          sourceControlActionId: null,
        }),
      );
      const action = trackSettled(
        runtime.runSourceControlAction(
          "denote.reference",
          "denote.reference.git",
          { id: "push" },
          { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
        ),
      );

      await vi.advanceTimersByTimeAsync(30_001);
      expect(command.rejection()).toMatch(/timed out/i);
      expect(action.settled()).toBe(false);

      await vi.advanceTimersByTimeAsync(600_000);
      expect(action.rejection()).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a running provider operation while its Git request is still pending", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bridgeRealPluginWorker();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(sequentialUuids()) });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(gitProviderModule());
    const gitRequests: { operation: string; operationId: string }[] = [];
    const status = deferred<PluginGitResult>();
    vi.mocked(api.pluginGitRequest).mockImplementation(
      (_pluginId, request, _workspaceScope, _projectId, operationId) => {
        gitRequests.push({ operation: request.operation, operationId });
        return request.operation === "cancel"
          ? Promise.resolve(gitResult(operationId, false))
          : status.promise;
      },
    );
    const onSourceControlChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      onSourceControlChanged,
    );

    await runtime.start(pluginWithGit());
    const worker = BridgedWorker.instances[0];

    const scope = { workspaceScope: "/vault", projectId: null, sourceControlActionId: null };
    const refresh = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      scope,
    );
    const refreshState = trackSettled(refresh);
    await vi.waitFor(() => {
      expect(gitRequests).toHaveLength(1);
      expect(publishedModel(onSourceControlChanged).repository.busy).toBe(true);
    });
    const operationId =
      publishedModel(onSourceControlChanged).repository.activeOperationId;
    expect(operationId).toBe(gitRequests[0].operationId);

    // The cancel action is dispatched while the operation it names is still
    // waiting on its own Git request.
    const cancel = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "cancel-operation", values: { operationId: operationId ?? "" } },
      scope,
    );
    await vi.waitFor(() => {
      expect(gitRequests.map((request) => request.operation)).toEqual([
        "status",
        "cancel",
      ]);
    });
    expect(refreshState.settled()).toBe(false);

    await cancel;
    expect(refreshState.settled()).toBe(false);
    expect(workerLogs(worker, "cancel-completed")).toHaveLength(1);

    status.resolve(gitResult(gitRequests[0].operationId, true));
    await refresh;
    expect(workerLogs(worker, "operation-settled")).toEqual([
      expect.objectContaining({ details: { cancelled: true } }),
    ]);

    // Both actions released their leases, so neither request ID can still buy
    // a privileged host operation.
    for (const actionId of dispatchedActionIds(worker)) {
      worker.runtimePort?.postMessage({
        type: "host-request",
        requestId: `stale-${actionId}`,
        actionId,
        operation: "git.run",
        operationId: "00000000-0000-4000-8000-000000009999",
        value: { operation: "status", scope: "vault" },
      });
    }
    await vi.waitFor(() => {
      for (const actionId of dispatchedActionIds(worker)) {
        expect(worker.received).toContainEqual({
          type: "host-response",
          requestId: `stale-${actionId}`,
          error: "Plugin action capability lease is invalid or expired.",
        });
      }
    });
    expect(gitRequests).toHaveLength(2);
  });

  it("delivers a project change to a provider whose operation is still running", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bridgeRealPluginWorker();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(sequentialUuids()) });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(gitProviderModule());
    const status = deferred<PluginGitResult>();
    vi.mocked(api.pluginGitRequest).mockImplementation(() => status.promise);
    const onSourceControlChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      onSourceControlChanged,
    );
    runtime.setProjectContext({
      projectId: "project-alpha",
      rootPath: "code/alpha",
    });

    await runtime.start(pluginWithGitAndProjectContext());
    const worker = BridgedWorker.instances[0];

    const refresh = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      { workspaceScope: "/vault", projectId: "project-alpha", sourceControlActionId: null },
    );
    const refreshState = trackSettled(refresh);
    await vi.waitFor(() => {
      expect(publishedModel(onSourceControlChanged).repository.busy).toBe(true);
    });
    const busyModel = publishedModel(onSourceControlChanged);

    runtime.setProjectContext({
      projectId: "project-beta",
      rootPath: "code/beta",
    });
    await vi.waitFor(() => {
      expect(workerLogs(worker, "project-changed")).toHaveLength(1);
    });
    expect(refreshState.settled()).toBe(false);

    status.resolve(gitResult("00000000-0000-4000-8000-000000009999", false));
    await refresh;
    expect(workerLogs(worker, "operation-discarded")).toHaveLength(1);
    expect(workerLogs(worker, "operation-settled")).toHaveLength(0);
    // The stale result never replaced the model the user is looking at.
    expect(publishedModel(onSourceControlChanged)).toEqual(busyModel);
  });

  it("only lets the clone and clean-up actions reach the host operations they name", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bridgeRealPluginWorker();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(sequentialUuids()) });
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(
      cloneCapabilityModule(),
    );
    vi.mocked(api.pluginGitCloneVault).mockResolvedValue({
      outcome: { status: "cancelled" },
      snapshot: null,
    });
    vi.mocked(api.pluginGitCleanFailedClone).mockResolvedValue({
      cleaned: true,
      message: "Denote deleted the incomplete clone folder.",
    });
    const opened: unknown[] = [];
    const runtime = new PluginWorkerRuntime(
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (snapshot) => {
        opened.push(snapshot);
      },
    );
    await runtime.start(pluginWithGit());
    const worker = BridgedWorker.instances[0];
    const lease = {
      workspaceScope: VAULT_ALPHA,
      projectId: null,
      sourceControlActionId: null,
    };

    // The standardised clone action is the only lease a clone runs under.
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "clone" },
      lease,
    );
    expect(api.pluginGitCloneVault).toHaveBeenCalledTimes(1);
    expect(api.pluginGitCloneVault).toHaveBeenCalledWith(
      "denote.reference",
      { url: "https://example.invalid/repo.git", authMode: "public" },
      VAULT_ALPHA,
      expect.any(String),
    );
    expect(workerLogs(worker, "clone-outcome")).toHaveLength(1);

    // A differently named action carries a different confirmation, so it
    // reaches neither the folder chooser nor the native command.
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "refresh" },
      lease,
    );
    // A command has no source-control action at all.
    await runtime.runCommand(
      "denote.reference",
      "denote.reference.ping",
      lease,
    );
    expect(api.pluginGitCloneVault).toHaveBeenCalledTimes(1);
    const refusals = workerLogs(worker, "clone-refused");
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) {
      expect(JSON.stringify(refusal)).toContain(
        'requires the \\"clone\\" source-control action',
      );
    }

    // The same binding protects the deletion.
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "clean-failed-clone" },
      lease,
    );
    expect(api.pluginGitCleanFailedClone).toHaveBeenCalledTimes(1);
    await runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "sneaky-cleanup" },
      lease,
    );
    expect(api.pluginGitCleanFailedClone).toHaveBeenCalledTimes(1);
    expect(workerLogs(worker, "cleanup-refused")).toHaveLength(1);
    // Nothing that was refused ever handed the renderer a workspace.
    expect(opened).toEqual([]);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value: T) => settle(value) };
}

function gitResult(operationId: string, cancelled: boolean): PluginGitResult {
  return { operationId, exitCode: 0, stdout: "", stderr: "", cancelled };
}

function publishedModel(
  onSourceControlChanged: ReturnType<typeof vi.fn>,
): PluginSourceControlViewModel {
  const calls = onSourceControlChanged.mock.calls;
  const providers = calls[calls.length - 1][0] as {
    model: PluginSourceControlViewModel;
  }[];
  return providers[0].model;
}

function workerLogs(worker: BridgedWorker, message: string): unknown[] {
  return (worker.runtimePort?.messages ?? []).filter(
    (entry) =>
      isRecord(entry) && entry.type === "log" && entry.message === message,
  );
}

function dispatchedActionIds(worker: BridgedWorker): string[] {
  return worker.received.flatMap((entry) =>
    isRecord(entry) &&
    entry.type === "run-source-control-action" &&
    typeof entry.requestId === "string"
      ? [entry.requestId]
      : [],
  );
}

/**
 * A synthetic vault-scoped provider modelled on the Git plugin: it refreshes
 * into a described repository, and resets to the unrefreshed model whenever the
 * host reports a workspace change, even though the scope identity never moves.
 */
function vaultProviderModule(): string {
  const unrefreshed = {
    ...sourceControlModel,
    repository: {
      ...sourceControlModel.repository,
      repositoryId: "vault",
      label: "Vault · refresh required",
      initialized: false,
      branch: null,
      upstream: null,
    },
    resourceGroups: [],
  };
  const refreshed = {
    ...sourceControlModel,
    repository: {
      ...sourceControlModel.repository,
      repositoryId: "vault",
      label: "Vault",
    },
    resourceGroups: [
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "notes/synthetic.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ],
  };
  return `
    const unrefreshed = ${JSON.stringify(unrefreshed)};
    const refreshed = ${JSON.stringify(refreshed)};
    let registration;
    export default {
      manifest: {
        id: ${JSON.stringify(catalog.manifest.id)},
        version: ${JSON.stringify(catalog.manifest.version)},
      },
      async activate(context) {
        if (context.capabilities.projectContext) {
          context.capabilities.projectContext.subscribe((event) => {
            if (event.workspaceChanged) {
              context.logger.info("workspace-changed");
              registration.update(unrefreshed);
              return;
            }
            context.logger.info("project-changed");
          });
        }
        registration = context.capabilities.sourceControl.register({
          id: "denote.reference.git",
          title: "Git",
          initialModel: unrefreshed,
          async runAction(action, userAction) {
            await userAction.capabilities.git.run({
              operation: "status",
              scope: "vault",
            }).result;
            registration.update(refreshed);
          },
        });
        context.subscriptions.add(registration);
      },
    };
  `;
}

/**
 * A synthetic provider and command that both reach for the two host-owned
 * operations a source-control action has to authorise: cloning into a folder
 * the user picks, and deleting what a failed clone left behind.
 */
function cloneCapabilityModule(): string {
  return `
    const model = ${JSON.stringify(sourceControlModel)};
    export default {
      manifest: {
        id: ${JSON.stringify(catalog.manifest.id)},
        version: ${JSON.stringify(catalog.manifest.version)},
      },
      async activate(context) {
        const clone = async (git, label) => {
          try {
            const operation = git.cloneVault({
              url: "https://example.invalid/repo.git",
              authMode: "public",
            });
            const outcome = await operation.result;
            context.logger.info("clone-outcome", {
              label,
              status: outcome.status,
              operationId: operation.operationId,
            });
          } catch (error) {
            context.logger.info("clone-refused", {
              label,
              message: String(error && error.message ? error.message : error),
            });
          }
        };
        const cleanup = async (git, label) => {
          try {
            await git.cleanFailedClone("11111111-2222-4333-8444-555555555555");
            context.logger.info("cleanup-outcome", { label });
          } catch (error) {
            context.logger.info("cleanup-refused", {
              label,
              message: String(error && error.message ? error.message : error),
            });
          }
        };
        const registration = context.capabilities.sourceControl.register({
          id: "denote.reference.git",
          title: "Git",
          initialModel: model,
          async runAction(action, userAction) {
            const git = userAction.capabilities.git;
            if (action.id === "clean-failed-clone" || action.id === "sneaky-cleanup") {
              await cleanup(git, action.id);
              return;
            }
            await clone(git, action.id);
          },
        });
        context.subscriptions.add(registration);
        context.subscriptions.add(
          context.capabilities.commands.register({
            id: "denote.reference.ping",
            title: "Ping",
            run: (userAction) => clone(userAction.capabilities.git, "command"),
          }),
        );
      },
    };
  `;
}

/**
 * A synthetic provider that publishes the operation ID of a running Git
 * request, cancels by ID, and discards a result that belongs to a project the
 * user already left.
 */
function gitProviderModule(): string {  return `
    const model = ${JSON.stringify(sourceControlModel)};
    let registration;
    let generation = 0;
    export default {
      manifest: {
        id: ${JSON.stringify(catalog.manifest.id)},
        version: ${JSON.stringify(catalog.manifest.version)},
      },
      async activate(context) {
        if (context.capabilities.projectContext) {
          context.capabilities.projectContext.subscribe((event) => {
            generation += 1;
            context.logger.info("project-changed", {
              projectId: event.current ? event.current.projectId : null,
            });
          });
        }
        registration = context.capabilities.sourceControl.register({
          id: "denote.reference.git",
          title: "Git",
          initialModel: model,
          async runAction(action, userAction) {
            const git = userAction.capabilities.git;
            if (action.id === "cancel-operation") {
              await git.cancel(String(action.values.operationId));
              context.logger.info("cancel-completed");
              return;
            }
            const started = generation;
            const operation = git.run({ operation: "status", scope: "vault" });
            registration.update({
              ...model,
              repository: {
                ...model.repository,
                busy: true,
                busyMessage: "Reading the working tree",
                activeOperationId: operation.operationId,
              },
            });
            const result = await operation.result;
            if (started !== generation) {
              context.logger.info("operation-discarded");
              return;
            }
            context.logger.info("operation-settled", {
              cancelled: result.cancelled,
            });
            registration.update(model);
          },
        });
        context.subscriptions.add(registration);
      },
    };
  `;
}

function trackSettled(promise: Promise<void>): {
  settled: () => boolean;
  rejection: () => string | null;
} {
  let error: string | null = null;
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    (reason: unknown) => {
      done = true;
      error = reason instanceof Error ? reason.message : String(reason);
    },
  );
  return { settled: () => done, rejection: () => error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dataModuleUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}
