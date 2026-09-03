import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { privilegedHostOperation, runHostOperation } from "./hostOperations";

vi.mock("../lib/api", () => ({
  api: {
    pluginGitRequest: vi.fn(),
    pluginGithubListRepositories: vi.fn(),
    pluginGitCloneVault: vi.fn(),
    pluginGitCleanFailedClone: vi.fn(),
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
      { workspaceScope: "/vaults/synthetic", projectId: "project-1", sourceControlActionId: null },
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

  it("targets another host-issued repository from the same vault", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      {
        request: { operation: "status", scope: "project" },
        target: { projectId: "project-2" },
      },
      {
        workspaceScope: "/vaults/synthetic",
        projectId: "project-1",
        projectIds: ["project-1", "project-2"],
        sourceControlActionId: null,
      },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      { operation: "status", scope: "project" },
      "/vaults/synthetic",
      "project-2",
      OPERATION_ID,
    );
  });

  it("rejects a repository target that the host did not issue", async () => {
    await expect(
      runHostOperation(
        "denote.git",
        "git.run",
        undefined,
        {
          request: { operation: "status", scope: "project" },
          target: { projectId: "outside-project" },
        },
        {
          workspaceScope: "/vaults/synthetic",
          projectId: "project-1",
          projectIds: ["project-1"],
          sourceControlActionId: null,
        },
        OPERATION_ID,
      ),
    ).rejects.toThrow("no longer available in this vault");
    expect(api.pluginGitRequest).not.toHaveBeenCalled();
  });

  it("supports vault scope without a project", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      { operation: "status", scope: "vault" },
      { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
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
      { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
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

  it("keeps a signing passphrase in the host action lease", async () => {
    await runHostOperation(
      "denote.git",
      "git.run",
      undefined,
      {
        request: {
          operation: "commit",
          scope: "vault",
          message: "Signed synthetic change",
        },
        target: null,
      },
      {
        workspaceScope: "/vaults/synthetic",
        projectId: null,
        sourceControlActionId: "commit",
        gitSigningPassphrase: "synthetic-passphrase",
        gitCommitSign: true,
      },
      OPERATION_ID,
    );

    expect(api.pluginGitRequest).toHaveBeenCalledWith(
      "denote.git",
      {
        operation: "commit",
        scope: "vault",
        message: "Signed synthetic change",
      },
      "/vaults/synthetic",
      null,
      OPERATION_ID,
      "synthetic-passphrase",
      true,
    );
  });

  it("rejects unsupported Git operations", async () => {
    await expect(
      runHostOperation(
        "denote.git",
        "git.run",
        undefined,
        { operation: "gc", scope: "vault" },
        { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
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
      { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
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
      { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
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
          { workspaceScope: "/vaults/synthetic", projectId: null, sourceControlActionId: null },
          operationId,
        ),
      ).rejects.toThrow("Plugin Git request is missing a valid operation ID.");
    }
    expect(api.pluginGitRequest).not.toHaveBeenCalled();
  });
});

describe("plugin clone and GitHub host operations", () => {
  const leaseFor = (sourceControlActionId: string | null) => ({
    workspaceScope: "/vaults/synthetic",
    projectId: null,
    sourceControlActionId,
  });
  /** A command lease: it names no source-control action at all. */
  const scope = leaseFor(null);
  const cloneScope = leaseFor("clone");
  const cleanupScope = leaseFor("clean-failed-clone");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a user action lease for every one of them", () => {
    for (const operation of [
      "git.list-github-repositories",
      "git.clone-vault",
      "git.clean-failed-clone",
    ]) {
      expect(privilegedHostOperation(operation)).toBe(true);
    }
  });

  it("bounds a repository listing and forwards the captured vault scope", async () => {
    vi.mocked(api.pluginGithubListRepositories).mockResolvedValue([]);

    await runHostOperation(
      "denote.git",
      "git.list-github-repositories",
      undefined,
      { limit: 25 },
      scope,
      OPERATION_ID,
    );

    expect(api.pluginGithubListRepositories).toHaveBeenCalledWith(
      "denote.git",
      25,
      "/vaults/synthetic",
      OPERATION_ID,
    );
    await expect(
      runHostOperation(
        "denote.git",
        "git.list-github-repositories",
        undefined,
        { limit: 5000 },
        scope,
        OPERATION_ID,
      ),
    ).rejects.toThrow(/cannot exceed/);
  });

  it("keeps the workspace snapshot in the host and returns only the outcome", async () => {
    const snapshot = { vaultPath: "/vaults/cloned" } as never;
    vi.mocked(api.pluginGitCloneVault).mockResolvedValue({
      outcome: {
        status: "cloned",
        label: "cloned",
        remoteUrl: "https://example.invalid/repo.git",
        branch: "main",
        defaultBranch: "main",
        upstream: "origin/main",
      },
      snapshot,
    });
    const opened: unknown[] = [];

    const result = await runHostOperation(
      "denote.git",
      "git.clone-vault",
      undefined,
      {
        url: "https://example.invalid/repo.git",
        authMode: "public",
      },
      cloneScope,
      OPERATION_ID,
      (value) => {
        opened.push(value);
      },
    );

    expect(api.pluginGitCloneVault).toHaveBeenCalledWith(
      "denote.git",
      { url: "https://example.invalid/repo.git", authMode: "public" },
      "/vaults/synthetic",
      OPERATION_ID,
    );
    // The renderer opens the vault; the plugin is told only that it worked.
    expect(opened).toEqual([snapshot]);
    expect(result).toEqual({
      status: "cloned",
      label: "cloned",
      remoteUrl: "https://example.invalid/repo.git",
      branch: "main",
      defaultBranch: "main",
      upstream: "origin/main",
    });
    expect(JSON.stringify(result)).not.toContain("/vaults/cloned");
  });

  it("never signals the renderer when a clone did not open a vault", async () => {
    vi.mocked(api.pluginGitCloneVault).mockResolvedValue({
      outcome: { status: "cancelled" },
      snapshot: null,
    });
    const opened: unknown[] = [];

    const result = await runHostOperation(
      "denote.git",
      "git.clone-vault",
      undefined,
      { url: "https://example.invalid/repo.git", authMode: "public" },
      cloneScope,
      OPERATION_ID,
      (value) => {
        opened.push(value);
      },
    );

    expect(opened).toEqual([]);
    expect(result).toEqual({ status: "cancelled" });
  });

  it("refuses a clean-up token that is not a host-generated identifier", async () => {
    vi.mocked(api.pluginGitCleanFailedClone).mockResolvedValue({
      cleaned: true,
      message: "Denote deleted the incomplete clone folder.",
    });

    await runHostOperation(
      "denote.git",
      "git.clean-failed-clone",
      undefined,
      { cleanupToken: OPERATION_ID },
      cleanupScope,
    );
    expect(api.pluginGitCleanFailedClone).toHaveBeenCalledWith(
      "denote.git",
      OPERATION_ID,
      "/vaults/synthetic",
    );

    await expect(
      runHostOperation(
        "denote.git",
        "git.clean-failed-clone",
        undefined,
        { cleanupToken: "../../vaults/other" },
        cleanupScope,
      ),
    ).rejects.toThrow();
  });

  it("refuses a clone without a workspace lease", async () => {
    await expect(
      runHostOperation("denote.git", "git.clone-vault", undefined, {
        url: "https://example.invalid/repo.git",
        authMode: "public",
      }),
    ).rejects.toThrow(/vault scope/);
  });

  it("binds a clone to the standardised clone action and nothing else", async () => {
    const opened: unknown[] = [];
    for (const lease of [scope, leaseFor("refresh"), leaseFor("pull")]) {
      await expect(
        runHostOperation(
          "denote.git",
          "git.clone-vault",
          undefined,
          { url: "https://example.invalid/repo.git", authMode: "public" },
          lease,
          OPERATION_ID,
          (value) => {
            opened.push(value);
          },
        ),
      ).rejects.toThrow('requires the "clone" source-control action');
    }

    // Nothing reached the native command, so no folder chooser was opened and
    // no workspace was handed to the renderer.
    expect(api.pluginGitCloneVault).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("binds deleting a failed clone to its own action and nothing else", async () => {
    for (const lease of [scope, cloneScope, leaseFor("remove-remote")]) {
      await expect(
        runHostOperation(
          "denote.git",
          "git.clean-failed-clone",
          undefined,
          { cleanupToken: OPERATION_ID },
          lease,
        ),
      ).rejects.toThrow(
        'requires the "clean-failed-clone" source-control action',
      );
    }

    expect(api.pluginGitCleanFailedClone).not.toHaveBeenCalled();
  });

  it("refuses a repository listing that carries no cancellable operation ID", async () => {
    await expect(
      runHostOperation(
        "denote.git",
        "git.list-github-repositories",
        undefined,
        { limit: 25 },
        scope,
      ),
    ).rejects.toThrow(/operation ID/);
    expect(api.pluginGithubListRepositories).not.toHaveBeenCalled();
  });
});
