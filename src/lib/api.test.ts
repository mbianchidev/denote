import { beforeEach, describe, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "./api";

describe("project configuration API", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test("includes the originating vault path in every mutation", async () => {
    invoke.mockResolvedValue({});
    const vaultPath = "/synthetic/vault";

    await api.markProjectRoot(vaultPath, "app");
    await api.unmarkProjectRoot(vaultPath, "project-id");
    await api.markProjectWorkspace(vaultPath, "packages");
    await api.unmarkProjectWorkspace(vaultPath, "workspace-id");
    await api.dismissGitProjectSuggestion(vaultPath);
    await api.refreshProjectConfiguration(vaultPath);

    expect(invoke.mock.calls).toEqual([
      [
        "mark_project_root",
        { expectedVaultPath: vaultPath, path: "app" },
      ],
      [
        "unmark_project_root",
        { expectedVaultPath: vaultPath, projectRootId: "project-id" },
      ],
      [
        "mark_project_workspace",
        { expectedVaultPath: vaultPath, path: "packages" },
      ],
      [
        "unmark_project_workspace",
        {
          expectedVaultPath: vaultPath,
          projectWorkspaceId: "workspace-id",
        },
      ],
      ["dismiss_git_project_suggestion", { expectedVaultPath: vaultPath }],
      ["refresh_project_configuration", { expectedVaultPath: vaultPath }],
    ]);
  });
});
