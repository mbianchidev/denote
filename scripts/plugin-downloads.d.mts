import type { PluginCatalogEntry } from "@denote/plugin-sdk";

export function verifyRemoteArtifact(
  initialUrl: string,
  pluginId: string,
  expectedSize: number,
  expectedSha256: string,
  fetcher?: typeof fetch,
): Promise<Buffer>;

export function verifyPluginDownloads(catalog: readonly PluginCatalogEntry[]): Promise<void>;
