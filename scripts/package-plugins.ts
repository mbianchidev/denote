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
import { extract, list } from "tar";
import {
  parsePluginManifest,
  type PluginCatalogEntry,
} from "@denote/plugin-sdk";
import {
  pluginPackagePaths,
  writePluginArchive,
} from "./plugin-archive";

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
let catalogChanged = false;

try {
  mkdirSync(artifactsRoot, { recursive: true });
  for (const pluginDirectory of pluginDirectories) {
    const manifest = parsePluginManifest(
      JSON.parse(readFileSync(join(pluginDirectory, "plugin.json"), "utf8")) as unknown,
    );
    const artifactName = `${manifest.id}-${manifest.version}.tgz`;
    const packagePaths = pluginPackagePaths(manifest);
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
      verifyPinnedArtifact(
        entry.provenance.sourceCommit,
        artifactName,
        sha256,
      );
      if (process.env.DENOTE_VERIFY_REMOTE_PLUGIN_ARTIFACTS === "1") {
        await verifyRemoteArtifact(
          entry.artifact.url,
          manifest.id,
          sizeBytes,
          sha256,
        );
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
    } else if (entry.manifest.version === manifest.version) {
      if (!existsSync(committedArtifact)) {
        throw new Error(
          `${artifactName} is missing. Bump only ${manifest.id}'s version and package it again.`,
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
          `Committed artifact metadata changed for ${manifest.id} without a version bump.`,
        );
      }
      const extracted = join(temporaryRoot, `${manifest.id}-retained`);
      mkdirSync(extracted);
      await extract({
        cwd: extracted,
        file: committedArtifact,
        strict: true,
      });
      for (const path of packagePaths) {
        const packaged = normalizeText(
          readFileSync(join(extracted, path), "utf8"),
        );
        const current = normalizeText(
          readFileSync(join(pluginDirectory, path), "utf8"),
        );
        if (packaged !== current) {
          throw new Error(
            `${manifest.id}@${manifest.version} changed ${path}. Bump only this plugin's version before packaging.`,
          );
        }
      }
      if (
        artifactRef &&
        !pinnedArtifactMatches(
          entry.provenance.sourceCommit,
          artifactName,
          sha256,
        )
      ) {
        verifyPinnedArtifact(artifactRef, artifactName, sha256);
        entry.artifact.url =
          `https://raw.githubusercontent.com/mbianchidev/denote/${artifactRef}/plugin-artifacts/${artifactName}`;
        entry.provenance = {
          publisherId: "denote",
          sourceCommit: artifactRef,
          trusted: true,
        };
        catalogChanged = true;
        console.log(`Repinned ${manifest.id}@${manifest.version}.`);
      }
      console.log(`Retained ${manifest.id}@${manifest.version}.`);
    } else {
      const temporaryArtifact = join(temporaryRoot, artifactName);
      const { bytes, sha256, sizeBytes } = await writePluginArchive(
        pluginDirectory,
        manifest,
        temporaryArtifact,
      );
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
      catalogChanged = true;
      console.log(`Packaged ${manifest.id}@${manifest.version}.`);
    }
  }
  if (!checkOnly && catalogChanged) {
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

async function verifyRemoteArtifact(
  initialUrl: string,
  pluginId: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  const allowedHosts = new Set([
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ]);
  let url = initialUrl;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      !allowedHosts.has(parsed.hostname)
    ) {
      throw new Error(`Pinned artifact host is not allowed for ${pluginId}.`);
    }
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 4) {
        throw new Error(`Pinned artifact redirect limit exceeded for ${pluginId}.`);
      }
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Pinned artifact is unavailable for ${pluginId}: HTTP ${response.status}.`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`Pinned artifact has no response body for ${pluginId}.`);
    }
    const remoteHash = createHash("sha256");
    let remoteBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      remoteBytes += chunk.value.byteLength;
      if (remoteBytes > expectedSize) {
        await reader.cancel();
        throw new Error(`Pinned artifact is larger than catalog metadata for ${pluginId}.`);
      }
      remoteHash.update(chunk.value);
    }
    if (
      remoteBytes !== expectedSize ||
      remoteHash.digest("hex") !== expectedSha256
    ) {
      throw new Error(
        `Pinned artifact bytes do not match catalog metadata for ${pluginId}.`,
      );
    }
    return;
  }
  throw new Error(`Pinned artifact redirect limit exceeded for ${pluginId}.`);
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

function verifyPinnedArtifact(
  sourceCommit: string,
  artifactName: string,
  expectedSha256: string,
): void {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("DENOTE_PLUGIN_ARTIFACT_REF must be a 40-character commit.");
  }

  let pinnedArtifact: Buffer;
  try {
    pinnedArtifact = execFileSync(
      "git",
      ["show", `${sourceCommit}:plugin-artifacts/${artifactName}`],
      { cwd: root, maxBuffer: MAX_PACKAGE_BYTES + 1 },
    );
  } catch {
    throw new Error(
      `Unable to read ${artifactName} from pinned commit ${sourceCommit}.`,
    );
  }
  const pinnedSha256 = createHash("sha256")
    .update(pinnedArtifact)
    .digest("hex");
  if (pinnedSha256 !== expectedSha256) {
    throw new Error(
      `${artifactName} in ${sourceCommit} does not match the committed artifact.`,
    );
  }
}

function pinnedArtifactMatches(
  sourceCommit: string,
  artifactName: string,
  expectedSha256: string,
): boolean {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    return false;
  }
  try {
    const pinnedArtifact = execFileSync(
      "git",
      ["show", `${sourceCommit}:plugin-artifacts/${artifactName}`],
      { cwd: root, maxBuffer: MAX_PACKAGE_BYTES + 1 },
    );
    return (
      createHash("sha256").update(pinnedArtifact).digest("hex") ===
      expectedSha256
    );
  } catch {
    return false;
  }
}
