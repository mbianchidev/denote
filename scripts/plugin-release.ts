import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { list } from "tar";
import { API } from "typescript/unstable/sync";
import {
  assertValidPluginCatalogEntry, type PluginCatalogEntry, type PluginManifest,
} from "@denote/plugin-sdk";
import { pluginPackagePaths, readPluginGuide, writePluginArchive } from "./plugin-archive";
import { verifyRemoteArtifact } from "./plugin-downloads.mjs";

const REPOSITORY = "https://github.com/mbianchidev/denote";
const MAX_BYTES = 25 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface PluginRelease {
  version: string;
  sourceCommit: string;
  kind: "historical" | "source";
  sourcePath?: string;
  artifact: PluginCatalogEntry["artifact"];
}

export function artifactName(manifest: Pick<PluginManifest, "id" | "version">): string {
  return `${manifest.id}-${manifest.version}.tgz`;
}

export function releaseUrl(manifest: PluginManifest, tag: string): string {
  if (!RELEASE_TAG.test(tag)) throw new Error("Release tag must be v followed by a semantic version.");
  return `${REPOSITORY}/releases/download/${tag}/${artifactName(manifest)}`;
}

export function readCatalog(root: string): PluginCatalogEntry[] {
  const value: unknown = JSON.parse(readFileSync(join(root, "plugins/catalog.json"), "utf8"));
  if (!Array.isArray(value)) throw new Error("Plugin catalog must be an array.");
  const ids = new Set<string>();
  for (const entry of value) {
    assertValidPluginCatalogEntry(entry);
    if (ids.has(entry.manifest.id)) throw new Error(`Duplicate catalog ID ${entry.manifest.id}.`);
    ids.add(entry.manifest.id);
  }
  return value;
}

export function readReleases(directory: string, manifest: PluginManifest): PluginRelease[] {
  const path = join(directory, "releases.json");
  if (!existsSync(path)) return [];
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value)) throw new Error(`${path} must contain an array.`);
  const versions = new Set<string>();
  for (const release of value) {
    if (
      !release || typeof release !== "object" ||
      typeof release.version !== "string" || !RELEASE_TAG.test(`v${release.version}`) ||
      !SHA.test(release.sourceCommit) ||
      !["historical", "source"].includes(release.kind) ||
      (release.kind === "source" && (typeof release.sourcePath !== "string" || !/^plugins\/[a-z0-9-]+$/.test(release.sourcePath))) ||
      !release.artifact || !DIGEST.test(release.artifact.sha256) ||
      !Number.isSafeInteger(release.artifact.sizeBytes) ||
      release.artifact.sizeBytes < 1 || release.artifact.sizeBytes > MAX_BYTES ||
      typeof release.artifact.url !== "string"
    ) throw new Error(`Invalid release ledger entry for ${manifest.id}.`);
    const name = artifactName({ id: manifest.id, version: release.version });
    const raw = `https://raw.githubusercontent.com/mbianchidev/denote/${release.sourceCommit}/plugin-artifacts/${name}`;
    const prefix = `${REPOSITORY}/releases/download/`;
    const parts = release.artifact.url.startsWith(prefix)
      ? release.artifact.url.slice(prefix.length).split("/") : [];
    const validRelease = parts.length === 2 && RELEASE_TAG.test(parts[0]) && parts[1] === name;
    if (!(release.kind === "historical" && release.artifact.url === raw) && !validRelease) {
      throw new Error(`Release ledger URL is not an immutable origin for ${name}.`);
    }
    if (versions.has(release.version)) throw new Error(`Duplicate release version for ${manifest.id}.`);
    versions.add(release.version);
  }
  return value;
}

export function verifyBytes(bytes: Uint8Array, artifact: PluginCatalogEntry["artifact"]): void {
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("Plugin artifact bytes do not match the pinned size and SHA-256: package size limit exceeded.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength !== artifact.sizeBytes ||
    digest !== artifact.sha256
  ) throw new Error(
    `Plugin artifact bytes do not match the pinned size and SHA-256. ` +
    `Expected ${artifact.sizeBytes} bytes / ${artifact.sha256}; got ${bytes.byteLength} bytes / ${digest}.`,
  );
}

export async function downloadArtifact(
  artifact: PluginCatalogEntry["artifact"],
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  return verifyRemoteArtifact(artifact.url, "plugin", artifact.sizeBytes, artifact.sha256, fetcher);
}

