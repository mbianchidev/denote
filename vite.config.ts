import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const workerSafeNamedCharacterDecoder = require.resolve(
  "decode-named-character-reference",
);
const packageVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
const tauriVersion = (
  JSON.parse(
    readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
const cargoVersion = readFileSync(
  new URL("./src-tauri/Cargo.toml", import.meta.url),
  "utf8",
).match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
if (
  packageVersion !== tauriVersion ||
  cargoVersion === undefined ||
  cargoVersion !== tauriVersion
) {
  throw new Error(
    `Version mismatch: package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion ?? "missing"}`,
  );
}
const commitHash = resolveCommitHash();
const dirtyBuild = resolveDirtyBuild();

function resolveCommitHash(): string {
  const configured = process.env.DENOTE_COMMIT_HASH?.trim();
  const hash =
    configured ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  if (!/^[0-9a-f]{40}$/i.test(hash)) {
    throw new Error(`Unable to resolve a full Git commit hash: ${hash}`);
  }
  return hash;
}

function resolveDirtyBuild(): boolean {
  const configured = process.env.DENOTE_BUILD_DIRTY?.trim().toLowerCase();
  if (configured) {
    if (configured !== "true" && configured !== "false") {
      throw new Error("DENOTE_BUILD_DIRTY must be true or false");
    }
    return configured === "true";
  }
  if (process.env.DENOTE_COMMIT_HASH) {
    return false;
  }
  return (
    execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      {
        cwd: projectRoot,
        encoding: "utf8",
      },
    ).trim().length > 0
  );
}

// https://vite.dev/config/
export default defineConfig(async ({ command }) => ({
  plugins: [
    react(),
    ...(command === "build" ? [editorPluginBoundary()] : []),
  ],
  resolve:
    command === "serve"
      ? {
          alias: {
            "decode-named-character-reference":
              workerSafeNamedCharacterDecoder,
          },
        }
      : undefined,
  worker: {
    plugins: () => [workerSafeMarkdownEntities()],
  },
  define: {
    __DENOTE_VERSION__: JSON.stringify(tauriVersion),
    __DENOTE_COMMIT_HASH__: JSON.stringify(commitHash),
    __DENOTE_DIRTY_BUILD__: JSON.stringify(dirtyBuild),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
}));

function workerSafeMarkdownEntities() {
  return {
    name: "worker-safe-markdown-entities",
    enforce: "pre" as const,
    resolveId(source: string) {
      return source === "decode-named-character-reference"
        ? workerSafeNamedCharacterDecoder
        : null;
    },
  };
}

function editorPluginBoundary() {
  const pluginsRoot = realpathSync(
    fileURLToPath(new URL("./plugins", import.meta.url)),
  );
  return {
    name: "denote-editor-plugin-boundary",
    moduleParsed(moduleInfo: { id: string }) {
      const modulePath = moduleInfo.id.split("?")[0];
      if (modulePath.startsWith("\0") || !existsSync(modulePath)) {
        return;
      }
      const canonicalPath = realpathSync(modulePath);
      if (
        canonicalPath === pluginsRoot ||
        canonicalPath.startsWith(`${pluginsRoot}${sep}`)
      ) {
        throw new Error(
          `Editor build cannot include plugin implementation ${canonicalPath}.`,
        );
      }
    },
  };
}
