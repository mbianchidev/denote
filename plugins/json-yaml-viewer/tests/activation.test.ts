import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isPluginStructuredViewerRegistration,
  type PluginActivationContext,
  type PluginDisposable,
  type PluginStructuredViewer,
} from "@denote/plugin-sdk";
import plugin from "../src/index";
import packageJson from "../package.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function activationHarness() {
  const dispose = vi.fn();
  const registration = { dispose };
  const register = vi.fn((_viewer: PluginStructuredViewer) => registration);
  const subscriptions: PluginDisposable[] = [];
  const context: PluginActivationContext = {
    pluginId: plugin.manifest.id,
    capabilities: { structuredViewer: { register } },
    settings: { getAll: vi.fn(async () => ({})) },
    storage: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    subscriptions: {
      add: vi.fn((disposable) => subscriptions.push(disposable)),
    },
  };
  return { context, register, registration, dispose, subscriptions };
}

describe("JSON and YAML viewer activation", () => {
  it("registers one host-rendered viewer for the supported extensions", async () => {
    const harness = activationHarness();

    await plugin.activate(harness.context);

    expect(harness.register).toHaveBeenCalledTimes(1);
    const viewer = harness.register.mock.calls[0][0];
    expect(
      isPluginStructuredViewerRegistration({
        id: viewer.id,
        title: viewer.title,
        extensions: viewer.extensions,
      }),
    ).toBe(true);
    expect(viewer).toMatchObject({
      id: "denote.json-yaml-viewer.viewer",
      title: "JSON and YAML viewer",
      extensions: ["json", "yaml", "yml"],
    });
    expect(typeof viewer.parse).toBe("function");
    expect(harness.subscriptions).toEqual([harness.registration]);
  });

  it("fails closed without the declared capability", async () => {
    const harness = activationHarness();
    harness.context.capabilities = {};

    expect(() => plugin.activate(harness.context)).toThrow(
      "Structured viewer permission",
    );
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("requests only structured viewing and has no install scripts or executable", () => {
    expect(plugin.manifest).toMatchObject({
      id: "denote.json-yaml-viewer",
      category: "code",
      permissions: [{ capability: "structured-viewer" }],
    });
    expect(plugin.manifest.permissions).toHaveLength(1);
    expect(packageJson.dependencies).toEqual({
      "@denote/plugin-sdk": "0.1.0",
      yaml: "2.9.0",
    });
    expect(packageJson).not.toHaveProperty("scripts");
    expect(packageJson).not.toHaveProperty("bin");
  });

  it("ships complete safety, limits, lifecycle, and license guidance", () => {
    const guide = readFileSync(join(root, "guide.md"), "utf8");

    for (const section of [
      "Purpose",
      "Enablement and permissions",
      "Usage",
      "Settings",
      "Disable behavior",
      "Troubleshooting",
    ]) {
      expect(guide).toContain(`## ${section}`);
    }
    for (const phrase of [
      "4 MiB",
      "50,000 emitted nodes",
      "500 aliases",
      "YAML 1.2 core",
      "custom tags disabled",
      "ISC license",
      "does not edit, reformat, save, or delete",
    ]) {
      expect(guide).toContain(phrase);
    }
  });
});
