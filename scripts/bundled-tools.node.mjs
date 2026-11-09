import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPackagedSize,
  currentTarget,
  downloadExact,
  gitBuildEnvironment,
  gitMakeFlags,
  githubApiToken,
  githubApiUrlAllowed,
  parseZipEntries,
  redirectAllowed,
  safeArchivePath,
} from "./bundled-tools.mjs";

test("maps supported release targets explicitly", () => {
  assert.equal(currentTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(currentTarget("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.throws(() => currentTarget("linux", "arm64"), /do not support/);
});

test("accepts only safe relative archive paths", () => {
  assert.equal(safeArchivePath("git/bin/git"), true);
  assert.equal(safeArchivePath("../git"), false);
  assert.equal(safeArchivePath("/git"), false);
  assert.equal(safeArchivePath("C:/git.exe"), false);
  assert.equal(safeArchivePath("git//bin"), false);
});

test("allows only pinned HTTPS redirect hosts", () => {
  const hosts = ["github.com", "release-assets.githubusercontent.com"];
  assert.equal(redirectAllowed("https://github.com/tool", hosts), true);
  assert.equal(
    redirectAllowed("https://release-assets.githubusercontent.com/tool", hosts),
    true,
  );
  assert.equal(redirectAllowed("http://github.com/tool", hosts), false);
  assert.equal(redirectAllowed("https://example.invalid/tool", hosts), false);
});

test("uses explicit or stored credentials only for the GitHub API", () => {
  assert.equal(
    githubApiToken({ GH_TOKEN: " explicit-token " }, () => {
      throw new Error("stored credentials should not be read");
    }),
    "explicit-token",
  );
  assert.equal(
    githubApiToken({ GITHUB_TOKEN: " workflow-token " }, () => {
      throw new Error("stored credentials should not be read");
    }),
    "workflow-token",
  );
  assert.equal(githubApiToken({}, () => " stored-token\n"), "stored-token");
  assert.equal(githubApiToken({}, () => null), null);

  assert.equal(
    githubApiUrlAllowed("https://api.github.com/repos/git/git/git/tags/example"),
    true,
  );
  assert.equal(
    githubApiUrlAllowed("http://api.github.com/repos/git/git/git/tags/example"),
    false,
  );
  assert.equal(
    githubApiUrlAllowed("https://example.invalid/repos/git/git/git/tags/example"),
    false,
  );
});

test("rejects malformed ZIP input before extraction", () => {
  assert.throws(() => parseZipEntries(Buffer.from("not-a-zip")), /missing/);
});

test("caps the combined installer payload for bundled tools", () => {
  assert.doesNotThrow(() => assertPackagedSize([32 * 1024 * 1024, 16 * 1024 * 1024]));
  assert.throws(
    () => assertPackagedSize([80 * 1024 * 1024, 20 * 1024 * 1024]),
    /package limit/,
  );
});

test("preserves the Make jobserver for Git's nested Cargo recipe", {
  skip: process.platform === "win32",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "denote-jobserver-test-"));
  try {
    writeFileSync(join(directory, "jobserver.sh"), [
      'for flag in $MAKEFLAGS; do',
      '  case "$flag" in',
      '    --jobserver-auth=fifo:*)',
      '      test -p "${flag#--jobserver-auth=fifo:}" && exit 0 ;;',
      '    --jobserver-auth=*|--jobserver-fds=*)',
      '      descriptors="${flag#*=}"',
      '      test -p "/dev/fd/${descriptors%,*}" &&',
      '        test -p "/dev/fd/${descriptors#*,}" && exit 0 ;;',
      '  esac',
      'done',
      'echo "Make jobserver handles are missing or closed" >&2',
      'exit 1',
      "",
    ].join("\n"));
    writeFileSync(join(directory, "Makefile"),
      "QUIET_CARGO = @\nall:\n\t$(QUIET_CARGO)sh jobserver.sh\n");
    const environment = { ...process.env };
    delete environment.MAKEFLAGS;
    delete environment.MFLAGS;
    delete environment.CARGO_MAKEFLAGS;
    const result = spawnSync("make", [...gitMakeFlags({}), "all"], {
      cwd: directory,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolves the macOS Git SDK and compiler with absolute xcrun", () => {
  const sdkRoot =
    "/synthetic/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk";
  const clang =
    "/synthetic/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang";
  const calls = [];
  const environment = gitBuildEnvironment("aarch64-apple-darwin", {
    PATH: "/usr/bin",
    DEVELOPER_DIR: "/synthetic/Xcode.app/Contents/Developer",
    SDKROOT: "/removed/macos-sdk",
  }, {
    spawn(program, args, options) {
      calls.push({ program, args, environment: options.env });
      return {
        status: 0,
        stdout: `${args.includes("--show-sdk-path") ? sdkRoot : clang}\n`,
        stderr: "",
      };
    },
    stat(path) {
      return {
        isDirectory: () => path === sdkRoot,
        isFile: () => path === clang,
      };
    },
  });
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(
    environment.DEVELOPER_DIR,
    "/synthetic/Xcode.app/Contents/Developer",
  );
  assert.equal(environment.SDKROOT, sdkRoot);
  assert.equal(environment.CC, clang);
  assert.equal(environment.LC_ALL, "C");
  assert.equal(environment.TZ, "UTC");
  assert.equal(environment.SOURCE_DATE_EPOCH, "1782745159");
  assert.deepEqual(
    calls.map(({ program, args }) => [program, args]),
    [
      ["/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]],
      ["/usr/bin/xcrun", ["--sdk", "macosx", "--find", "clang"]],
    ],
  );
  for (const call of calls) {
    assert.equal(call.environment.SDKROOT, undefined);
    assert.equal(
      call.environment.DEVELOPER_DIR,
      "/synthetic/Xcode.app/Contents/Developer",
    );
  }
});

test("reports macOS SDK xcrun failures clearly", () => {
  assert.throws(
    () =>
      gitBuildEnvironment("aarch64-apple-darwin", {}, {
        spawn() {
          return {
            status: 1,
            stdout: "",
            stderr: "xcrun: error: unable to find sdk",
          };
        },
        stat() {
          throw new Error("stat should not run");
        },
      }),
    /Unable to resolve the active macOS SDK.*xcrun: error: unable to find sdk/,
  );
});

test("rejects a macOS SDK path that is not a directory", () => {
  assert.throws(
    () =>
      gitBuildEnvironment("x86_64-apple-darwin", {}, {
        spawn() {
          return {
            status: 0,
            stdout: "/tmp/not-a-directory\n",
            stderr: "",
          };
        },
        stat() {
          return {
            isDirectory: () => false,
            isFile: () => true,
          };
        },
      }),
    /macOS SDK path is not a directory: \/tmp\/not-a-directory/,
  );
});

test("reports macOS clang xcrun failures clearly", () => {
  const sdkRoot = "/synthetic/Xcode.app/SDKs/MacOSX.sdk";
  let calls = 0;
  assert.throws(
    () =>
      gitBuildEnvironment("aarch64-apple-darwin", {}, {
        spawn() {
          calls += 1;
          return calls === 1
            ? { status: 0, stdout: `${sdkRoot}\n`, stderr: "" }
            : {
                status: 1,
                stdout: "",
                stderr: "xcrun: error: unable to find clang",
              };
        },
        stat() {
          return {
            isDirectory: () => true,
            isFile: () => false,
          };
        },
      }),
    /Unable to resolve the active macOS clang.*xcrun: error: unable to find clang/,
  );
});

test("preserves non-macOS build environment values without xcrun", () => {
  const environment = gitBuildEnvironment("x86_64-unknown-linux-gnu", {
    CC: "/custom/clang",
    SDKROOT: "/custom/sdk",
  }, {
    spawn() {
      throw new Error("xcrun should not run");
    },
    stat() {
      throw new Error("stat should not run");
    },
  });
  assert.equal(environment.CC, "/custom/clang");
  assert.equal(environment.SDKROOT, "/custom/sdk");
});

function downloadFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "denote-download-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("synthetic tool archive");
  const artifact = {
    archiveUrl: "https://downloads.example.test/tool.zip",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const delays = [];
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  return {
    artifact,
    bytes,
    destination: join(directory, "archive"),
    allowlist: ["downloads.example.test", "assets.example.test"],
    delays,
    warnings,
    sleep: async (delay) => { delays.push(delay); },
  };
}

test("retries gateway failures from the original locked URL", async (t) => {
  const fixture = downloadFixture(t);
  const urls = [];
  const signals = [];
  const deadlines = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  let cancellations = 0;
  const discardedBody = () => new ReadableStream({
    cancel() { cancellations += 1; },
  });
  const responses = [
    new Response(discardedBody(), { status: 504 }),
    new Response(discardedBody(), {
      status: 302,
      headers: { location: "https://assets.example.test/stale" },
    }),
    new Response(discardedBody(), { status: 503 }),
    new Response(discardedBody(), {
      status: 302,
      headers: { location: "https://assets.example.test/fresh" },
    }),
    new Response(fixture.bytes),
  ];
  const path = await downloadExact(
    fixture.artifact,
    fixture.allowlist,
    fixture.destination,
    {
      sleep: fixture.sleep,
      async fetch(url, options) {
        urls.push(url);
        signals.push(options.signal);
        assert.equal(options.redirect, "manual");
        assert.equal(options.headers.authorization, undefined);
        assert.equal(options.signal.aborted, false);
        assert.ok(responses.length > 0);
        return responses.shift();
      },
    },
  );
  assert.equal(path, fixture.destination);
  assert.deepEqual(readFileSync(path), fixture.bytes);
  assert.deepEqual(urls, [
    fixture.artifact.archiveUrl,
    fixture.artifact.archiveUrl,
    "https://assets.example.test/stale",
    fixture.artifact.archiveUrl,
    "https://assets.example.test/fresh",
  ]);
  assert.equal(signals[1], signals[2]);
  assert.equal(signals[3], signals[4]);
  assert.notEqual(signals[0], signals[1]);
  assert.notEqual(signals[1], signals[3]);
  assert.deepEqual(deadlines, [60_000, 60_000, 60_000]);
  assert.equal(cancellations, 4);
  assert.deepEqual(fixture.delays, [1_000, 2_000]);
  assert.equal(fixture.warnings.length, 2);
  assert.match(fixture.warnings[0], /attempt 1\/4.*HTTP 504.*1000 ms/);
  assert.match(fixture.warnings[1], /attempt 2\/4.*HTTP 503.*2000 ms/);
});

test("retries only the explicitly transient HTTP statuses", async (t) => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const fixture = downloadFixture(t);
      let calls = 0;
      await downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
        sleep: fixture.sleep,
        async fetch() {
          calls += 1;
          return calls === 1
            ? new Response("temporarily unavailable", { status })
            : new Response(fixture.bytes);
        },
      });
      assert.equal(calls, 2);
      assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
      assert.deepEqual(fixture.delays, [1_000]);
    });
  }
});

