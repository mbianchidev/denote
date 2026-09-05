import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emojiPickerMatchesManifest,
  isPluginEmojiPicker,
  type PluginActivationContext,
  type PluginDisposable,
  type PluginEmojiPicker,
} from "@denote/plugin-sdk";
import plugin from "../src/index";
import emojiJson from "../src/emoji.json";
import packageJson from "../package.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function activationHarness(settings: Record<string, unknown> = {}) {
  const dispose = vi.fn();
  const registration = { dispose };
  const register = vi.fn((_picker: PluginEmojiPicker) => registration);
  const subscriptions: PluginDisposable[] = [];
  const add = vi.fn((disposable: PluginDisposable) => {
    subscriptions.push(disposable);
  });
  const getAll = vi.fn(async () => settings);
  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  const context: PluginActivationContext = {
    pluginId: plugin.manifest.id,
    capabilities: { emojiPicker: { register } },
    settings: { getAll },
    storage,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    subscriptions: { add },
  };
  return { context, register, registration, dispose, getAll, add, storage, subscriptions };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("emoji picker registration", () => {
  it("registers a valid static local dataset with exactly one host-owned contribution", async () => {
    const harness = activationHarness();

    await plugin.activate(harness.context);

    expect(harness.register).toHaveBeenCalledTimes(1);
    const [picker] = harness.register.mock.calls[0];
    expect(picker).toEqual({
      id: "denote.emoji-picker.catalog",
      title: "Emoji picker",
      entries: emojiJson,
      shortcodes: true,
      settingsKeys: { recents: "recents", favorites: "favorites", tone: "tone" },
    });
    expect(isPluginEmojiPicker(picker)).toBe(true);
    expect(emojiPickerMatchesManifest(picker, plugin.manifest)).toBe(true);
    expect(JSON.parse(JSON.stringify(picker))).toEqual(picker);
    expect(harness.getAll).toHaveBeenCalledTimes(1);
  });

  it("tracks the registration for deterministic host disposal", async () => {
    const harness = activationHarness();
    await plugin.activate(harness.context);

    expect(harness.add).toHaveBeenCalledExactlyOnceWith(harness.registration);
    expect(harness.dispose).not.toHaveBeenCalled();
    await harness.subscriptions[0].dispose();
    expect(harness.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("uses autocomplete=%s only to select shortcode suggestions", async (autocomplete) => {
    const harness = activationHarness({ autocomplete });

    await plugin.activate(harness.context);

    expect(harness.register.mock.calls[0][0].shortcodes).toBe(autocomplete);
    expect(harness.register.mock.calls[0][0].entries).toEqual(emojiJson);
  });

  it("never reads host-owned recent, favorite, or tone preference values", async () => {
    const unreadable = () => {
      throw new Error("The plugin must leave picker preferences to the host.");
    };
    const settings = Object.defineProperties({ autocomplete: true }, {
      recents: { get: unreadable },
      favorites: { get: unreadable },
      tone: { get: unreadable },
    });
    const harness = activationHarness(settings);

    await plugin.activate(harness.context);

    expect(harness.register).toHaveBeenCalledTimes(1);
    for (const method of Object.values(harness.storage)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("fails before reading settings when the capability is absent", async () => {
    const harness = activationHarness();
    harness.context.capabilities = {};

    await expect(plugin.activate(harness.context)).rejects.toThrow(
      "Emoji picker requires the Emoji picker permission.",
    );

    expect(harness.getAll).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.add).not.toHaveBeenCalled();
  });

  it("leaves no contribution when reading settings fails", async () => {
    const harness = activationHarness();
    harness.getAll.mockRejectedValueOnce(new Error("Settings unavailable."));

    await expect(plugin.activate(harness.context)).rejects.toThrow("Settings unavailable.");

    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.add).not.toHaveBeenCalled();
  });

  it("propagates registration failure without adding a false disposable", async () => {
    const harness = activationHarness();
    harness.register.mockImplementationOnce(() => {
      throw new Error("Registration refused.");
    });

    await expect(plugin.activate(harness.context)).rejects.toThrow("Registration refused.");

    expect(harness.add).not.toHaveBeenCalled();
  });

  it("imports and activates offline without network or browser storage", async () => {
    const unexpected = vi.fn(() => {
      throw new Error("Unexpected ambient capability.");
    });
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) {
      vi.stubGlobal(name, unexpected);
    }
    vi.stubGlobal("localStorage", {
      getItem: unexpected,
      setItem: unexpected,
      removeItem: unexpected,
    });
    vi.resetModules();
    const offlinePlugin = (await import("../src/index")).default;
    const harness = activationHarness();

    await offlinePlugin.activate(harness.context);

    expect(harness.register).toHaveBeenCalledTimes(1);
    expect(unexpected).not.toHaveBeenCalled();
  });
});

describe("independent optional package contract", () => {
  it("requests only the additive emoji picker permission on a compatible Denote release", () => {
    expect(plugin.manifest).toMatchObject({
      id: "denote.emoji-picker",
      version: "0.1.1",
      category: "editor-writing",
      license: "MIT AND Unicode-3.0",
      compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.3" },
      permissions: [{ capability: "emoji-picker" }],
    });
    expect(plugin.manifest.permissions).toHaveLength(1);
  });

  it("declares only the local preference and autocomplete settings", () => {
    const schema = plugin.manifest.settings;

    expect(schema?.version).toBe(1);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      "autocomplete", "favorites", "recents", "tone",
    ]);
    expect(schema?.properties).toMatchObject({
      autocomplete: { type: "boolean", default: true },
      recents: { type: "string", default: "[]" },
      favorites: { type: "string", default: "[]" },
      tone: { type: "number", default: 0, minimum: 0, maximum: 5 },
    });
  });

  it("has no third-party runtime dependency, installation script, or executable", () => {
    expect(packageJson.dependencies).toEqual({ "@denote/plugin-sdk": "0.1.0" });
    expect(packageJson).not.toHaveProperty("scripts");
    expect(packageJson).not.toHaveProperty("bin");
    expect(packageJson).toMatchObject({
      name: "@denote/plugin-emoji-picker",
      private: true,
      version: plugin.manifest.version,
      main: `./${plugin.manifest.entrypoint}`,
    });
    const source = readFileSync(join(root, "src/index.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../plugin.json", "./emoji.json", "@denote/plugin-sdk"]);
  });

  it("ships the usage, safety, settings, disablement, and licensing guide", () => {
    const guide = readFileSync(join(root, "guide.md"), "utf8");

    for (const section of [
      "Purpose", "Enablement and permissions", "Usage", "Settings",
      "Disable behavior", "Troubleshooting", "Licenses and notices",
    ]) {
      expect(guide).toContain(`## ${section}`);
    }
    for (const instruction of [
      "Mod+Shift+E", "editor toolbar", "command palette", "Escape",
      "read-only", "locked", "Recent emoji", "Favorite emoji",
      "No note\nis edited or deleted",
    ]) {
      expect(guide).toContain(instruction);
    }
    expect(plugin.manifest.documentation).toBe("guide.md");
  });
});
