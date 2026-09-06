import { describe, expect, it } from "vitest";
import { detectRecommendedDownload, resolveReleaseDownloads } from "./downloads.js";

const contract = {
  schemaVersion: 1,
  repository: "mbianchidev/denote",
  downloads: [
    {
      id: "macos-aarch64",
      label: "macOS Apple Silicon",
      fileName: "Denote_{version}_aarch64.dmg",
    },
    {
      id: "windows-x64",
      label: "Windows",
      fileName: "Denote_{version}_x64-setup.exe",
    },
  ],
};

describe("website downloads", () => {
  it("resolves only exact official latest-release assets", () => {
    const result = resolveReleaseDownloads(contract, {
      tag_name: "v1.2.3",
      draft: false,
      prerelease: false,
      html_url: "https://github.com/mbianchidev/denote/releases/tag/v1.2.3",
      assets: [
        asset("Denote_1.2.3_aarch64.dmg"),
        asset("Denote_1.2.3_x64-setup.exe"),
      ],
    });
    expect(result.downloads["macos-aarch64"].url).toContain(
      "/v1.2.3/Denote_1.2.3_aarch64.dmg",
    );
  });

  it("fails visibly when an expected artifact is absent or unofficial", () => {
    expect(() =>
      resolveReleaseDownloads(contract, {
        tag_name: "v1.2.3",
        draft: false,
        prerelease: false,
        assets: [asset("Denote_1.2.3_aarch64.dmg")],
      }),
    ).toThrow("Windows is unavailable");
    expect(() =>
      resolveReleaseDownloads(contract, {
        tag_name: "v1.2.3",
        draft: false,
        prerelease: false,
        assets: [
          asset("Denote_1.2.3_aarch64.dmg"),
          {
            name: "Denote_1.2.3_x64-setup.exe",
            browser_download_url: "https://example.test/installer.exe",
          },
        ],
      }),
    ).toThrow("Windows is unavailable");
  });

  it("recommends without hiding explicit platform choices", () => {
    expect(detectRecommendedDownload("Win32", "Synthetic", "")).toBe(
      "windows-x64",
    );
    expect(detectRecommendedDownload("MacIntel", "Synthetic", "arm")).toBe(
      "macos-aarch64",
    );
    expect(detectRecommendedDownload("Unknown", "Synthetic", "")).toBeNull();
  });
});

function asset(name) {
  return {
    name,
    browser_download_url: `https://github.com/mbianchidev/denote/releases/download/v1.2.3/${name}`,
  };
}
