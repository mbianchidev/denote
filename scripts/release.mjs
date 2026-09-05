import {
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const VERSION_FILES = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  cargoToml: join("src-tauri", "Cargo.toml"),
  cargoLock: join("src-tauri", "Cargo.lock"),
  tauriConfig: join("src-tauri", "tauri.conf.json"),
  pluginCatalog: join("plugins", "catalog.json"),
};

export function normalizeVersion(value) {
  const version = value.trim().replace(/^v/, "");
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(
      `Invalid version "${value}". Expected semantic version MAJOR.MINOR.PATCH, optionally with prerelease or build metadata.`,
    );
  }
  return version;
}

export function readDenoteVersions(projectRoot) {
  const packageJson = readJson(projectRoot, VERSION_FILES.packageJson);
  const packageLock = readJson(projectRoot, VERSION_FILES.packageLock);
  const cargoToml = readText(projectRoot, VERSION_FILES.cargoToml);
  const cargoLock = readText(projectRoot, VERSION_FILES.cargoLock);
  const tauriConfig = readJson(projectRoot, VERSION_FILES.tauriConfig);

  if (typeof packageLock.packages?.[""]?.version !== "string") {
    throw new Error('package-lock.json is missing packages[""].version.');
  }

  return {
    "package.json": requireVersion(packageJson.version, "package.json"),
    "package-lock.json": requireVersion(
      packageLock.version,
      "package-lock.json",
    ),
    'package-lock.json packages[""]': requireVersion(
      packageLock.packages[""].version,
      'package-lock.json packages[""]',
    ),
    "src-tauri/Cargo.toml": locateCargoTomlVersion(cargoToml).version,
    "src-tauri/Cargo.lock": locateCargoLockVersion(cargoLock).version,
    "src-tauri/tauri.conf.json": requireVersion(
      tauriConfig.version,
      "src-tauri/tauri.conf.json",
    ),
  };
}

export function setDenoteVersion(
  projectRoot,
  requestedVersion,
  { checkOnly = false } = {},
) {
  const version = normalizeVersion(requestedVersion);
  const versions = readDenoteVersions(projectRoot);
  const currentVersions = new Set(Object.values(versions));

  if (currentVersions.size !== 1) {
    throw new Error(
      `Denote versions are out of sync:\n${formatVersions(versions)}`,
    );
  }

  const currentVersion = currentVersions.values().next().value;
  const pluginCatalog = readPluginCatalog(projectRoot);
  const releaseCatalog = pluginCatalogForRelease(pluginCatalog, `v${version}`);
  if (checkOnly) {
    if (currentVersion !== version) {
      throw new Error(
        `Tag version ${version} does not match Denote version ${currentVersion}.`,
      );
    }
    if (JSON.stringify(pluginCatalog) !== JSON.stringify(releaseCatalog)) {
      throw new Error(
        `Plugin catalog URLs do not match release tag v${version}. Run npm run release -- ${version}.`,
      );
    }
    return { changed: false, currentVersion, version };
  }

  const packageJsonPath = resolve(projectRoot, VERSION_FILES.packageJson);
  const packageLockPath = resolve(projectRoot, VERSION_FILES.packageLock);
  const cargoTomlPath = resolve(projectRoot, VERSION_FILES.cargoToml);
  const cargoLockPath = resolve(projectRoot, VERSION_FILES.cargoLock);
  const tauriConfigPath = resolve(projectRoot, VERSION_FILES.tauriConfig);
  const pluginCatalogPath = resolve(projectRoot, VERSION_FILES.pluginCatalog);

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const cargoLock = readFileSync(cargoLockPath, "utf8");

  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  tauriConfig.version = version;

  const updates = new Map([
    [packageJsonPath, formatJson(packageJson)],
    [packageLockPath, formatJson(packageLock)],
    [
      cargoTomlPath,
      replaceLocatedVersion(
        cargoToml,
        locateCargoTomlVersion(cargoToml),
        version,
      ),
    ],
    [
      cargoLockPath,
      replaceLocatedVersion(
        cargoLock,
        locateCargoLockVersion(cargoLock),
        version,
      ),
    ],
    [tauriConfigPath, formatJson(tauriConfig)],
    [pluginCatalogPath, formatJson(releaseCatalog)],
  ]);
  const changed = writeChangedFiles(updates);

  return { changed, currentVersion, version };
}

function readPluginCatalog(projectRoot) {
  const catalog = readJson(projectRoot, VERSION_FILES.pluginCatalog);
  if (!Array.isArray(catalog)) {
    throw new Error("plugins/catalog.json must contain an array.");
  }
  return catalog;
}

