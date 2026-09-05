import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@denote/plugin-sdk";
import { writePluginArchive } from "./plugin-archive";
import {
  acquirePinLock, artifactName, catalogEntry, downloadArtifact, readReleases, releaseUrl, stageRelease,
  verifyArchiveContents, verifyBytes, verifySourceCommit, type PluginRelease,
} from "./plugin-release";

vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.unstubAllGlobals();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "denote-plugin-release-"));
  roots.push(root);
  const directory = join(root, "plugins/synthetic");
  mkdirSync(join(directory, "src"), { recursive: true });
  mkdirSync(join(directory, "dist"));
  const manifest: PluginManifest = {
    schemaVersion: 1, id: "synthetic.plugin", name: "Synthetic plugin", version: "1.0.0",
    description: "Synthetic fixture.", publisher: { name: "Denote", url: "https://github.com/mbianchidev/denote" },
    license: "MIT", repository: "https://github.com/mbianchidev/denote", icon: "icon.svg", category: "other",
    compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.0", maximumDenoteVersion: "1.0.0" },
    permissions: [], entrypoint: "dist/index.js", documentation: "guide.md",
  };
  writeFileSync(join(directory, "src/index.ts"), "export default {};\n");
  writeFileSync(join(directory, "dist/index.js"), "export default {};\n");
  writeFileSync(join(directory, "plugin.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "package.json"), '{"private":true,"version":"1.0.0"}');
  writeFileSync(join(directory, "guide.md"), "# Synthetic guide\n");
  writeFileSync(join(directory, "icon.svg"), "<svg/>");
  mkdirSync(join(root, "packages/plugin-sdk/src"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "packages/plugin-sdk/src/index.ts"), "export {};\n");
  writeFileSync(join(root, "scripts/plugin-build.ts"), "export {};\n");
  writeFileSync(join(root, "scripts/plugin-archive.ts"), "export {};\n");
  writeFileSync(join(root, "package.json"), '{"private":true}');
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
  writeFileSync(join(root, "tsconfig.json"), '{"extends":"./config/compiler-base.json"}');
  writeFileSync(join(root, "tsconfig.node.json"), '{"compilerOptions":{}}');
  writeFileSync(join(root, "plugins/tsconfig.json"), '{"extends":"../tsconfig.json"}');
  writeFileSync(join(root, "config/compiler-base.json"), '{"compilerOptions":{"target":"ES2022"}}');
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Synthetic Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgSign", "false");
  writeFileSync(join(root, ".gitignore"), "dist/\n*.tgz\n");
  git("add", ".");
  git("commit", "--no-gpg-sign", "-qm", "Synthetic source only");
  return { root, directory, manifest, git, sourceCommit: git("rev-parse", "HEAD") };
}

describe("release-only plugin packages", () => {
  it("serializes catalog pins and surfaces interrupted lock recovery", () => {
    const { root } = fixture();
    const unlock = acquirePinLock(root);
    expect(() => acquirePinLock(root)).toThrow("Another pin is active or interrupted");
    unlock();
    acquirePinLock(root)();
  });

  it("reproduces and stages a pending release from source without any archive in its commit", async () => {
    const { root, directory, manifest, git, sourceCommit } = fixture();
    const archive = await writePluginArchive(directory, manifest, join(root, "first.tgz"));
    const second = await writePluginArchive(directory, manifest, join(root, "second.tgz"));
    expect(second.bytes).toEqual(archive.bytes);
    const release: PluginRelease = {
      version: manifest.version, sourceCommit, kind: "source", sourcePath: "plugins/synthetic",
      artifact: { url: releaseUrl(manifest, "v2.0.0"), sha256: archive.sha256, sizeBytes: archive.sizeBytes },
    };
    writeFileSync(join(directory, "releases.json"), JSON.stringify([release]));
    expect(git("ls-tree", "-r", "--name-only", sourceCommit)).not.toContain(".tgz");
    const path = await stageRelease(root, directory, catalogEntry(directory, manifest, release));
    expect(path).toBe(join(root, ".plugin-artifacts", artifactName(manifest)));
    expect(readFileSync(path)).toEqual(archive.bytes);
  });

  it("normalizes checkout line endings for deterministic archives", async () => {
    const { root, directory, manifest } = fixture();
    const first = await writePluginArchive(directory, manifest, join(root, "lf.tgz"));
    writeFileSync(join(directory, "guide.md"), "# Synthetic guide\r\n");
    writeFileSync(join(directory, "dist/index.js"), "export default {};\r\n");
    const second = await writePluginArchive(directory, manifest, join(root, "crlf.tgz"));
    expect(second.bytes).toEqual(first.bytes);
  });

  it("normalizes archive file modes independently of the caller's umask", async () => {
    const { root, directory, manifest } = fixture();
    const first = await writePluginArchive(directory, manifest, join(root, "normal.tgz"));
    const restricted = join(root, "restricted.tgz");
    execFileSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "-e",
      `import { readFileSync } from "node:fs";
       import { writePluginArchive } from ${JSON.stringify(pathToFileURL(resolve("scripts/plugin-archive.ts")).href)};
       process.umask(0o077);
       await writePluginArchive(process.argv[1], JSON.parse(readFileSync(process.argv[1] + "/plugin.json", "utf8")), process.argv[2]);`,
      directory, restricted,
    ]);
    expect(readFileSync(restricted)).toEqual(first.bytes);
  });

  it.each(["tsconfig.json", "plugins/tsconfig.json", "config/compiler-base.json"])(
    "binds compiler configuration %s to the source commit",
    (path) => {
      const { root, directory, sourceCommit } = fixture();
      expect(() => verifySourceCommit(root, directory, sourceCommit, true)).not.toThrow();
      writeFileSync(join(root, path), '{"compilerOptions":{"useDefineForClassFields":false}}');
      expect(() => verifySourceCommit(root, directory, sourceCommit, true)).toThrow("differs");
    },
  );

  it("rejects removed compiler configurations instead of pinning default compiler behavior", () => {
    const { root, directory, sourceCommit } = fixture();
    rmSync(join(root, "tsconfig.json"));
    rmSync(join(root, "plugins/tsconfig.json"));
    expect(() => verifySourceCommit(root, directory, sourceCommit, true)).toThrow();
  });

  it("requires source commits to travel with the branch rather than exist only locally", () => {
    const { root, directory, git } = fixture();
    const sourceCommit = git("commit-tree", "--no-gpg-sign", git("write-tree"), "-m", "Synthetic detached source");
    expect(() => verifySourceCommit(root, directory, sourceCommit)).toThrow("reachable from HEAD");
  });

  it("ignores interrupted metadata staging, but verifies similarly named source data", () => {
    const { root, directory, sourceCommit } = fixture();
    writeFileSync(join(directory, "releases.json.00000000-0000-4000-8000-000000000000.tmp"), "partial metadata");
    expect(() => verifySourceCommit(root, directory, sourceCommit)).not.toThrow();
    writeFileSync(join(directory, "src/releases.json"), '{"synthetic":true}');
    expect(() => verifySourceCommit(root, directory, sourceCommit)).toThrow();
  });

  it("rejects modified, extra, or missing committed source before provenance pinning", () => {
    const { root, directory, sourceCommit } = fixture();
    expect(() => verifySourceCommit(root, directory, sourceCommit)).not.toThrow();
    writeFileSync(join(directory, "src/index.ts"), "export default { changed: true };\n");
    expect(() => verifySourceCommit(root, directory, sourceCommit)).toThrow("differs");
    rmSync(join(directory, "src/index.ts"));
    expect(() => verifySourceCommit(root, directory, sourceCommit)).toThrow("missing");
  });

  it("rejects uncommitted source additions rather than attributing them to an older commit", () => {
    const { root, directory, sourceCommit } = fixture();
    writeFileSync(join(directory, "src/addition.ts"), "export const value = 1;\n");
    expect(() => verifySourceCommit(root, directory, sourceCommit)).toThrow();
  });

  it("retains exact historical bytes from one explicitly pinned immutable origin", async () => {
    const { root, directory, manifest, sourceCommit } = fixture();
    const archive = await writePluginArchive(directory, manifest, join(root, "historic.tgz"));
    const release: PluginRelease = {
      version: manifest.version, sourceCommit, kind: "historical",
      artifact: {
        url: `https://raw.githubusercontent.com/mbianchidev/denote/${sourceCommit}/plugin-artifacts/${artifactName(manifest)}`,
        sha256: archive.sha256, sizeBytes: archive.sizeBytes,
      },
    };
    writeFileSync(join(directory, "releases.json"), JSON.stringify([release]));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(archive.bytes)));
    vi.stubGlobal("fetch", fetcher);
    const entry = catalogEntry(directory, manifest, release);
    entry.artifact = { ...entry.artifact, url: releaseUrl(manifest, "v2.0.0") };
    const path = await stageRelease(root, directory, entry);
    expect(readFileSync(path)).toEqual(archive.bytes);
    expect(fetcher.mock.calls[0][0]).toBe(release.artifact.url);
  });

  it("rejects unsafe entries without extracting any archive content", async () => {
    const { root, directory, manifest } = fixture();
    writeFileSync(join(directory, "unexpected.txt"), "mock");
    const path = join(root, "unexpected.tgz");
    await create({ cwd: directory, file: path, gzip: true }, ["unexpected.txt"]);
    await expect(verifyArchiveContents(path, directory, manifest)).rejects.toThrow("unsafe entry");
  });

  it("refuses stale same-version content and leaves existing staged bytes untouched", async () => {
    const { root, directory, manifest, sourceCommit } = fixture();
    const archive = await writePluginArchive(directory, manifest, join(root, "original.tgz"));
    const release: PluginRelease = {
      version: manifest.version, sourceCommit, kind: "source", sourcePath: "plugins/synthetic",
      artifact: { url: releaseUrl(manifest, "v2.0.0"), sha256: archive.sha256, sizeBytes: archive.sizeBytes },
    };
    writeFileSync(join(directory, "releases.json"), JSON.stringify([release]));
    const entry = catalogEntry(directory, manifest, release);
    const path = await stageRelease(root, directory, entry);
    writeFileSync(join(directory, "dist/index.js"), "export default { changed: true };\n");
    await expect(stageRelease(root, directory, entry)).rejects.toThrow("pinned size and SHA-256");
    expect(readFileSync(path)).toEqual(archive.bytes);
  });

  it("rejects mutable ledger origins and duplicate versions", () => {
    const { directory, manifest, sourceCommit } = fixture();
    const release: PluginRelease = {
      version: manifest.version, sourceCommit, kind: "source", sourcePath: "plugins/synthetic",
      artifact: { url: releaseUrl(manifest, "v2.0.0"), sha256: "a".repeat(64), sizeBytes: 1 },
    };
    writeFileSync(join(directory, "releases.json"), JSON.stringify([release, release]));
    expect(() => readReleases(directory, manifest)).toThrow("Duplicate");
    release.artifact.url = "https://github.com/mbianchidev/denote/releases/latest/download/synthetic.plugin-1.0.0.tgz";
    writeFileSync(join(directory, "releases.json"), JSON.stringify([release]));
    expect(() => readReleases(directory, manifest)).toThrow("immutable origin");
  });
});

describe("bounded integrity-checked downloads", () => {
  const bytes = Buffer.from("synthetic archive");
  const artifact = {
    url: "https://github.com/mbianchidev/denote/releases/download/v1.0.0/synthetic.plugin-1.0.0.tgz",
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length,
  };

  it("rejects corrupt or oversized responses", async () => {
    expect(() => verifyBytes(Buffer.from("wrong"), artifact)).toThrow("pinned");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("too many bytes in this response"));
    await expect(downloadArtifact(artifact, fetcher)).rejects.toThrow("larger than catalog metadata");
  });

  it("does not fallback on missing releases", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    await expect(downloadArtifact(artifact, fetcher)).rejects.toThrow("HTTP 404");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects outside the allowlist", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: "https://untrusted.invalid/mock.tgz" },
    }));
    await expect(downloadArtifact(artifact, fetcher)).rejects.toThrow("host is not allowed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
