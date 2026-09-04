import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlugin, pluginDirectories } from "./plugin-build";

export async function runBuildPlugins(argv: string[]): Promise<void> {
  const pluginIndex = argv.indexOf("--plugin");
  const pluginId = pluginIndex >= 0 ? argv[pluginIndex + 1] : undefined;
  if (pluginIndex >= 0 && !pluginId) {
    throw new Error("Usage: build-plugins.ts [--plugin <plugin-id>]");
  }
  const consumed = new Set(
    pluginIndex >= 0 ? [pluginIndex, pluginIndex + 1] : [],
  );
  const remaining = argv.filter((_, index) => !consumed.has(index));
  if (remaining.length > 0) {
    throw new Error(`Unknown build plugin arguments: ${remaining.join(" ")}`);
  }
  for (const pluginDirectory of pluginDirectories(pluginId)) {
    await buildPlugin(pluginDirectory);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runBuildPlugins(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
