import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function checkPluginArchives(root, base) {
  const git = (args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const archives = (output) => output.split("\0").filter((path) => /\.tgz$/i.test(path));
  const tracked = archives(git(["ls-files", "-z"]));
  if (tracked.length) {
    throw new Error(`Plugin archives must not be tracked:\n${tracked.join("\n")}`);
  }
  if (base) {
    if (!/^[0-9a-f]{40}$/i.test(base)) {
      throw new Error("Archive guard --base must be a full commit SHA.");
    }
    git(["cat-file", "-e", `${base}^{commit}`]);
    const introduced = archives(git([
      "log", "--format=", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent",
      "--diff-filter=AM", `${base}..HEAD`,
    ]));
    if (introduced.length) {
      throw new Error(
        `Proposed commits introduce plugin archives (even if later deleted):\n${[...new Set(introduced)].join("\n")}`,
      );
    }
    const tree = git(["ls-tree", "-r", "--name-only", base]).trim().split("\n");
    const currentLedgers = new Map();
    if (existsSync(join(root, "plugins"))) {
      for (const directory of readdirSync(join(root, "plugins"), { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        const directoryPath = join(root, "plugins", directory.name);
        const manifest = JSON.parse(readFileSync(join(directoryPath, "plugin.json"), "utf8"));
        if (typeof manifest.id !== "string" || currentLedgers.has(manifest.id)) {
          throw new Error("Plugin directories must have unique stable manifest IDs.");
        }
        currentLedgers.set(manifest.id, join(directoryPath, "releases.json"));
      }
    }
    for (const path of tree.filter((path) => /^plugins\/[^/]+\/releases\.json$/.test(path))) {
      const manifest = JSON.parse(git(["show", `${base}:${posix.dirname(path)}/plugin.json`]));
      const prior = JSON.parse(git(["show", `${base}:${path}`]));
      const currentPath = currentLedgers.get(manifest.id);
      if (!currentPath || !existsSync(currentPath)) throw new Error(`Immutable release ledger removed: ${path}`);
      const current = JSON.parse(readFileSync(currentPath, "utf8"));
      for (const entry of prior) {
        const retained = current.find((candidate) => candidate.version === entry.version);
        if (JSON.stringify(retained) !== JSON.stringify(entry)) {
          throw new Error(`Immutable release ledger changed: ${path}@${entry.version}`);
        }
      }
    }
    const catalogPath = tree.find((path) => path === "plugins/catalog.json" || path === "packages/plugins/catalog.json");
    const currentPath = join(root, "plugins/catalog.json");
    if (catalogPath && existsSync(currentPath)) {
      const prior = JSON.parse(git(["show", `${base}:${catalogPath}`]));
      const current = JSON.parse(readFileSync(currentPath, "utf8"));
      for (const entry of current) {
        const previous = prior.find((candidate) => candidate.manifest.id === entry.manifest.id &&
          candidate.manifest.version === entry.manifest.version);
        if (previous && (
          previous.artifact.sha256 !== entry.artifact.sha256 ||
          previous.artifact.sizeBytes !== entry.artifact.sizeBytes ||
          previous.provenance.sourceCommit !== entry.provenance.sourceCommit
        )) throw new Error(`Same-version plugin bytes or source provenance changed: ${entry.manifest.id}`);
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--base")) {
    throw new Error("Usage: npm run check:plugin-archives -- [--base <commit>]");
  }
  checkPluginArchives(fileURLToPath(new URL("..", import.meta.url)), args[1]);
  console.log("No plugin archives in the Git index or proposed commits.");
}
