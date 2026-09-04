import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import {
  parsePluginManifest,
  type PluginManifest,
} from "@denote/plugin-sdk";

export const projectRoot = fileURLToPath(new URL("..", import.meta.url));
export const pluginsRoot = join(projectRoot, "packages", "plugins");
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
  const outputPath = join(pluginDirectory, manifest.entrypoint);
  const sourcePath = join(
    pluginDirectory,
    manifest.entrypoint.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"),
  );
  await build({
    configFile: false,
    logLevel: "error",
    plugins: [pluginBoundary(pluginDirectory, sdkRoot)],
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
