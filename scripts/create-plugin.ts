import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_CATEGORIES,
  type PluginCatalogEntry,
  type PluginCategory,
  type PluginManifest,
} from "@denote/plugin-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const [pluginId, displayName, requestedCategory = "other"] = process.argv.slice(2);

if (!pluginId || !displayName) {
  throw new Error(
    "Usage: npm run create:plugin -- <namespaced-plugin-id> <display-name> [category]",
  );
}
if (!/^(?=.*\.)[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId)) {
  throw new Error(
    "Plugin ID must be a namespaced lowercase identifier such as denote.example.",
  );
}
if (!PLUGIN_CATEGORIES.includes(requestedCategory as PluginCategory)) {
  throw new Error(
    `Category must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`,
  );
}

const category = requestedCategory as PluginCategory;
const packageSuffix = pluginId.split(".").at(-1);
if (!packageSuffix) {
  throw new Error("Plugin ID does not contain a package name.");
}
const pluginDirectory = join(root, "packages", "plugins", pluginId);
if (existsSync(pluginDirectory)) {
  throw new Error(`Plugin directory already exists: ${pluginDirectory}`);
}

const manifest: PluginManifest = {
  schemaVersion: 1,
  id: pluginId,
  name: displayName,
  version: "0.1.0",
  description: `Describe the ${displayName} plugin.`,
  publisher: {
    name: "Denote",
    url: "https://github.com/mbianchidev/denote",
  },
  license: "MIT",
  repository: "https://github.com/mbianchidev/denote",
  icon: "icon.svg",
  category,
  compatibility: {
    apiVersion: 1,
    minimumDenoteVersion: "0.1.0",
    maximumDenoteVersion: "1.0.0",
  },
  permissions: [],
  entrypoint: "dist/index.js",
  documentation: "guide.md",
};
const guide = `# ${displayName}

## Purpose

Describe the problem this plugin solves.

## Enablement and permissions

Explain every requested permission and why it is necessary.

## Usage

Document commands, views, and expected workflows.

## Settings

Document settings, or state that the plugin has none.

## Disable behavior

Explain retained data and confirm that package code is deleted.

## Troubleshooting

List actionable recovery steps and known limitations.
`;
const catalogPath = join(root, "packages", "plugins", "catalog.json");
const catalog = JSON.parse(
  readFileSync(catalogPath, "utf8"),
) as PluginCatalogEntry[];
catalog.push({
  manifest,
  artifact: {
    url: `https://raw.githubusercontent.com/mbianchidev/denote/${"0".repeat(40)}/plugin-artifacts/${pluginId}-0.1.0.tgz`,
    sha256: "0".repeat(64),
    sizeBytes: 1,
  },
  provenance: {
    publisherId: "denote",
    sourceCommit: "0".repeat(40),
    trusted: true,
  },
  guide: guide.trim(),
});

mkdirSync(join(pluginDirectory, "src"), { recursive: true });
writeJson(join(pluginDirectory, "package.json"), {
  name: `@denote/plugin-${packageSuffix}`,
  version: "0.1.0",
  private: true,
  type: "module",
  main: "./dist/index.js",
  files: ["dist", "plugin.json", "guide.md", "icon.svg"],
  dependencies: {
    "@denote/plugin-sdk": "0.1.0",
  },
});
writeJson(join(pluginDirectory, "plugin.json"), manifest);
writeFileSync(join(pluginDirectory, "guide.md"), guide);
writeFileSync(
  join(pluginDirectory, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="8" fill="#202327"/>
  <path d="M18 16h20l8 8v24H18z" fill="none" stroke="#b1cf98" stroke-width="4"/>
</svg>
`,
);
writeFileSync(
  join(pluginDirectory, "src", "index.ts"),
  `import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    context.logger.info("${displayName} activated.");
  },
};

export default plugin;
`,
);
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Created ${pluginDirectory}.`);
console.log("Implement the plugin, then run npm run package:plugins.");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
