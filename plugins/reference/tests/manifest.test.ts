import { describe, expect, it } from "vitest";
import referenceManifestJson from "../plugin.json";
import {
  checkPluginCompatibility,
  parsePluginManifest,
  validatePluginCatalogEntry,
  validatePluginBundles,
  validatePluginManifest,
} from "@denote/plugin-sdk";

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
        version: 1,
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
        expect.stringMatching(/hosts must be a non-empty array/i),
        expect.stringMatching(/type must be boolean, string, number, or select/i),
      ]),
    );
  });

  it("accepts project context as an unconstrained API v1 capability", () => {
    expect(
      validatePluginManifest({
        ...referenceManifestJson,
        permissions: [{ capability: "project-context" }],
      }),
    ).toMatchObject({ valid: true, errors: [] });

    const constrained = validatePluginManifest({
      ...referenceManifestJson,
      permissions: [
        {
          capability: "project-context",
          hosts: ["projects.example"],
        },
      ],
    });
    expect(constrained.valid).toBe(false);
    expect(constrained.errors).toContain(
      "permissions[0].hosts is only valid for network permission.",
    );
  });

  it("accepts source control permissions as unconstrained API v1 capabilities", () => {
    expect(
      validatePluginManifest({
        ...referenceManifestJson,
        permissions: [
          { capability: "source-control" },
          { capability: "automatic-local-commit" },
        ],
      }),
    ).toMatchObject({ valid: true, errors: [] });

    const constrained = validatePluginManifest({
      ...referenceManifestJson,
      permissions: [
        {
          capability: "source-control",
          executables: { macos: ["/usr/bin/git"] },
        },
      ],
    });
    expect(constrained.valid).toBe(false);
    expect(constrained.errors).toContain(
      "permissions[0].executables is only valid for process permission.",
    );
  });

  it("validates named bundle roles and allows unavailable candidates", () => {
    const result = validatePluginBundles(
      [
        {
          id: "synthetic-tools",
          name: "Synthetic tools",
          categories: ["code"],
          roles: [
            {
              id: "language-server",
              name: "Language server",
              candidatePluginIds: [],
            },
          ],
        },
      ],
      new Set(["denote.synthetic"]),
    );

    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects duplicate roles, candidates, and unknown catalog IDs", () => {
    const result = validatePluginBundles(
      [
        {
          id: "synthetic-tools",
          name: "Synthetic tools",
          categories: ["unknown"],
          roles: [
            {
              id: "terminal",
              name: "Terminal",
              candidatePluginIds: ["denote.missing", "denote.missing", 42],
            },
            {
              id: "terminal",
              name: "Terminal",
              candidatePluginIds: [],
            },
          ],
        },
      ],
      new Set(["denote.synthetic"]),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/categories\[0\] must be one of/i),
        expect.stringMatching(/unknown catalog plugin denote\.missing/i),
        expect.stringMatching(/contains duplicate denote\.missing/i),
        expect.stringMatching(/candidatePluginIds\[2\] must be a string/i),
        expect.stringMatching(/roles\[1\]\.id duplicates terminal/i),
        expect.stringMatching(/roles\[1\]\.name duplicates the name terminal/i),
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
        version: 1,
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
