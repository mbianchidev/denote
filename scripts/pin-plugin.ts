import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCatalogEntry } from "@denote/plugin-sdk";
import {
  pluginDirectories,
  projectRoot,
  readPluginManifest,
} from "./plugin-build";
import {
  readPluginGuide,
  writePluginArchive,
} from "./plugin-archive";

const args = process.argv.slice(2);
const pluginId = args[0];
const refIndex = args.indexOf("--ref");
const sourceCommit = refIndex >= 0 ? args[refIndex + 1] : undefined;
const remaining = args.filter(
  (_, index) =>
    index !== 0 &&
    index !== refIndex &&
    index !== refIndex + 1,
);
if (
  !pluginId ||
  !sourceCommit ||
  remaining.length > 0 ||
  !/^[0-9a-f]{40}$/.test(sourceCommit)
) {
  throw new Error(
    "Usage: npm run pin:plugin -- <plugin-id> --ref <40-character-commit>",
  );
}

const [pluginDirectory] = pluginDirectories(pluginId);
const manifest = readPluginManifest(pluginDirectory);
const artifactName = `${manifest.id}-${manifest.version}.tgz`;
const artifactPath = join(projectRoot, "plugin-artifacts", artifactName);
const bytes = readFileSync(artifactPath);
const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-pin-"));
try {
  const current = await writePluginArchive(
    pluginDirectory,
    manifest,
    join(temporaryRoot, artifactName),
  );
  if (!bytes.equals(current.bytes)) {
    throw new Error(
      `${artifactName} is stale. Run npm run package:plugin -- ${pluginId}.`,
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
const committed = execFileSync(
  "git",
  ["show", `${sourceCommit}:plugin-artifacts/${artifactName}`],
  { cwd: projectRoot, maxBuffer: 25 * 1024 * 1024 + 1 },
);
if (!bytes.equals(committed)) {
  throw new Error(
    `${artifactName} does not match plugin-artifacts/${artifactName} in ${sourceCommit}.`,
  );
}

const catalogPath = join(projectRoot, "packages", "plugins", "catalog.json");
const catalog = JSON.parse(
  readFileSync(catalogPath, "utf8"),
) as PluginCatalogEntry[];
const pinned: PluginCatalogEntry = {
  manifest,
  artifact: {
    url: `https://raw.githubusercontent.com/mbianchidev/denote/${sourceCommit}/plugin-artifacts/${artifactName}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: statSync(artifactPath).size,
  },
  provenance: {
    publisherId: "denote",
    sourceCommit,
    trusted: true,
  },
  guide: readPluginGuide(pluginDirectory, manifest),
};
const index = catalog.findIndex(
  (candidate) => candidate.manifest.id === pluginId,
);
if (index >= 0) {
  if (
    catalog[index].manifest.version === manifest.version &&
    catalog[index].artifact.sha256 !== pinned.artifact.sha256
  ) {
    throw new Error(
      `${pluginId}@${manifest.version} already pins different artifact bytes. Bump the plugin version.`,
    );
  }
  catalog[index] = pinned;
} else {
  catalog.push(pinned);
}
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Pinned ${manifest.id}@${manifest.version} to ${sourceCommit}.`);
