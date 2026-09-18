import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPackagedSize,
  currentTarget,
  gitBuildEnvironment,
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
