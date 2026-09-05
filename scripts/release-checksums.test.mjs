import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReleaseProvenance,
  writeReleaseChecksums,
} from "./release-checksums.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("release checksums", () => {
  it("keeps every release asset while deduplicating attestation subjects by digest", async () => {
    const target = "x86_64-unknown-linux-gnu";
    const artifact = "linux-x64";
    const { projectRoot, runnerTemp } = createFixture({
      runnerOs: "Linux",
      target,
      artifact,
    });
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        target,
        "release",
        "bundle",
        "appimage",
        "Denote.AppImage",
      ),
      "duplicate release bytes",
    );
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        target,
        "release",
        "bundle",
        "deb",
        "Denote.deb",
      ),
      "duplicate release bytes",
    );
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        target,
        "release",
        "bundle",
        "appimage",
        "Denote.AppDir",
        "usr",
        "bin",
        "denote",
      ),
      "internal staging bytes",
    );

    const result = await writeReleaseChecksums({
      projectRoot,
      runnerTemp,
      runnerOs: "Linux",
      target,
      artifact,
      provenance: provenanceFixture(),
    });
    const releaseLines = readLines(result.releaseChecksumsPath);
    const attestationLines = readLines(result.attestationSubjectsPath);

    expect(releaseLines.map(readName)).toEqual([
      "Denote.AppImage",
      "Denote.deb",
      "Denote.rpm",
      `bundled-tools-${artifact}.spdx.json`,
      `denote-tools-${target}-git.tar.gz`,
      `denote-tools-${target}-gh.tar.gz`,
    ]);
    expect(attestationLines.map(readName)).toEqual([
      "Denote.AppImage",
      "Denote.rpm",
      `denote-tools-${target}-git.tar.gz`,
      `denote-tools-${target}-gh.tar.gz`,
    ]);
    expect(new Set(attestationLines.map(readDigest)).size).toBe(
      attestationLines.length,
    );
  });

  it.each([
    {
      runnerOs: "macOS",
      target: "aarch64-apple-darwin",
      artifact: "macos-aarch64",
      bundleNames: ["dmg/Denote.dmg"],
    },
    {
      runnerOs: "Windows",
      target: "x86_64-pc-windows-msvc",
      artifact: "windows-x64",
      bundleNames: ["msi/Denote.msi", "nsis/Denote-setup.exe"],
    },
  ])("selects only published $runnerOs bundles", async (fixture) => {
    const { projectRoot, runnerTemp } = createFixture(fixture);

    const result = await writeReleaseChecksums({
      projectRoot,
      runnerTemp,
      runnerOs: fixture.runnerOs,
      target: fixture.target,
      artifact: fixture.artifact,
      provenance: provenanceFixture(),
    });

    expect(readLines(result.releaseChecksumsPath).map(readName)).toEqual([
      ...fixture.bundleNames.map((name) => name.split("/").at(-1)),
      `bundled-tools-${fixture.artifact}.spdx.json`,
      `denote-tools-${fixture.target}-git.tar.gz`,
      `denote-tools-${fixture.target}-gh.tar.gz`,
    ]);
  });

  it("rejects ambiguous release bundle output", async () => {
    const fixture = {
      runnerOs: "macOS",
      target: "x86_64-apple-darwin",
      artifact: "macos-x64",
    };
    const { projectRoot, runnerTemp } = createFixture(fixture);
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        fixture.target,
        "release",
        "bundle",
        "dmg",
        "Duplicate.dmg",
      ),
      "second disk image",
    );

    await expect(
      writeReleaseChecksums({
        projectRoot,
        runnerTemp,
        ...fixture,
        provenance: provenanceFixture(),
      }),
    ).rejects.toThrow("Expected exactly one macOS disk image");
  });

  it("rejects unexpected bundled tool archives", async () => {
    const fixture = {
      runnerOs: "Linux",
      target: "x86_64-unknown-linux-gnu",
      artifact: "linux-x64",
    };
    const { projectRoot, runnerTemp } = createFixture(fixture);
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        "bundled-tools",
        fixture.target,
        "unexpected.tar.gz",
      ),
      "unexpected tool archive",
    );

    await expect(
      writeReleaseChecksums({
        projectRoot,
        runnerTemp,
        ...fixture,
        provenance: provenanceFixture(),
      }),
    ).rejects.toThrow("Expected bundled tool archives");
  });

  it("runs against an explicit release checkout", () => {
    const fixture = {
      runnerOs: "macOS",
      target: "aarch64-apple-darwin",
      artifact: "macos-aarch64",
    };
    const { projectRoot, runnerTemp } = createFixture(fixture);
    const scriptPath = resolve("scripts/release-checksums.mjs");

    execFileSync(
      process.execPath,
      [
        scriptPath,
        projectRoot,
        fixture.runnerOs,
        fixture.target,
        fixture.artifact,
        runnerTemp,
      ],
      {
        cwd: runnerTemp,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "push",
          GITHUB_REF: "refs/tags/v0.1.3",
          GITHUB_REPOSITORY: "mbianchidev/denote",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_RUN_ID: "33977250528",
          GITHUB_SERVER_URL: "https://github.com",
          RELEASE_REPOSITORY_ID: "1348692382",
          RELEASE_REPOSITORY_OWNER_ID: "37507190",
          RELEASE_RUNNER_ENVIRONMENT: "github-hosted",
          RELEASE_SOURCE_SHA: "a".repeat(40),
          RELEASE_TAG: "v0.1.3",
          RELEASE_WORKFLOW_REF:
            "mbianchidev/denote/.github/workflows/release.yml@refs/tags/v0.1.3",
          RELEASE_WORKFLOW_SHA: "a".repeat(40),
        },
      },
    );

    const releaseContents = readFileSync(
      join(projectRoot, `denote-${fixture.artifact}-SHA256SUMS.txt`),
      "utf8",
    );
    expect(releaseContents).not.toContain("\r");
    expect(releaseContents).toContain("Denote.dmg");
    expect(
      JSON.parse(
        readFileSync(
          join(runnerTemp, `denote-${fixture.artifact}-PROVENANCE.json`),
          "utf8",
        ),
      ).buildDefinition.resolvedDependencies,
    ).toHaveLength(1);
  });
});

