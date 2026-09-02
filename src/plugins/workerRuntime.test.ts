import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../packages/plugins/catalog.json";
import {
  assertValidPluginCatalogEntry,
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
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const catalogValue: unknown = catalogJson[0];
assertValidPluginCatalogEntry(catalogValue);
const catalog = catalogValue;
const GIT_OPERATION_ID = "11111111-2222-4333-8444-555555555555";
const GIT_CANCEL_ID = "99999999-8888-4777-8666-555555555555";
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
  diffFiles: [],
  conflicts: [],
  recovery: { state: "idle" },
};

class FakePort extends EventTarget {
  peer: FakePort | null = null;
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

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

describe("PluginWorkerRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    FakeWorker.completeCommands = true;
    FakeWorker.commandIdOnActivate = "denote.reference.ping";
    FakeWorker.completeSourceControlActions = true;
    FakeWorker.sourceControlModelOnActivate = null;
    FakeWorker.sourceControlProviderIdOnActivate = "denote.reference.git";
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
      { workspaceScope: "/vault", projectId: null },
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
      { workspaceScope: "/vault", projectId: null },
    );
    expect(worker.received).toContainEqual({
      type: "run-source-control-action",
      providerId: "denote.reference.git",
      action: { id: "refresh", values: { force: true } },
      requestId: "request-id",
    });

    await runtime.stop("denote.reference");
    expect(onSourceControlChanged).toHaveBeenLastCalledWith([]);
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
        { workspaceScope: "/vault", projectId: null },
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
      { workspaceScope: "/vault", projectId: "project-alpha" },
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
      { workspaceScope: "/vault", projectId: "project-alpha" },
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
      { workspaceScope: "/vault", projectId: "project-alpha" },
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
      { workspaceScope: "/vault", projectId: "project-alpha" },
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
        },
      },
    ]);
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
      { workspaceScope: "/vault", projectId: null },
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
      { workspaceScope: "/vault", projectId: null },
    );
    const cancelling = runtime.runSourceControlAction(
      "denote.reference",
      "denote.reference.git",
      { id: "cancel" },
      { workspaceScope: "/vault", projectId: null },
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
        }),
      );
      const action = trackSettled(
        runtime.runSourceControlAction(
          "denote.reference",
          "denote.reference.git",
          { id: "push" },
          { workspaceScope: "/vault", projectId: null },
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
});

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
