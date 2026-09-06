import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  expectedUpdaterAssets,
  officialReleaseAssetUrl,
  readReleaseAssetContract,
} from "./release-assets.mjs";

const UPDATER_CONFIG_PATH = resolve("src-tauri/updater.json");

export function readUpdaterConfiguration(path = UPDATER_CONFIG_PATH) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (
    config?.schemaVersion !== 1 ||
    typeof config.enabled !== "boolean" ||
    config.channel !== "stable" ||
    config.endpoint !==
      "https://github.com/mbianchidev/denote/releases/latest/download/latest.json" ||
    (config.publicKey !== null && typeof config.publicKey !== "string")
  ) {
    throw new Error("Invalid updater configuration.");
  }
  if (config.enabled && !config.publicKey?.trim()) {
    throw new Error(
      "Updater release generation is enabled without a committed public key.",
    );
  }
  return config;
}

export function updaterReleaseEnabled(path = UPDATER_CONFIG_PATH) {
  return readUpdaterConfiguration(path).enabled;
}

export function stageUpdaterArtifacts({
  projectRoot,
  runnerOs,
  target,
  artifact,
  version,
  destination,
}) {
  const contract = readReleaseAssetContract(join(projectRoot, "release-assets.json"));
  const specs = expectedUpdaterAssets(contract, version).filter(
    (entry) =>
      entry.platform === platformForRunner(runnerOs) &&
      targetMatchesArchitecture(target, entry.architecture),
  );
  if (specs.length === 0) {
    throw new Error(`No updater targets match ${runnerOs} ${target}.`);
  }
  mkdirSync(destination, { recursive: true });
  const staged = [];
  for (const spec of specs) {
    const source = updaterSource(projectRoot, target, spec.bundleType);
    const signature = `${source}.sig`;
    requireRegularFile(source, `${spec.target} updater artifact`);
    requireRegularFile(signature, `${spec.target} updater signature`);
    if (spec.platform === "macos") {
      const output = join(destination, spec.name);
      copyFileSync(source, output);
      staged.push(output);
    }
    const signatureOutput = join(destination, spec.signatureName);
    copyFileSync(signature, signatureOutput);
    staged.push(signatureOutput);
  }
  return staged;
}

export function createLatestJson({
  releaseDirectory,
  version,
  publishedAt,
  notes,
  outputPath,
}) {
  const contract = readReleaseAssetContract();
  const tag = `v${version}`;
  const platforms = {};
  for (const spec of expectedUpdaterAssets(contract, version)) {
    const artifactPath = join(releaseDirectory, spec.name);
    const signaturePath = join(releaseDirectory, spec.signatureName);
    requireRegularFile(artifactPath, `${spec.target} release artifact`);
    requireRegularFile(signaturePath, `${spec.target} release signature`);
    const signature = readFileSync(signaturePath, "utf8").trim();
    if (!signature || signature.length > 16_384) {
      throw new Error(`Invalid updater signature: ${spec.signatureName}`);
    }
    platforms[spec.target] = {
      url: officialReleaseAssetUrl(contract.repository, tag, spec.name),
      signature,
    };
  }
  const manifest = {
    version,
    notes: String(notes ?? "").slice(0, 8_000),
    pub_date: new Date(publishedAt).toISOString(),
    platforms,
  };
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function updaterSource(projectRoot, target, bundleType) {
  const bundleRoot = join(
    projectRoot,
    "src-tauri",
    "target",
    target,
    "release",
    "bundle",
  );
  const directory =
    bundleType === "app" ? "macos" : bundleType === "appimage" ? "appimage" : bundleType;
  const suffix =
    bundleType === "app"
      ? ".app.tar.gz"
      : bundleType === "appimage"
        ? ".AppImage"
        : bundleType === "nsis"
          ? "-setup.exe"
          : bundleType === "msi"
            ? ".msi"
            : bundleType === "deb"
              ? ".deb"
              : ".rpm";
  return findSingle(join(bundleRoot, directory), suffix);
}

function findSingle(directory, suffix) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to inspect updater output at ${directory}: ${error}`);
  }
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(directory, entry.name));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one updater artifact ending in ${suffix}, found ${matches.length}.`,
    );
  }
  return matches[0];
}

function requireRegularFile(path, label) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new Error(`Missing ${label} at ${path}: ${error}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}

function platformForRunner(runnerOs) {
  if (runnerOs === "macOS") return "macos";
  if (runnerOs === "Windows") return "windows";
  if (runnerOs === "Linux") return "linux";
  throw new Error(`Unsupported runner OS: ${runnerOs}`);
}

function targetMatchesArchitecture(target, architecture) {
  return target.startsWith(
    architecture === "aarch64"
      ? "aarch64-"
      : architecture === "x86_64"
        ? "x86_64-"
        : `${architecture}-`,
  );
}

function usage() {
  throw new Error(
    "Usage: node scripts/updater-release.mjs status | stage <root> <runner-os> <target> <artifact> <version> <destination> | manifest <release-dir> <version> <published-at> <output>",
  );
}

if (process.argv[1] && basename(process.argv[1]) === "updater-release.mjs") {
  const [command, ...args] = process.argv.slice(2);
  if (command === "status" && args.length === 0) {
    process.stdout.write(`${updaterReleaseEnabled()}\n`);
  } else if (command === "stage" && args.length === 6) {
    stageUpdaterArtifacts({
      projectRoot: resolve(args[0]),
      runnerOs: args[1],
      target: args[2],
      artifact: args[3],
      version: args[4],
      destination: resolve(args[5]),
    });
  } else if (command === "manifest" && args.length === 4) {
    createLatestJson({
      releaseDirectory: resolve(args[0]),
      version: args[1],
      publishedAt: args[2],
      notes: `See the Denote v${args[1]} release notes on GitHub.`,
      outputPath: resolve(args[3]),
    });
  } else {
    usage();
  }
}
