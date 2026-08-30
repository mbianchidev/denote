import { createHash } from "node:crypto";
import {
  existsSync,
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
import { create, extract } from "tar";
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
    const committedArtifact = join(artifactsRoot, artifactName);
    const entry = catalog.find(
      (candidate) => candidate.manifest.id === manifest.id,
    );
    if (!entry) {
      throw new Error(`Catalog is missing ${manifest.id}.`);
    }

    if (checkOnly) {
      if (!existsSync(committedArtifact)) {
        throw new Error(
          `${artifactName} is missing. Run npm run package:plugins.`,
        );
      }
      const committed = readFileSync(committedArtifact);
      const sha256 = createHash("sha256").update(committed).digest("hex");
      const sizeBytes = statSync(committedArtifact).size;
      if (
        entry.artifact.sha256 !== sha256 ||
        entry.artifact.sizeBytes !== sizeBytes
      ) {
        throw new Error(
          `Catalog integrity metadata is stale for ${manifest.id}.`,
        );
      }
      const extracted = join(temporaryRoot, manifest.id);
      mkdirSync(extracted);
      await extract({
        cwd: extracted,
        file: committedArtifact,
        strict: true,
      });
      for (const path of [
        "dist/index.js",
        "plugin.json",
        "guide.md",
        "icon.svg",
        "package.json",
      ]) {
        const packaged = normalizeText(readFileSync(join(extracted, path), "utf8"));
        const current = normalizeText(
          readFileSync(join(pluginDirectory, path), "utf8"),
        );
        if (packaged !== current) {
          throw new Error(
            `${artifactName} contains stale ${path}. Run npm run package:plugins.`,
          );
        }
      }
    } else {
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
        ["dist/index.js", "plugin.json", "guide.md", "icon.svg", "package.json"],
      );
      const bytes = readFileSync(temporaryArtifact);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const sizeBytes = statSync(temporaryArtifact).size;
      writeFileSync(committedArtifact, bytes);
      entry.manifest = manifest;
      entry.guide = normalizeText(
        readFileSync(join(pluginDirectory, manifest.documentation), "utf8"),
      );
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

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
