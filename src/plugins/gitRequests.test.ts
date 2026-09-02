import { describe, expect, it } from "vitest";
import type { PluginGitRequest } from "@denote/plugin-sdk";
import {
  parsePluginGitCleanupToken,
  parsePluginGitCloneVaultRequest,
  parsePluginGitHubListLimit,
  parsePluginGitRequest,
} from "./gitRequests";

const accepted: PluginGitRequest[] = [
  { operation: "discover", scope: "vault" },
  { operation: "status", scope: "project" },
  { operation: "operation-state", scope: "vault" },
  { operation: "initialize", scope: "vault", defaultBranch: "main" },
  { operation: "stage", scope: "vault", paths: ["notes/alpha.md"] },
  { operation: "unstage", scope: "vault", paths: ["notes/alpha.md"] },
  {
    operation: "commit",
    scope: "vault",
    message: "Record synthetic note",
    amend: false,
    allowEmpty: false,
  },
  {
    operation: "commit",
    scope: "vault",
    message: "Record synthetic note",
    authorName: "Synthetic Author",
    authorEmail: "author@example.invalid",
  },
  { operation: "list-branches", scope: "vault" },
  { operation: "list-remotes", scope: "vault" },
  {
    operation: "list-history",
    scope: "vault",
    maxCount: 25,
    skip: 0,
    ref: "main",
    path: "notes/alpha.md",
  },
  { operation: "diff", scope: "vault", target: { kind: "worktree" } },
  { operation: "diff", scope: "vault", target: { kind: "index" } },
  {
    operation: "diff",
    scope: "vault",
    target: { kind: "commit", commit: "0123456789abcdef0123456789abcdef01234567" },
    paths: ["notes/alpha.md"],
  },
  {
    operation: "diff",
    scope: "vault",
    target: { kind: "range", fromCommit: "main~1", toCommit: "main" },
  },
  { operation: "fetch", scope: "vault", remote: "origin", prune: true },
  {
    operation: "pull",
    scope: "vault",
    remote: "origin",
    branch: "main",
    strategy: "fast-forward-only",
  },
  {
    operation: "push",
    scope: "vault",
    remote: "origin",
    branch: "main",
    setUpstream: true,
    mode: "force-with-lease",
  },
  {
    operation: "add-remote",
    scope: "vault",
    name: "origin",
    url: "https://example.invalid/synthetic.git",
  },
  {
    operation: "set-remote-url",
    scope: "vault",
    name: "origin",
    url: "ssh://example.invalid/synthetic.git",
  },
  { operation: "remove-remote", scope: "vault", name: "origin" },
  {
    operation: "create-branch",
    scope: "vault",
    name: "topic",
    startPoint: "main",
    checkout: true,
  },
  { operation: "checkout-branch", scope: "vault", name: "topic" },
  {
    operation: "rename-branch",
    scope: "vault",
    name: "topic",
    newName: "topic-two",
  },
  { operation: "delete-branch", scope: "vault", name: "topic", force: true },
  {
    operation: "stash",
    scope: "vault",
    action: "push",
    message: "synthetic",
    includeUntracked: true,
  },
  { operation: "stash", scope: "vault", action: "drop", entry: 0 },
  { operation: "merge", scope: "vault", ref: "topic", noCommit: true },
  { operation: "rebase", scope: "vault", upstream: "main" },
  { operation: "cherry-pick", scope: "vault", commit: "main" },
  { operation: "revert", scope: "vault", commit: "main" },
  { operation: "continue", scope: "vault", sequencer: "rebase" },
  { operation: "skip", scope: "vault", sequencer: "rebase" },
  { operation: "abort", scope: "vault", sequencer: "merge" },
  {
    operation: "read-conflict-stage",
    scope: "vault",
    path: "notes/alpha.md",
    stage: "theirs",
  },
  {
    operation: "resolve-conflict",
    scope: "vault",
    path: "notes/alpha.md",
    resolution: { kind: "stage", stage: "ours" },
  },
  {
    operation: "resolve-conflict",
    scope: "vault",
    path: "notes/alpha.md",
    resolution: { kind: "content", contentBase64: "c3ludGhldGlj" },
  },
  {
    operation: "clone",
    scope: "vault",
    url: "https://example.invalid/synthetic.git",
    directory: "synthetic",
    branch: "main",
  },
  {
    operation: "cancel",
    operationId: "11111111-2222-4333-8444-555555555555",
  },
];

