import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function declarations(directory) {
  const files = new Map();
  if (!existsSync(directory)) return files;
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error("API declarations must not contain links.");
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
        files.set(relative(directory, target), readFileSync(target, "utf8").replace(/\r\n/g, "\n"));
      } else {
        throw new Error(`Unexpected API baseline entry: ${entry.name}`);
      }
    }
  };
  visit(directory);
  return files;
}

export function checkPluginApi({
  project = join(root, "packages/plugin-sdk/tsconfig.api.json"),
  baseline = join(root, "packages/plugin-sdk/api/v1"),
  update = false,
} = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "denote-api-declarations-"));
  try {
    execFileSync(process.execPath, [
      join(root, "node_modules/typescript/bin/tsc"),
      "--project", project, "--outDir", temporary,
    ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    const current = declarations(temporary);
    if (current.size === 0) throw new Error("No plugin API declarations were emitted.");
    const frozen = declarations(baseline);
    if (update) {
      mkdirSync(baseline, { recursive: true });
      for (const [name, content] of current) {
        const target = join(baseline, name);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      for (const name of frozen.keys()) {
        if (!current.has(name)) unlinkSync(join(baseline, name));
      }
    } else {
      const changed = [...new Set([...frozen.keys(), ...current.keys()])]
        .filter((name) => frozen.get(name) !== current.get(name)).sort();
      if (changed.length) {
        throw new Error(
          `Plugin API 1 declarations changed: ${changed.join(", ")}. ` +
          "Review compatibility and the API freeze policy before explicitly updating the baseline.",
        );
      }
    }
    return current.size;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--update-baseline")) {
      throw new Error("Usage: npm run check:plugin-api -- [--update-baseline]");
    }
    const update = args.includes("--update-baseline");
    const count = checkPluginApi({ update });
    console.log(`${update ? "Recorded" : "Verified"} ${count} frozen plugin API 1 declaration files.`);
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout) process.stderr.write(error.stdout);
    if (typeof error?.stderr === "string" && error.stderr) process.stderr.write(error.stderr);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
