import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { extract, list } from "tar";

const root = fileURLToPath(new URL("..", import.meta.url));
const lockPath = join(root, "bundled-tools.lock.json");
const resourcesRoot = join(root, "src-tauri", "resources", "tools");
const cacheRoot = join(root, "src-tauri", "target", "bundled-tools-cache");
const MAX_REDIRECTS = 4;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 30_000;

export function currentTarget(platform = process.platform, arch = process.arch) {
  const key = `${platform}:${arch}`;
  const targets = {
    "linux:x64": "x86_64-unknown-linux-gnu",
    "darwin:x64": "x86_64-apple-darwin",
    "darwin:arm64": "aarch64-apple-darwin",
    "win32:x64": "x86_64-pc-windows-msvc",
  };
  const target = targets[key];
  if (!target) {
    throw new Error(`Bundled tools do not support ${platform} ${arch}.`);
  }
  return target;
}

export function safeArchivePath(value) {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized.split("/").every((part) => part !== ".." && part !== "")
  );
}

function safeArchiveSymlink(path, linkpath) {
  const normalizedLink = linkpath.replaceAll("\\", "/");
  if (
    normalizedLink.startsWith("/") ||
    /^[A-Za-z]:/.test(normalizedLink) ||
    normalizedLink.includes("\0")
  ) {
    return false;
  }
  const target = posix.normalize(
    posix.join(posix.dirname(path), normalizedLink),
  );
  return (
    safeArchivePath(target) &&
    target.split("/")[0] === path.replaceAll("\\", "/").split("/")[0]
  );
}

export function redirectAllowed(url, allowlist) {
  const parsed = new URL(url);
  return parsed.protocol === "https:" && allowlist.includes(parsed.hostname);
}

export function parseZipEntries(bytes) {
  const view = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const eocd = findEndOfCentralDirectory(view);
  const entries = view.readUInt16LE(eocd + 10);
  const centralSize = view.readUInt32LE(eocd + 12);
  const centralOffset = view.readUInt32LE(eocd + 16);
  if (entries > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > view.length) {
    throw new Error("ZIP central directory is outside the archive bounds.");
  }
  let offset = centralOffset;
  let expandedBytes = 0;
  const paths = [];
  for (let index = 0; index < entries; index += 1) {
    if (view.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory contains an invalid entry.");
    }
    const compressedSize = view.readUInt32LE(offset + 20);
    const expandedSize = view.readUInt32LE(offset + 24);
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const externalAttributes = view.readUInt32LE(offset + 38);
    const name = view.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!safeArchivePath(name.replace(/\/$/, ""))) {
      throw new Error(`ZIP archive contains unsafe path ${name}.`);
    }
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000 || unixType === 0x6000 || unixType === 0x2000) {
      throw new Error(`ZIP archive contains unsupported entry ${name}.`);
    }
    expandedBytes += expandedSize;
    if (
      expandedBytes > MAX_EXPANDED_BYTES ||
      compressedSize > MAX_EXPANDED_BYTES
    ) {
      throw new Error("ZIP archive exceeds the expanded size limit.");
    }
    paths.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return paths;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      if (bytes.readUInt16LE(offset + 20) !== 0) {
        throw new Error("ZIP archive comments are not supported.");
      }
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record is missing.");
}

export function sha256File(path) {
  const hash = createHash("sha256");
  const bytes = readFileSync(path);
  hash.update(bytes);
  return hash.digest("hex");
}

