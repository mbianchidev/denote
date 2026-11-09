import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  selectMacosSigningIdentity,
  verifyMacosBundle,
} from "./macos-bundle.mjs";

const temporaryDirectories = [];
const projectRoot = process.cwd();
const cli = join(projectRoot, "node_modules/@tauri-apps/cli/tauri.js");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("macOS release signing identity", () => {
  it("uses a complete ad-hoc signature only without configured Apple signing", () => {
    expect(selectMacosSigningIdentity({}, [])).toBe("-");
  });

  it("preserves an explicit Developer ID identity over configuration", () => {
    expect(selectMacosSigningIdentity(
      { APPLE_SIGNING_IDENTITY: "Developer ID Application: Example (TESTTEAM01)" },
      [{ bundle: { macOS: { signingIdentity: "Configured identity" } } }],
    )).toBe("Developer ID Application: Example (TESTTEAM01)");
  });

  it("honors the last effective Tauri signing configuration", () => {
    expect(selectMacosSigningIdentity({}, [
      { bundle: { macOS: { signingIdentity: "Base identity" } } },
      { bundle: { macOS: { signingIdentity: "Release identity" } } },
    ])).toBe("Release identity");
    expect(selectMacosSigningIdentity({}, [
      { bundle: { macOS: { signingIdentity: "Base identity" } } },
      { bundle: { macOS: { signingIdentity: null } } },
    ])).toBe("-");
  });

  it("lets Tauri infer the identity from a complete certificate pair", () => {
    expect(selectMacosSigningIdentity({
      APPLE_CERTIFICATE: "synthetic certificate",
      APPLE_CERTIFICATE_PASSWORD: "synthetic password",
    }, [])).toBeUndefined();
    expect(selectMacosSigningIdentity({
      APPLE_CERTIFICATE: "synthetic certificate",
      APPLE_CERTIFICATE_PASSWORD: "",
    }, [])).toBeUndefined();
  });

  it.each([
    { APPLE_CERTIFICATE: "synthetic certificate" },
    { APPLE_CERTIFICATE_PASSWORD: "synthetic password" },
  ])("rejects incomplete certificate credentials instead of downgrading", (env) => {
    expect(() => selectMacosSigningIdentity(env, [])).toThrow(
      "APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD",
    );
  });

  it("rejects multiline identities before writing the Actions environment", () => {
    expect(() => selectMacosSigningIdentity({
      APPLE_SIGNING_IDENTITY: "Example\nUNEXPECTED=value",
    }, [])).toThrow("single line");
  });

  it.each(["unsupported", "constructor"])("rejects %s before inspecting a bundle", (target) => {
    expect(() => verifyMacosBundle("/missing/Fixture.app", target)).toThrow(
      "Unsupported macOS target",
    );
  });
});

