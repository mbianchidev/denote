// @vitest-environment node
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectVendoredSources,
  verifyResolvedBackports,
} from "./audit-rust-dependencies.mjs";

const root = resolve("synthetic-native");
const versions = {
  glib: "0.18.5",
  "glib-macros": "0.18.5",
  "gtk3-macros": "0.18.2",
  urlpattern: "0.3.0",
};

function metadata() {
  return {
    packages: [
      {
        id: "synthetic-application",
        name: "denote",
        manifest_path: join(root, "Cargo.toml"),
      },
      ...Object.entries(versions).map(([name, version]) => ({
        id: `synthetic-${name}`,
        name,
        version,
        source: null,
        manifest_path: join(root, "vendor", name, "Cargo.toml"),
      })),
    ],
    workspace_default_members: ["synthetic-application"],
  };
}

function lockfile() {
  return `version = 4\n\n${Object.entries(versions)
    .map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
    .join("\n")}`;
}

describe("Rust source-backport audit", () => {
  it("requires the reviewed local packages and application-only default", () => {
    expect(() => verifyResolvedBackports(metadata(), root)).not.toThrow();
  });

  it.each([
    ["registry source", (entry) => { entry.source = "registry+https://github.com/rust-lang/crates.io-index"; }],
    ["different version", (entry) => { entry.version = "0.20.0"; }],
    ["unapproved path", (entry) => { entry.manifest_path = join(root, "unapproved", "Cargo.toml"); }],
  ])("rejects a backport with %s", (_label, change) => {
    const input = metadata();
    change(input.packages.find((entry) => entry.name === "glib"));
    expect(() => verifyResolvedBackports(input, root)).toThrow(/glib/);
  });

  it("rejects missing or duplicate packages rather than auditing a detached test copy", () => {
    const missing = metadata();
    missing.packages = missing.packages.filter((entry) => entry.name !== "glib");
    expect(() => verifyResolvedBackports(missing, root)).toThrow(/glib/);

    const duplicate = metadata();
    duplicate.packages.push({ ...duplicate.packages.find((entry) => entry.name === "glib") });
    expect(() => verifyResolvedBackports(duplicate, root)).toThrow(/glib/);
  });

  it("does not make GTK a default macOS or Windows build requirement", () => {
    const input = metadata();
    input.workspace_default_members.push("synthetic-glib");
    expect(() => verifyResolvedBackports(input, root)).toThrow(/default/);
  });

  it.each([null, "git+https://example.invalid/synthetic"])(
    "rejects unreviewed dependency sources instead of silently skipping advisories: %s",
    (source) => {
      const input = metadata();
      input.packages.push({ id: "synthetic-extra", name: "synthetic-extra", source });
      expect(() => verifyResolvedBackports(input, root)).toThrow(/Unreviewed dependency source/);
    },
  );

  it("normalizes Cargo manifest separators on Windows", () => {
    const input = metadata();
    for (const entry of input.packages) {
      entry.manifest_path = entry.manifest_path.replaceAll("\\", "/");
    }
    expect(() => verifyResolvedBackports(input, root)).not.toThrow();
  });

  it("projects original registry identities without changing names, versions, or dependencies", () => {
    const dependency = '\n[[package]]\nname = "synthetic-dependency"\nversion = "1.2.3"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n';
    const input = lockfile() + dependency;
    const projected = projectVendoredSources(input);
    for (const [name, version] of Object.entries(versions)) {
      expect(projected).toContain(
        `name = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "`,
      );
    }
    expect(projected).toContain(dependency);
    expect(input).toBe(lockfile() + dependency);
  });

  it("supports Windows line endings", () => {
    expect(projectVendoredSources(lockfile().replaceAll("\n", "\r\n")))
      .toBe(projectVendoredSources(lockfile()));
  });

  it("refuses missing, relabelled, duplicated, or non-local lockfile records", () => {
    expect(() => projectVendoredSources(lockfile().replace('name = "glib"', 'name = "missing"')))
      .toThrow(/glib/);
    expect(() => projectVendoredSources(lockfile().replace('version = "0.18.5"', 'version = "0.20.0"')))
      .toThrow(/glib/);
    expect(() => projectVendoredSources(lockfile() + '\n[[package]]\nname = "glib"\nversion = "0.18.5"\n'))
      .toThrow(/glib/);
    expect(() => projectVendoredSources(lockfile().replace('name = "glib"', 'name = "glib"\nsource = "git+https://example.invalid/synthetic"')))
      .toThrow(/glib/);
  });
});
