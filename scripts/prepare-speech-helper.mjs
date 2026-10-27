import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--debug")) {
  throw new Error("Usage: npm run prepare:speech-helper -- [--debug]");
}
const debug = args.includes("--debug") || process.env.TAURI_ENV_DEBUG === "true";
const profile = debug ? "debug" : "release";
const manifest = join(root, "src-tauri/Cargo.toml");
const stage = join(root, "src-tauri/resources/speech");

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root, stdio: "inherit", timeout: 1_800_000, ...options,
  });
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? result.signal}.`);
  return result.stdout;
}

const host = run("rustc", ["-vV"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
  .match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Rust did not report its host target.");
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const targetArgs = target === host ? [] : ["--target", target];
run("cargo", ["build", "--manifest-path", manifest, "--locked",
  "--package", "denote-speech-worker", "--jobs", "2", ...targetArgs,
  ...(debug ? [] : ["--release"])]);
const metadata = JSON.parse(run("cargo", ["metadata", "--manifest-path", manifest,
  "--format-version", "1", "--no-deps"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
const output = join(metadata.target_directory, ...(targetArgs.length ? [target] : []), profile);
if (existsSync(stage) && lstatSync(stage).isSymbolicLink()) {
  throw new Error("The generated speech-helper directory must not be a symlink.");
}
mkdirSync(stage, { recursive: true });

if (target.endsWith("apple-darwin")) {
  const env = { ...process.env };
  const outer = JSON.parse(env.TAURI_CONFIG || "{}");
  if (!env.APPLE_SIGNING_IDENTITY && outer.bundle?.macOS?.signingIdentity) {
    env.APPLE_SIGNING_IDENTITY = outer.bundle.macOS.signingIdentity;
  }
  if (!env.APPLE_SIGNING_IDENTITY && !env.APPLE_CERTIFICATE) env.APPLE_SIGNING_IDENTITY = "-";
  // Only the containing desktop app is notarized; Tauri signs this nested code first.
  for (const key of ["TAURI_CONFIG", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID",
    "APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH",
    "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
    delete env[key];
  }
  run(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "bundle",
    "--bundles", "app", ...targetArgs, ...(debug ? ["--debug"] : [])], {
    cwd: join(root, "src-tauri/speech-worker"), env,
  });
  const app = join(output, "bundle/macos/Denote Speech Helper.app");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const destination = join(stage, "Denote Speech Helper.app");
  if (existsSync(destination)) rmSync(destination, { recursive: true });
  cpSync(app, destination, { recursive: true, dereference: false, errorOnExist: true });
  for (const name of ["denote-speech-worker", "denote-speech-worker.exe"]) {
    const obsolete = join(stage, name);
    if (existsSync(obsolete)) rmSync(obsolete);
  }
} else {
  const name = target.includes("windows") ? "denote-speech-worker.exe" : "denote-speech-worker";
  copyFileSync(join(output, name), join(stage, name));
  const other = join(stage, target.includes("windows") ? "denote-speech-worker" : "denote-speech-worker.exe");
  if (existsSync(other)) rmSync(other);
  const app = join(stage, "Denote Speech Helper.app");
  if (existsSync(app)) rmSync(app, { recursive: true });
}
console.log(`Prepared isolated speech helper for ${target} (${profile}).`);