function pluginCatalogForRelease(catalog, releaseTag) {
  return catalog.map((entry, index) => {
    const id = entry?.manifest?.id;
    const version = entry?.manifest?.version;
    if (
      typeof id !== "string" ||
      typeof version !== "string" ||
      typeof entry?.artifact?.url !== "string"
    ) {
      throw new Error(
        `plugins/catalog.json entry ${index} is missing manifest or artifact metadata.`,
      );
    }
    const artifactName = `${id}-${version}.tgz`;
    return {
      ...entry,
      artifact: {
        ...entry.artifact,
        url: `https://github.com/mbianchidev/denote/releases/download/${releaseTag}/${artifactName}`,
      },
    };
  });
}

function readJson(projectRoot, relativePath) {
  const contents = readText(projectRoot, relativePath);
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Unable to parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readText(projectRoot, relativePath) {
  try {
    return readFileSync(resolve(projectRoot, relativePath), "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireVersion(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} is missing a string version.`);
  }
  const version = normalizeVersion(value);
  if (version !== value) {
    throw new Error(`${label} must contain an unprefixed semantic version.`);
  }
  return version;
}

function locateCargoTomlVersion(contents) {
  const packageHeader = /^\[package\]\r?$/m.exec(contents);
  if (!packageHeader) {
    throw new Error("src-tauri/Cargo.toml is missing [package].");
  }

  const sectionStart = packageHeader.index + packageHeader[0].length;
  const nextHeaderPattern = /^\[[^\]]+\]\r?$/gm;
  nextHeaderPattern.lastIndex = sectionStart;
  const nextHeader = nextHeaderPattern.exec(contents);
  const sectionEnd = nextHeader?.index ?? contents.length;
  const section = contents.slice(sectionStart, sectionEnd);
  const matches = [
    ...section.matchAll(/^([ \t]*version[ \t]*=[ \t]*")([^"]+)(".*)$/gm),
  ];

  if (matches.length !== 1) {
    throw new Error(
      "src-tauri/Cargo.toml must contain exactly one [package] version.",
    );
  }

  return locateMatchVersion(matches[0], sectionStart, "src-tauri/Cargo.toml");
}

function locateCargoLockVersion(contents) {
  const matches = [
    ...contents.matchAll(
      /^\[\[package\]\]\r?\nname = "denote"\r?\nversion = "([^"]+)"/gm,
    ),
  ];

  if (matches.length !== 1) {
    throw new Error(
      'src-tauri/Cargo.lock must contain exactly one package named "denote".',
    );
  }

  const match = matches[0];
  const version = requireVersion(match[1], "src-tauri/Cargo.lock");
  const versionOffset = match[0].lastIndexOf(match[1]);
  const start = match.index + versionOffset;
  return { start, end: start + match[1].length, version };
}

function locateMatchVersion(match, baseOffset, label) {
  const version = requireVersion(match[2], label);
  const start = baseOffset + match.index + match[1].length;
  return { start, end: start + match[2].length, version };
}

function replaceLocatedVersion(contents, location, version) {
  return `${contents.slice(0, location.start)}${version}${contents.slice(location.end)}`;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatVersions(versions) {
  return Object.entries(versions)
    .map(([file, version]) => `- ${file}: ${version}`)
    .join("\n");
}

function writeChangedFiles(updates) {
  const changed = [...updates].filter(
    ([path, contents]) => readFileSync(path, "utf8") !== contents,
  );
  const temporaryFiles = [];

  try {
    changed.forEach(([path, contents], index) => {
      const temporaryPath = `${path}.release-${process.pid}-${index}.tmp`;
      writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
      temporaryFiles.push(temporaryPath);
    });
    changed.forEach(([path], index) => {
      renameSync(temporaryFiles[index], path);
    });
  } finally {
    for (const temporaryPath of temporaryFiles) {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
    }
  }

  return changed.length > 0;
}

function run(argv) {
  const checkOnly = argv.includes("--check");
  const positional = argv.filter((argument) => argument !== "--check");
  const unknownOption = positional.find((argument) => argument.startsWith("--"));

  if (unknownOption || positional.length !== 1) {
    throw new Error(
      "Usage: npm run release -- [--check] <version-or-v-prefixed-tag>",
    );
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = setDenoteVersion(projectRoot, positional[0], { checkOnly });

  if (checkOnly) {
    console.log(`Denote version ${result.version} matches the release tag.`);
  } else if (result.changed) {
    console.log(
      `Updated Denote version from ${result.currentVersion} to ${result.version}.`,
    );
  } else {
    console.log(`Denote is already version ${result.version}.`);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Release version update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
