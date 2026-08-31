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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create, extract, list } from "tar";
import {
  parsePluginManifest,
  type PluginCatalogEntry,
} from "@denote/plugin-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsRoot = join(root, "packages", "plugins");
const artifactsRoot = join(root, "plugin-artifacts");
const catalogPath = join(pluginsRoot, "catalog.json");
const checkOnly = process.argv.includes("--check");
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRYPOINT_BYTES = 5 * 1024 * 1024;
const artifactRef = process.env.DENOTE_PLUGIN_ARTIFACT_REF;
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
    const packagePaths = [
      manifest.entrypoint,
      manifest.documentation,
      manifest.icon,
      "plugin.json",
      "package.json",
    ];
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
      if (sizeBytes > MAX_PACKAGE_BYTES) {
        throw new Error(`${artifactName} exceeds the package size limit.`);
      }
      if (
        entry.artifact.sha256 !== sha256 ||
        entry.artifact.sizeBytes !== sizeBytes
      ) {
        throw new Error(
          `Catalog integrity metadata is stale for ${manifest.id}.`,
        );
      }
      if (process.env.DENOTE_SKIP_REMOTE_ARTIFACT_CHECK !== "1") {
        const response = await fetch(entry.artifact.url, {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok || response.url !== entry.artifact.url) {
          throw new Error(
            `Pinned artifact is unavailable for ${manifest.id}: HTTP ${response.status}.`,
          );
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error(`Pinned artifact has no response body for ${manifest.id}.`);
        }
        const remoteHash = createHash("sha256");
        let remoteBytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          remoteBytes += chunk.value.byteLength;
          if (remoteBytes > sizeBytes) {
            await reader.cancel();
            throw new Error(`Pinned artifact is larger than catalog metadata for ${manifest.id}.`);
          }
          remoteHash.update(chunk.value);
        }
        if (remoteBytes !== sizeBytes || remoteHash.digest("hex") !== sha256) {
          throw new Error(
            `Pinned artifact bytes do not match catalog metadata for ${manifest.id}.`,
          );
        }
      }
      let expandedBytes = 0;
      await list({
        file: committedArtifact,
        strict: true,
        onentry(entry) {
          if (
            entry.path.startsWith("/") ||
            entry.path.split("/").some((part) => part === ".." || part === "")
          ) {
            throw new Error(`${artifactName} contains unsafe path ${entry.path}.`);
          }
          if (entry.type !== "File" && entry.type !== "Directory") {
            throw new Error(
              `${artifactName} contains unsupported ${entry.type} entry ${entry.path}.`,
            );
          }
          expandedBytes += entry.size;
          if (expandedBytes > MAX_PACKAGE_BYTES) {
            throw new Error(`${artifactName} exceeds the expanded size limit.`);
          }
          if (entry.path === manifest.entrypoint && entry.size > MAX_ENTRYPOINT_BYTES) {
            throw new Error(`${artifactName} entrypoint exceeds the size limit.`);
          }
        },
      });
      const extracted = join(temporaryRoot, manifest.id);
      mkdirSync(extracted);
      await extract({
        cwd: extracted,
        file: committedArtifact,
        strict: true,
      });
      for (const path of packagePaths) {
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
        packagePaths,
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
        url: artifactRef
          ? `https://raw.githubusercontent.com/mbianchidev/denote/${artifactRef}/plugin-artifacts/${artifactName}`
          : retainedArtifactUrl(entry.artifact.url, artifactName, sha256),
        sha256,
        sizeBytes,
      };
      if (artifactRef) {
        entry.provenance = {
          publisherId: "denote",
          sourceCommit: artifactRef,
          trusted: true,
        };
      }
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

function retainedArtifactUrl(
  current: string,
  artifactName: string,
  expectedSha256: string,
): string {
  const match = current.match(
    /^https:\/\/raw\.githubusercontent\.com\/mbianchidev\/denote\/([0-9a-f]{40})\/plugin-artifacts\/([^/]+)$/,
  );
  if (!match || match[2] !== artifactName) {
    throw new Error(
      `Set DENOTE_PLUGIN_ARTIFACT_REF to the commit containing ${artifactName}.`,
    );
  }
  let pinnedArtifact: Buffer;
  try {
    pinnedArtifact = execFileSync(
      "git",
      ["show", `${match[1]}:plugin-artifacts/${artifactName}`],
      { cwd: root, maxBuffer: MAX_PACKAGE_BYTES + 1 },
    );
  } catch {
    throw new Error(
      `Unable to read ${artifactName} from pinned commit ${match[1]}.`,
    );
  }
  const pinnedSha256 = createHash("sha256")
    .update(pinnedArtifact)
    .digest("hex");
  if (pinnedSha256 !== expectedSha256) {
    throw new Error(
      `${artifactName} changed. Commit the artifact, then rerun with DENOTE_PLUGIN_ARTIFACT_REF set to that commit.`,
    );
  }
  return current;
}
