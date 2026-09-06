import { describe, expect, it } from "vitest";
import {
  assertExpectedDownloads,
  expectedDownloadAssets,
  expectedUpdaterAssets,
  officialReleaseAssetUrl,
  readReleaseAssetContract,
} from "./release-assets.mjs";

describe("release asset contract", () => {
  const contract = readReleaseAssetContract();

  it("renders every public download and updater target deterministically", () => {
    expect(expectedDownloadAssets(contract, "1.2.3").map(({ name }) => name)).toEqual([
      "Denote_1.2.3_aarch64.dmg",
      "Denote_1.2.3_x64.dmg",
      "Denote_1.2.3_x64-setup.exe",
      "Denote_1.2.3_amd64.AppImage",
      "Denote_1.2.3_amd64.deb",
      "Denote-1.2.3-1.x86_64.rpm",
    ]);
    expect(expectedUpdaterAssets(contract, "1.2.3")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "darwin-aarch64-app",
          name: "Denote_1.2.3_aarch64.app.tar.gz",
          signatureName: "Denote_1.2.3_aarch64.app.tar.gz.sig",
        }),
        expect.objectContaining({
          target: "windows-x86_64-nsis",
          name: "Denote_1.2.3_x64-setup.exe",
          signatureName: "Denote_1.2.3_x64-setup.exe.sig",
        }),
      ]),
    );
  });

  it("requires every expected download exactly once", () => {
    const assets = expectedDownloadAssets(contract, "1.2.3");
    expect(() => assertExpectedDownloads(contract, "1.2.3", assets)).not.toThrow();
    expect(() =>
      assertExpectedDownloads(contract, "1.2.3", assets.slice(1)),
    ).toThrow("macOS Apple Silicon");
    expect(() =>
      assertExpectedDownloads(contract, "1.2.3", [...assets, assets[0]]),
    ).toThrow("duplicate filenames");
  });

  it("builds only exact official GitHub release URLs", () => {
    expect(
      officialReleaseAssetUrl(
        contract.repository,
        "v1.2.3",
        "Denote_1.2.3_aarch64.dmg",
      ),
    ).toBe(
      "https://github.com/mbianchidev/denote/releases/download/v1.2.3/Denote_1.2.3_aarch64.dmg",
    );
    expect(() =>
      officialReleaseAssetUrl(contract.repository, "v1.2.3", "../bad"),
    ).toThrow("Invalid release filename");
  });
});
