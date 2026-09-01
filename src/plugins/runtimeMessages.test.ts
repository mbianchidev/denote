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
});
