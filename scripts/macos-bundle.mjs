import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function selectMacosSigningIdentity(environment, configurations) {
  const certificate = environment.APPLE_CERTIFICATE;
  const password = environment.APPLE_CERTIFICATE_PASSWORD;
  if ((certificate && password === undefined) || (!certificate && password)) {
    throw new Error(
      "APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD must be supplied together.",
    );
  }
  let configuredIdentity;
  for (const configuration of configurations) {
    const macos = configuration.bundle?.macOS;
    if (macos && Object.hasOwn(macos, "signingIdentity")) {
      configuredIdentity = macos.signingIdentity ?? undefined;
    }
  }
  const identity = environment.APPLE_SIGNING_IDENTITY || configuredIdentity;
  if (identity !== undefined && (typeof identity !== "string" || /[\r\n]/.test(identity))) {
    throw new Error("The Apple signing identity must be a single line of text.");
  }
  return identity || (certificate ? undefined : "-");
}

export function verifyMacosBundle(app, target) {
  const architecture = new Map([
    ["aarch64-apple-darwin", "arm64"],
    ["x86_64-apple-darwin", "x86_64"],
  ]).get(target);
  if (!architecture) throw new Error(`Unsupported macOS target: ${target}`);
  const bundles = [
    [app, "main app", "com.apple.security.device.audio-input"],
    [join(app, "Contents/Helpers/Denote Speech Helper.app"), "speech helper",
      "com.apple.security.cs.disable-library-validation"],
  ];
  for (const [bundle, label, entitlement] of bundles) {
    const metadata = lstatSync(bundle);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`The ${label} must be a real app directory: ${bundle}`);
    }
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle]);
    const display = run("/usr/bin/codesign", [
      "--display", "--verbose=4", "--entitlements", "-", "--xml", bundle,
    ]);
    if (!/\bflags=0x[0-9a-f]+\([^)\n]*\bruntime\b/i.test(display.stderr)) {
      throw new Error(`The ${label} must use the hardened runtime: ${bundle}`);
    }
    const entitlements = JSON.parse(run("/usr/bin/plutil", [
      "-convert", "json", "-o", "-", "-",
    ], display.stdout).stdout);
    if (Object.keys(entitlements).length !== 1 || entitlements[entitlement] !== true) {
      throw new Error(`Unexpected ${label} entitlements: ${JSON.stringify(entitlements)}`);
    }
    const info = JSON.parse(run("/usr/bin/plutil", [
      "-convert", "json", "-o", "-", join(bundle, "Contents/Info.plist"),
    ]).stdout);
    const executable = info.CFBundleExecutable;
    if (typeof executable !== "string" || !executable || /[/\\]/.test(executable) ||
        executable === "." || executable === "..") {
      throw new Error(`Invalid ${label} executable in Info.plist.`);
    }
    const architectures = run("/usr/bin/lipo", [
      "-archs", join(bundle, "Contents/MacOS", executable),
    ]).stdout.trim();
    if (architectures !== architecture) {
      throw new Error(`The ${label} architecture must be ${architecture}, found ${architectures}.`);
    }
  }
  console.log(`Verified complete macOS bundle signatures, entitlements, and ${architecture} code: ${app}`);
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000, input,
  });
  if (result.error) {
    throw new Error(`Unable to run ${basename(command)}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${basename(command)} failed (${result.status ?? result.signal}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "configure" && (args.length === 1 || args.length === 2)) {
    if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required to configure release signing.");
    const native = join(resolve(args[0]), "src-tauri");
    const paths = [join(native, "tauri.conf.json")];
    const platform = join(native, "tauri.macos.conf.json");
    if (existsSync(platform)) paths.push(platform);
    if (args[1]) paths.push(resolve(args[1]));
    const identity = selectMacosSigningIdentity(
      process.env, paths.map((path) => JSON.parse(readFileSync(path, "utf8"))),
    );
    if (identity !== undefined) {
      appendFileSync(process.env.GITHUB_ENV, `APPLE_SIGNING_IDENTITY=${identity}\n`);
    }
    console.log(identity === "-"
      ? "Using complete ad-hoc macOS signatures. These builds are not notarized."
      : "Using configured Apple code signing without an ad-hoc fallback.");
  } else if (command === "verify" && args.length === 2) {
    verifyMacosBundle(resolve(args[0]), args[1]);
  } else {
    throw new Error(
      "Usage: node scripts/macos-bundle.mjs configure <root> [<release-config>] | verify <app> <target>",
    );
  }
}
