import type {
  PluginStructuredViewerFormat,
} from "@denote/plugin-sdk";
import type { PluginStructuredViewerContribution } from "./workerRuntime";

export interface StructuredViewerMatch {
  viewer: PluginStructuredViewerContribution;
  format: PluginStructuredViewerFormat;
}

export function structuredViewerForPath(
  viewers: PluginStructuredViewerContribution[],
  path: string,
): StructuredViewerMatch | null {
  const parts = path.split("/");
  const basename = parts[parts.length - 1] ?? path;
  const dot = basename.lastIndexOf(".");
  if (dot < 0 || dot === basename.length - 1) {
    return null;
  }
  const extension = basename.slice(dot + 1).toLowerCase();
  const viewer = viewers.find((candidate) =>
    candidate.extensions.includes(extension),
  );
  if (!viewer) {
    return null;
  }
  return {
    viewer,
    format: extension === "json" ? "json" : "yaml",
  };
}
