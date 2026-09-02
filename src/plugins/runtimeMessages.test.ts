import { describe, expect, it } from "vitest";
import {
  isPluginHostMessage,
  isPluginRuntimeMessage,
  type PluginRuntimeMessage,
} from "./runtimeMessages";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";

const model: PluginSourceControlViewModel = {
  selectedTab: "changes",
  selectedView: { kind: "repository" },
  repository: {
    repositoryId: "repo-1",
    label: "Synthetic repository",
    initialized: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    latestCommit: null,
    busy: false,
  },
  resourceGroups: [],
  branches: [],
  remotes: [],
  history: [],
  historyPage: {
    pageIndex: 0,
    pageSize: 20,
    hasPrevious: false,
    hasNext: false,
    loading: false,
    error: null,
  },
  commitDetail: null,
  diffFiles: [],
  diffSource: null,
  conflicts: [],
  conflictDetail: null,
  operationProgress: null,
  operationPlan: null,
  recovery: { state: "idle" },
  pendingBranchSwitch: null,
  remoteAccess: {
    authMode: "public" as const,
    cloneAvailable: true,
    githubAvailable: false,
    repositories: [],
    cleanup: null,
    review: null,
  },
};

describe("plugin runtime source control messages", () => {
  it("accepts serializable registration, update, and action results", () => {
    const messages: PluginRuntimeMessage[] = [
      {
        type: "register-source-control",
        id: "denote.synthetic.git",
        title: "Git",
        model,
      },
      {
        type: "update-source-control",
        id: "denote.synthetic.git",
        model,
      },
      {
        type: "unregister-source-control",
        id: "denote.synthetic.git",
      },
      {
        type: "source-control-action-result",
        requestId: "request-1",
      },
    ];

    expect(messages.every(isPluginRuntimeMessage)).toBe(true);
  });

  it("rejects malformed source control models", () => {
    expect(
      isPluginRuntimeMessage({
        type: "register-source-control",
        id: "denote.synthetic.git",
        title: "Git",
        model: {
          ...model,
          repository: { ...model.repository, busy: "no" },
        },
      }),
    ).toBe(false);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: { ...model, resourceGroups: [{}] },
      }),
    ).toBe(false);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          resourceGroups: [
            {
              kind: new String("unstaged"),
              label: "Changes",
              resources: [],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("accepts an optional active operation ID and rejects a malformed one", () => {    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          repository: {
            ...model.repository,
            busy: true,
            busyMessage: "Refreshing the repository",
            activeOperationId: "11111111-2222-4333-8444-555555555555",
          },
        },
      }),
    ).toBe(true);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          repository: { ...model.repository, busy: true, activeOperationId: 7 },
        },
      }),
    ).toBe(false);
  });

  it("validates the history page, the selected commit, and the diff source", () => {
    const commit = {
      id: "1111111111111111111111111111111111111111",
      shortId: "1111111",
      summary: "Record a synthetic note",
      authorName: "Synthetic Author",
      authoredAt: "2026-01-01T00:00:00+00:00",
      parentIds: [],
      refs: ["main"],
    };
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          history: [commit],
          historyPage: {
            pageIndex: 1,
            pageSize: 20,
            hasPrevious: true,
            hasNext: false,
            loading: false,
            error: null,
          },
          commitDetail: { commit, files: [], limitation: null },
          diffSource: { kind: "commit", commitId: commit.id },
        },
      }),
    ).toBe(true);
    // A page a provider cannot describe as whole commits is refused rather
    // than rendered as an unbounded window.
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          historyPage: { ...model.historyPage, pageSize: -1 },
        },
      }),
    ).toBe(false);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: { ...model, historyPage: undefined },
      }),
    ).toBe(false);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: {
          ...model,
          commitDetail: { commit: { id: commit.id }, files: [], limitation: null },
        },
      }),
    ).toBe(false);
    // A commit diff has to name the revision it came from, so a surface can
    // never treat history content as a stageable working-tree change.
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: { ...model, diffSource: { kind: "commit" } },
      }),
    ).toBe(false);
    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: { ...model, diffSource: { kind: "stash" } },
      }),
    ).toBe(false);
  });

  it("validates typed source control action requests", () => {
    expect(
      isPluginHostMessage({
        type: "run-source-control-action",
        providerId: "denote.synthetic.git",
        action: {
          id: "commit",
          values: { amend: false, retries: 1, message: "Synthetic commit" },
        },
        requestId: "request-1",
      }),
    ).toBe(true);
    expect(
      isPluginHostMessage({
        type: "run-source-control-action",
        providerId: "denote.synthetic.git",
        action: { id: "commit", values: { paths: ["note.md"] } },
        requestId: "request-1",
      }),
    ).toBe(false);
  });

  it("accepts a conflict, an operation, and a review only when they are typed", () => {
    const conflictDetail = {
      path: "notes/alpha.md",
      operation: "merge",
      binary: false,
      encrypted: false,
      base: {
        side: "base",
        label: "Common ancestor",
        present: true,
        text: "one\n",
        byteLength: 4,
      },
      ours: {
        side: "ours",
        label: "main",
        present: true,
        text: "OURS\n",
        byteLength: 5,
      },
      theirs: {
        side: "theirs",
        label: "Incoming change",
        present: false,
        text: null,
        byteLength: 0,
      },
      chunks: [
        {
          id: "chunk-0",
          kind: "conflict",
          base: ["one"],
          ours: ["OURS"],
          theirs: [],
          choice: null,
          automatic: false,
        },
      ],
      result: "one\n",
      unsavedResult: false,
      unresolvedChunks: 1,
      wholeSideOnly: false,
      limitation: null,
      status: null,
      error: null,
      loading: false,
    };
    const operationProgress = {
      operation: "rebase",
      summary: "A rebase is in progress.",
      conflictedPaths: ["notes/alpha.md"],
      continueAvailable: false,
      continueUnavailableReason: "Resolve the conflict first.",
      skipAvailable: true,
      abortAvailable: true,
    };
    const operationPlan = {
      operation: "cherry-pick",
      source: "commit-1",
      sourceDetail: "abc1234 · Synthetic commit",
      currentBranch: "main",
      risk: "creates-commit",
      summary: "Record the change made by commit-1 as a new commit.",
      affectedPaths: ["notes/alpha.md"],
      affectedPathsLimitation: null,
      startActionId: "cherry-pick",
      cancelActionId: "cancel-operation-plan",
    };

    expect(
      isPluginRuntimeMessage({
        type: "update-source-control",
        id: "denote.synthetic.git",
        model: { ...model, conflictDetail, operationProgress, operationPlan },
      }),
    ).toBe(true);

    // A side that names another stage, an operation Denote does not run, and a
    // risk it has no wording for are all refused rather than rendered.
    for (const invalid of [
      { ...model, conflictDetail: { ...conflictDetail, ours: conflictDetail.base } },
      {
        ...model,
        conflictDetail: {
          ...conflictDetail,
          chunks: [{ ...conflictDetail.chunks[0], choice: "mine" }],
        },
      },
      { ...model, operationProgress: { ...operationProgress, operation: "bisect" } },
      { ...model, operationPlan: { ...operationPlan, risk: "harmless" } },
      {
        ...model,
        pendingBranchSwitch: {
          operation: "reset",
          target: "topic",
          localBranch: null,
          fromBranch: "main",
          stagedPaths: [],
          unstagedPaths: [],
          untrackedPaths: [],
          commitAvailable: true,
          stashAvailable: true,
          stashUnavailableReason: null,
          commitActionId: "branch-switch-commit",
          stashActionId: "branch-switch-stash",
          cancelActionId: "branch-switch-cancel",
        },
      },
    ]) {
      expect(
        isPluginRuntimeMessage({
          type: "update-source-control",
          id: "denote.synthetic.git",
          model: invalid,
        }),
      ).toBe(false);
    }
  });

  it("requires a workspace change flag on every project context change", () => {
    expect(
      isPluginHostMessage({
        type: "project-context-change",
        event: { previous: null, current: null, workspaceChanged: true },
      }),
    ).toBe(true);
    expect(
      isPluginHostMessage({
        type: "project-context-change",
        event: {
          previous: null,
          current: { projectId: "project-1", rootPath: "code/alpha" },
          workspaceChanged: false,
        },
      }),
    ).toBe(true);
    // Without the flag a plugin cannot tell a vault switch from no change at
    // all, so the message is refused rather than assumed.
    expect(
      isPluginHostMessage({
        type: "project-context-change",
        event: { previous: null, current: null },
      }),
    ).toBe(false);
    expect(
      isPluginHostMessage({
        type: "project-context-change",
        event: { previous: null, current: null, workspaceChanged: "yes" },
      }),
    ).toBe(false);
  });
});
