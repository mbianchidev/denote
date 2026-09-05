import type { PluginCatalogEntry, PluginManifest } from "@denote/plugin-sdk";

export function pluginSdkSourceCommit(
  manifest: PluginManifest,
  catalog: PluginCatalogEntry[],
): string | null {
  const entry = catalog.find(
    (candidate) => candidate.manifest.id === manifest.id &&
      candidate.manifest.version === manifest.version,
  );
  return entry?.provenance.sourceCommit ?? null;
}

export function pluginSdkModulePath(sdkRoot: string, moduleId: string): string | null {
  const root = sdkRoot.replace(/\\/g, "/");
  const modulePath = moduleId.split("?")[0].replace(/\\/g, "/");
  if (!modulePath.startsWith(`${root}/`)) {
    return null;
  }
  const path = modulePath.slice(root.length + 1);
  if (path.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid pinned SDK module path.");
  }
  return `packages/plugin-sdk/${path}`;
}
