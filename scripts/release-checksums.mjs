import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_WORKFLOW_BUILD_TYPE =
  "https://actions.github.io/buildtypes/workflow/v1";

const BUNDLE_SPECS = {
  Linux: [
    {
      directory: "appimage",
      suffix: ".AppImage",
      label: "Linux AppImage",
    },
    {
      directory: "deb",
      suffix: ".deb",
      label: "Debian package",
    },
    {
      directory: "rpm",
      suffix: ".rpm",
      label: "RPM package",
    },
  ],
  macOS: [
    {
      directory: "dmg",
      suffix: ".dmg",
      label: "macOS disk image",
    },
  ],
  Windows: [
    {
      directory: "msi",
      suffix: ".msi",
      label: "Windows MSI",
    },
    {
      directory: "nsis",
      suffix: "-setup.exe",
      label: "Windows NSIS installer",
    },
  ],
};

export async function writeReleaseChecksums({
  projectRoot,
  runnerTemp,
  runnerOs,
  target,
  artifact,
  provenance,
}) {
  requireSafeToken(target, "target");
  requireSafeToken(artifact, "artifact");

  const bundleSpecs = Object.hasOwn(BUNDLE_SPECS, runnerOs)
    ? BUNDLE_SPECS[runnerOs]
    : undefined;
  if (!bundleSpecs) {
    throw new Error(`Unsupported runner OS: ${runnerOs}`);
  }

  const root = resolve(projectRoot);
  const temporaryRoot = resolve(runnerTemp);
  requireDirectory(temporaryRoot, "runner temporary directory");

  const bundleRoot = join(
    root,
    "src-tauri",
    "target",
    target,
    "release",
    "bundle",
  );
  const bundlePaths = bundleSpecs.map(({ directory, suffix, label }) =>
    findSingleArtifact(join(bundleRoot, directory), suffix, label),
  );

  const toolsRoot = join(
    root,
    "src-tauri",
    "target",
    "bundled-tools",
    target,
  );
  const toolPaths = requireExactArtifacts(
    toolsRoot,
    ["git", "gh"].map((tool) => `denote-tools-${target}-${tool}.tar.gz`),
    "bundled tool archives",
  );

  const sbomPath = join(root, `bundled-tools-${artifact}.spdx.json`);
  requireRegularFile(sbomPath, "bundled tools SBOM");

  const bundleEntries = await checksumEntries(root, bundlePaths);
  const toolEntries = await checksumEntries(root, toolPaths);
  const sbomEntry = await checksumEntry(root, sbomPath);
  const releaseEntries = withReleaseNames([
    ...bundleEntries,
    sbomEntry,
    ...toolEntries,
  ]);
  const subjectEntries = releaseEntries.filter(
    ({ name }) => name !== basename(sbomEntry.name),
  );
  const uniqueSubjectEntries = uniqueSubjectsByDigest(subjectEntries);

  const releaseChecksumsPath = join(
    root,
    `denote-${artifact}-SHA256SUMS.txt`,
  );
  const attestationSubjectsPath = join(
    temporaryRoot,
    `denote-${artifact}-ATTESTATION-SUBJECTS.txt`,
  );
  const provenancePath = join(
    temporaryRoot,
    `denote-${artifact}-PROVENANCE.json`,
  );

  writeChecksumFile(releaseChecksumsPath, releaseEntries);
  writeChecksumFile(attestationSubjectsPath, uniqueSubjectEntries);
  writeFileSync(
    provenancePath,
    `${JSON.stringify(buildReleaseProvenance(provenance))}\n`,
    "utf8",
  );

  return {
    releaseChecksumsPath,
    attestationSubjectsPath,
    provenancePath,
    releaseCount: bundleEntries.length + toolEntries.length + 1,
    subjectCount: subjectEntries.length,
    uniqueSubjectCount: uniqueSubjectEntries.length,
  };
}

