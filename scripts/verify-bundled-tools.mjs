import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { currentTarget, sha256File } from "./bundled-tools.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const lockPath = join(root, "bundled-tools.lock.json");
const resourcesRoot = join(root, "src-tauri", "resources", "tools");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function filesUnder(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Bundled resource contains symbolic link ${path}.`);
      }
      if (metadata.isDirectory()) {
        stack.push(path);
      } else if (metadata.isFile()) {
        files.push(path);
      } else {
        throw new Error(`Bundled resource contains unsupported file ${path}.`);
      }
    }
  }
  return files.sort();
}

const targetName = argument("--target") ?? currentTarget();
const targetRoot = join(resourcesRoot, targetName);
const integrityPath = join(targetRoot, "integrity.json");
if (!existsSync(integrityPath)) {
  throw new Error(
    `Bundled resources for ${targetName} are missing. Run npm run prepare:bundled-tools -- --target ${targetName}.`,
  );
}
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const target = lock.targets[targetName];
const integrity = JSON.parse(readFileSync(integrityPath, "utf8"));
if (
  integrity.schemaVersion !== 1 ||
  integrity.target !== targetName ||
  integrity.lockSha256 !== sha256File(lockPath)
) {
  throw new Error(`Bundled resource manifest does not match the immutable lock.`);
}
const expected = new Map(integrity.files.map((file) => [file.path, file]));
for (const path of filesUnder(targetRoot)) {
  const name = relative(targetRoot, path).split(sep).join("/");
  if (name === "integrity.json") {
    continue;
  }
  const record = expected.get(name);
  if (!record) {
    throw new Error(`Bundled resource is not declared: ${name}.`);
  }
  if (statSync(path).size !== record.sizeBytes || sha256File(path) !== record.sha256) {
    throw new Error(`Bundled resource failed integrity verification: ${name}.`);
  }
  expected.delete(name);
}
if (expected.size > 0) {
  throw new Error(`Bundled resources are missing: ${[...expected.keys()].join(", ")}.`);
}
for (const path of [...target.git.expectedPaths, ...target.githubCli.expectedPaths]) {
  if (!existsSync(join(targetRoot, path))) {
    throw new Error(`Bundled resource tree is missing ${path}.`);
  }
}
for (const sbom of [lock.git.sbom, lock.githubCli.sbom]) {
  if (sha256File(join(root, sbom.path)) !== sbom.sha256) {
    throw new Error(`SBOM digest changed for ${sbom.path}.`);
  }
}
console.log(`Verified bundled tools for ${targetName}.`);
