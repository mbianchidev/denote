import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeVersion,
  readDenoteVersions,
  setDenoteVersion,
} from "./release.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("release version script", () => {
  it("normalizes semantic versions and v-prefixed tags", () => {
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("v2.0.0-beta.1")).toBe("2.0.0-beta.1");
    expect(() => normalizeVersion("release-1")).toThrow("Invalid version");
  });

  it("updates every Denote version source", () => {
    const root = createFixture();
    const catalogBefore = JSON.parse(
      readFileSync(join(root, "plugins", "catalog.json"), "utf8"),
    )[0];

    expect(setDenoteVersion(root, "v1.4.0")).toEqual({
      changed: true,
      currentVersion: "0.1.0",
      version: "1.4.0",
    });
    expect(new Set(Object.values(readDenoteVersions(root)))).toEqual(
      new Set(["1.4.0"]),
    );
    expect(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8")).toContain(
      'description = "Synthetic desktop fixture"',
    );
    expect(
      JSON.parse(
        readFileSync(join(root, "plugins", "catalog.json"), "utf8"),
      )[0].artifact.url,
    ).toBe(
      "https://github.com/mbianchidev/denote/releases/download/v1.4.0/synthetic.plugin-2.3.4.tgz",
    );
    const catalogAfter = JSON.parse(
      readFileSync(join(root, "plugins", "catalog.json"), "utf8"),
    )[0];
    expect(catalogAfter).toEqual({
      ...catalogBefore,
      artifact: { ...catalogBefore.artifact, url: catalogAfter.artifact.url },
    });
  });

  it("checks a tag without changing files", () => {
    const root = createFixture();
    const packageBefore = readFileSync(join(root, "package.json"), "utf8");

    expect(
      setDenoteVersion(root, "v0.1.0", { checkOnly: true }),
    ).toEqual({
      changed: false,
      currentVersion: "0.1.0",
      version: "0.1.0",
    });
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(packageBefore);
    expect(() =>
      setDenoteVersion(root, "v0.2.0", { checkOnly: true }),
    ).toThrow("does not match");
  });

  it("rejects mismatched manifests before writing", () => {
    const root = createFixture({ cargoVersion: "0.2.0" });
    const packageBefore = readFileSync(join(root, "package.json"), "utf8");

    expect(() => setDenoteVersion(root, "0.3.0")).toThrow("out of sync");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(packageBefore);
  });

  it("rejects v-prefixed manifest versions", () => {
    const root = createFixture({ packageVersion: "v0.1.0" });

    expect(() => readDenoteVersions(root)).toThrow(
      "must contain an unprefixed semantic version",
    );
  });

  it("rejects catalog URLs for a different release tag", () => {
    const root = createFixture({ catalogReleaseVersion: "0.0.9" });

    expect(() =>
      setDenoteVersion(root, "v0.1.0", { checkOnly: true }),
    ).toThrow("Plugin catalog URLs do not match release tag v0.1.0");
  });
});