test("bounds retries and preserves the last HTTP failure", async (t) => {
  const fixture = downloadFixture(t);
  let calls = 0;
  await assert.rejects(
    downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
      sleep: fixture.sleep,
      async fetch() {
        calls += 1;
        return new Response("temporarily unavailable", { status: 504 });
      },
    }),
    /after 4 attempts.*HTTP 504/,
  );
  assert.equal(calls, 4);
  assert.deepEqual(fixture.delays, [1_000, 2_000, 4_000]);
  assert.equal(fixture.warnings.length, 3);
  assert.equal(existsSync(fixture.destination), false);
});

test("retries timeouts and transient network errors", async (t) => {
  const errors = [
    new DOMException("request timed out", "TimeoutError"),
    new DOMException("body read aborted", "AbortError"),
    new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }),
    new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } }),
    Object.assign(new Error("connection timed out"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    }),
  ];
  for (const error of errors) {
    await t.test(error.message, async (t) => {
      const fixture = downloadFixture(t);
      let calls = 0;
      await downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
        sleep: fixture.sleep,
        async fetch() {
          calls += 1;
          if (calls === 1) throw error;
          return new Response(fixture.bytes);
        },
      });
      assert.equal(calls, 2);
      assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
      assert.deepEqual(fixture.delays, [1_000]);
    });
  }
});

