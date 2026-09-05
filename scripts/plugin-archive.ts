import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "tar";
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
  try {
    for (const path of pluginPackagePaths(manifest)) {
      const source = join(pluginDirectory, path);
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.size > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error(`Plugin package input must be a bounded regular file: ${path}`);
      }
      const bytes = readFileSync(source);
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      const text = path !== manifest.icon || path.endsWith(".svg");
      writeFileSync(target, text ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes, { mode: 0o644 });
    }
    await create(
      {
        cwd: staging,
        file: destination,
        gzip: true,
        portable: true,
        noMtime: true,
        follow: false,
      },
      pluginPackagePaths(manifest),
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const bytes = readFileSync(destination);
  if (bytes.length > MAX_PLUGIN_PACKAGE_BYTES) {
    throw new Error(
      `${manifest.id}@${manifest.version} exceeds the 25 MB plugin package limit.`,
    );
  }
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: statSync(destination).size,
  };
}

export function readPluginGuide(
  pluginDirectory: string,
  manifest: PluginManifest,
): string {
  return readFileSync(join(pluginDirectory, manifest.documentation), "utf8")
    .replace(/\r\n/g, "\n");
}
