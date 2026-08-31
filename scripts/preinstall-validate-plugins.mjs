import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsRoot = join(root, "packages", "plugins");
const failures = [];

for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const packagePath = join(pluginsRoot, entry.name, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
    failures.push(`${entry.name} declares npm lifecycle scripts.`);
  }
  if (packageJson.bin) {
    failures.push(`${entry.name} declares executable package bins.`);
  }
  for (const group of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
  ]) {
    for (const dependency of Object.keys(group ?? {})) {
      if (
        dependency.startsWith("@denote/plugin-") &&
        dependency !== "@denote/plugin-sdk"
      ) {
        failures.push(`${entry.name} depends on plugin ${dependency}.`);
      }
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Unsafe plugin packages:\n- ${failures.join("\n- ")}`);
}
console.log("Plugin packages contain no install scripts or executable bins.");
