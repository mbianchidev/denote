import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { privilegedHostOperation, runHostOperation } from "./hostOperations";

vi.mock("../lib/api", () => ({
  api: {
    pluginGitRequest: vi.fn(),
  },
}));

const OPERATION_ID = "11111111-2222-4333-8444-555555555555";

describe("plugin Git host operation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.pluginGitRequest).mockResolvedValue({
      operationId: OPERATION_ID,
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
    });
  });

  it("is privileged so it requires a user action lease", () => {
    expect(privilegedHostOperation("git.run")).toBe(true);
  });

  it("forwards the captured vault scope and project identity", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      { operation: "status", scope: "project" },
      { workspaceScope: "/vaults/synthetic", projectId: "project-1" },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      { operation: "status", scope: "project" },
      "/vaults/synthetic",
      "project-1",
      OPERATION_ID,
    );
  });

  it("supports vault scope without a project", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      { operation: "status", scope: "vault" },
      { workspaceScope: "/vaults/synthetic", projectId: null },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      { operation: "status", scope: "vault" },
      "/vaults/synthetic",
      null,
      OPERATION_ID,
    );
  });

  it("rejects requests without a vault scope lease", async () => {
    await expect(
      runHostOperation(
        "denote.git",
        "git.run",
        undefined,
        { operation: "status", scope: "vault" },
        undefined,
        OPERATION_ID,
      ),
    ).rejects.toThrow("Workspace action lease has no vault scope.");
    expect(api.pluginGitRequest).not.toHaveBeenCalled();
  });

  it("strips undeclared fields before reaching the native transport", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      {
        operation: "commit",
        scope: "vault",
        message: "Record synthetic note",
        arguments: ["--upload-pack=touch pwned"],
      },
      { workspaceScope: "/vaults/synthetic", projectId: null },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      {
        operation: "commit",
        scope: "vault",
        message: "Record synthetic note",
      },
      "/vaults/synthetic",
      null,
      OPERATION_ID,
    );
  });

  it("rejects unsupported Git operations", async () => {
    await expect(
      runHostOperation(
        "denote.git",
        "git.run",
        undefined,
        { operation: "gc", scope: "vault" },
        { workspaceScope: "/vaults/synthetic", projectId: null },
        OPERATION_ID,
      ),
    ).rejects.toThrow("Unsupported plugin Git operation: gc");
    expect(api.pluginGitRequest).not.toHaveBeenCalled();
  });

  it("never lets a request name a Git executable", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      {
        operation: "status",
        scope: "vault",
        executablePath: "/opt/synthetic/bin/git",
        options: { executablePath: "/opt/synthetic/bin/git" },
        gitExecutablePath: "/opt/synthetic/bin/git",
      },
      { workspaceScope: "/vaults/synthetic", projectId: null },
      OPERATION_ID,
    );

    // The transport receives the request, the captured scope, and the
    // operation ID. A custom executable is host-owned, read from persisted
    // plugin settings, so it is never an argument here.
    expect(vi.mocked(api.pluginGitRequest).mock.calls[0]).toEqual([
      "denote.git",
      { operation: "status", scope: "vault" },
      "/vaults/synthetic",
      null,
      OPERATION_ID,
    ]);
  });

  it("forwards the caller-generated operation ID a plugin can cancel", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      { operation: "cancel", operationId: "99999999-8888-4777-8666-555555555555" },
      { workspaceScope: "/vaults/synthetic", projectId: null },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      { operation: "cancel", operationId: "99999999-8888-4777-8666-555555555555" },
      "/vaults/synthetic",
      null,
      OPERATION_ID,
    );
  });

  it("rejects a missing or malformed operation ID before reaching the transport", async () => {
    for (const operationId of [
      undefined,
      "",
      "operation-1",
      "11111111-2222-4333-8444-55555555555",
      "1111111122224333844455555555555z",
    ]) {
      await expect(
        runHostOperation(
          "denote.git",
          "git.run",
          undefined,
          { operation: "status", scope: "vault" },
          { workspaceScope: "/vaults/synthetic", projectId: null },
          operationId,
        ),
      ).rejects.toThrow("Plugin Git request is missing a valid operation ID.");
    }
    expect(api.pluginGitRequest).not.toHaveBeenCalled();
  });
});
