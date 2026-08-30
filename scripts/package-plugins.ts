import {
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "tar";
import {
  parsePluginManifest,
  type PluginCatalogEntry,
} from "@denote/plugin-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsRoot = join(root, "packages", "plugins");
const artifactsRoot = join(root, "plugin-artifacts");
const catalogPath = join(pluginsRoot, "catalog.json");
const checkOnly = process.argv.includes("--check");
const artifactRef =
  process.env.DENOTE_PLUGIN_ARTIFACT_REF ??
  "cp-desktop-plugin-ecosystem-foundation";
const pluginDirectories = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(pluginsRoot, entry.name))
  .sort();
const catalog = JSON.parse(
  readFileSync(catalogPath, "utf8"),
) as PluginCatalogEntry[];
const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-artifacts-"));

try {
  mkdirSync(artifactsRoot, { recursive: true });
  for (const pluginDirectory of pluginDirectories) {
    const manifest = parsePluginManifest(
      JSON.parse(readFileSync(join(pluginDirectory, "plugin.json"), "utf8")) as unknown,
    );
    const artifactName = `${manifest.id}-${manifest.version}.tgz`;
    const temporaryArtifact = join(temporaryRoot, artifactName);
    await create(
      {
        cwd: pluginDirectory,
        file: temporaryArtifact,
        gzip: true,
        portable: true,
        noMtime: true,
        follow: false,
      },
      ["dist", "plugin.json", "guide.md", "icon.svg", "package.json"],
    );
    const bytes = readFileSync(temporaryArtifact);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const sizeBytes = statSync(temporaryArtifact).size;
    const committedArtifact = join(artifactsRoot, artifactName);
    const entry = catalog.find(
      (candidate) => candidate.manifest.id === manifest.id,
    );
    if (!entry) {
      throw new Error(`Catalog is missing ${manifest.id}.`);
    }

    if (checkOnly) {
      const committed = readFileSync(committedArtifact);
      if (!committed.equals(bytes)) {
        throw new Error(
          `${artifactName} is stale. Run npm run package:plugins.`,
        );
      }
      if (
        entry.artifact.sha256 !== sha256 ||
        entry.artifact.sizeBytes !== sizeBytes
      ) {
        throw new Error(
          `Catalog integrity metadata is stale for ${manifest.id}.`,
        );
      }
    } else {
      writeFileSync(committedArtifact, bytes);
      entry.artifact = {
        url: `https://raw.githubusercontent.com/mbianchidev/denote/${artifactRef}/plugin-artifacts/${artifactName}`,
        sha256,
        sizeBytes,
      };
      console.log(`Packaged ${manifest.id}@${manifest.version}.`);
    }
  }
  if (!checkOnly) {
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
