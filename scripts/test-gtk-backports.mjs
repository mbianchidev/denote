import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const crates = ["glib", "glib-macros"];
const registry = "registry+https://github.com/rust-lang/crates.io-index";

export function prepareGtkWorkspace(root) {
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  const directory = mkdtempSync(join(target, "gtk-backports-"));
  try {
    for (const name of crates) {
      cpSync(join(root, "vendor", name), join(directory, "vendor", name), { recursive: true });
    }
    copyFileSync(join(root, "Cargo.lock"), join(directory, "Cargo.lock"));
    writeFileSync(join(directory, "Cargo.toml"), [
      "[workspace]",
      'members = ["vendor/glib", "vendor/glib-macros"]',
      'resolver = "3"',
      "",
      "[patch.crates-io]",
      'glib = { path = "vendor/glib" }',
      'glib-macros = { path = "vendor/glib-macros" }',
      "",
    ].join("\n"));
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyGtkDependencies(actual, baseline, directory) {
  if (!Array.isArray(actual?.packages) || !Array.isArray(baseline?.packages)) {
    throw new Error("GTK fixture Cargo metadata is missing resolved packages.");
  }
  const identity = (entry) => JSON.stringify([entry.name, entry.version, entry.source]);
  const approved = new Set(baseline.packages.map(identity));
  for (const entry of actual.packages) {
    if (entry.source === null) {
      if (!crates.includes(entry.name) || typeof entry.manifest_path !== "string" ||
        resolve(entry.manifest_path) !== join(directory, "vendor", entry.name, "Cargo.toml") ||
        !approved.has(identity(entry))) {
        throw new Error(`GTK fixtures must use the exact copied backport for ${entry.name}.`);
      }
    } else if (entry.source !== registry || !approved.has(identity(entry))) {
      throw new Error(`GTK fixtures selected an unreviewed dependency: ${entry.name} ${entry.version}.`);
    }
  }
  for (const name of crates) {
    if (actual.packages.filter((entry) => entry.name === name).length !== 1) {
      throw new Error(`GTK fixtures are missing the unique ${name} backport.`);
    }
  }
}

function testGtkBackports() {
  const root = fileURLToPath(new URL("../src-tauri", import.meta.url));
  const env = {
    ...process.env,
    // trybuild treats sources inside its target directory as generated output.
    CARGO_TARGET_DIR: join(root, "target", "gtk-backport-build"),
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
    RUSTFLAGS: `${process.env.RUSTFLAGS ?? ""} -Dwarnings`.trim(),
  };
  if (process.env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    env.CARGO_ENCODED_RUSTFLAGS = [process.env.CARGO_ENCODED_RUSTFLAGS, "-Dwarnings"].filter(Boolean).join("\u001f");
  }
  const cargo = (args, capture = false) => execFileSync("cargo", args, {
    env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  const originalManifest = join(root, "Cargo.toml");
  const baseline = JSON.parse(cargo(["metadata", "--manifest-path", originalManifest, "--locked", "--format-version", "1"], true));
  const directory = prepareGtkWorkspace(root);
  try {
    const manifest = join(directory, "Cargo.toml");
    const actual = JSON.parse(cargo(["metadata", "--manifest-path", manifest, "--offline", "--format-version", "1"], true));
    verifyGtkDependencies(actual, baseline, directory);
    const run = (args) => cargo([args[0], "--manifest-path", manifest, "--locked", "--offline", ...args.slice(1)]);
    run(["rustc", "--package", "glib", "--lib", "--", "-Dunused_parens", "-Dmismatched_lifetime_syntaxes"]);
    run(["test", "--package", "glib", "--lib"]);
    run(["test", "--package", "glib-macros"]);
    run(["test", "--package", "glib", "--features", "compiletests", "--test", "subclass_compiletest"]);
    run(["test", "--release", "--package", "glib", "--lib", "--", "variant_iter", "collections::strv::test::test_into_strv"]);
    cargo(["rustc", "--manifest-path", originalManifest, "--locked", "--package", "gtk3-macros", "--lib", "--", "-Dwarnings"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  testGtkBackports();
}
