import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const allowedHosts = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export async function verifyRemoteArtifact(
  initialUrl,
  pluginId,
  expectedSize,
  expectedSha256,
  fetcher = fetch,
) {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > 25 * 1024 * 1024 ||
    !/^[0-9a-f]{64}$/.test(expectedSha256)
  ) {
    throw new Error(`Invalid pinned artifact integrity metadata for ${pluginId}.`);
  }
  let url = initialUrl;
  const signal = AbortSignal.timeout(30_000);
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
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 4) {
        throw new Error(`Pinned artifact redirect limit exceeded for ${pluginId}.`);
      }
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Pinned artifact is unavailable for ${pluginId} at ${initialUrl}: HTTP ${response.status}.`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`Pinned artifact has no response body for ${pluginId}.`);
    }
    const remoteHash = createHash("sha256");
    const chunks = [];
    let remoteBytes = 0;
    try {
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
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (
      remoteBytes !== expectedSize ||
      remoteHash.digest("hex") !== expectedSha256
    ) {
      throw new Error(
        `Pinned artifact bytes do not match catalog metadata for ${pluginId}.`,
      );
    }
    return Buffer.concat(chunks);
  }
  throw new Error(`Pinned artifact redirect limit exceeded for ${pluginId}.`);
}

export async function verifyPluginDownloads(catalog) {
  const failures = [];
  for (const entry of catalog) {
    const { manifest, artifact, provenance } = entry;
    try {
      if (!/^[0-9a-f]{40}$/.test(provenance.sourceCommit)) {
        throw new Error(`${manifest.id} requires a 40-character source commit.`);
      }
      await verifyRemoteArtifact(artifact.url, manifest.id, artifact.sizeBytes, artifact.sha256);
    } catch (error) {
      failures.push(`${manifest.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Plugin download verification failed:\n${failures.join("\n")}`);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--source")) {
      throw new Error("Usage: npm run check:plugin-downloads -- [--source]");
    }
    const root = fileURLToPath(new URL("..", import.meta.url));
    if (args.includes("--source")) {
      for (const script of ["build-plugins.ts", "package-plugins.ts"]) {
        execFileSync(process.execPath, ["--import", "tsx", join(root, "scripts", script)], {
          cwd: root, stdio: "inherit",
        });
      }
      console.log("Verified immutable plugin source recipes and historical origins.");
    } else {
      const catalog = JSON.parse(
        readFileSync(new URL("../plugins/catalog.json", import.meta.url), "utf8"),
      );
      await verifyPluginDownloads(catalog);
      console.log(`Verified ${catalog.length} published plugin archive(s).`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
