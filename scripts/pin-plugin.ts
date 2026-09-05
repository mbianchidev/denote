import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { buildPlugin, pluginDirectories, projectRoot } from "./plugin-build";
import { writePluginArchive } from "./plugin-archive";
import {
  acquirePinLock, artifactName, catalogEntry, readCatalog, readReleases, releaseUrl,
  verifyArchiveContents, verifySourceCommit, writeAtomic, type PluginRelease,
} from "./plugin-release";

const [pluginId, refFlag, sourceCommit, releaseFlag, tag, ...remaining] = process.argv.slice(2);
if (!pluginId || refFlag !== "--ref" || !sourceCommit || releaseFlag !== "--release" || !tag || remaining.length) {
  throw new Error("Usage: npm run pin:plugin -- <plugin-id> --ref <source-commit> --release <vSEMVER>");
}
const [directory] = pluginDirectories(pluginId);
verifySourceCommit(projectRoot, directory, sourceCommit, true);
const manifest = await buildPlugin(directory);
const url = releaseUrl(manifest, tag);
const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-pin-"));
let unlock: (() => void) | undefined;
try {
  unlock = acquirePinLock(projectRoot);
  const releases = readReleases(directory, manifest);
  const previous = releases.find((item) => item.version === manifest.version);
  const catalog = readCatalog(projectRoot);
  const index = catalog.findIndex((entry) => entry.manifest.id === manifest.id);
  const path = join(temporaryRoot, artifactName(manifest));
  const archive = await writePluginArchive(directory, manifest, path);
  await verifyArchiveContents(path, directory, manifest);
  verifySourceCommit(projectRoot, directory, sourceCommit, true);
  const release: PluginRelease = {
    version: manifest.version, sourceCommit, kind: "source",
    sourcePath: relative(projectRoot, directory).split(sep).join("/"),
    artifact: { url, sha256: archive.sha256, sizeBytes: archive.sizeBytes },
  };
  if (previous && JSON.stringify(previous) !== JSON.stringify(release)) {
    throw new Error(`${manifest.id}@${manifest.version} is immutable. Bump the version instead of replacing its bytes or provenance.`);
  }
  if (index >= 0 && catalog[index].manifest.version === manifest.version &&
      catalog[index].artifact.sha256 !== archive.sha256) {
    throw new Error(`${manifest.id}@${manifest.version} already pins different bytes.`);
  }
  if (!previous) releases.push(release);
  const pinned = catalogEntry(directory, manifest, release);
  if (index < 0) catalog.push(pinned); else catalog[index] = pinned;
  writeAtomic(join(projectRoot, ".plugin-artifacts", artifactName(manifest)), archive.bytes);
  // Record the immutable version first. An interrupted catalog update is safely retryable.
  writeAtomic(join(directory, "releases.json"), `${JSON.stringify(releases, null, 2)}\n`);
  writeAtomic(join(projectRoot, "plugins/catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Pinned ${manifest.id}@${manifest.version} from source ${sourceCommit} for ${tag}. No release was published.`);
} finally {
  try {
    rmSync(temporaryRoot, { recursive: true, force: true });
  } finally {
    unlock?.();
  }
}