describe.runIf(process.platform === "darwin")("packaged macOS signatures", () => {
  it.each([
    { target: "aarch64-apple-darwin", clangTarget: "arm64-apple-macos11", updaterEnabled: true },
    { target: "x86_64-apple-darwin", clangTarget: "x86_64-apple-macos10.13", updaterEnabled: true },
    { target: "aarch64-apple-darwin", clangTarget: "arm64-apple-macos11", updaterEnabled: false },
    { target: "x86_64-apple-darwin", clangTarget: "x86_64-apple-macos10.13", updaterEnabled: false },
  ])("verifies $target containers with updater enabled: $updaterEnabled", ({
    target, clangTarget, updaterEnabled,
  }) => {
    const root = mkdtempSync(join(tmpdir(), "denote-signing-fixture-"));
    temporaryDirectories.push(root);
    const native = join(root, "src-tauri");
    const output = join(native, "target", target, "release");
    const helper = join(root, "helper/Denote Speech Helper.app");
    const manifest = join(root, "integrity.json");
    mkdirSync(join(native, "src"), { recursive: true });
    mkdirSync(output, { recursive: true });
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/index.html"), "<!doctype html><title>Fixture</title>");
    writeFileSync(join(native, "src/main.rs"), "fn main() {}\n");
    writeFileSync(join(native, "Cargo.toml"), [
      "[package]", 'name = "fixture-app"', 'version = "0.1.0"', 'edition = "2024"', "",
    ].join("\n"));
    writeFileSync(manifest, '{"schemaVersion":1,"fixture":true}\n');
    createHelper(helper, clangTarget);
    const helperDigest = digest(join(helper, "Contents/MacOS/fixture-helper"));
    run("/usr/bin/clang", [
      "-x", "c", "-target", clangTarget, "-o", join(output, "fixture-app"), "-",
    ], { input: "int main(void) { return 0; }\n" });

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("APPLE_") || key.startsWith("TAURI_")) delete env[key];
    }
    env.CI = "true";
    const key = join(root, "updater.key");
    if (updaterEnabled) {
      run(process.execPath, [
        cli, "signer", "generate", "--ci", "--password", "fixture-password", "-w", key,
      ], { cwd: root, env });
      env.TAURI_SIGNING_PRIVATE_KEY = key;
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "fixture-password";
    }
    const config = {
      productName: "Fixture",
      version: "0.1.0",
      identifier: "dev.example.signing-fixture",
      build: { frontendDist: "../dist" },
      bundle: {
        active: true,
        targets: ["app", "dmg"],
        icon: [],
        createUpdaterArtifacts: updaterEnabled,
        resources: { [manifest]: `tools/${target}/integrity.json` },
        macOS: {
          entitlements: join(projectRoot, "src-tauri/Entitlements.plist"),
          files: { "Helpers/Denote Speech Helper.app": helper },
        },
      },
      plugins: updaterEnabled ? {
        updater: { pubkey: readFileSync(`${key}.pub`, "utf8").trim() },
      } : {},
    };
    writeFileSync(join(native, "tauri.conf.json"), JSON.stringify(config));
    env.GITHUB_ENV = join(root, "github-env");
    run(process.execPath, [join(projectRoot, "scripts/macos-bundle.mjs"), "configure", root], {
      cwd: root, env,
    });
    expect(readFileSync(env.GITHUB_ENV, "utf8")).toBe("APPLE_SIGNING_IDENTITY=-\n");
    env.APPLE_SIGNING_IDENTITY = readFileSync(env.GITHUB_ENV, "utf8").trim().split("=")[1];
    run(process.execPath, [cli, "bundle", "--target", target, "--bundles", "app", "dmg"], {
      cwd: root, env,
    });

    const app = join(output, "bundle/macos/Fixture.app");
    verifyMacosBundle(app, target);
    expect(digest(join(app, "Contents/Helpers/Denote Speech Helper.app/Contents/MacOS/fixture-helper")))
      .toBe(helperDigest);
    expect(readFileSync(join(app, `Contents/Resources/tools/${target}/integrity.json`)))
      .toEqual(readFileSync(manifest));

    if (updaterEnabled) {
      const extracted = join(root, "updater-extracted");
      mkdirSync(extracted);
      const archive = join(output, "bundle/macos/Fixture.app.tar.gz");
      run("/usr/bin/tar", ["-xzf", archive, "-C", extracted]);
      verifyMacosBundle(join(extracted, "Fixture.app"), target);
      expect(readFileSync(`${archive}.sig`, "utf8").trim()).not.toBe("");
    } else {
      expect(readdirSync(join(output, "bundle/macos")).filter((name) =>
        name.endsWith(".tar.gz") || name.endsWith(".sig"))).toEqual([]);
    }

    const dmgDirectory = join(output, "bundle/dmg");
    const images = readdirSync(dmgDirectory).filter((name) => name.endsWith(".dmg"));
    expect(images).toHaveLength(1);
    const mount = join(root, "dmg-mounted");
    mkdirSync(mount);
    run("/usr/bin/hdiutil", [
      "attach", "-nobrowse", "-readonly", "-mountpoint", mount, join(dmgDirectory, images[0]),
    ]);
    try {
      verifyMacosBundle(join(mount, "Fixture.app"), target);
    } finally {
      run("/usr/bin/hdiutil", ["detach", mount]);
    }

    writeFileSync(join(app, `Contents/Resources/tools/${target}/integrity.json`), "tampered");
    expect(() => verifyMacosBundle(app, target)).toThrow("codesign");
  }, 120_000);

  it("rejects helper-only/linker signatures and an over-entitled main app", () => {
    const root = mkdtempSync(join(tmpdir(), "denote-signing-negative-"));
    temporaryDirectories.push(root);
    const app = join(root, "Fixture.app");
    const target = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    const clangTarget = process.arch === "arm64" ? "arm64-apple-macos11" : "x86_64-apple-macos10.13";
    createHelper(app, clangTarget);
    createHelper(join(app, "Contents/Helpers/Denote Speech Helper.app"), clangTarget);
    expect(() => verifyMacosBundle(app, target)).toThrow("codesign");
    run("/usr/bin/codesign", [
      "--force", "--sign", "-", "--options", "runtime", "--entitlements",
      join(projectRoot, "src-tauri/SpeechHelper.entitlements.plist"), app,
    ]);
    expect(() => verifyMacosBundle(app, target)).toThrow("main app entitlements");
    for (const bundle of [join(app, "Contents/Helpers/Denote Speech Helper.app"), app]) {
      run("/usr/bin/codesign", [
        "--force", "--sign", "-", "--options", "runtime", "--entitlements",
        join(projectRoot, "src-tauri/Entitlements.plist"), bundle,
      ]);
    }
    expect(() => verifyMacosBundle(app, target)).toThrow("speech helper entitlements");
  });
});

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90_000, ...options,
  });
}

function createHelper(app, clangTarget) {
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  writeFileSync(join(app, "Contents/Resources/fixture.txt"), "synthetic helper resource\n");
  writeFileSync(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>fixture-helper</string>
<key>CFBundleIdentifier</key><string>dev.example.fixture-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  run("/usr/bin/clang", [
    "-x", "c", "-target", clangTarget, "-o", join(app, "Contents/MacOS/fixture-helper"), "-",
  ], { input: "int main(void) { return 0; }\n" });
  run("/usr/bin/codesign", [
    "--force", "--sign", "-", "--options", "runtime", "--entitlements",
    resolve("src-tauri/SpeechHelper.entitlements.plist"), app,
  ]);
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