export function buildReleaseProvenance({
  serverUrl,
  repository,
  repositoryId,
  repositoryOwnerId,
  eventName,
  workflowRef,
  workflowGitRef,
  workflowSha,
  runnerEnvironment,
  releaseTag,
  sourceSha,
  runId,
  runAttempt,
}) {
  requireHttpsUrl(serverUrl, "GitHub server URL");
  requireRepository(repository);
  requireNumericId(repositoryId, "repository ID");
  requireNumericId(repositoryOwnerId, "repository owner ID");
  requireNumericId(runId, "run ID");
  requireNumericId(runAttempt, "run attempt");
  requireGitRef(workflowGitRef, "workflow Git ref");
  requireGitSha(workflowSha, "workflow SHA");
  requireGitSha(sourceSha, "release source SHA");
  requireSafeToken(releaseTag, "release tag", true);
  requireSafeToken(runnerEnvironment, "runner environment");
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(`Unsupported release event: ${eventName}`);
  }

  const workflowPath = parseWorkflowPath({
    repository,
    workflowRef,
    workflowGitRef,
  });
  const repositoryUrl = `${serverUrl.replace(/\/$/, "")}/${repository}`;
  const releaseRef = `refs/tags/${releaseTag}`;
  if (
    eventName === "push" &&
    (workflowGitRef !== releaseRef || workflowSha !== sourceSha)
  ) {
    throw new Error(
      `Tag push provenance must build ${releaseRef} at ${sourceSha}.`,
    );
  }

  const workflowDependency = {
    uri: `git+${repositoryUrl}@${workflowGitRef}`,
    digest: { gitCommit: workflowSha },
  };
  const releaseDependency = {
    uri: `git+${repositoryUrl}@${releaseRef}`,
    digest: { gitCommit: sourceSha },
  };
  const resolvedDependencies =
    workflowDependency.uri === releaseDependency.uri &&
    workflowDependency.digest.gitCommit === releaseDependency.digest.gitCommit
      ? [workflowDependency]
      : [workflowDependency, releaseDependency];
  return {
    buildDefinition: {
      buildType: GITHUB_WORKFLOW_BUILD_TYPE,
      externalParameters: {
        workflow: {
          ref: workflowGitRef,
          repository: repositoryUrl,
          path: workflowPath,
        },
      },
      internalParameters: {
        github: {
          event_name: eventName,
          repository_id: repositoryId,
          repository_owner_id: repositoryOwnerId,
          runner_environment: runnerEnvironment,
        },
      },
      resolvedDependencies,
    },
    runDetails: {
      builder: {
        id: `${serverUrl.replace(/\/$/, "")}/${workflowRef}`,
      },
      metadata: {
        invocationId: `${repositoryUrl}/actions/runs/${runId}/attempts/${runAttempt}`,
      },
    },
  };
}

function findSingleArtifact(directory, suffix, label) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to inspect ${label} output at ${directory}: ${errorMessage(error)}`,
    );
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(directory, entry.name))
    .sort();

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${label} in ${directory}, found ${matches.length}.`,
    );
  }
  return matches[0];
}