test("discards interrupted response bytes before retrying", async (t) => {
  const fixture = downloadFixture(t);
  let calls = 0;
  await downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
    sleep: fixture.sleep,
    async fetch() {
      calls += 1;
      if (calls > 1) return new Response(fixture.bytes);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(fixture.bytes.subarray(0, 4));
        },
        pull(controller) {
          controller.error(new TypeError("terminated", {
            cause: { code: "UND_ERR_SOCKET" },
          }));
        },
      }));
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
  assert.deepEqual(fixture.delays, [1_000]);
});

test("does not retry permanent HTTP or TLS failures", async (t) => {
  for (const status of [401, 403, 404, 410]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const fixture = downloadFixture(t);
      let calls = 0;
      await assert.rejects(
        downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          async fetch() {
            calls += 1;
            return new Response("unavailable", { status });
          },
        }),
        new RegExp(`HTTP ${status}`),
      );
      assert.equal(calls, 1);
      assert.deepEqual(fixture.delays, []);
      assert.deepEqual(fixture.warnings, []);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
  await t.test("invalid TLS certificate", async (t) => {
    const fixture = downloadFixture(t);
    const error = new TypeError("fetch failed", {
      cause: { code: "CERT_HAS_EXPIRED" },
    });
    let calls = 0;
    await assert.rejects(
      downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
        sleep: fixture.sleep,
        async fetch() {
          calls += 1;
          throw error;
        },
      }),
      (actual) => actual === error,
    );
    assert.equal(calls, 1);
    assert.deepEqual(fixture.delays, []);
  });
});

