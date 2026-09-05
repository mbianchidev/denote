import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(join(root, "plugins/synthetic/plugin.json"), '{"id":"synthetic.plugin"}');
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

it("matches immutable ledgers by plugin ID after a directory move", () => {
  const { root, git } = fixture();
  mkdirSync(join(root, "plugins/synthetic"), { recursive: true });
  writeFileSync(join(root, "plugins/synthetic/plugin.json"), '{"id":"synthetic.plugin"}');
  writeFileSync(join(root, "plugins/synthetic/releases.json"), '[{"version":"1.0.0","sourcePath":"plugins/synthetic"}]');
  git("add", "plugins");
  git("commit", "--no-gpg-sign", "-qm", "Record synthetic ledger");
  const base = git("rev-parse", "HEAD");
  renameSync(join(root, "plugins/synthetic"), join(root, "plugins/renamed"));
  expect(() => checkPluginArchives(root, base)).not.toThrow();
});

it("rejects archives introduced only by a merge resolution and then deleted", () => {
  const { root, git, base } = fixture();
  git("switch", "-c", "synthetic-work");
  git("switch", "-c", "synthetic-side");
  git("commit", "--no-gpg-sign", "--allow-empty", "-qm", "Synthetic side");
  git("switch", "synthetic-work");
  git("merge", "--no-ff", "--no-commit", "synthetic-side");
  writeFileSync(join(root, "resolution.tgz"), "mock archive");
  git("add", "resolution.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Synthetic merge resolution");
  git("rm", "resolution.tgz");
  git("commit", "--no-gpg-sign", "-qm", "Remove synthetic archive");
  expect(() => checkPluginArchives(root, base)).toThrow("even if later deleted");
});
