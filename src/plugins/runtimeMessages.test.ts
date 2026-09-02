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
  diffFiles: [],
  conflicts: [],
  recovery: { state: "idle" },
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

  it("accepts an optional active operation ID and rejects a malformed one", () => {
    expect(
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
