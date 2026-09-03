import assert from "node:assert/strict";
import test from "node:test";
import {
  currentTarget,
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

test("rejects malformed ZIP input before extraction", () => {
  assert.throws(() => parseZipEntries(Buffer.from("not-a-zip")), /missing/);
});
