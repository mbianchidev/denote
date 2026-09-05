import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "tar";
import { Deflate } from "pako";
import type { PluginManifest } from "@denote/plugin-sdk";

const MAX_PLUGIN_PACKAGE_BYTES = 25 * 1024 * 1024;

export interface PluginArchive {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
}

export function pluginPackagePaths(manifest: PluginManifest): string[] {
  return [
    manifest.entrypoint,
    manifest.documentation,
    manifest.icon,
    "plugin.json",
    "package.json",
  ];
}

export async function writePluginArchive(
  pluginDirectory: string,
  manifest: PluginManifest,
  destination: string,
): Promise<PluginArchive> {
  mkdirSync(dirname(destination), { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), "denote-plugin-archive-"));
  let bytes: Buffer;
  try {
    const inputs = join(staging, "inputs");
    mkdirSync(inputs);
    let expandedBytes = 0;
    for (const path of pluginPackagePaths(manifest)) {
      const source = join(pluginDirectory, path);
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.size > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error(`Plugin package input must be a bounded regular file: ${path}`);
      }
      const bytes = readFileSync(source);
      const target = join(inputs, path);
      mkdirSync(dirname(target), { recursive: true });
      const text = path !== manifest.icon || path.endsWith(".svg");
      const content = text ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
      expandedBytes += content.length;
      if (expandedBytes > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error(`${manifest.id}@${manifest.version} exceeds the 25 MB expanded package limit.`);
      }
      writeFileSync(target, content, { mode: 0o644 });
      chmodSync(target, 0o644);
    }
    const tarPath = join(staging, "package.tar");
    await create(
      {
        cwd: inputs,
        file: tarPath,
        portable: true,
        noMtime: true,
        follow: false,
      },
      pluginPackagePaths(manifest),
    );
    bytes = gzipPluginArchive(readFileSync(tarPath));
    if (bytes.length > MAX_PLUGIN_PACKAGE_BYTES) {
      throw new Error(`${manifest.id}@${manifest.version} exceeds the 25 MB plugin package limit.`);
    }
    writeFileSync(destination, bytes);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
  };
}

export function gzipPluginArchive(bytes: Uint8Array): Buffer {
  // Native zlib variants emit different DEFLATE bytes. Pako 2.1.0 is pinned to
  // retain the established archive format, including the portable gzip header.
  const compressor = new Deflate({
    gzip: true,
    level: 6,
    memLevel: 8,
    windowBits: 15,
    strategy: 0,
    header: { os: 255, time: 0 },
  });
  if (!compressor.push(bytes, true) || compressor.err !== 0) {
    throw new Error(`Plugin archive compression failed: ${compressor.msg}`);
  }
  return Buffer.from(compressor.result);
}

export function readPluginGuide(
  pluginDirectory: string,
  manifest: PluginManifest,
): string {
  return readFileSync(join(pluginDirectory, manifest.documentation), "utf8")
    .replace(/\r\n/g, "\n");
}