async function downloadExact(artifact, allowlist, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    verifyArtifact(destination, artifact);
    return destination;
  }
  let url = artifact.archiveUrl ?? artifact.signatureUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!redirectAllowed(url, allowlist)) {
      throw new Error(`Download host is not allowed: ${url}`);
    }
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "Denote bundled-tools preparation" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error(`Download redirect limit exceeded for ${url}.`);
      }
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Download failed for ${url}: HTTP ${response.status}.`);
    }
    const expectedSize = artifact.sizeBytes ?? artifact.signatureSizeBytes;
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (
      !response.headers.get("content-encoding") &&
      declaredSize &&
      declaredSize !== expectedSize
    ) {
      throw new Error(`Download size changed for ${url}.`);
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > expectedSize) {
        throw new Error(`Download exceeded the locked size for ${url}.`);
      }
      chunks.push(Buffer.from(chunk));
    }
    if (total !== expectedSize) {
      throw new Error(`Download size did not match the lock for ${url}.`);
    }
    writeFileSync(destination, Buffer.concat(chunks));
    verifyArtifact(destination, artifact);
    return destination;
  }
  throw new Error(`Download could not be completed for ${url}.`);
}

function verifyArtifact(path, artifact) {
  const expectedSize = artifact.sizeBytes ?? artifact.signatureSizeBytes;
  const expectedHash = artifact.sha256 ?? artifact.signatureSha256;
  if (statSync(path).size !== expectedSize || sha256File(path) !== expectedHash) {
    rmSync(path, { force: true });
    throw new Error(`Cached artifact failed integrity verification: ${basename(path)}.`);
  }
}

async function verifySignedTag(url, expectedTag, expectedCommit) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Denote bundled-tools preparation",
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to verify signed release tag: HTTP ${response.status}.`);
  }
  const value = await response.json();
  if (
    value.tag !== expectedTag ||
    value.object?.sha !== expectedCommit ||
    value.object?.type !== "commit" ||
    value.verification?.verified !== true ||
    value.verification?.reason !== "valid"
  ) {
    throw new Error(`Release tag verification failed for ${expectedTag}.`);
  }
}

async function validateTar(path) {
  let entries = 0;
  let expandedBytes = 0;
  await list({
    file: path,
    strict: true,
    onentry(entry) {
      entries += 1;
      const safeSymlink =
        entry.type === "SymbolicLink" &&
        safeArchiveSymlink(entry.path, entry.linkpath);
      if (
        entries > MAX_ARCHIVE_ENTRIES ||
        !safeArchivePath(entry.path.replace(/\/$/, "")) ||
        (!["File", "Directory"].includes(entry.type) && !safeSymlink)
      ) {
        throw new Error(`Archive contains unsafe entry ${entry.path}.`);
      }
      expandedBytes += entry.size;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error("Archive exceeds the expanded size limit.");
      }
    },
  });
}

async function extractTar(path, destination) {
  await validateTar(path);
  mkdirSync(destination, { recursive: true });
  await extract({ cwd: destination, file: path, strict: true });
}

function extractZip(path, destination) {
  parseZipEntries(readFileSync(path));
  mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    run(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:DENOTE_ARCHIVE, $env:DENOTE_DESTINATION)",
      ],
      {
        env: {
          ...process.env,
          DENOTE_ARCHIVE: path,
          DENOTE_DESTINATION: destination,
        },
      },
    );
  } else {
    run("unzip", ["-q", path, "-d", destination]);
  }
}

function archiveRoot(extracted) {
  const entries = readdirSync(extracted, { withFileTypes: true }).filter(
    (entry) => entry.name !== "__MACOSX",
  );
  return entries.length === 1 && entries[0].isDirectory()
    ? join(extracted, entries[0].name)
    : extracted;
}