test("does not retry size or digest violations or retain invalid bytes", async (t) => {
  for (const failure of ["declared size", "oversized", "short", "digest"]) {
    await t.test(failure, async (t) => {
      const fixture = downloadFixture(t);
      let calls = 0;
      const responses = {
        "declared size": new Response(fixture.bytes, {
          headers: { "content-length": String(fixture.bytes.length + 1) },
        }),
        oversized: new Response(Buffer.concat([fixture.bytes, Buffer.from("extra")])),
        short: new Response(fixture.bytes.subarray(0, 4)),
        digest: new Response(Buffer.alloc(fixture.bytes.length, 120)),
      };
      await assert.rejects(
        downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          async fetch() {
            calls += 1;
            return responses[failure];
          },
        }),
        /size|integrity/,
      );
      assert.equal(calls, 1);
      assert.deepEqual(fixture.delays, []);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});

test("does not mask permanent failures when discarding an errored body", async (t) => {
  for (const failure of ["HTTP 404", "declared size"]) {
    await t.test(failure, async (t) => {
      const fixture = downloadFixture(t);
      let calls = 0;
      await assert.rejects(
        downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          async fetch() {
            calls += 1;
            return new Response(new ReadableStream({
              start(controller) {
                controller.error(new TypeError("terminated", {
                  cause: { code: "UND_ERR_SOCKET" },
                }));
              },
            }), failure === "HTTP 404"
              ? { status: 404 }
              : { headers: { "content-length": "1" } });
          },
        }),
        failure === "HTTP 404" ? /HTTP 404/ : /Download size changed/,
      );
      assert.equal(calls, 1);
      assert.deepEqual(fixture.delays, []);
      assert.equal(fixture.warnings.length, 1);
      assert.match(fixture.warnings[0], /Unable to cancel.*terminated/);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});

test("rechecks the redirect allowlist after a retry", async (t) => {
  const fixture = downloadFixture(t);
  let calls = 0;
  await assert.rejects(
    downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
      sleep: fixture.sleep,
      async fetch(url) {
        assert.equal(url, fixture.artifact.archiveUrl);
        calls += 1;
        return calls === 1
          ? new Response("temporarily unavailable", { status: 504 })
          : new Response(null, {
              status: 302,
              headers: { location: "http://untrusted.example.test/tool.zip" },
            });
      },
    }),
    /Download host is not allowed/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(fixture.delays, [1_000]);
  assert.equal(existsSync(fixture.destination), false);
});

test("does not retry an exhausted redirect limit", async (t) => {
  const fixture = downloadFixture(t);
  let calls = 0;
  await assert.rejects(
    downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
      sleep: fixture.sleep,
      async fetch() {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `/tool.zip?redirect=${calls}` },
        });
      },
    }),
    /redirect limit exceeded/,
  );
  assert.equal(calls, 5);
  assert.deepEqual(fixture.delays, []);
  assert.equal(existsSync(fixture.destination), false);
});

test("verifies cached artifacts without fetching or retrying", async (t) => {
  const fixture = downloadFixture(t);
  const options = {
    sleep: fixture.sleep,
    async fetch() { assert.fail("cached artifacts must not be fetched"); },
  };
  writeFileSync(fixture.destination, fixture.bytes);
  await downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, options);
  writeFileSync(fixture.destination, "invalid cached bytes");
  await assert.rejects(
    downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, options),
    /Cached artifact failed integrity verification/,
  );
  assert.equal(existsSync(fixture.destination), false);
  assert.deepEqual(fixture.delays, []);
});