describe("parsePluginGitRequest", () => {
  it("accepts every supported structured operation", () => {
    for (const request of accepted) {
      expect(parsePluginGitRequest(request)).toEqual(request);
    }
  });

  it("keeps only declared fields so plugins cannot smuggle arguments", () => {
    const parsed = parsePluginGitRequest({
      operation: "commit",
      scope: "vault",
      message: "Record synthetic note",
      arguments: ["--exec=touch pwned"],
      authorDate: "2026-01-01T00:00:00Z",
      committerName: "Synthetic Committer",
      extra: true,
    });

    expect(parsed).toEqual({
      operation: "commit",
      scope: "vault",
      message: "Record synthetic note",
    });
  });

  it("drops any attempt to name a Git executable", () => {
    // The executable is host-owned and read from persisted plugin settings, so
    // a request has no field that can carry one.
    const parsed = parsePluginGitRequest({
      operation: "status",
      scope: "vault",
      executablePath: "/opt/synthetic/bin/git",
      gitExecutablePath: "/opt/synthetic/bin/git",
      options: { executablePath: "/opt/synthetic/bin/git" },
    });

    expect(parsed).toEqual({ operation: "status", scope: "vault" });
  });

  it("rejects unknown operations, scopes, and malformed fields", () => {
    const rejected: unknown[] = [
      null,
      "status",
      [],
      { operation: "unknown", scope: "vault" },
      { operation: "status" },
      { operation: "status", scope: "workspace" },
      { operation: "stage", scope: "vault", paths: "notes/alpha.md" },
      { operation: "stage", scope: "vault", paths: [1] },
      { operation: "commit", scope: "vault" },
      { operation: "commit", scope: "vault", message: 4 },
      {
        operation: "commit",
        scope: "vault",
        message: "Record synthetic note",
        authorName: 7,
      },
      {
        operation: "commit",
        scope: "vault",
        message: "Record synthetic note",
        authorEmail: ["author@example.invalid"],
      },
      { operation: "list-history", scope: "vault" },
      { operation: "list-history", scope: "vault", maxCount: 0 },
      { operation: "list-history", scope: "vault", maxCount: 1.5 },
      { operation: "diff", scope: "vault", target: { kind: "tree" } },
      { operation: "diff", scope: "vault", target: { kind: "commit" } },
      { operation: "pull", scope: "vault", remote: "origin", branch: "main" },
      {
        operation: "pull",
        scope: "vault",
        remote: "origin",
        branch: "main",
        strategy: "squash",
      },
      { operation: "stash", scope: "vault", action: "clear" },
      { operation: "stash", scope: "vault", action: "drop", entry: -1 },
      { operation: "continue", scope: "vault", sequencer: "bisect" },
      {
        operation: "read-conflict-stage",
        scope: "vault",
        path: "notes/alpha.md",
        stage: "mine",
      },
      {
        operation: "resolve-conflict",
        scope: "vault",
        path: "notes/alpha.md",
        resolution: { kind: "merge" },
      },
      { operation: "cancel" },
      { operation: "cancel", operationId: 7 },
      // Only the host runtime generates operation IDs, so nothing else can
      // address a running operation.
      { operation: "cancel", operationId: "operation-1" },
      {
        operation: "cancel",
        operationId: "11111111-2222-4333-8444-55555555555",
      },
    ];

    for (const request of rejected) {
      expect(() => parsePluginGitRequest(request)).toThrow();
    }
  });
});

describe("remote authentication and clone parsing", () => {
  it("keeps a declared authentication mode and drops an unknown one", () => {
    expect(
      parsePluginGitRequest({
        operation: "fetch",
        scope: "vault",
        remote: "origin",
        authMode: "github-https",
      }),
    ).toEqual({
      operation: "fetch",
      scope: "vault",
      authMode: "github-https",
      remote: "origin",
    });
    expect(() =>
      parsePluginGitRequest({
        operation: "push",
        scope: "vault",
        remote: "origin",
        branch: "main",
        authMode: "basic-password",
      }),
    ).toThrow();
  });

  it("rebuilds a clone request without a destination", () => {
    expect(
      parsePluginGitCloneVaultRequest({
        url: "https://github.com/synthetic-owner/synthetic-notes.git",
        authMode: "github-https",
        branch: "main",
        // The host owns the destination, so a supplied one is dropped.
        directory: "/synthetic/elsewhere",
      }),
    ).toEqual({
      url: "https://github.com/synthetic-owner/synthetic-notes.git",
      authMode: "github-https",
      branch: "main",
    });
    expect(() =>
      parsePluginGitCloneVaultRequest({
        url: "https://example.invalid/repo.git",
      }),
    ).toThrow();
  });

  it("bounds a repository listing and requires an opaque clean-up token", () => {
    expect(parsePluginGitHubListLimit({ limit: 50 })).toBe(50);
    expect(() => parsePluginGitHubListLimit({ limit: 0 })).toThrow();
    expect(() => parsePluginGitHubListLimit({ limit: 201 })).toThrow();
    expect(
      parsePluginGitCleanupToken({
        cleanupToken: "11111111-2222-4333-8444-555555555555",
      }),
    ).toBe("11111111-2222-4333-8444-555555555555");
    expect(() =>
      parsePluginGitCleanupToken({ cleanupToken: "/synthetic/destination" }),
    ).toThrow();
  });
});
