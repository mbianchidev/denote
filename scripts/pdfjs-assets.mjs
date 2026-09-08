import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repositoryRoot, "node_modules", "pdfjs-dist");
const outputRoot = join(repositoryRoot, "public", "pdfjs-assets");
const assetDirectories = ["cmaps", "standard_fonts", "wasm", "iccs"];
const maximumAssetBytes = 8 * 1024 * 1024;

const packageJson = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
if (packageJson.license !== "Apache-2.0") {
  throw new Error(
    `Unexpected pdfjs-dist license ${packageJson.license ?? "missing"}.`,
  );
}

const files = [];
for (const directory of assetDirectories) {
  await collect(join(packageRoot, directory));
}
files.push(join(packageRoot, "LICENSE"));

const totalBytes = (
  await Promise.all(files.map(async (path) => (await stat(path)).size))
).reduce((sum, size) => sum + size, 0);
if (totalBytes > maximumAssetBytes) {
  throw new Error(
    `PDF.js runtime assets use ${totalBytes} bytes, above the ${maximumAssetBytes}-byte limit.`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
for (const source of files) {
  const assetPath =
    source === join(packageRoot, "LICENSE")
      ? "LICENSE"
      : relative(packageRoot, source);
  const destination = join(outputRoot, assetPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(
    {
      package: "pdfjs-dist",
      version: packageJson.version,
      license: packageJson.license,
      files: files.length,
      bytes: totalBytes,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Prepared ${files.length} PDF.js assets (${totalBytes} bytes) for pdfjs-dist ${packageJson.version}.`,
);

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`PDF.js runtime asset cannot be a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      await collect(path);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported PDF.js runtime asset type: ${path}`);
    }
    if (
      path.includes(`${sep}wasm${sep}quickjs-eval.`) ||
      path.endsWith(".map")
    ) {
      continue;
    }
    files.push(path);
  }
}
