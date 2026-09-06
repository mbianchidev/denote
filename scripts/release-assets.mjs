import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTRACT_PATH = resolve("release-assets.json");

export function readReleaseAssetContract(path = CONTRACT_PATH) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  validateContract(value);
  return value;
}

export function renderReleaseFileName(template, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (
    typeof template !== "string" ||
    !template.includes("{version}") ||
    template.includes("/") ||
    template.includes("\\")
  ) {
    throw new Error(`Invalid release filename template: ${template}`);
  }
  return template.replaceAll("{version}", version);
}

export function expectedDownloadAssets(contract, version) {
  return contract.downloads.map((entry) => ({
    ...entry,
    name: renderReleaseFileName(entry.fileName, version),
  }));
}

export function expectedUpdaterAssets(contract, version) {
  return contract.updaterTargets.map((entry) => {
    const name = renderReleaseFileName(entry.releaseFileName, version);
    return { ...entry, name, signatureName: `${name}.sig` };
  });
}

export function officialReleaseAssetUrl(repository, tag, fileName) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  if (
    typeof fileName !== "string" ||
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw new Error(`Invalid release filename: ${fileName}`);
  }
  return `https://github.com/${repository}/releases/download/${tag}/${fileName}`;
}

export function assertExpectedDownloads(contract, version, assets) {
  const names = assets.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error("Release assets contain duplicate filenames.");
  }
  for (const expected of expectedDownloadAssets(contract, version)) {
    const count = names.filter((name) => name === expected.name).length;
    if (count !== 1) {
      throw new Error(
        `Expected exactly one ${expected.label} asset named ${expected.name}, found ${count}.`,
      );
    }
  }
}

function validateContract(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.repository !== "string" ||
    !Array.isArray(value.downloads) ||
    !Array.isArray(value.updaterTargets)
  ) {
    throw new Error("Invalid release asset contract.");
  }
  requireUnique(value.downloads, "id");
  requireUnique(value.updaterTargets, "target");
  const templates = [
    ...value.downloads.map(({ fileName }) => fileName),
    ...value.updaterTargets.map(({ releaseFileName }) => releaseFileName),
  ];
  for (const template of templates) {
    renderReleaseFileName(template, "1.2.3");
  }
}

function requireUnique(entries, key) {
  const values = entries.map((entry) => entry?.[key]);
  if (
    values.some((value) => typeof value !== "string" || !value) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`Release asset contract has invalid or duplicate ${key} values.`);
  }
}
