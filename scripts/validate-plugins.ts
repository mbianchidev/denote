import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_GUIDE_SECTIONS,
  assertValidPluginManifest,
  type PluginManifest,
} from "@denote/plugin-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsRoot = join(root, "packages", "plugins");
const requireArtifacts = process.argv.includes("--artifacts");
const errors: string[] = [];
const pluginDirectories = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(pluginsRoot, entry.name))
  .sort();

for (const pluginDirectory of pluginDirectories) {
  validatePlugin(pluginDirectory);
}
validateEditorImports(join(root, "src"));

if (errors.length > 0) {
  console.error(`Plugin validation failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${pluginDirectories.length} plugin package(s).`);
}

function validatePlugin(pluginDirectory: string): void {
  const label = relative(root, pluginDirectory);
  const manifestPath = join(pluginDirectory, "plugin.json");
  const packagePath = join(pluginDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    errors.push(`${label} is missing plugin.json.`);
    return;
  }
  if (!existsSync(packagePath)) {
    errors.push(`${label} is missing package.json.`);
    return;
  }

  const manifestValue = readJson(manifestPath, label);
  if (manifestValue === null) {
    return;
  }
  let manifest: PluginManifest;
  try {
    assertValidPluginManifest(manifestValue);
    manifest = manifestValue;
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return;
  }

  const packageValue = readJson(packagePath, label);
  if (packageValue === null) {
    return;
  }
  if (!isRecord(packageValue)) {
    errors.push(`${label}/package.json must be an object.`);
    return;
  }
  if (packageValue.private !== true) {
    errors.push(`${label}/package.json must remain private.`);
  }
  if (packageValue.version !== manifest.version) {
    errors.push(`${label} package and manifest versions must match.`);
  }

  const documentationPath = join(pluginDirectory, manifest.documentation);
  if (!existsSync(documentationPath) || !statSync(documentationPath).isFile()) {
    errors.push(`${label} is missing ${manifest.documentation}.`);
  } else {
    validateGuide(documentationPath, label);
  }
  const requiredPaths = [manifest.icon];
  requiredPaths.push(
    requireArtifacts ? manifest.entrypoint : sourceEntrypoint(manifest.entrypoint),
  );
  for (const packagePath of requiredPaths) {
    const path = join(pluginDirectory, packagePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      errors.push(`${label} is missing ${packagePath}.`);
    }
  }

  const dependencyGroups = [
    packageValue.dependencies,
    packageValue.devDependencies,
    packageValue.peerDependencies,
  ];
  for (const group of dependencyGroups) {
    if (!isRecord(group)) {
      continue;
    }
    for (const dependency of Object.keys(group)) {
      if (
        dependency.startsWith("@denote/plugin-") &&
        dependency !== "@denote/plugin-sdk"
      ) {
        errors.push(`${label} cannot depend on plugin package ${dependency}.`);
      }
    }
  }

  const runtimeDependencies = new Set([
    ...dependencyNames(packageValue.dependencies),
    ...dependencyNames(packageValue.peerDependencies),
  ]);
  validateSourceImports(
    join(pluginDirectory, "src"),
    pluginDirectory,
    label,
    runtimeDependencies,
  );
}

function validateGuide(path: string, label: string): void {
  const guide = readFileSync(path, "utf8").toLowerCase();
  for (const heading of PLUGIN_GUIDE_SECTIONS) {
    if (!guide.includes(`## ${heading}`)) {
      errors.push(`${label} guide is missing the "${heading}" section.`);
    }
  }
}

function validateSourceImports(
  sourceRoot: string,
  pluginRoot: string,
  label: string,
  runtimeDependencies: ReadonlySet<string>,
): void {
  if (!existsSync(sourceRoot)) {
    errors.push(`${label} is missing src/.`);
    return;
  }
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        const resolved = resolve(dirname(path), specifier);
        if (!isInside(pluginRoot, resolved)) {
          errors.push(
            `${relative(root, path)} imports outside its plugin folder: ${specifier}.`,
          );
        }
        continue;
      }
      if (specifier === "@denote/plugin-sdk") {
        continue;
      }
      if (
        specifier.startsWith("@denote/plugin-") ||
        specifier.startsWith("@tauri-apps/") ||
        specifier.startsWith("src/") ||
        specifier.startsWith("@/")
      ) {
        errors.push(
          `${relative(root, path)} uses forbidden import ${specifier}.`,
        );
        continue;
      }
      const packageName = dependencyName(specifier);
      if (!runtimeDependencies.has(packageName)) {
        errors.push(
          `${relative(root, path)} imports undeclared runtime dependency ${packageName}.`,
        );
      }
    }
  }
}

function validateEditorImports(sourceRoot: string): void {
  const canonicalPluginsRoot = realpathSync(pluginsRoot);
  for (const path of sourceFiles(sourceRoot)) {
    if (path.includes(".test.") || path.includes(".spec.")) {
      continue;
    }
    const canonicalPath = realpathSync(path);
    if (
      canonicalPath === canonicalPluginsRoot ||
      canonicalPath.startsWith(`${canonicalPluginsRoot}${sep}`)
    ) {
      errors.push(
        `${relative(root, path)} resolves into a plugin implementation.`,
      );
      continue;
    }
    const source = readFileSync(path, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (
        specifier.includes("packages/plugins/") ||
        (specifier.startsWith("@denote/plugin-") &&
          specifier !== "@denote/plugin-sdk")
      ) {
        errors.push(
          `${relative(root, path)} must not bundle plugin implementation ${specifier}.`,
        );
      }
    }
  }
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (
      [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(
        extname(path),
      )
    ) {
      files.push(path);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function sourceEntrypoint(entrypoint: string): string {
  return entrypoint.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
}

function isInside(parent: string, child: string): boolean {
  const canonicalParent = realpathSync(parent);
  const resolvedChild = resolve(child);
  const candidate = existsSync(resolvedChild)
    ? realpathSync(resolvedChild)
    : resolvedChild;
  return (
    candidate === canonicalParent ||
    candidate.startsWith(`${canonicalParent}${sep}`)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dependencyNames(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function dependencyName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function readJson(path: string, label: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    errors.push(`${label}: unable to parse ${relative(root, path)}: ${errorMessage(error)}`);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
