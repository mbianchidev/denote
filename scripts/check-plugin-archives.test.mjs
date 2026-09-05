import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkPluginArchives } from "./check-plugin-archives.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "denote-archive-guard-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Synthetic Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgSign", "false");
  writeFileSync(join(root, "synthetic.tgz"), "mock archive bytes");
  git("add", "synthetic.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Historic fixture");
  const base = git("rev-parse", "HEAD");
  git("rm", "synthetic.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Remove historic fixture");
  return { root, git, base };
}

it("allows removal while keeping immutable historical archives reachable", () => {
  const { root, base } = fixture();
  expect(() => checkPluginArchives(root, base)).not.toThrow();
});

it("rejects newly tracked archives regardless of capitalization", () => {
  const { root, git } = fixture();
  writeFileSync(join(root, "synthetic.TGZ"), "mock");
  git("add", "synthetic.TGZ");
  expect(() => checkPluginArchives(root)).toThrow("must not be tracked");
});

it("rejects an archive introduced then removed within proposed commits", () => {
  const { root, git, base } = fixture();
  writeFileSync(join(root, "transient.tgz"), "mock");
  git("add", "transient.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Introduce fixture");
  git("rm", "transient.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Delete fixture");
  expect(() => checkPluginArchives(root, base)).toThrow("even if later deleted");
});

it("keeps previously recorded plugin versions append-only", () => {
  const { root, git } = fixture();
  mkdirSync(join(root, "plugins/synthetic"), { recursive: true });
  const path = join(root, "plugins/synthetic/releases.json");
  const entry = { version: "1.0.0", sourceCommit: "a".repeat(40), artifact: { sha256: "b".repeat(64) } };
  writeFileSync(path, JSON.stringify([entry]));
  git("add", "plugins");
  git("commit", "--no-gpg-sign", "-qm", "Record synthetic release");
  const base = git("rev-parse", "HEAD");
  writeFileSync(path, JSON.stringify([entry, { ...entry, version: "2.0.0" }]));
  expect(() => checkPluginArchives(root, base)).not.toThrow();
  writeFileSync(path, JSON.stringify([{ ...entry, sourceCommit: "c".repeat(40) }]));
  expect(() => checkPluginArchives(root, base)).toThrow("Immutable release ledger changed");
});
