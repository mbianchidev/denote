import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readGitSettings } from "../src/settings";

describe("readGitSettings", () => {
  it("falls back to documented defaults for missing or unusable values", () => {
    expect(readGitSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      readGitSettings({
        defaultBranch: "   ",
        autoCommitIntervalMinutes: -5,
        autoCommitMessage: "",
        includePatterns: 7,
        excludePatterns: null,
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.defaultBranch).toBe("main");
    expect(DEFAULT_SETTINGS.autoCommitIntervalMinutes).toBe(0);
    expect(DEFAULT_SETTINGS.autoCommitMessage).toBe("Denote automatic commit");
    expect(DEFAULT_SETTINGS.useSystemGitSettings).toBe(true);
    expect(DEFAULT_SETTINGS.authMode).toBe("system");
    expect(DEFAULT_SETTINGS.signingMode).toBe("system");
    expect(DEFAULT_SETTINGS.signingKey).toBeNull();
  });

  it("reads a complete configuration", () => {
    expect(
      readGitSettings({
        gitExecutablePath: "/synthetic/bin/git",
        defaultBranch: "trunk",
        authorName: "Synthetic Author",
        authorEmail: "author@example.invalid",
        autoCommitIntervalMinutes: 15,
        autoCommitMessage: "Synthetic automatic commit",
        includePatterns: "notes, projects/alpha ,",
        excludePatterns: "scratch",
        useSystemGitSettings: false,
        authenticationMode: "github-https",
        commitSigning: "always",
        gpgSigningKey: "ABCDEF1234567890",
      }),
    ).toEqual({
      useSystemGitSettings: false,
      authMode: "github-https",
      pullStrategy: "fast-forward-only",
      signingMode: "always",
      signingKey: "ABCDEF1234567890",
      defaultBranch: "trunk",
      identity: {
        authorName: "Synthetic Author",
        authorEmail: "author@example.invalid",
      },
      autoCommitIntervalMinutes: 15,
      autoCommitMessage: "Synthetic automatic commit",
      includePatterns: ["notes", "projects/alpha"],
      excludePatterns: ["scratch"],
    });
  });

  it("uses an identity only when both halves are present and safe", () => {
    const rejected = [
      { authorName: "Synthetic Author", authorEmail: "" },
      { authorName: "", authorEmail: "author@example.invalid" },
      {
        authorName: "Synthetic\nAuthor",
        authorEmail: "author@example.invalid",
      },
      {
        authorName: "Synthetic <hidden>",
        authorEmail: "author@example.invalid",
      },
      {
        authorName: "Synthetic Author",
        authorEmail: "<author@example.invalid>",
      },
      {
        authorName: "N".repeat(256),
        authorEmail: "author@example.invalid",
      },
      { authorName: 7, authorEmail: "author@example.invalid" },
    ];

    for (const settings of rejected) {
      expect(readGitSettings(settings).identity).toBeNull();
    }
  });

  it("refuses a branch name Git would reject or read as an option", () => {
    for (const defaultBranch of [
      "-main",
      "main..topic",
      "main branch",
      "main.lock",
      "refs/heads/main~1",
      "topic^",
      "topic:name",
      "topic?",
      "topic*",
      "topic[1]",
    ]) {
      expect(readGitSettings({ defaultBranch }).defaultBranch).toBe("main");
    }
    expect(
      readGitSettings({ defaultBranch: "release/2026" }).defaultBranch,
    ).toBe("release/2026");
  });

  it("bounds the automatic commit interval", () => {
    expect(
      readGitSettings({ autoCommitIntervalMinutes: 1440 })
        .autoCommitIntervalMinutes,
    ).toBe(1440);
    for (const autoCommitIntervalMinutes of [1441, 2.5, -1, "10"]) {
      expect(
        readGitSettings({ autoCommitIntervalMinutes })
          .autoCommitIntervalMinutes,
      ).toBe(0);
    }
  });

  it("keeps only usable relative path prefixes", () => {
    expect(
      readGitSettings({
        includePatterns:
          "notes/, /absolute, ../escape, notes/../secrets, ~/home, C:/drive, back\\slash, :(glob)magic, --option, .git, notes/.git, ",
        excludePatterns: "scratch/drafts/",
      }),
    ).toMatchObject({
      includePatterns: ["notes"],
      excludePatterns: ["scratch/drafts"],
    });
  });
});
