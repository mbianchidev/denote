import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURED_PARSE_LIMITS,
  parseStructuredSource,
} from "../src/parser";

describe("JSON and YAML structured parsing", () => {
  it("preserves JSON container and scalar types without changing source", () => {
    const source =
      '{"name":"Denote","count":2,"ready":true,"missing":null,"items":[],"meta":{}}';

    const model = parseStructuredSource({
      path: "fixtures/sample.json",
      format: "json",
      source,
    });

    expect(model.error).toBeNull();
    expect(model.nodes.map(({ label, type, value }) => ({ label, type, value })))
      .toEqual([
        { label: "Root", type: "object", value: undefined },
        { label: "name", type: "string", value: "Denote" },
        { label: "count", type: "number", value: "2" },
        { label: "ready", type: "boolean", value: "true" },
        { label: "missing", type: "null", value: "null" },
        { label: "items", type: "array", value: undefined },
        { label: "meta", type: "object", value: undefined },
      ]);
    expect(source).toBe(
      '{"name":"Denote","count":2,"ready":true,"missing":null,"items":[],"meta":{}}',
    );
  });

  it("uses deterministic last-value behavior for duplicate JSON keys", () => {
    const model = parseStructuredSource({
      path: "fixtures/duplicate.json",
      format: "json",
      source: '{"value":1,"value":2}',
    });

    expect(model.error).toBeNull();
    expect(model.nodes.find((node) => node.label === "value")?.value).toBe("2");
  });

  it("parses YAML mappings, sequences, multi-document streams, anchors and aliases without expanding aliases", () => {
    const source = [
      "---",
      "defaults: &defaults",
      "  enabled: true",
      "copy: *defaults",
      "...",
      "---",
      "- 3",
      "- null",
      "",
    ].join("\r\n");

    const model = parseStructuredSource({
      path: "fixtures/stream.yaml",
      format: "yaml",
      source,
    });

    expect(model.error).toBeNull();
    expect(model.nodes[0]).toMatchObject({
      label: "Documents",
      type: "stream",
      childCount: 2,
    });
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "defaults",
          type: "mapping",
          anchor: "defaults",
        }),
        expect.objectContaining({
          label: "copy",
          type: "alias",
          value: "*defaults",
        }),
        expect.objectContaining({ label: "[0]", type: "number", value: "3" }),
        expect.objectContaining({ label: "[1]", type: "null", value: "null" }),
      ]),
    );
    expect(source.endsWith("\r\n")).toBe(true);
  });

  it("keeps recursive aliases finite", () => {
    const model = parseStructuredSource({
      path: "fixtures/cycle.yml",
      format: "yaml",
      source: "loop: &loop [*loop]\n",
    });

    expect(model.error).toBeNull();
    expect(model.nodes).toHaveLength(3);
    expect(model.nodes[2]).toMatchObject({
      type: "alias",
      value: "*loop",
      childCount: 0,
    });
  });

  it("reports malformed JSON and YAML with actionable locations", () => {
    const json = parseStructuredSource({
      path: "fixtures/broken.json",
      format: "json",
      source: '{\n  "value":\n}',
    });
    const yaml = parseStructuredSource({
      path: "fixtures/broken.yaml",
      format: "yaml",
      source: "items: [one, two\n",
    });

    expect(json.error).toMatchObject({ line: 3, column: 1 });
    expect(json.error?.message).toMatch(/JSON/i);
    expect(yaml.error?.line).toBeGreaterThan(0);
    expect(yaml.error?.column).toBeGreaterThan(0);
  });

  it("rejects unsupported YAML tags and duplicate mapping keys", () => {
    const tagged = parseStructuredSource({
      path: "fixtures/tagged.yaml",
      format: "yaml",
      source: "value: !execute dangerous\n",
    });
    const duplicate = parseStructuredSource({
      path: "fixtures/duplicate.yaml",
      format: "yaml",
      source: "value: one\nvalue: two\n",
    });

    expect(tagged.error?.message).toMatch(/tag/i);
    expect(duplicate.error?.message).toMatch(/unique|map keys/i);
  });

  it("bounds source bytes, depth, aliases, document count and emitted nodes", () => {
    const tooLarge = parseStructuredSource(
      {
        path: "fixtures/large.json",
        format: "json",
        source: '{"value":"' + "x".repeat(40) + '"}',
      },
      { ...DEFAULT_STRUCTURED_PARSE_LIMITS, maxSourceBytes: 16 },
    );
    const tooDeep = parseStructuredSource(
      {
        path: "fixtures/deep.json",
        format: "json",
        source: '{"a":{"b":{"c":1}}}',
      },
      { ...DEFAULT_STRUCTURED_PARSE_LIMITS, maxDepth: 2 },
    );
    const tooManyAliases = parseStructuredSource(
      {
        path: "fixtures/aliases.yaml",
        format: "yaml",
        source: "base: &base 1\na: *base\nb: *base\n",
      },
      { ...DEFAULT_STRUCTURED_PARSE_LIMITS, maxAliases: 1 },
    );
    const tooManyDocuments = parseStructuredSource(
      {
        path: "fixtures/documents.yaml",
        format: "yaml",
        source: "---\na: 1\n---\nb: 2\n",
      },
      { ...DEFAULT_STRUCTURED_PARSE_LIMITS, maxDocuments: 1 },
    );
    const truncated = parseStructuredSource(
      {
        path: "fixtures/nodes.json",
        format: "json",
        source: '{"a":1,"b":2,"c":3}',
      },
      { ...DEFAULT_STRUCTURED_PARSE_LIMITS, maxNodes: 3 },
    );

    expect(tooLarge.error?.message).toMatch(/size limit/i);
    expect(tooDeep.error?.message).toMatch(/depth limit/i);
    expect(tooManyAliases.error?.message).toMatch(/alias limit/i);
    expect(tooManyDocuments.error?.message).toMatch(/document limit/i);
    expect(truncated.error).toBeNull();
    expect(truncated.truncated).toBe(true);
    expect(truncated.nodes).toHaveLength(3);
    expect(truncated.notices.join(" ")).toMatch(/node limit/i);
  });

  it("keeps YAML 1.2 core scalars deterministic and offline", () => {
    const model = parseStructuredSource({
      path: "fixtures/scalars.yml",
      format: "yaml",
      source: "date: 2026-09-09\nhex: 0x10\nplain: yes\n",
    });

    expect(model.error).toBeNull();
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "date",
          type: "string",
          value: "2026-09-09",
        }),
        expect.objectContaining({ label: "hex", type: "number", value: "16" }),
        expect.objectContaining({ label: "plain", type: "string", value: "yes" }),
      ]),
    );
  });

  it("represents empty keys, empty strings, and multiline scalars safely", () => {
    const json = parseStructuredSource({
      path: "fixtures/empty.json",
      format: "json",
      source: '{"":""}',
    });
    const yaml = parseStructuredSource({
      path: "fixtures/multiline.yaml",
      format: "yaml",
      source: "message: |\n  first\n  second\n",
    });

    expect(json.error).toBeNull();
    expect(json.nodes[1]).toMatchObject({
      label: "(empty key)",
      type: "string",
      value: "",
    });
    expect(yaml.error).toBeNull();
    expect(yaml.nodes[1]).toMatchObject({
      label: "message",
      type: "string",
      value: "first\\nsecond\\n",
    });
  });
});
