import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const destination = resolve("dist/website");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(resolve("website"), destination, { recursive: true });
cpSync(resolve("release-assets.json"), resolve(destination, "release-assets.json"));
console.log(`Built static website at ${destination}`);
