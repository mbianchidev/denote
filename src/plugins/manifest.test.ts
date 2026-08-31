import { describe, expect, it } from "vitest";
import referenceManifestJson from "../../packages/plugins/denote.reference/plugin.json";
import {
  checkPluginCompatibility,
  parsePluginManifest,
  validatePluginCatalogEntry,
  validatePluginManifest,
} from "./api";

const referenceManifest = parsePluginManifest(referenceManifestJson);

describe("plugin manifest validation", () => {
  it("accepts the repository reference plugin", () => {
    expect(validatePluginManifest(referenceManifestJson)).toEqual({
      valid: true,
      value: referenceManifestJson,
      errors: [],
    });
  });

  it("rejects traversal paths, duplicate permissions, and unknown categories", () => {
    const manifest = {
      ...referenceManifestJson,
      category: "unknown",
      documentation: "../guide.md",
      permissions: [
        { capability: "commands" },
        { capability: "commands" },
      ],
    };

    const result = validatePluginManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/category must be one of/i),
        expect.stringMatching(/documentation must be a safe/i),
        expect.stringMatching(/duplicate commands/i),
      ]),
    );
  });

  it("requires a dot-namespaced plugin ID", () => {
    const result = validatePluginManifest({
      ...referenceManifestJson,
      id: "foo-bar",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "id must be a namespaced lowercase identifier such as denote.example.",
    );
  });

  it("rejects unsupported capabilities and keeps secrets out of settings", () => {
    const manifest = {
      ...referenceManifestJson,
      permissions: [{ capability: "network", hosts: [] }],
      settings: {
        properties: {
          token: {
            type: "secret",
            title: "API token",
            default: "",
          },
        },
      },
    };

    const result = validatePluginManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/capability must be one of/i),
        expect.stringMatching(/type must be boolean, string, number, or select/i),
      ]),
    );
  });

  it("validates catalog artifact integrity metadata", () => {
    const result = validatePluginCatalogEntry({
      manifest: referenceManifestJson,
      guide: "# Guide",
      artifact: {
        url: "http://plugins.example/reference.zip",
        sha256: "broken",
        sizeBytes: 0,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/artifact.url must be an HTTPS URL/i),
        expect.stringMatching(/artifact.sha256/i),
        expect.stringMatching(/artifact.sizeBytes/i),
      ]),
    );
  });

  it("rejects incompatible API and Denote version ranges", () => {
    expect(
      checkPluginCompatibility(referenceManifest, "0.1.0", 2),
    ).toMatchObject({
      compatible: false,
      reason: expect.stringMatching(/plugin api version 1/i),
    });
    expect(
      checkPluginCompatibility(referenceManifest, "1.0.0", 1),
    ).toMatchObject({
      compatible: false,
      reason: expect.stringMatching(/below 1.0.0/i),
    });
  });

  it("uses strict semantic version validation", () => {
    for (const version of [
      "1.0.0-01",
      "1.0.0-alpha..1",
      "9007199254740993.0.0",
      "v1.2.3",
      " 1.2.3 ",
    ]) {
      const result = validatePluginManifest({
        ...referenceManifestJson,
        version,
      });
      expect(result.valid, version).toBe(false);
      expect(result.errors).toContain("version must be a semantic version.");
    }

    expect(
      validatePluginManifest({
        ...referenceManifestJson,
        version: "1.2.3+build.1",
      }).valid,
    ).toBe(true);
  });

  it("rejects invalid numeric setting ranges", () => {
    const result = validatePluginManifest({
      ...referenceManifestJson,
      settings: {
        properties: {
          count: {
            type: "number",
            title: "Count",
            default: 10,
            minimum: 3,
            maximum: 1,
          },
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/minimum cannot exceed maximum/i),
        expect.stringMatching(/default must be inside/i),
      ]),
    );
  });
});