describe("release provenance", () => {
  it("records both the workflow revision and immutable release source for manual retries", () => {
    const predicate = buildReleaseProvenance(
      provenanceFixture({
        eventName: "workflow_dispatch",
        workflowGitRef: "refs/heads/main",
        workflowRef:
          "mbianchidev/denote/.github/workflows/release.yml@refs/heads/main",
        workflowSha: "b".repeat(40),
      }),
    );

    expect(predicate.buildDefinition.externalParameters).toEqual({
      workflow: {
        ref: "refs/heads/main",
        repository: "https://github.com/mbianchidev/denote",
        path: ".github/workflows/release.yml",
      },
    });
    expect(predicate.buildDefinition.resolvedDependencies).toEqual([
      {
        uri: "git+https://github.com/mbianchidev/denote@refs/heads/main",
        digest: { gitCommit: "b".repeat(40) },
      },
      {
        uri: "git+https://github.com/mbianchidev/denote@refs/tags/v0.1.3",
        digest: { gitCommit: "a".repeat(40) },
      },
    ]);
  });

  it("does not duplicate the release dependency for a tag push", () => {
    const predicate = buildReleaseProvenance(provenanceFixture());

    expect(predicate.buildDefinition.resolvedDependencies).toHaveLength(1);
  });

  it("rejects tag push provenance for a different source commit", () => {
    expect(() =>
      buildReleaseProvenance(
        provenanceFixture({ workflowSha: "b".repeat(40) }),
      ),
    ).toThrow("Tag push provenance must build");
  });
});

function createFixture({ runnerOs, target, artifact }) {
  const projectRoot = mkdtempSync(join(tmpdir(), "denote-release-checksums-"));
  const runnerTemp = join(projectRoot, "runner-temp");
  temporaryRoots.push(projectRoot);
  mkdirSync(runnerTemp);

  const bundleNames = {
    Linux: [
      "appimage/Denote.AppImage",
      "deb/Denote.deb",
      "rpm/Denote.rpm",
    ],
    macOS: ["dmg/Denote.dmg"],
    Windows: ["msi/Denote.msi", "nsis/Denote-setup.exe"],
  }[runnerOs];

  for (const [index, name] of bundleNames.entries()) {
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        target,
        "release",
        "bundle",
        name,
      ),
      `synthetic bundle ${index}`,
    );
  }

  for (const tool of ["git", "gh"]) {
    writeSynthetic(
      join(
        projectRoot,
        "src-tauri",
        "target",
        "bundled-tools",
        target,
        `denote-tools-${target}-${tool}.tar.gz`,
      ),
      `synthetic ${tool} archive`,
    );
  }

  writeSynthetic(
    join(projectRoot, `bundled-tools-${artifact}.spdx.json`),
    '{"synthetic":true}\n',
  );

  return { projectRoot, runnerTemp };
}

function writeSynthetic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function readLines(path) {
  return readFileSync(path, "utf8").trim().split(/\r?\n/);
}

function readDigest(line) {
  return line.slice(0, line.indexOf(" "));
}

function readName(line) {
  return line.slice(line.indexOf(" ") + 2);
}

function provenanceFixture(overrides = {}) {
  return {
    serverUrl: "https://github.com",
    repository: "mbianchidev/denote",
    repositoryId: "1348692382",
    repositoryOwnerId: "37507190",
    eventName: "push",
    workflowRef:
      "mbianchidev/denote/.github/workflows/release.yml@refs/tags/v0.1.3",
    workflowGitRef: "refs/tags/v0.1.3",
    workflowSha: "a".repeat(40),
    runnerEnvironment: "github-hosted",
    releaseTag: "v0.1.3",
    sourceSha: "a".repeat(40),
    runId: "33977250528",
    runAttempt: "1",
    ...overrides,
  };
}