function requireExactArtifacts(directory, expectedNames, label) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to inspect ${label} at ${directory}: ${errorMessage(error)}`,
    );
  }

  const actualNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tar.gz"))
    .map((entry) => entry.name)
    .sort();
  const sortedExpectedNames = [...expectedNames].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(sortedExpectedNames)) {
    throw new Error(
      `Expected ${label} ${sortedExpectedNames.join(", ")} in ${directory}, found ${actualNames.join(", ") || "none"}.`,
    );
  }
  return expectedNames.map((name) => join(directory, name));
}

function requireDirectory(path, label) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new Error(
      `Unable to inspect ${label} at ${path}: ${errorMessage(error)}`,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
}

function requireRegularFile(path, label) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new Error(
      `Unable to inspect ${label} at ${path}: ${errorMessage(error)}`,
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}

async function checksumEntries(projectRoot, paths) {
  const entries = [];
  for (const path of paths) {
    entries.push(await checksumEntry(projectRoot, path));
  }
  return entries;
}

async function checksumEntry(projectRoot, path) {
  const name = relative(projectRoot, path).split(sep).join("/");
  if (!name || name === ".." || name.startsWith("../")) {
    throw new Error(`Release asset is outside the project root: ${path}`);
  }
  return { digest: await sha256File(path), name };
}

function withReleaseNames(entries) {
  const names = new Set();
  return entries.map(({ digest, name }) => {
    const releaseName = basename(name);
    if (names.has(releaseName)) {
      throw new Error(`Duplicate release asset filename: ${releaseName}`);
    }
    names.add(releaseName);
    return { digest, name: releaseName };
  });
}

function sha256File(path) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.once("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolveDigest(hash.digest("hex")));
  });
}

function uniqueSubjectsByDigest(entries) {
  const seen = new Set();
  return entries.filter(({ digest }) => {
    // GitHub rejects repeated digests in one attestation statement, even when
    // the identical bytes have different filenames.
    if (seen.has(digest)) {
      return false;
    }
    seen.add(digest);
    return true;
  });
}

function writeChecksumFile(path, entries) {
  const contents = entries
    .map(({ digest, name }) => `${digest}  ${name}`)
    .join("\n");
  writeFileSync(path, `${contents}\n`, "utf8");
}

function parseWorkflowPath({ repository, workflowRef, workflowGitRef }) {
  const prefix = `${repository}/`;
  const suffix = `@${workflowGitRef}`;
  if (!workflowRef.startsWith(prefix) || !workflowRef.endsWith(suffix)) {
    throw new Error(
      `Workflow ref must identify ${repository} at ${workflowGitRef}: ${workflowRef}`,
    );
  }
  const path = workflowRef.slice(prefix.length, -suffix.length);
  if (!path.startsWith(".github/workflows/") || !/\.ya?ml$/.test(path)) {
    throw new Error(`Invalid release workflow path: ${path}`);
  }
  return path;
}

function requireHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${errorMessage(error)}`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS origin.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must not contain a path, query, or fragment.`);
  }
}

function requireRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid repository: ${value}`);
  }
}

function requireNumericId(value, label) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function requireGitRef(value, label) {
  if (!value.startsWith("refs/") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function requireGitSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function requireSafeToken(value, label, allowPlus = false) {
  const pattern = allowPlus
    ? /^[A-Za-z0-9][A-Za-z0-9._+-]*$/
    : /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function run(argv) {
  if (argv.length !== 5) {
    throw new Error(
      "Usage: node scripts/release-checksums.mjs <project-root> <runner-os> <target> <artifact> <runner-temp>",
    );
  }

  const [projectRoot, runnerOs, target, artifact, runnerTemp] = argv;
  const result = await writeReleaseChecksums({
    projectRoot,
    runnerTemp,
    runnerOs,
    target,
    artifact,
    provenance: {
      serverUrl: requireEnvironment("GITHUB_SERVER_URL"),
      repository: requireEnvironment("GITHUB_REPOSITORY"),
      repositoryId: requireEnvironment("RELEASE_REPOSITORY_ID"),
      repositoryOwnerId: requireEnvironment("RELEASE_REPOSITORY_OWNER_ID"),
      eventName: requireEnvironment("GITHUB_EVENT_NAME"),
      workflowRef: requireEnvironment("RELEASE_WORKFLOW_REF"),
      workflowGitRef: requireEnvironment("GITHUB_REF"),
      workflowSha: requireEnvironment("RELEASE_WORKFLOW_SHA"),
      runnerEnvironment: requireEnvironment("RELEASE_RUNNER_ENVIRONMENT"),
      releaseTag: requireEnvironment("RELEASE_TAG"),
      sourceSha: requireEnvironment("RELEASE_SOURCE_SHA"),
      runId: requireEnvironment("GITHUB_RUN_ID"),
      runAttempt: requireEnvironment("GITHUB_RUN_ATTEMPT"),
    },
  });

  console.log(
    `Wrote ${result.releaseCount} release checksums and ${result.uniqueSubjectCount} unique attestation subjects from ${result.subjectCount} files.`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(
      `Release checksum generation failed: ${errorMessage(error)}`,
    );
    process.exitCode = 1;
  });
}
