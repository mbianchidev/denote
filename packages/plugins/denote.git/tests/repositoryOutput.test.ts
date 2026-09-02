import { describe, expect, it } from "vitest";
import {
  describeOperationState,
  parseBranches,
  parseHistory,
  parseInitialized,
  parseOperationState,
  parseRemotes,
} from "../src/repositoryOutput";

describe("parseBranches", () => {
  it("reads local and remote branches with tracking counts", () => {
    const branches = parseBranches(
      [
        "refs/heads/main\t1111111111111111111111111111111111111111\t*\trefs/remotes/origin/main\t[ahead 2, behind 1]",
        "refs/heads/topic\t2222222222222222222222222222222222222222\t \t\t",
        "refs/heads/gone\t3333333333333333333333333333333333333333\t \trefs/remotes/origin/gone\t[gone]",
        "refs/remotes/origin/main\t1111111111111111111111111111111111111111\t \t\t",
        "refs/remotes/origin/HEAD\t1111111111111111111111111111111111111111\t \t\t",
        "refs/tags/v1\t4444444444444444444444444444444444444444\t \t\t",
      ].join("\n"),
    );

    expect(branches).toEqual([
      {
        name: "main",
        current: true,
        remote: false,
        upstream: "origin/main",
        ahead: 2,
        behind: 1,
      },
      {
        name: "topic",
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
      {
        name: "gone",
        current: false,
        remote: false,
        upstream: "origin/gone",
        ahead: 0,
        behind: 0,
      },
      {
        name: "origin/main",
        current: false,
        remote: true,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ]);
  });
});

describe("parseRemotes", () => {
  it("merges fetch and push URLs and tolerates a URL that contains a space", () => {
    const remotes = parseRemotes(
      [
        "origin\thttps://example.invalid/synthetic.git (fetch)",
        "origin\thttps://example.invalid/synthetic.git (push)",
        "backup\t/synthetic/local path/mirror.git (fetch)",
        "malformed-line-without-a-marker",
      ].join("\n"),
    );

    expect(remotes).toEqual([
      {
        name: "origin",
        fetchUrl: "https://example.invalid/synthetic.git",
        pushUrl: "https://example.invalid/synthetic.git",
      },
      {
        name: "backup",
        fetchUrl: "/synthetic/local path/mirror.git",
        pushUrl: null,
      },
    ]);
  });
});

describe("parseHistory", () => {
  it("cannot be shifted by tabs or newlines in an author name or a subject", () => {
    const history = parseHistory(
      [
        "1111111111111111111111111111111111111111",
        "1111111",
        "Synthetic\tAuthor",
        "2026-01-01T00:00:00+00:00",
        "2222222222222222222222222222222222222222",
        "HEAD -> main, origin/main",
        "Record a note\twith a tab\nand a newline",
        "2222222222222222222222222222222222222222",
        "2222222",
        "Synthetic Author",
        "2025-12-31T00:00:00+00:00",
        "",
        "",
        "Create the vault",
        "",
      ].join("\0"),
    );

    expect(history).toEqual([
      {
        id: "1111111111111111111111111111111111111111",
        shortId: "1111111",
        authorName: "Synthetic\tAuthor",
        authoredAt: "2026-01-01T00:00:00+00:00",
        summary: "Record a note\twith a tab\nand a newline",
        parentIds: ["2222222222222222222222222222222222222222"],
        refs: ["main", "origin/main"],
      },
      {
        id: "2222222222222222222222222222222222222222",
        shortId: "2222222",
        authorName: "Synthetic Author",
        authoredAt: "2025-12-31T00:00:00+00:00",
        summary: "Create the vault",
        parentIds: [],
        refs: [],
      },
    ]);
  });

  it("reports nothing for empty or partial output", () => {
    expect(parseHistory("")).toEqual([]);
    expect(parseHistory("\0")).toEqual([]);
    // A record cut short by the host's output limit is discarded rather than
    // reported with fields borrowed from nothing.
    expect(
      parseHistory(
        [
          "1111111111111111111111111111111111111111",
          "1111111",
          "Synthetic Author",
          "2026-01-01T00:00:00+00:00",
        ].join("\0"),
      ),
    ).toEqual([]);
  });
});

describe("parseOperationState and parseInitialized", () => {
  it("reads the host report and names the interrupted operation", () => {
    const state = parseOperationState(
      JSON.stringify({
        mergeInProgress: false,
        cherryPickInProgress: false,
        revertInProgress: false,
        rebaseInProgress: true,
        rebaseKind: "merge",
        sequencerInProgress: false,
        bisectInProgress: false,
      }),
    );

    expect(state).toEqual({
      mergeInProgress: false,
      cherryPickInProgress: false,
      revertInProgress: false,
      rebaseInProgress: true,
      sequencerInProgress: false,
      bisectInProgress: false,
    });
    expect(state && describeOperationState(state)).toBe("rebase");
  });

  it("treats unreadable reports as unknown rather than as quiet success", () => {
    expect(parseOperationState("not json")).toBeNull();
    expect(parseOperationState("[]")).toBeNull();
    expect(parseInitialized('{"initialized":true}')).toBe(true);
    expect(parseInitialized('{"initialized":false}')).toBe(false);
    expect(parseInitialized("not json")).toBe(false);
  });
});
