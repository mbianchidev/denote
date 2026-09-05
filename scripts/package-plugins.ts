import { pluginDirectories, projectRoot, readPluginManifest } from "./plugin-build";
import { readCatalog, stageRelease } from "./plugin-release";

if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: npm run package:plugins -- [--check]");
}
const catalog = readCatalog(projectRoot);
for (const directory of pluginDirectories()) {
  const manifest = readPluginManifest(directory);
  const entry = catalog.find((candidate) => candidate.manifest.id === manifest.id);
  if (!entry || JSON.stringify(entry.manifest) !== JSON.stringify(manifest)) {
    throw new Error(`Pin ${manifest.id}@${manifest.version} before packaging the catalog.`);
  }
  const path = await stageRelease(projectRoot, directory, entry);
  console.log(`Verified ${manifest.id}@${manifest.version}: ${path}`);
}
