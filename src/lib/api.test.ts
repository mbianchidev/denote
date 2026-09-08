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

  describe("PDF API", () => {
    beforeEach(() => {
      invoke.mockReset();
    });

    test("reads a PDF through its byte-preserving native command", async () => {
      invoke.mockResolvedValue({
        path: "Synthetic.pdf",
        dataBase64: "JVBERi0xLjcK",
        contentHash: "synthetic-hash",
        stats: {},
      });

      await api.readPdf("Synthetic.pdf");

      expect(invoke).toHaveBeenCalledWith("read_pdf", {
        path: "Synthetic.pdf",
      });
    });
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
    await api.refreshGitignoreStatus(vaultPath, ["app", "packages/ui"]);

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
      [
        "refresh_gitignore_status",
        {
          expectedVaultPath: vaultPath,
          scopePaths: ["app", "packages/ui"],
        },
      ],
    ]);
  });

  test("reads clipboard text through the native clipboard command", async () => {
    invoke.mockResolvedValue("Synthetic clipboard text");

    await expect(api.readClipboardText()).resolves.toBe(
      "Synthetic clipboard text",
    );
    expect(invoke).toHaveBeenCalledWith("read_clipboard_text");
  });
});
