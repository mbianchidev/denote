import { describe, expect, it, vi } from "vitest";
import { buildProjectCommands } from "./projectCommands";

const callbacks = {
  onMarkProject: vi.fn(),
  onUnmarkProject: vi.fn(),
  onUnmarkAllProjects: vi.fn(),
  onMarkWorkspace: vi.fn(),
  onUnmarkWorkspace: vi.fn(),
  onUnmarkAllWorkspaces: vi.fn(),
};

describe("buildProjectCommands", () => {
  it("allows implicit project promotion and excludes implicit unmark commands", () => {
    const commands = buildProjectCommands({
      workspaceReady: true,
      workspaceLocked: false,
      projectRoots: [
        {
          id: "implicit",
          rootPath: "code/app",
          available: true,
          explicit: false,
          workspaceId: "workspace",
        },
      ],
      projectWorkspaces: [
        {
          id: "workspace",
          rootPath: "code",
          available: true,
        },
      ],
      selectedDirectoryPath: "code/app",
      ...callbacks,
    });

    expect(
      commands.find(({ id }) => id === "project.mark-selected-folder"),
    ).toMatchObject({
      disabled: false,
      description: expect.stringContaining("Promote"),
    });
    expect(
      commands.some(({ id }) => id === "project.unmark.implicit"),
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "project.unmark-all")?.disabled,
    ).toBe(true);
  });

  it("includes unavailable explicit projects and workspaces as individual unmark commands", () => {
    const commands = buildProjectCommands({
      workspaceReady: true,
      workspaceLocked: false,
      projectRoots: [
        {
          id: "missing-project",
          rootPath: "missing/project",
          available: false,
          explicit: true,
          workspaceId: null,
        },
      ],
      projectWorkspaces: [
        {
          id: "missing-workspace",
          rootPath: "missing/workspace",
          available: false,
        },
      ],
      selectedDirectoryPath: null,
      ...callbacks,
    });

    expect(
      commands.find(({ id }) => id === "project.unmark.missing-project"),
    ).toMatchObject({
      disabled: false,
      description: expect.stringContaining("unavailable"),
    });
    expect(
      commands.find(({ id }) => id === "workspace.unmark.missing-workspace"),
    ).toMatchObject({
      disabled: false,
      description: expect.stringContaining("unavailable"),
    });
    expect(
      commands.find(({ id }) => id === "project.unmark-all")?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "workspace.unmark-all")?.disabled,
    ).toBe(false);
  });

  it("keeps vault, selected-folder, and all-project actions independent", () => {
    const commands = buildProjectCommands({
      workspaceReady: true,
      workspaceLocked: false,
      projectRoots: [],
      projectWorkspaces: [],
      selectedDirectoryPath: "code",
      ...callbacks,
    });

    expect(
      commands.find(({ id }) => id === "project.mark-vault")?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "workspace.mark-vault")?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "project.mark-selected-folder")
        ?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "workspace.mark-selected-folder")
        ?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "project.unmark-all")?.disabled,
    ).toBe(true);
    expect(
      commands.find(({ id }) => id === "workspace.unmark-all")?.disabled,
    ).toBe(true);
  });
});
