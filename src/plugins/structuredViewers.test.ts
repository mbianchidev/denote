import { describe, expect, it } from "vitest";
import {
  isPluginStructuredViewModel,
  isPluginStructuredViewerRegistration,
  type PluginStructuredViewModel,
} from "@denote/plugin-sdk";

const validModel: PluginStructuredViewModel = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      parentId: null,
      label: "Root",
      type: "object",
      depth: 0,
      childCount: 1,
    },
    {
      id: "root/name",
      parentId: "root",
      label: "name",
      type: "string",
      value: "Denote",
      depth: 1,
      childCount: 0,
    },
  ],
  error: null,
  notices: [],
  truncated: false,
};

describe("structured viewer contract", () => {
  it("accepts one bounded serializable tree with parent-first nodes", () => {
    expect(isPluginStructuredViewModel(validModel)).toBe(true);
    expect(JSON.parse(JSON.stringify(validModel))).toEqual(validModel);
  });

  it.each([
    { ...validModel, rootId: "missing" },
    {
      ...validModel,
      nodes: [
        validModel.nodes[1],
        validModel.nodes[0],
      ],
    },
    {
      ...validModel,
      nodes: [
        validModel.nodes[0],
        { ...validModel.nodes[1], depth: 2 },
      ],
    },
    {
      ...validModel,
      nodes: [
        validModel.nodes[0],
        { ...validModel.nodes[1], value: undefined, type: "string" as const },
      ],
    },
  ])("rejects malformed tree relationships and scalar payloads", (model) => {
    expect(isPluginStructuredViewModel(model)).toBe(false);
  });

  it("accepts a located parse error without a partial tree", () => {
    expect(
      isPluginStructuredViewModel({
        rootId: null,
        nodes: [],
        error: {
          message: "Unexpected token",
          line: 3,
          column: 8,
          code: "PARSE_ERROR",
        },
        notices: [],
        truncated: false,
      }),
    ).toBe(true);
  });

  it("validates normalized, unique JSON and YAML extensions", () => {
    expect(
      isPluginStructuredViewerRegistration({
        id: "denote.json-yaml-viewer.viewer",
        title: "JSON and YAML viewer",
        extensions: ["json", "yaml", "yml"],
      }),
    ).toBe(true);
    expect(
      isPluginStructuredViewerRegistration({
        id: "denote.json-yaml-viewer.viewer",
        title: "JSON and YAML viewer",
        extensions: [".json", "JSON"],
      }),
    ).toBe(false);
  });
});
