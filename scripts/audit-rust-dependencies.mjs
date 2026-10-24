import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const registry = "registry+https://github.com/rust-lang/crates.io-index";
const backports = new Map([
  ["glib", {
    version: "0.18.5",
    checksum: "233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5",
  }],
  ["glib-macros", {
    version: "0.18.5",
    checksum: "0bb0228f477c0900c880fd78c8759b95c7636dbd7842707f49e132378aa2acdc",
  }],
  ["gtk3-macros", {
    version: "0.18.2",
    checksum: "52ff3c5b21f14f0736fed6dcfc0bfb4225ebf5725f3c0209edeec181e4d73e9d",
  }],
  ["tauri-plugin-notification", {
    version: "2.4.0",
    checksum: "ad2fd40946aef810c4be9fd33a2d1b9b397cb79042b2d21c81a0a8f204354fd1",
  }],
  ["tauri-plugin-opener", {
    version: "2.5.5",
    checksum: "60d60366174b745b4ef5824b8bbc1c457fd08f0ce101ff643c0a49181a9f4e91",
  }],
  ["tauri-plugin-single-instance", {
    version: "2.4.5",
    checksum: "db817fe9295e19b7d8357e900af31edb93703dd9fb6de524b007b47b6afc63b0",
  }],
  ["urlpattern", {
    version: "0.3.0",
    checksum: "70acd30e3aa1450bc2eece896ce2ad0d178e9c079493819301573dae3c37ba6d",
  }],
]);

export function verifyResolvedBackports(metadata, root) {
  if (!Array.isArray(metadata?.packages)) {
    throw new Error("Cargo metadata is missing resolved packages.");
  }
  const application = metadata.packages.find(
    (entry) => entry.name === "denote"
      && typeof entry.manifest_path === "string"
      && resolve(entry.manifest_path) === join(root, "Cargo.toml"),
  );
  if (!application
    || JSON.stringify(metadata.workspace_default_members) !== JSON.stringify([application.id])) {
    throw new Error("Only the Denote application may be a default workspace member.");
  }
  const approvedLocalIds = new Set([application.id]);
  for (const [name, backport] of backports) {
    if (existsSync(join(root, "vendor", name, "Cargo.lock"))) {
      throw new Error(`Vendored ${name} must use the workspace Cargo.lock, not a stale nested lockfile.`);
    }
    const matches = metadata.packages.filter((entry) => entry.name === name);
    if (matches.length !== 1
      || matches[0].version !== backport.version
      || matches[0].source !== null
      || typeof matches[0].manifest_path !== "string"
      || resolve(matches[0].manifest_path) !== join(root, "vendor", name, "Cargo.toml")) {
      throw new Error(`Resolved ${name} must use the reviewed local ${backport.version} backport.`);
    }
    approvedLocalIds.add(matches[0].id);
  }
  for (const entry of metadata.packages) {
    if (!approvedLocalIds.has(entry.id) && entry.source !== registry) {
      throw new Error(`Unreviewed dependency source for ${entry.name}; RustSec cannot audit it.`);
    }
  }
}

export function projectVendoredSources(lockfile) {
  const seen = new Set();
  const projected = lockfile.replaceAll("\r\n", "\n")
    .split(/(?=^\[\[package\]\])/m)
    .map((block) => {
      const name = block.match(/^name = "([^"]+)"$/m)?.[1];
      const backport = backports.get(name);
      if (!backport) {
        return block;
      }
      if (seen.has(name)
        || block.match(/^version = "([^"]+)"$/m)?.[1] !== backport.version
        || /^source = /m.test(block)
        || /^checksum = /m.test(block)) {
        throw new Error(`Cargo.lock must contain exactly one local ${name} ${backport.version}.`);
      }
      seen.add(name);
      return block.replace(
        /^version = "[^"]+"$/m,
        (line) => `${line}\nsource = "${registry}"\nchecksum = "${backport.checksum}"`,
      );
    }).join("");
  for (const name of backports.keys()) {
    if (!seen.has(name)) {
      throw new Error(`Cargo.lock is missing the reviewed ${name} backport.`);
    }
  }
  return projected;
}

function audit() {
  const root = fileURLToPath(new URL("../src-tauri", import.meta.url));
  const manifest = join(root, "Cargo.toml");
  const lockfile = join(root, "Cargo.lock");
  const metadata = JSON.parse(execFileSync(
    "cargo",
    ["metadata", "--manifest-path", manifest, "--locked", "--format-version", "1"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 },
  ));
  verifyResolvedBackports(metadata, root);
  const projected = projectVendoredSources(readFileSync(lockfile, "utf8"));

  console.log("Auditing resolved registry dependencies.");
  execFileSync("cargo", ["audit", "--file", lockfile, "--deny", "unmaintained"], {
    stdio: "inherit",
  });

  // RustSec skips path sources. Audit their original registry identities too,
  // without changing Cargo.lock or hiding the version-based GLib advisory.
  console.log("Auditing published backport baselines; optimized tests verify the GLib source fix.");
  execFileSync("cargo", ["audit", "--file", "-", "--no-fetch", "--deny", "unmaintained"], {
    input: projected,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    audit();
  } catch (error) {
    console.error(`Rust dependency audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
