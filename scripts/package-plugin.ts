import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlugin, pluginDirectories, projectRoot } from "./plugin-build";
import { writePluginArchive } from "./plugin-archive";
import {
  artifactName, catalogEntry, readReleases, stageRelease, verifyArchiveContents, writeAtomic,
} from "./plugin-release";

const [pluginId, ...remaining] = process.argv.slice(2);
if (!pluginId || remaining.length) throw new Error("Usage: npm run package:plugin -- <plugin-id>");
const [directory] = pluginDirectories(pluginId);
const manifest = await buildPlugin(directory);
const release = readReleases(directory, manifest).find((item) => item.version === manifest.version);
if (release) {
  const path = await stageRelease(projectRoot, directory, catalogEntry(directory, manifest, release));
  console.log(`Retained immutable ${manifest.id}@${manifest.version}: ${path}`);
} else {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-package-"));
  try {
    const path = join(temporaryRoot, artifactName(manifest));
    const archive = await writePluginArchive(directory, manifest, path);
    await verifyArchiveContents(path, directory, manifest);
    const destination = join(projectRoot, ".plugin-artifacts", artifactName(manifest));
    if (existsSync(destination) && !readFileSync(destination).equals(archive.bytes)) {
      throw new Error(`${artifactName(manifest)} already has different staged bytes. Bump the version or remove this unpublished staging file explicitly.`);
    }
    writeAtomic(destination, archive.bytes);
    console.log(`Staged ${destination} (${archive.sizeBytes} bytes, ${archive.sha256}).`);
    console.log(`Commit source only, then npm run pin:plugin -- ${pluginId} --ref <source-sha> --release <vSEMVER>.`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