describe("release shell script", () => {
  it.each([
    { input: "1.4.0", tag: "v1.4.0", signTags: false },
    {
      input: "v1.4.0-rc.1+build.2",
      tag: "v1.4.0-rc.1+build.2",
      signTags: true,
    },
  ])(
    "generates commit and tag messages without an editor with tag signing $signTags",
    ({ input, tag, signTags }) => {
      const { root, remote, git, env } = createShellFixture({ signTags });
      const bash = process.platform === "win32"
        ? resolve(git("--exec-path"), "../../../bin/bash.exe")
        : "bash";
      const result = spawnSync(bash, ["scripts/release.sh", input], {
        cwd: root,
        env,
        encoding: "utf8",
        input: "",
        timeout: 20_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(git("log", "-1", "--format=%B")).toBe(`Release ${tag}`);
      expect(git("cat-file", "-p", "HEAD")).not.toContain("\ngpgsig ");
      expect(
        git("for-each-ref", "--format=%(contents:subject)", `refs/tags/${tag}`),
      ).toBe(`Release ${tag}`);
      expect(
        git("cat-file", "-p", `refs/tags/${tag}`).includes(
          "-----BEGIN SSH SIGNATURE-----",
        ),
      ).toBe(signTags);
      const commit = git("rev-parse", "HEAD");
      expect(git("--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(commit);
      expect(
        git("--git-dir", remote, "rev-parse", `refs/tags/${tag}^{commit}`),
      ).toBe(commit);
      expect(git("status", "--porcelain")).toBe("");
    },
    30_000,
  );
});

function createShellFixture({ signTags }) {
  const root = createFixture();
  const sandbox = mkdtempSync(join(tmpdir(), "denote-release-shell-"));
  temporaryRoots.push(sandbox);
  const remote = join(sandbox, "origin.git");
  const globalConfig = join(sandbox, "gitconfig");
  const validation = join(sandbox, "validation.sh");
  writeFileSync(globalConfig, "");
  writeFileSync(
    validation,
    `npm() {
  if [[ "$1" == run && "$2" == release ]]; then
    shift 3
    node scripts/release.mjs "$@"
  fi
}
cargo() { return 0; }
`,
  );
  const env = {
    ...process.env,
    BASH_ENV: validation.replaceAll("\\", "/"),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EDITOR: "false",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Synthetic Release",
    GIT_AUTHOR_EMAIL: "release@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic Release",
    GIT_COMMITTER_EMAIL: "release@example.invalid",
  };
  const git = (...args) => execFileSync("git", args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  }).trim();
  mkdirSync(join(root, "scripts"));
  for (const name of ["release.sh", "release.mjs"]) {
    copyFileSync(
      fileURLToPath(new URL(name, import.meta.url)),
      join(root, "scripts", name),
    );
  }
  for (const name of ["updater-release.mjs", "preinstall-validate-plugins.mjs"]) {
    writeFileSync(join(root, "scripts", name), "process.exit(0);\n");
  }
  git("init", "--quiet", "--initial-branch=main");
  git("config", "core.autocrlf", "false");
  git("config", "commit.gpgSign", "true");
  git("config", "tag.gpgSign", String(signTags));
  if (signTags) {
    const signingKey = join(sandbox, "signing-key");
    execFileSync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", "synthetic-release", "-f", signingKey],
      { env, stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 },
    );
    git("config", "gpg.format", "ssh");
    git("config", "user.signingKey", signingKey);
  }
  git("add", ".");
  git("commit", "--no-gpg-sign", "-qm", "Synthetic release fixture");
  git("init", "--bare", "--quiet", remote);
  git("remote", "add", "origin", remote);
  git("push", "--quiet", "--set-upstream", "origin", "main");
  return { root, remote, git, env };
}

function createFixture({
  cargoVersion = "0.1.0",
  packageVersion = "0.1.0",
  catalogReleaseVersion = "0.1.0",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "denote-release-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "src-tauri"));
  mkdirSync(join(root, "plugins"), { recursive: true });

  writeJson(join(root, "package.json"), {
    name: "synthetic-denote",
    version: packageVersion,
  });
  writeJson(join(root, "package-lock.json"), {
    name: "synthetic-denote",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "synthetic-denote",
        version: "0.1.0",
      },
    },
  });
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "synthetic-denote"\nversion = "${cargoVersion}"\ndescription = "Synthetic desktop fixture"\n\n[dependencies]\nserde = "1"\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "denote"\nversion = "${cargoVersion}"\ndependencies = [\n "serde",\n]\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n`,
  );
  writeJson(join(root, "src-tauri", "tauri.conf.json"), {
    productName: "Synthetic Denote",
    version: "0.1.0",
  });
  writeJson(join(root, "plugins", "catalog.json"), [
    {
      manifest: {
        id: "synthetic.plugin",
        version: "2.3.4",
      },
      artifact: {
        url: `https://github.com/mbianchidev/denote/releases/download/v${catalogReleaseVersion}/synthetic.plugin-2.3.4.tgz`,
        sha256: "0".repeat(64),
        sizeBytes: 1,
      },
      provenance: {
        publisherId: "denote",
        sourceCommit: "a".repeat(40),
        trusted: true,
      },
    },
  ]);

  return root;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
