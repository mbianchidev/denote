import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
      "log", "--format=", "--name-only", "-z", "--no-renames",
      "--diff-filter=AM", `${base}..HEAD`,
    ]));
    if (introduced.length) {
      throw new Error(
        `Proposed commits introduce plugin archives (even if later deleted):\n${[...new Set(introduced)].join("\n")}`,
      );
    }
    const tree = git(["ls-tree", "-r", "--name-only", base]).trim().split("\n");
    for (const path of tree.filter((path) => /^plugins\/[^/]+\/releases\.json$/.test(path))) {
      const prior = JSON.parse(git(["show", `${base}:${path}`]));
      if (!existsSync(join(root, path))) throw new Error(`Immutable release ledger removed: ${path}`);
      const current = JSON.parse(readFileSync(join(root, path), "utf8"));
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
