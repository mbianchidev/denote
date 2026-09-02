import { describe, expect, it } from "vitest";
import type { PluginAutomaticLocalCommitSchedule } from "@denote/plugin-sdk";
import {
  isPluginAutomaticLocalCommitPayload,
  normalizeAutomaticLocalCommitSchedule,
} from "./automaticCommits";

function schedule(
  overrides: Partial<PluginAutomaticLocalCommitSchedule> = {},
): PluginAutomaticLocalCommitSchedule {
  return {
    id: "denote.synthetic.nightly",
    intervalMinutes: 15,
    message: "Synthetic automatic commit",
    ...overrides,
  };
}

describe("normalizeAutomaticLocalCommitSchedule", () => {
  it("resolves optional fields and normalizes path prefixes", () => {
    expect(
      normalizeAutomaticLocalCommitSchedule(
        "denote.synthetic",
        schedule({
          includePatterns: ["notes/", "projects/alpha"],
          excludePatterns: ["notes/drafts/"],
          authorName: "Synthetic Author",
          authorEmail: "synthetic@example.invalid",
        }),
      ),
    ).toEqual({
      id: "denote.synthetic.nightly",
      intervalMinutes: 15,
      message: "Synthetic automatic commit",
      includePatterns: ["notes", "projects/alpha"],
      excludePatterns: ["notes/drafts"],
      authorName: "Synthetic Author",
      authorEmail: "synthetic@example.invalid",
    });
  });

  it("requires the plugin's own ID prefix", () => {
    expect(() =>
      normalizeAutomaticLocalCommitSchedule(
        "denote.synthetic",
        schedule({ id: "denote.other.nightly" }),
      ),
    ).toThrow(/denote.synthetic. prefix/);
  });

  it("bounds the interval to whole minutes above zero", () => {
    for (const intervalMinutes of [0, -1, 1441, 2.5, Number.NaN]) {
      expect(() =>
        normalizeAutomaticLocalCommitSchedule(
          "denote.synthetic",
          schedule({ intervalMinutes }),
        ),
      ).toThrow(/interval/i);
    }
    expect(
      normalizeAutomaticLocalCommitSchedule(
        "denote.synthetic",
        schedule({ intervalMinutes: 1440 }),
      ).intervalMinutes,
    ).toBe(1440);
  });

  it("refuses an empty, oversized, or multi-line message", () => {
    for (const message of ["", "   ", "a".repeat(501), "one\ntwo"]) {
      expect(() =>
        normalizeAutomaticLocalCommitSchedule(
          "denote.synthetic",
          schedule({ message }),
        ),
      ).toThrow(/message/i);
    }
  });

  it("refuses a pattern that is not a repository-relative prefix", () => {
    for (const pattern of [
      "/notes",
      "../notes",
      "notes/../secrets",
      "~/notes",
      "C:/notes",
      "notes\\drafts",
      ":(glob)notes",
      "--output",
      ".git",
      "notes/.git",
      "",
      "notes\u0000",
    ]) {
      expect(() =>
        normalizeAutomaticLocalCommitSchedule(
          "denote.synthetic",
          schedule({ includePatterns: [pattern] }),
        ),
      ).toThrow(/include patterns/i);
    }
  });

  it("refuses a half-configured identity", () => {
    expect(() =>
      normalizeAutomaticLocalCommitSchedule(
        "denote.synthetic",
        schedule({ authorName: "Synthetic Author" }),
      ),
    ).toThrow(/both an author name and an author email/i);
    expect(() =>
      normalizeAutomaticLocalCommitSchedule(
        "denote.synthetic",
        schedule({
          authorName: "Synthetic <Author>",
          authorEmail: "synthetic@example.invalid",
        }),
      ),
    ).toThrow(/angle brackets/i);
  });
});

describe("isPluginAutomaticLocalCommitPayload", () => {
  it("accepts a fully normalized payload", () => {
    expect(
      isPluginAutomaticLocalCommitPayload({
        id: "denote.synthetic.nightly",
        intervalMinutes: 15,
        message: "Synthetic automatic commit",
        includePatterns: [],
        excludePatterns: [],
        authorName: null,
        authorEmail: null,
      }),
    ).toBe(true);
  });

  it("rejects a payload whose identity or patterns were not normalized", () => {
    expect(
      isPluginAutomaticLocalCommitPayload({
        id: "denote.synthetic.nightly",
        intervalMinutes: 15,
        message: "Synthetic automatic commit",
        includePatterns: ["notes/"],
        excludePatterns: [],
        authorName: null,
        authorEmail: null,
      }),
    ).toBe(false);
    expect(
      isPluginAutomaticLocalCommitPayload({
        id: "denote.synthetic.nightly",
        intervalMinutes: 15,
        message: "Synthetic automatic commit",
        includePatterns: [],
        excludePatterns: [],
        authorName: "Synthetic Author",
        authorEmail: null,
      }),
    ).toBe(false);
    expect(isPluginAutomaticLocalCommitPayload({ id: "" })).toBe(false);
  });
});
