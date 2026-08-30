import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../packages/plugins/catalog.json";
import { assertValidPluginCatalogEntry } from "@denote/plugin-sdk";
import type { PluginView } from "../types";
import { api } from "../lib/api";
import { PluginWorkerRuntime } from "./workerRuntime";

vi.mock("../lib/api", () => ({
  api: {
    readPluginEntrypoint: vi.fn(),
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

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  messages: unknown[] = [];

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
    if (!isRecord(message)) {
      return;
    }
    if (message.type === "activate") {
      queueMicrotask(() => this.emit({ type: "activated" }));
    } else if (
      message.type === "run-command" &&
      typeof message.requestId === "string"
    ) {
      queueMicrotask(() =>
        this.emit({
          type: "command-result",
          requestId: message.requestId,
        }),
      );
    } else if (
      message.type === "deactivate" &&
      typeof message.requestId === "string"
    ) {
      queueMicrotask(() =>
        this.emit({
          type: "deactivated",
          requestId: message.requestId,
        }),
      );
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function plugin(): PluginView {
  return {
    catalog,
    status: "installing",
    enabled: false,
    error: null,
    approvedPermissions: [],
    settings: {},
  };
}

describe("PluginWorkerRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-id") });
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    vi.mocked(api.readPluginEntrypoint).mockResolvedValue(
      "export default {};",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads code only when started and publishes registered commands", async () => {
    const onCommandsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(onCommandsChanged, vi.fn());

    expect(api.readPluginEntrypoint).not.toHaveBeenCalled();
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];
    worker.emit({
      type: "register-command",
      id: "denote.reference.ping",
      title: "Reference command",
    });

    expect(api.readPluginEntrypoint).toHaveBeenCalledWith("denote.reference");
    expect(onCommandsChanged).toHaveBeenLastCalledWith([
      {
        pluginId: "denote.reference",
        id: "denote.reference.ping",
        title: "Reference command",
      },
    ]);
    await runtime.runCommand("denote.reference", "denote.reference.ping");
    expect(worker.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run-command",
          commandId: "denote.reference.ping",
        }),
      ]),
    );
  });

  it("terminates the worker and removes contributions on disable", async () => {
    const onCommandsChanged = vi.fn();
    const runtime = new PluginWorkerRuntime(onCommandsChanged, vi.fn());
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];
    worker.emit({
      type: "register-command",
      id: "denote.reference.ping",
      title: "Reference command",
    });

    await runtime.stop("denote.reference");

    expect(worker.terminated).toBe(true);
    expect(onCommandsChanged).toHaveBeenLastCalledWith([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("terminates unauthorized command registrations", async () => {
    const onError = vi.fn();
    const runtime = new PluginWorkerRuntime(vi.fn(), onError);
    await runtime.start(plugin());
    const worker = FakeWorker.instances[0];

    worker.emit({
      type: "register-command",
      id: "other.command",
      title: "Unauthorized",
    });

    expect(worker.terminated).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      "denote.reference",
      expect.objectContaining({
        message: expect.stringMatching(/unauthorized command/i),
      }),
    );
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