export function writeAtomic(path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function acquirePinLock(root: string): () => void {
  const staging = join(root, ".plugin-artifacts");
  mkdirSync(staging, { recursive: true });
  const path = join(staging, "pin.lock");
  try {
    writeFileSync(path, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another pin is active or interrupted. Check the PID in .plugin-artifacts/pin.lock; remove that file only after confirming no pin is running.");
    }
    throw error;
  }
  return () => rmSync(path);
}

export function verifySourceCommit(
  root: string, directory: string, sourceCommit: string, tooling = false,
  sourcePath = relative(root, directory).split(sep).join("/"),
): void {
  if (!SHA.test(sourceCommit)) throw new Error("Source provenance requires a full commit SHA.");
  const git = (args: string[]) => execFileSync("git", args, {
    cwd: root, maxBuffer: MAX_BYTES, stdio: ["ignore", "pipe", "pipe"],
  });
  git(["cat-file", "-e", `${sourceCommit}^{commit}`]);
  try {
    git(["merge-base", "--is-ancestor", sourceCommit, "HEAD"]);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 1) {
      throw new Error("Source commit must be reachable from HEAD so it travels with the pushed branch.");
    }
    throw error;
  }
  const inputs = sourceFiles(directory).filter((path) => !relative(directory, path).startsWith(`tests${sep}`));
  if (tooling) {
    inputs.push(...sourceFiles(join(root, "packages/plugin-sdk")));
    inputs.push(...[
      "package.json", "package-lock.json", "tsconfig.json", "tsconfig.node.json",
      "plugins/tsconfig.json", "scripts/plugin-build.ts", "scripts/plugin-archive.ts",
    ].map((path) => join(root, path)));
    inputs.push(...compilerConfigurationInputs(root, inputs));
  }
  for (const path of inputs) {
    const relativePath = path.startsWith(`${directory}${sep}`)
      ? `${sourcePath}/${relative(directory, path).split(sep).join("/")}`
      : relative(root, path).split(sep).join("/");
    const committed = git(["show", `${sourceCommit}:${relativePath}`]);
    const current = readFileSync(path);
    const text = /\.(?:[cm]?[jt]sx?|json|md|svg|css)$/.test(path);
    if (!(text
      ? committed.toString("utf8").replace(/\r\n/g, "\n") === current.toString("utf8").replace(/\r\n/g, "\n")
      : committed.equals(current))) {
      throw new Error(`Source ${relativePath} differs from ${sourceCommit}. Commit source before pinning.`);
    }
  }
  // Deleted source is just as significant as an edited or untracked source file.
  const trees = [{ path: sourcePath, directory }];
  if (tooling) trees.push({ path: "packages/plugin-sdk", directory: join(root, "packages/plugin-sdk") });
  for (const tree of trees) {
    const committedFiles = git(["ls-tree", "-r", "--name-only", sourceCommit, "--", tree.path])
      .toString("utf8").trim().split("\n");
    for (const path of committedFiles) {
      const child = path.slice(tree.path.length + 1);
      if (!path || child === "releases.json" || child.startsWith("tests/")) continue;
      if (!existsSync(join(tree.directory, child))) {
        throw new Error(`Source ${path} from ${sourceCommit} is missing.`);
      }
    }
  }
}

