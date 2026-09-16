import { describe, expect, it } from "vitest";
import { parsePluginManifest, type PluginCatalogEntry } from "@denote/plugin-sdk";
import { pluginEntrypointConditions } from "./plugin-build-conditions";
import { pluginSdkModulePath, pluginSdkSourceCommit } from "./plugin-sdk-provenance";
import { containsPluginRuntimeImport } from "./plugin-runtime-imports";

const manifest = parsePluginManifest({
  schemaVersion: 1,
  id: "denote.synthetic",
  name: "Synthetic package",
  version: "1.0.0",
  description: "Synthetic package",
  publisher: { name: "Synthetic publisher" },
  license: "MIT",
  repository: "https://github.com/example/synthetic",
  icon: "icon.svg",
  category: "editor-writing",
  compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.3" },
  permissions: [],
  entrypoint: "dist/index.js",
  documentation: "guide.md",
});
const entry: PluginCatalogEntry = {
  manifest,
  artifact: {
    url: "https://github.com/example/synthetic/releases/download/v1.0.0/denote.synthetic-1.0.0.tgz",
    sha256: "a".repeat(64),
    sizeBytes: 1,
  },
  provenance: { sourceCommit: "b".repeat(40), publisherId: "synthetic", trusted: true },
  guide: "Synthetic guide",
};

describe("plugin SDK build provenance", () => {
  it("uses worker package exports only for isolated activation bundles", () => {
    expect(pluginEntrypointConditions("worker")).toEqual(["worker"]);
    expect(pluginEntrypointConditions("diagram-renderer")).toEqual([]);
  });

  it("resolves native and Vite-normalized paths on every platform", () => {
    expect(pluginSdkModulePath("/synthetic/sdk", "/synthetic/sdk/src/index.ts"))
      .toBe("packages/plugin-sdk/src/index.ts");
    expect(pluginSdkModulePath("C:\\synthetic\\sdk", "C:/synthetic/sdk/src/index.ts?import"))
      .toBe("packages/plugin-sdk/src/index.ts");
    expect(pluginSdkModulePath("C:\\synthetic\\sdk", "C:\\synthetic\\sdk\\src\\index.ts"))
      .toBe("packages/plugin-sdk/src/index.ts");
    expect(pluginSdkModulePath("/synthetic/sdk", "/synthetic/sdk-other/index.ts")).toBeNull();
    expect(() => pluginSdkModulePath("/synthetic/sdk", "/synthetic/sdk/../private.ts")).toThrow();
  });

  describe("plugin runtime import detection", () => {
    it("rejects executable runtime loaders", () => {
      expect(containsPluginRuntimeImport('import "./chunk.js"')).toBe(true);
      expect(containsPluginRuntimeImport('export * from "./chunk.js"')).toBe(true);
      expect(containsPluginRuntimeImport('await import("./chunk.js")')).toBe(true);
      expect(containsPluginRuntimeImport('importScripts("./chunk.js")')).toBe(true);
      expect(containsPluginRuntimeImport('self.importScripts("./chunk.js")')).toBe(
        true,
      );
      expect(
        containsPluginRuntimeImport('self["importScripts"]("./chunk.js")'),
      ).toBe(true);
    });

    it("ignores import-shaped text in comments and strings", () => {
      expect(
        containsPluginRuntimeImport(
          '/** @typedef {import("./types.js").Thing} Thing */',
        ),
      ).toBe(false);
      expect(
        containsPluginRuntimeImport('const example = "import(\\"./chunk.js\\")";'),
      ).toBe(false);
      expect(
        containsPluginRuntimeImport("const value = 1; export { value };"),
      ).toBe(false);
    });
  });
  it("rebuilds an immutable plugin with its original shared SDK", () => {
    expect(pluginSdkSourceCommit(manifest, [entry])).toBe("b".repeat(40));
  });

  it("uses current SDK for a new plugin or version without changing another pin", () => {
    expect(pluginSdkSourceCommit({ ...manifest, version: "1.0.1" }, [entry])).toBeNull();
    expect(pluginSdkSourceCommit({ ...manifest, id: "denote.another" }, [entry])).toBeNull();
    expect(pluginSdkSourceCommit(manifest, [])).toBeNull();
    expect(entry.provenance.sourceCommit).toBe("b".repeat(40));
  });
});
