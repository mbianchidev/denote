import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { pluginSdkModulePath, pluginSdkSourceCommit } from "./plugin-sdk-provenance";
import { build, type Plugin } from "vite";
import {
  parsePluginManifest,
  assertValidPluginCatalogEntry,
  type PluginCatalogEntry,
  type PluginManifest,
} from "@denote/plugin-sdk";

export const projectRoot = fileURLToPath(new URL("..", import.meta.url));
export const pluginsRoot = join(projectRoot, "plugins");
const sdkRoot = realpathSync(join(projectRoot, "packages", "plugin-sdk"));

export function pluginDirectories(pluginId?: string): string[] {
  const directories = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(pluginsRoot, entry.name))
    .sort();
  if (!pluginId) {
    return directories;
  }
  const selected = directories.find(
    (directory) => readPluginManifest(directory).id === pluginId,
  );
  if (!selected) {
    throw new Error(`Unknown plugin: ${pluginId}`);
  }
  return [selected];
}

export function readPluginManifest(pluginDirectory: string): PluginManifest {
  const manifestValue: unknown = JSON.parse(
    readFileSync(join(pluginDirectory, "plugin.json"), "utf8"),
  );
  return parsePluginManifest(manifestValue);
}

export async function buildPlugin(pluginDirectory: string): Promise<PluginManifest> {
  const manifest = readPluginManifest(pluginDirectory);
  const catalog: unknown = JSON.parse(readFileSync(join(pluginsRoot, "catalog.json"), "utf8"));
  if (!Array.isArray(catalog)) {
    throw new Error("Plugin catalog must be an array.");
  }
  const entries: PluginCatalogEntry[] = catalog.map((entry: unknown) => {
    assertValidPluginCatalogEntry(entry);
    return entry;
  });
  const sourceCommit = pluginSdkSourceCommit(manifest, entries);
  const outputPath = join(pluginDirectory, manifest.entrypoint);
  const sourcePath = join(
    pluginDirectory,
    manifest.entrypoint.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"),
  );
  await build({
    configFile: false,
    logLevel: "error",
    plugins: [
      ...(sourceCommit ? [pinnedPluginSdk(sourceCommit)] : []),
      pluginBoundary(pluginDirectory, sdkRoot),
      stableSourceLabels(manifest),
    ],
    build: {
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      outDir: dirname(outputPath),
      lib: {
        entry: sourcePath,
        formats: ["es"],
        fileName: () => basename(outputPath),
      },
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  });
  console.log(`Built ${manifest.id}@${manifest.version}.`);
  return manifest;
}

function stableSourceLabels(manifest: PluginManifest): Plugin {
  return {
    name: "denote-stable-plugin-source-labels",
    renderChunk(code) {
      // Keep historical debug labels stable when a package moves on disk.
      return code.replace(
        /^\/\/#region plugins\/[^/]+\//gm,
        `//#region packages/plugins/${manifest.id}/`,
      );
    },
  };
}

function pinnedPluginSdk(sourceCommit: string): Plugin {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error("Plugin SDK provenance must be a complete source commit.");
  }
  return {
    name: "denote-pinned-plugin-sdk",
    enforce: "pre",
    load(id) {
      const path = pluginSdkModulePath(sdkRoot, id);
      if (!path) {
        return;
      }
      // Keep canonical module IDs (and bundle bytes), but rebuild an immutable
      // plugin against the SDK that produced it, not a later host capability.
      return execFileSync("git", ["show", `${sourceCommit}:${path}`], {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
  };
}

function pluginBoundary(pluginDirectory: string, canonicalSdkRoot: string): Plugin {
  const canonicalRoot = realpathSync(pluginDirectory);
  return {
    name: "denote-plugin-boundary",
    moduleParsed(moduleInfo) {
      const modulePath = moduleInfo.id.split("?")[0];
      if (modulePath.startsWith("\0") || !existsSync(modulePath)) {
        return;
      }
      const canonicalPath = realpathSync(modulePath);
      if (
        canonicalPath === canonicalRoot ||
        canonicalPath.startsWith(`${canonicalRoot}${sep}`) ||
        canonicalPath === canonicalSdkRoot ||
        canonicalPath.startsWith(`${canonicalSdkRoot}${sep}`) ||
        canonicalPath.includes(`${sep}node_modules${sep}`)
      ) {
        return;
      }
      this.error(`Plugin module resolves outside its package: ${canonicalPath}.`);
    },
  };
}