test("applies the same retry and integrity checks to detached signatures", async (t) => {
  const fixture = downloadFixture(t);
  let calls = 0;
  await downloadExact({
    signatureUrl: "https://downloads.example.test/tool.tar.sign",
    signatureSizeBytes: fixture.artifact.sizeBytes,
    signatureSha256: fixture.artifact.sha256,
  }, fixture.allowlist, fixture.destination, {
    sleep: fixture.sleep,
    async fetch(url) {
      assert.equal(url, "https://downloads.example.test/tool.tar.sign");
      calls += 1;
      return calls === 1
        ? new Response("temporarily unavailable", { status: 504 })
        : new Response(fixture.bytes);
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
  assert.deepEqual(fixture.delays, [1_000]);
});

function githubDownloadFixture(t) {
  const fixture = downloadFixture(t);
  fixture.artifact.archiveUrl =
    "https://github.com/example/tools/releases/download/v1.2.3/tool.zip";
  fixture.allowlist = ["github.com", "api.github.com", "release-assets.githubusercontent.com"];
  fixture.metadataUrl = "https://api.github.com/repos/example/tools/releases/tags/v1.2.3";
  fixture.assetUrl = "https://api.github.com/repos/example/tools/releases/assets/42";
  fixture.release = {
    tag_name: "v1.2.3",
    assets: [{
      id: 42,
      name: "tool.zip",
      state: "uploaded",
      browser_download_url: fixture.artifact.archiveUrl,
      url: fixture.assetUrl,
      size: fixture.artifact.sizeBytes,
      digest: `sha256:${fixture.artifact.sha256}`,
    }],
  };
  return fixture;
}

test("recovers a locked GitHub release asset through the official API", async (t) => {
  const fixture = githubDownloadFixture(t);
  const urls = [];
  let apiDownloads = 0;
  await downloadExact(fixture.artifact, fixture.allowlist, fixture.destination, {
    sleep: fixture.sleep,
    loadGithubToken: () => "synthetic-token",
    async fetch(url, options) {
      urls.push(url);
      if (url === fixture.artifact.archiveUrl) {
        assert.equal(options.headers.authorization, undefined);
        return new Response("gateway timeout", { status: 504 });
      }
      if (url === fixture.metadataUrl) {
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.authorization, "Bearer synthetic-token");
        assert.equal(options.headers.accept, "application/vnd.github+json");
        return Response.json(fixture.release);
      }
      if (url === fixture.assetUrl) {
        assert.equal(options.redirect, "manual");
        assert.equal(options.headers.authorization, "Bearer synthetic-token");
        assert.equal(options.headers.accept, "application/octet-stream");
        apiDownloads += 1;
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://release-assets.githubusercontent.com/tool-${apiDownloads}`,
          },
        });
      }
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers.accept, undefined);
      return apiDownloads === 1
        ? new Response("expired redirect", { status: 503 })
        : new Response(fixture.bytes);
    },
  });
  assert.deepEqual(urls, [
    ...Array(4).fill(fixture.artifact.archiveUrl),
    fixture.metadataUrl,
    fixture.assetUrl,
    "https://release-assets.githubusercontent.com/tool-1",
    fixture.assetUrl,
    "https://release-assets.githubusercontent.com/tool-2",
  ]);
  assert.deepEqual(fixture.delays, [1_000, 2_000, 4_000, 1_000]);
  assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
  assert.ok(fixture.warnings.some((warning) => /official GitHub asset API/.test(warning)));
});

test("supports anonymous GitHub API recovery without changing detached-signature checks", async (t) => {
  const fixture = githubDownloadFixture(t);
  fixture.release.assets[0].digest = null;
  const artifact = {
    signatureUrl: fixture.artifact.archiveUrl,
    signatureSizeBytes: fixture.artifact.sizeBytes,
    signatureSha256: fixture.artifact.sha256,
  };
  await downloadExact(artifact, fixture.allowlist, fixture.destination, {
    sleep: fixture.sleep,
    loadGithubToken: () => null,
    async fetch(url, options) {
      assert.equal(options.headers.authorization, undefined);
      if (url === artifact.signatureUrl) return new Response(null, { status: 504 });
      if (url === fixture.metadataUrl) return Response.json(fixture.release);
      assert.equal(url, fixture.assetUrl);
      return new Response(fixture.bytes);
    },
  });
  assert.deepEqual(readFileSync(fixture.destination), fixture.bytes);
});

