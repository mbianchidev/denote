import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import {
  parsePluginManifest,
  type PluginManifest,
} from "@denote/plugin-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsRoot = join(root, "packages", "plugins");
const pluginDirectories = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(pluginsRoot, entry.name))
  .sort();

for (const pluginDirectory of pluginDirectories) {
  const manifest = parseManifest(pluginDirectory);
  const outputPath = join(pluginDirectory, manifest.entrypoint);
  const sourcePath = join(
    pluginDirectory,
    manifest.entrypoint.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"),
  );
  await build({
    configFile: false,
    logLevel: "error",
    plugins: [pluginBoundary(pluginDirectory)],
    build: {
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      outDir: dirname(outputPath),
      lib: {
        entry: sourcePath,
        formats: ["es"],
        fileName: () => basename(outputPath),
      },
      rolldownOptions: {
        external: ["@denote/plugin-sdk"],
      },
    },
  });
  console.log(`Built ${manifest.id}@${manifest.version}.`);
}

function parseManifest(pluginDirectory: string): PluginManifest {
  const manifestValue: unknown = JSON.parse(
    readFileSync(join(pluginDirectory, "plugin.json"), "utf8"),
  );
  return parsePluginManifest(manifestValue);
}

function pluginBoundary(pluginDirectory: string): Plugin {
  const canonicalRoot = realpathSync(pluginDirectory);
  return {
    name: "denote-plugin-boundary",
    moduleParsed(moduleInfo) {
      const modulePath = moduleInfo.id.split("?")[0];
      if (
        modulePath.startsWith("\0") ||
        !existsSync(modulePath)
      ) {
        return;
      }
      const canonicalPath = realpathSync(modulePath);
      if (
        canonicalPath === canonicalRoot ||
        canonicalPath.startsWith(`${canonicalRoot}${sep}`) ||
        canonicalPath.includes(`${sep}node_modules${sep}`)
      ) {
        return;
      }
      this.error(
        `Plugin module resolves outside its package: ${canonicalPath}.`,
      );
    },
  };
}
