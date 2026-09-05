import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { buildPlugin, pluginDirectories, projectRoot } from "./plugin-build";
import { writePluginArchive } from "./plugin-archive";

const args = process.argv.slice(2);
const pluginId = args.find((argument) => !argument.startsWith("--"));
const watchMode = !args.includes("--once");
const unknown = args.filter(
  (argument) => argument !== pluginId && argument !== "--once",
);
if (!pluginId || unknown.length > 0) {
  throw new Error("Usage: npm run dev:plugin -- <plugin-id> [--once]");
}

const [pluginDirectory] = pluginDirectories(pluginId);
const destination = join(projectRoot, ".plugin-dev", `${pluginId}.tgz`);
let building = false;
let rebuildQueued = false;
let timer: NodeJS.Timeout | null = null;

async function rebuild(): Promise<boolean> {
  if (building) {
    rebuildQueued = true;
    return false;
  }
  building = true;
  try {
    const manifest = await buildPlugin(pluginDirectory);
    const archive = await writePluginArchive(
      pluginDirectory,
      manifest,
      destination,
    );
    console.log(
      `Development archive ready: ${destination} (${archive.sizeBytes} bytes, ${archive.sha256.slice(0, 12)}…).`,
    );
    console.log(
      "In Denote Development, open Settings → Plugins and choose Load local plugin archive.",
    );
    return true;
  } catch (error) {
    console.error(
      `Development plugin build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  } finally {
    building = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      await rebuild();
    }
  }
}

const initialBuildSucceeded = await rebuild();
if (!initialBuildSucceeded && !watchMode) {
  process.exitCode = 1;
}

if (watchMode) {
  const watchers: FSWatcher[] = [];
  const schedule = (filename: string | Buffer | null) => {
    if (filename === null) {
      return;
    }
    const path = filename.toString().replaceAll("\\", "/");
    if (
      path === "dist" ||
      path.startsWith("dist/") ||
      path === "releases.json" ||
      path === "node_modules" ||
      path.startsWith("node_modules/")
    ) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void rebuild();
    }, 150);
  };
  watchers.push(
    watch(pluginDirectory, { recursive: true }, (_event, filename) =>
      schedule(filename),
    ),
  );
  const sdkSource = join(projectRoot, "packages", "plugin-sdk", "src");
  watchers.push(
    watch(sdkSource, { recursive: true }, (_event, filename) =>
      schedule(filename),
    ),
  );
  const stop = () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`Watching ${pluginId}. Press Ctrl+C to stop.`);
  await new Promise(() => {});
}
