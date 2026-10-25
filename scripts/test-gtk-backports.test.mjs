import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareGtkWorkspace, verifyGtkDependencies } from "./test-gtk-backports.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "denote-gtk-fixture-"));
  roots.push(root);
  writeFileSync(join(root, "Cargo.lock"), "# Synthetic lockfile\nversion = 4\n");
  writeFileSync(join(root, "Cargo.toml"), "[patch.crates-io]\nsynthetic = { path = \"vendor/synthetic\" }\n");
  for (const name of ["glib", "glib-macros"]) {
    const directory = join(root, "vendor", name);
    mkdirSync(join(directory, "src"), { recursive: true });
    writeFileSync(join(directory, "Cargo.toml"), `[package]\nname = "${name}"\nversion = "0.18.5"\n`);
    writeFileSync(join(directory, "src", "lib.rs"), "// Synthetic source fixture.\n");
  }
  return root;
}

const registry = "registry+https://github.com/rust-lang/crates.io-index";
function metadata(root) {
  return { packages: [
    ...["glib", "glib-macros"].map((name) => ({
      name, version: "0.18.5", source: null, manifest_path: join(root, "vendor", name, "Cargo.toml"),
    })),
    { name: "synthetic-dependency", version: "1.2.3", source: registry },
  ] };
}

describe("isolated GTK backport workspace", () => {
  it("copies exact source and the reviewed lockfile but only the two required patches", () => {
    const root = fixture();
    const directory = prepareGtkWorkspace(root);
    expect(directory.startsWith(join(root, "target", "gtk-backports-"))).toBe(true);
    expect(readFileSync(join(directory, "Cargo.lock"), "utf8")).toBe(readFileSync(join(root, "Cargo.lock"), "utf8"));
    const manifest = readFileSync(join(directory, "Cargo.toml"), "utf8");
    expect(manifest).toContain('[workspace]');
    expect(manifest).toContain('glib = { path = "vendor/glib" }');
    expect(manifest).toContain('glib-macros = { path = "vendor/glib-macros" }');
    expect(manifest).not.toContain("synthetic");
    for (const name of ["glib", "glib-macros"]) {
      expect(readFileSync(join(directory, "vendor", name, "src", "lib.rs"), "utf8"))
        .toBe(readFileSync(join(root, "vendor", name, "src", "lib.rs"), "utf8"));
    }
    expect(readFileSync(join(root, "Cargo.toml"), "utf8")).toContain("synthetic");
  });

  it("accepts only the original local identities and reviewed registry dependency versions", () => {
    const root = fixture();
    const directory = prepareGtkWorkspace(root);
    expect(() => verifyGtkDependencies(metadata(directory), metadata(root), directory)).not.toThrow();
    const changed = metadata(directory);
    changed.packages[2].version = "1.2.4";
    expect(() => verifyGtkDependencies(changed, metadata(root), directory)).toThrow(/reviewed dependency/u);
    const foreign = metadata(directory);
    foreign.packages[0].manifest_path = join(root, "vendor", "glib", "Cargo.toml");
    expect(() => verifyGtkDependencies(foreign, metadata(root), directory)).toThrow(/copied backport/u);
    const missing = metadata(directory);
    missing.packages.shift();
    expect(() => verifyGtkDependencies(missing, metadata(root), directory)).toThrow(/missing.*glib/u);
  });
});
