import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../packages/plugins/catalog.json";
import { assertValidPluginCatalogEntry } from "@denote/plugin-sdk";
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
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const catalogValue: unknown = catalogJson[0];
assertValidPluginCatalogEntry(catalogValue);
const catalog = catalogValue;

class FakePort extends EventTarget {
  peer: FakePort | null = null;
  closed = false;
  messages: unknown[] = [];

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
  terminated = false;
  runtimePort: FakePort | null = null;
  received: unknown[] = [];

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    if (!isRecord(message) || message.type !== "connect") {
      return;
    }
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
          id: "denote.reference.ping",
          title: "Reference command",
        });
        port.postMessage({ type: "activated" });
      } else if (
        data.type === "run-command" &&
        typeof data.requestId === "string"
      ) {
        port.postMessage({
          type: "command-result",
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

describe("PluginWorkerRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
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
    expect(onCommandsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.ping",
        title: "Reference command",
      },
    ]);
    await runtime.runCommand("denote.reference", "denote.reference.ping");
    expect(worker.runtimePort?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command-result",
          requestId: "request-id",
        }),
      ]),
    );
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
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
