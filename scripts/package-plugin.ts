import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCatalogEntry } from "@denote/plugin-sdk";
import { buildPlugin, pluginDirectories, projectRoot } from "./plugin-build";
import { writePluginArchive } from "./plugin-archive";

const [pluginId, ...remaining] = process.argv.slice(2);
if (!pluginId || remaining.length > 0) {
  throw new Error("Usage: npm run package:plugin -- <plugin-id>");
}

const [pluginDirectory] = pluginDirectories(pluginId);
const manifest = await buildPlugin(pluginDirectory);
const destination = join(
  projectRoot,
  "plugin-artifacts",
  `${manifest.id}-${manifest.version}.tgz`,
);
const catalog = JSON.parse(
  readFileSync(
    join(projectRoot, "packages", "plugins", "catalog.json"),
    "utf8",
  ),
) as PluginCatalogEntry[];
const existing = catalog.find(
  (entry) => entry.manifest.id === manifest.id,
);
if (
  existing?.manifest.version === manifest.version &&
  !existsSync(destination)
) {
  throw new Error(
    `${manifest.id}@${manifest.version} is already published in the catalog but its committed artifact is missing. Restore it or bump the plugin version.`,
  );
}
const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-package-"));
const temporaryArtifact = join(temporaryRoot, `${manifest.id}.tgz`);
let archive: Awaited<ReturnType<typeof writePluginArchive>>;
try {
  archive = await writePluginArchive(
    pluginDirectory,
    manifest,
    temporaryArtifact,
  );
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(archive.bytes)) {
      throw new Error(
        `${manifest.id}@${manifest.version} already has different artifact bytes. Bump the plugin version.`,
      );
    }
  } else {
    writeFileSync(destination, archive.bytes);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log(
  `Packaged ${manifest.id}@${manifest.version} at ${destination} (${archive.sizeBytes} bytes, ${archive.sha256}).`,
);
console.log(
  "Commit the source and archive, then run npm run pin:plugin -- " +
    `${manifest.id} --ref "$(git rev-parse HEAD)".`,
);