function compilerConfigurationInputs(root: string, inputs: string[]): string[] {
  const configurations = new Set<string>();
  const consumed = new Set<string>();
  const inside = (path: string) => {
    const child = relative(root, path);
    return !isAbsolute(child) && !child.startsWith(`..${sep}`) && child !== "..";
  };
  for (const input of inputs) {
    let directory = dirname(input);
    while (inside(directory)) {
      const path = join(directory, "tsconfig.json");
      if (existsSync(path)) {
        configurations.add(path);
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (/[/\\]tsconfig(?:\.[^/\\]+)?\.json$/.test(input)) configurations.add(input);
  }
  const outside = new Set<string>();
  const compiler = new API({
    cwd: root,
    fs: {
      readFile(path) {
        if (!inside(path)) {
          outside.add(path);
          return null;
        }
        if (!path.replaceAll("\\", "/").includes("/node_modules/") && existsSync(path)) consumed.add(path);
        return undefined;
      },
    },
  });
  try {
    for (const path of configurations) compiler.parseConfigFile(path);
  } finally {
    compiler.close();
  }
  if (outside.size) throw new Error(`Compiler configuration is outside the repository: ${[...outside].join(", ")}`);
  return [...consumed];
}

function sourceFiles(directory: string, packageRoot = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const metadata = entry.name === "releases.json" ||
      /^releases\.json\.[0-9a-f-]{36}\.tmp$/.test(entry.name);
    if (entry.name === "node_modules" || (directory === packageRoot && (entry.name === "dist" || metadata))) return [];
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Plugin build inputs cannot be symbolic links: ${path}`);
    return entry.isDirectory() ? sourceFiles(path, packageRoot) : [path];
  });
}

export async function verifyArchiveContents(path: string, directory: string, manifest: PluginManifest): Promise<void> {
  const expected = new Set(pluginPackagePaths(manifest));
  const seen = new Set<string>();
  const contents = new Map<string, Buffer>();
  let expanded = 0;
  let failure: Error | undefined;
  await list({
    file: path,
    strict: true,
    onReadEntry(entry) {
      if (entry.type !== "File" || !expected.has(entry.path) || seen.has(entry.path)) {
        failure ??= new Error(`Plugin archive has an unexpected, duplicate, or unsafe entry: ${entry.path}`);
      }
      seen.add(entry.path);
      expanded += entry.size;
      if (expanded > MAX_BYTES || (entry.path === manifest.entrypoint && entry.size > 5 * 1024 * 1024)) {
        failure ??= new Error("Plugin archive exceeds expanded size limits.");
      }
      const chunks: Buffer[] = [];
      let length = 0;
      entry.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_BYTES) failure ??= new Error("Plugin archive entry exceeds size limits.");
        if (!failure) chunks.push(chunk);
      });
      entry.on("end", () => { if (!failure) contents.set(entry.path, Buffer.concat(chunks)); });
    },
  });
  if (failure) throw failure;
  for (const name of expected) {
    const packaged = contents.get(name);
    const currentPath = join(directory, name);
    if (!packaged || !lstatSync(currentPath).isFile()) throw new Error(`Plugin archive is missing ${name}.`);
    const current = readFileSync(currentPath);
    const normalize = (bytes: Buffer) => bytes.toString("utf8").replace(/\r\n/g, "\n");
    if (!(name.endsWith(".svg") || /\.(?:js|json|md)$/.test(name)
      ? normalize(packaged) === normalize(current) : packaged.equals(current))) {
      throw new Error(`${manifest.id}@${manifest.version} changed ${name}. Bump this plugin's version.`);
    }
  }
}

export async function stageRelease(
  root: string, directory: string, entry: PluginCatalogEntry,
): Promise<string> {
  const release = readReleases(directory, entry.manifest).find((item) => item.version === entry.manifest.version);
  if (!release ||
    release.sourceCommit !== entry.provenance.sourceCommit ||
    release.artifact.sha256 !== entry.artifact.sha256 ||
    release.artifact.sizeBytes !== entry.artifact.sizeBytes
  ) throw new Error(`Missing or mismatched immutable release ledger for ${entry.manifest.id}.`);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "denote-plugin-stage-"));
  const temporary = join(temporaryRoot, artifactName(entry.manifest));
  const destination = join(root, ".plugin-artifacts", artifactName(entry.manifest));
  try {
    let bytes: Buffer;
    if (release.kind === "historical") {
      bytes = existsSync(destination)
        ? readFileSync(destination) : await downloadArtifact(release.artifact);
      verifyBytes(bytes, release.artifact);
      writeFileSync(temporary, bytes);
    } else {
      verifySourceCommit(root, directory, release.sourceCommit, false, release.sourcePath);
      bytes = (await writePluginArchive(directory, entry.manifest, temporary)).bytes;
      verifyBytes(bytes, release.artifact);
    }
    await verifyArchiveContents(temporary, directory, entry.manifest);
    if (process.env.DENOTE_VERIFY_REMOTE_PLUGIN_ARTIFACTS === "1") {
      await downloadArtifact(entry.artifact);
    }
    writeAtomic(destination, bytes);
    return destination;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function catalogEntry(
  directory: string, manifest: PluginManifest, release: PluginRelease,
): PluginCatalogEntry {
  return {
    manifest, artifact: release.artifact,
    provenance: { publisherId: "denote", sourceCommit: release.sourceCommit, trusted: true },
    guide: readPluginGuide(directory, manifest),
  };
}
