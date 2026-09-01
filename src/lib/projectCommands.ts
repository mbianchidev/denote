import type { CommandPaletteCommand } from "../components/CommandPalette";
import type { ProjectRoot, ProjectWorkspace } from "../types";
import {
  projectRootAtPath,
  projectRootLabel,
  projectWorkspaceAtPath,
  projectWorkspaceLabel,
} from "./workspaceTree";

interface ProjectCommandOptions {
  workspaceReady: boolean;
  workspaceLocked: boolean;
  projectRoots: ProjectRoot[];
  projectWorkspaces: ProjectWorkspace[];
  selectedDirectoryPath: string | null;
  onMarkProject: (path: string) => void | Promise<void>;
  onUnmarkProject: (projectRoot: ProjectRoot) => void | Promise<void>;
  onUnmarkAllProjects: () => void | Promise<void>;
  onMarkWorkspace: (path: string) => void | Promise<void>;
  onUnmarkWorkspace: (
    projectWorkspace: ProjectWorkspace,
  ) => void | Promise<void>;
  onUnmarkAllWorkspaces: () => void | Promise<void>;
}

export function buildProjectCommands({
  workspaceReady,
  workspaceLocked,
  projectRoots,
  projectWorkspaces,
  selectedDirectoryPath,
  onMarkProject,
  onUnmarkProject,
  onUnmarkAllProjects,
  onMarkWorkspace,
  onUnmarkWorkspace,
  onUnmarkAllWorkspaces,
}: ProjectCommandOptions): CommandPaletteCommand[] {
  const vaultProjectRoot = projectRootAtPath(projectRoots, "");
  const vaultExplicitProjectRoot =
    vaultProjectRoot?.explicit === true ? vaultProjectRoot : null;
  const vaultWorkspace = projectWorkspaceAtPath(projectWorkspaces, "");
  const selectedProjectRoot =
    selectedDirectoryPath === null
      ? null
      : projectRootAtPath(projectRoots, selectedDirectoryPath);
  const selectedWorkspace =
    selectedDirectoryPath === null
      ? null
      : projectWorkspaceAtPath(projectWorkspaces, selectedDirectoryPath);
  const explicitProjectRoots = projectRoots.filter(
    (projectRoot) => projectRoot.explicit,
  );
  const actionsDisabled = !workspaceReady || workspaceLocked;

  return [
    {
      id: "project.mark-vault",
      title: "Mark vault as project",
      description: "Use the whole vault as a project root.",
      category: "Project",
      disabled: actionsDisabled || vaultExplicitProjectRoot !== null,
      run: () => onMarkProject(""),
    },
    {
      id: "project.unmark-vault",
      title: "Unmark vault project",
      description: "Stop using the whole vault as an explicit project root.",
      category: "Project",
      disabled: actionsDisabled || vaultExplicitProjectRoot === null,
      run: () =>
        vaultExplicitProjectRoot
          ? onUnmarkProject(vaultExplicitProjectRoot)
          : undefined,
    },
    {
      id: "workspace.mark-vault",
      title: "Mark vault as workspace",
      description: "Treat each direct child folder as an implicit project.",
      category: "Workspace",
      disabled: actionsDisabled || vaultWorkspace !== null,
      run: () => onMarkWorkspace(""),
    },
    {
      id: "workspace.unmark-vault",
      title: "Unmark vault workspace",
      description: "Stop discovering direct child folders as projects.",
      category: "Workspace",
      disabled: actionsDisabled || vaultWorkspace === null,
      run: () =>
        vaultWorkspace ? onUnmarkWorkspace(vaultWorkspace) : undefined,
    },
    {
      id: "project.mark-selected-folder",
      title: "Mark selected folder as project",
      description:
        selectedProjectRoot?.explicit === false
          ? "Promote the selected workspace child to an explicit project."
          : "Use the selected directory as a project root.",
      category: "Project",
      disabled:
        actionsDisabled ||
        selectedDirectoryPath === null ||
        selectedProjectRoot?.explicit === true,
      run: () =>
        selectedDirectoryPath !== null
          ? onMarkProject(selectedDirectoryPath)
          : undefined,
    },
    {
      id: "workspace.mark-selected-folder",
      title: "Mark selected folder as workspace",
      description:
        "Treat each direct child folder of the selected directory as a project.",
      category: "Workspace",
      disabled:
        actionsDisabled ||
        selectedDirectoryPath === null ||
        selectedWorkspace !== null,
      run: () =>
        selectedDirectoryPath !== null
          ? onMarkWorkspace(selectedDirectoryPath)
          : undefined,
    },
    ...explicitProjectRoots.map(
      (projectRoot): CommandPaletteCommand => ({
        id: `project.unmark.${projectRoot.id}`,
        title: `Unmark project: ${projectRootLabel(projectRoot)}`,
        description: projectRoot.available
          ? `Remove the explicit project root at ${
              projectRoot.rootPath || "the vault root"
            }.`
          : `Remove the unavailable project root at ${projectRoot.rootPath}.`,
        category: "Project",
        disabled: actionsDisabled,
        run: () => onUnmarkProject(projectRoot),
      }),
    ),
    ...projectWorkspaces.map(
      (projectWorkspace): CommandPaletteCommand => ({
        id: `workspace.unmark.${projectWorkspace.id}`,
        title: `Unmark workspace: ${projectWorkspaceLabel(projectWorkspace)}`,
        description: projectWorkspace.available
          ? `Stop discovering projects under ${
              projectWorkspace.rootPath || "the vault root"
            }.`
          : `Remove the unavailable workspace root at ${projectWorkspace.rootPath}.`,
        category: "Workspace",
        disabled: actionsDisabled,
        run: () => onUnmarkWorkspace(projectWorkspace),
      }),
    ),
    {
      id: "project.unmark-all",
      title: "Unmark all projects",
      description:
        "Remove every explicit project root, including unavailable folders.",
      category: "Project",
      disabled: actionsDisabled || explicitProjectRoots.length === 0,
      run: onUnmarkAllProjects,
    },
    {
      id: "workspace.unmark-all",
      title: "Unmark all workspaces",
      description:
        "Remove every workspace root, including unavailable folders.",
      category: "Workspace",
      disabled: actionsDisabled || projectWorkspaces.length === 0,
      run: onUnmarkAllWorkspaces,
    },
  ];
}