function run(program, args, options = {}) {
  const outcome = spawnSync(program, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (outcome.status !== 0) {
    const detail = options.capture ? ` ${outcome.stderr?.trim() ?? ""}` : "";
    throw new Error(`${program} failed with exit code ${outcome.status}.${detail}`);
  }
  return outcome.stdout?.trim() ?? "";
}

async function prepareGit(lock, targetName, target, staging, temporary) {
  const output = join(staging, "git");
  const definition =
    target.git.kind === "source-build"
      ? lock.git.sourceArtifact
      : lock.git.windowsArtifact;
  await verifySignedTag(
    definition.verifiedTagApi,
    target.git.kind === "source-build"
      ? lock.git.sourceTag
      : lock.git.windowsArtifact.sourceTag,
    target.git.kind === "source-build"
      ? lock.git.sourceCommit
      : lock.git.windowsArtifact.sourceCommit,
  );
  if (target.git.kind === "archive") {
    const archive = await downloadExact(
      definition,
      lock.redirectAllowlist,
      join(cacheRoot, definition.sha256),
    );
    extractZip(archive, output);
  } else {
    const source = await downloadExact(
      definition,
      lock.redirectAllowlist,
      join(cacheRoot, definition.sha256),
    );
    await downloadExact(
      {
        signatureUrl: definition.signatureUrl,
        signatureSizeBytes: definition.signatureSizeBytes,
        signatureSha256: definition.signatureSha256,
      },
      lock.redirectAllowlist,
      join(cacheRoot, definition.signatureSha256),
    );
    const signingKey = await downloadExact(
      {
        archiveUrl: definition.signingKeyUrl,
        sizeBytes: definition.signingKeySizeBytes,
        sha256: definition.signingKeySha256,
      },
      lock.redirectAllowlist,
      join(cacheRoot, definition.signingKeySha256),
    );
    const signature = join(cacheRoot, definition.signatureSha256);
    const keyring = mkdtempSync("/tmp/denote-gpg-");
    const signedTar = join(temporary, "git-source.tar");
    writeFileSync(signedTar, gunzipSync(readFileSync(source)));
    try {
      run("gpg", ["--batch", "--homedir", keyring, "--import", signingKey], {
        capture: true,
      });
      const verification = run(
        "gpg",
        [
          "--batch",
          "--homedir",
          keyring,
          "--status-fd",
          "1",
          "--verify",
          signature,
          signedTar,
        ],
        { capture: true },
      );
      if (
        !verification.includes(
          `[GNUPG:] VALIDSIG ${definition.signerFingerprint}`,
        )
      ) {
        throw new Error("Git source signature did not match the locked signer.");
      }
    } finally {
      rmSync(keyring, { recursive: true, force: true });
    }
    const extracted = join(temporary, "git-source");
    await extractTar(source, extracted);
    const sourceRoot = archiveRoot(extracted);
    mkdirSync(output, { recursive: true });
    const environment = {
      ...process.env,
      SOURCE_DATE_EPOCH: "1782745159",
      TZ: "UTC",
      LC_ALL: "C",
    };
    run("./configure", [`--prefix=${output}`, "--without-tcltk"], {
      cwd: sourceRoot,
      env: environment,
    });
    const makeFlags = [
      `-j${Math.max(1, Math.min(4, Number(process.env.DENOTE_TOOL_BUILD_JOBS ?? 2)))}`,
      "NO_GETTEXT=YesPlease",
      "NO_TCLTK=YesPlease",
      "NO_PYTHON=YesPlease",
    ];
    run("make", [...makeFlags, "all"], { cwd: sourceRoot, env: environment });
    run("make", [...makeFlags, "install"], { cwd: sourceRoot, env: environment });
    if (targetName.endsWith("apple-darwin")) {
      run("make", ["-C", "contrib/credential/osxkeychain"], {
        cwd: sourceRoot,
        env: environment,
      });
      cpSync(
        join(sourceRoot, "contrib", "credential", "osxkeychain", "git-credential-osxkeychain"),
        join(output, "libexec", "git-core", "git-credential-osxkeychain"),
      );
    }
    cpSync(join(sourceRoot, "COPYING"), join(output, "COPYING"));
  }
  makeExecutable(join(staging, target.git.executablePath));
  const version = run(join(staging, target.git.executablePath), ["--version"], {
    capture: true,
  });
  if (!version.startsWith(`git version ${lock.git.version}`)) {
    throw new Error(`Bundled Git version check failed: ${version}`);
  }
}

async function prepareGitHubCli(lock, target, staging, temporary, skipAttestation) {
  const definition = target.githubCli;
  const archive = await downloadExact(
    definition,
    lock.redirectAllowlist,
    join(cacheRoot, definition.sha256),
  );
  if (!skipAttestation) {
    run("gh", [
      "attestation",
      "verify",
      archive,
      "--repo",
      lock.githubCli.attestation.repository,
      "--predicate-type",
      lock.githubCli.attestation.predicateType,
      "--cert-identity",
      lock.githubCli.attestation.workflow,
      "--signer-digest",
      lock.githubCli.attestation.workflowCommit,
      "--source-digest",
      lock.githubCli.sourceCommit,
    ]);
  }
  const extracted = join(temporary, "gh");
  if (definition.format === "zip") {
    extractZip(archive, extracted);
  } else {
    await extractTar(archive, extracted);
  }
  cpSync(archiveRoot(extracted), join(staging, "gh"), { recursive: true });
  makeExecutable(join(staging, definition.executablePath));
  const version = run(join(staging, definition.executablePath), ["version"], {
    capture: true,
  });
  if (!version.startsWith(`gh version ${lock.githubCli.version}`)) {
    throw new Error(`Bundled GitHub CLI version check failed: ${version}`);
  }
}

function makeExecutable(path) {
  if (process.platform !== "win32") {
    chmodSync(path, 0o755);
  }
}

function assertExpectedTree(staging, target) {
  for (const path of [...target.git.expectedPaths, ...target.githubCli.expectedPaths]) {
    if (!existsSync(join(staging, path))) {
      throw new Error(`Prepared tools are missing expected path ${path}.`);
    }
  }
}

function filesUnder(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Prepared tools contain symbolic link ${path}.`);
      }
      if (metadata.isDirectory()) {
        stack.push(path);
      } else if (metadata.isFile()) {
        files.push(path);
      } else {
        throw new Error(`Prepared tools contain unsupported file ${path}.`);
      }
    }
  }
  return files.sort();
}

function writeIntegrityManifest(lock, targetName, target, staging) {
  const files = filesUnder(staging).map((path) => {
    const metadata = statSync(path);
    return {
      path: relative(staging, path).split(sep).join("/"),
      sizeBytes: metadata.size,
      sha256: sha256File(path),
      executable:
        path === join(staging, target.git.executablePath) ||
        path === join(staging, target.githubCli.executablePath),
    };
  });
  const manifest = {
    schemaVersion: 1,
    target: targetName,
    lockSha256: sha256File(lockPath),
    git: {
      version: lock.git.version,
      executablePath: target.git.executablePath,
    },
    githubCli: {
      version: lock.githubCli.version,
      executablePath: target.githubCli.executablePath,
    },
    files,
  };
  writeFileSync(join(staging, "integrity.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function prepare({
  targetName = currentTarget(),
  skipAttestation = false,
} = {}) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  if (JSON.stringify(lock).toLocaleLowerCase().includes("latest")) {
    throw new Error("The bundled-tools lock must never resolve latest.");
  }
  const target = lock.targets[targetName];
  if (!target) {
    throw new Error(`No bundled-tools lock entry exists for ${targetName}.`);
  }
  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(resourcesRoot, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), "denote-bundled-tools-"));
  const staging = join(temporary, targetName);
  mkdirSync(staging);
  try {
    await prepareGit(lock, targetName, target, staging, temporary);
    await prepareGitHubCli(
      lock,
      target,
      staging,
      temporary,
      skipAttestation,
    );
    const legal = join(staging, "legal");
    mkdirSync(legal);
    for (const path of [
      lock.git.notice,
      lock.git.sbom.path,
      lock.githubCli.sbom.path,
    ]) {
      cpSync(join(root, path), join(legal, basename(path)));
    }
    assertExpectedTree(staging, target);
    writeIntegrityManifest(lock, targetName, target, staging);
    const output = join(resourcesRoot, targetName);
    rmSync(output, { recursive: true, force: true });
    renameSync(staging, output);
    return realpathSync(output);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetName = argument("--target") ?? currentTarget();
  const skipAttestation = process.argv.includes("--skip-attestation");
  prepare({ targetName, skipAttestation })
    .then((path) => console.log(`Prepared bundled tools at ${path}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