test("rejects mismatched GitHub API metadata before downloading an asset", async (t) => {
  const mutations = [
    ["tag", (release) => { release.tag_name = "v9.9.9"; }],
    ["name", (release) => { release.assets[0].name = "other.zip"; }],
    ["origin URL", (release) => { release.assets[0].browser_download_url += "?changed"; }],
    ["API repository", (release) => {
      release.assets[0].url = "https://api.github.com/repos/other/tools/releases/assets/42";
    }],
    ["size", (release) => { release.assets[0].size += 1; }],
    ["digest", (release) => { release.assets[0].digest = `sha256:${"0".repeat(64)}`; }],
    ["state", (release) => { release.assets[0].state = "new"; }],
    ["asset ID", (release) => { release.assets[0].id = -1; }],
    ["duplicate", (release) => { release.assets.push({ ...release.assets[0] }); }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, async (t) => {
      const fixture = githubDownloadFixture(t);
      mutate(fixture.release);
      await assert.rejects(downloadExact(
        fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          loadGithubToken: () => "synthetic-token",
          async fetch(url) {
            if (url === fixture.artifact.archiveUrl) return new Response(null, { status: 504 });
            assert.equal(url, fixture.metadataUrl);
            return Response.json(fixture.release);
          },
        },
      ), /GitHub release asset.*match the lock/);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});

test("fails closed on unavailable, redirected, malformed, or oversized GitHub API metadata", async (t) => {
  for (const failure of ["unavailable", "redirected", "malformed", "oversized"]) {
    await t.test(failure, async (t) => {
      const fixture = githubDownloadFixture(t);
      await assert.rejects(downloadExact(
        fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          loadGithubToken: () => null,
          async fetch(url, options) {
            if (url === fixture.artifact.archiveUrl) return new Response(null, { status: 504 });
            assert.equal(url, fixture.metadataUrl);
            assert.equal(options.redirect, "error");
            if (failure === "unavailable") return new Response(null, { status: 403 });
            if (failure === "redirected") return new Response(null, {
              status: 302, headers: { location: "https://untrusted.example.test/metadata" },
            });
            if (failure === "malformed") return new Response("not JSON");
            return new Response(Buffer.alloc(1024 * 1024 + 1, 32));
          },
        },
      ), /GitHub release metadata/);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});

test("does not use GitHub API recovery to hide permanent or integrity failures", async (t) => {
  for (const failure of ["HTTP 404", "digest", "redirect"]) {
    await t.test(failure, async (t) => {
      const fixture = githubDownloadFixture(t);
      let calls = 0;
      await assert.rejects(downloadExact(
        fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          loadGithubToken() { assert.fail("permanent failures must not read API credentials"); },
          async fetch(url) {
            calls += 1;
            assert.equal(url, fixture.artifact.archiveUrl);
            if (failure === "HTTP 404") return new Response(null, { status: 404 });
            if (failure === "digest") return new Response(Buffer.alloc(fixture.bytes.length, 120));
            return new Response(null, {
              status: 302, headers: { location: "https://untrusted.example.test/tool.zip" },
            });
          },
        },
      ), /HTTP 404|integrity|host is not allowed/);
      assert.equal(calls, 1);
      assert.deepEqual(fixture.delays, []);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});

test("bounds GitHub API recovery retries and still checks the locked bytes", async (t) => {
  for (const failure of ["transient", "digest"]) {
    await t.test(failure, async (t) => {
      const fixture = githubDownloadFixture(t);
      let calls = 0;
      await assert.rejects(downloadExact(
        fixture.artifact, fixture.allowlist, fixture.destination, {
          sleep: fixture.sleep,
          loadGithubToken: () => null,
          async fetch(url) {
            calls += 1;
            if (url === fixture.artifact.archiveUrl) return new Response(null, { status: 504 });
            if (url === fixture.metadataUrl) return Response.json(fixture.release);
            assert.equal(url, fixture.assetUrl);
            return failure === "transient"
              ? new Response(null, { status: 504 })
              : new Response(Buffer.alloc(fixture.bytes.length, 120));
          },
        },
      ), failure === "transient" ? /after 4 attempts.*releases\/assets\/42.*HTTP 504/ : /integrity/);
      assert.equal(calls, failure === "transient" ? 9 : 6);
      assert.equal(existsSync(fixture.destination), false);
    });
  }
});
