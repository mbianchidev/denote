import { describe, expect, it } from "vitest";
import { structuredViewerForPath } from "./structuredViewers";

const viewer = {
  pluginId: "denote.json-yaml-viewer",
  id: "denote.json-yaml-viewer.viewer",
  title: "JSON and YAML viewer",
  extensions: ["json", "yaml", "yml"],
};

describe("structured viewer file routing", () => {
  it.each([
    ["fixtures/data.JSON", "json"],
    ["fixtures/data.yaml", "yaml"],
    ["fixtures/data.yml", "yaml"],
  ] as const)("routes %s to %s", (path, format) => {
    expect(structuredViewerForPath([viewer], path)).toMatchObject({
      viewer,
      format,
    });
  });

  it("does not claim unrelated or extensionless files", () => {
    expect(structuredViewerForPath([viewer], "fixtures/data.toml")).toBeNull();
    expect(structuredViewerForPath([viewer], "fixtures/json")).toBeNull();
  });
});
