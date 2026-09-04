import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
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
  await create(
    {
      cwd: pluginDirectory,
      file: destination,
      gzip: true,
      portable: true,
      noMtime: true,
      follow: false,
    },
    pluginPackagePaths(manifest),
  );
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
