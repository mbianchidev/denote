import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLatestJson,
  readUpdaterConfiguration,
  stageUpdaterArtifacts,
} from "./updater-release.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("updater release", () => {
  it("keeps the checked-in channel explicitly disabled without a public key", () => {
    expect(readUpdaterConfiguration()).toMatchObject({
      enabled: false,
      publicKey: null,
      channel: "stable",
    });
  });

  it("stages architecture-qualified macOS updater bytes and signatures", () => {
    const root = fixtureRoot();
    write(
      join(
        root,
        "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Denote.app.tar.gz",
      ),
      "signed updater bytes",
    );
    write(
      join(
        root,
        "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Denote.app.tar.gz.sig",
      ),
      "synthetic signature",
    );
    const destination = join(root, "staged");
    const staged = stageUpdaterArtifacts({
      projectRoot: root,
      runnerOs: "macOS",
      target: "aarch64-apple-darwin",
      artifact: "macos-aarch64",
      version: "1.2.3",
      destination,
    });
    expect(staged.map((path) => path.split("/").at(-1))).toEqual([
      "Denote_1.2.3_aarch64.app.tar.gz",
      "Denote_1.2.3_aarch64.app.tar.gz.sig",
    ]);
  });

  it("generates complete official static updater metadata", () => {
    const root = fixtureRoot();
    const contract = JSON.parse(readFileSync("release-assets.json", "utf8"));
    for (const entry of contract.updaterTargets) {
      const name = entry.releaseFileName.replace("{version}", "1.2.3");
      write(join(root, name), `${entry.target} bytes`);
      write(join(root, `${name}.sig`), `${entry.target} signature`);
    }
    const output = join(root, "latest.json");
    const manifest = createLatestJson({
      releaseDirectory: root,
      version: "1.2.3",
      publishedAt: "2026-01-02T03:04:05Z",
      notes: "Synthetic release.",
      outputPath: output,
    });
    expect(manifest.platforms["darwin-aarch64-app"]).toEqual({
      url: "https://github.com/mbianchidev/denote/releases/download/v1.2.3/Denote_1.2.3_aarch64.app.tar.gz",
      signature: "darwin-aarch64-app signature",
    });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(manifest);
  });

  it("rejects a missing updater signature", () => {
    const root = fixtureRoot();
    expect(() =>
      createLatestJson({
        releaseDirectory: root,
        version: "1.2.3",
        publishedAt: "2026-01-02T03:04:05Z",
        notes: "",
        outputPath: join(root, "latest.json"),
      }),
    ).toThrow("release artifact");
  });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "denote-updater-release-"));
  temporaryRoots.push(root);
  writeFileSync(
    join(root, "release-assets.json"),
    readFileSync("release-assets.json"),
  );
  return root;
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
