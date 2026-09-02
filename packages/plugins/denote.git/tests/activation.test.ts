import { describe, expect, it } from "vitest";
import type {
  PluginActivationContext,
  PluginCommand,
  PluginDisposable,
  PluginProjectContextChangeEvent,
  PluginSourceControlProvider,
  PluginSourceControlViewModel,
  PluginStatusItem,
} from "@denote/plugin-sdk";
import plugin from "../src/index";
import { FakeGit, last, repositoryResponder } from "./support";

interface ActivationHarness {
  context: PluginActivationContext;
  commands: PluginCommand[];
  statusItems: PluginStatusItem[];
  providers: PluginSourceControlProvider[];
  models: PluginSourceControlViewModel[];
  subscriptions: PluginDisposable[];
  projectListeners: Array<
    (event: PluginProjectContextChangeEvent) => void | Promise<void>
  >;
  logs: string[];
}

function activationHarness(
  settings: Record<string, unknown> = {},
): ActivationHarness {
  const commands: PluginCommand[] = [];
  const statusItems: PluginStatusItem[] = [];
  const providers: PluginSourceControlProvider[] = [];
  const models: PluginSourceControlViewModel[] = [];
  const subscriptions: PluginDisposable[] = [];
  const projectListeners: ActivationHarness["projectListeners"] = [];
  const logs: string[] = [];
  const noop: PluginDisposable = { dispose: () => {} };
  const context: PluginActivationContext = {
    pluginId: "denote.git",
    logger: {
      debug: (message) => logs.push(message),
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    storage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    settings: { getAll: () => Promise.resolve(settings) },
    capabilities: {
      commands: {
        register: (command) => {
          commands.push(command);
          return noop;
        },
      },
      status: {
        register: (item) => {
          statusItems.push(item);
          return noop;
        },
      },
      sourceControl: {
        register: (provider) => {
          providers.push(provider);
          return {
            update: (model) => models.push(model),
            dispose: () => {},
          };
        },
      },
      projectContext: {
        getCurrent: () => null,
        subscribe: (listener) => {
          projectListeners.push(listener);
          return noop;
        },
      },
    },
    subscriptions: {
      add: (disposable) => subscriptions.push(disposable),
    },
  };
  return {
    context,
    commands,
    statusItems,
    providers,
    models,
    subscriptions,
    projectListeners,
    logs,
  };
}

describe("Git plugin activation", () => {
  it("declares only the permissions and settings this increment uses", () => {
    const capabilities = plugin.manifest.permissions.map(
      (permission) => permission.capability,
    );

    expect(capabilities).toEqual([
      "commands",
      "status",
      "source-control",
      "project-context",
      "git",
      "automatic-local-commit",
    ]);
    expect(capabilities).not.toContain("network");
    expect(capabilities).not.toContain("process");
    expect(capabilities).not.toContain("workspace-write");
    expect(plugin.manifest.category).toBe("code");
    expect(plugin.manifest.compatibility.apiVersion).toBe(1);
    expect(plugin.manifest.settings?.version).toBe(1);
    expect(
      Object.fromEntries(
        Object.entries(plugin.manifest.settings?.properties ?? {}).map(
          ([key, definition]) => [key, definition.default],
        ),
      ),
    ).toEqual({
      gitExecutablePath: "",
      defaultBranch: "main",
      authorName: "",
      authorEmail: "",
      autoCommitIntervalMinutes: 0,
      autoCommitMessage: "Denote automatic commit",
      includePatterns: "",
      excludePatterns: "",
    });
  });

  it("registers its surfaces without running Git or touching the vault", async () => {
    const harness = activationHarness();

    await plugin.activate(harness.context);

    expect(harness.providers).toHaveLength(1);
    expect(harness.providers[0].id).toBe("denote.git.repository");
    expect(harness.providers[0].title).toBe("Git");
    expect(harness.providers[0].initialModel.repository).toMatchObject({
      repositoryId: "vault",
      label: "Vault · refresh required",
      initialized: false,
      busy: false,
    });
    expect(harness.statusItems).toEqual([
      { id: "denote.git.status", text: "Git: refresh required" },
    ]);
    expect(
      harness.commands.map((command) => [command.id, command.title]),
    ).toEqual([
      ["denote.git.refresh", "Git: Refresh repository"],
      ["denote.git.initialize", "Git: Initialize repository"],
    ]);
    // Activation registers surfaces only: nothing is published and no Git
    // request exists to run yet.
    expect(harness.models).toEqual([]);
    expect(harness.subscriptions).toHaveLength(5);
  });

  it("routes provider and command actions to the repository controller", async () => {
    const harness = activationHarness();
    await plugin.activate(harness.context);
    const git = new FakeGit(repositoryResponder());

    await harness.providers[0].runAction(
      { id: "refresh" },
      { capabilities: { git } },
    );

    expect(git.operations[0]).toBe("discover");
    expect(last(harness.models)?.repository).toMatchObject({
      initialized: true,
      branch: "main",
      busy: false,
    });
    expect(last(harness.statusItems)?.text).toBe("Git: main · 3 changes");

    const commandGit = new FakeGit(repositoryResponder());
    await harness.commands[0].run({ capabilities: { git: commandGit } });
    expect(commandGit.operations[0]).toBe("discover");
  });

  it("resets to the new repository when the active project changes", async () => {
    const harness = activationHarness();
    await plugin.activate(harness.context);
    await harness.providers[0].runAction(
      { id: "refresh" },
      { capabilities: { git: new FakeGit(repositoryResponder()) } },
    );

    await harness.projectListeners[0]({
      previous: null,
      current: { projectId: "project-1", rootPath: "/synthetic/vault/alpha" },
      workspaceChanged: false,
    });

    expect(last(harness.models)?.repository).toMatchObject({
      repositoryId: "project:project-1",
      label: "alpha · refresh required",
      initialized: false,
      busy: false,
    });
    expect(last(harness.models)?.history).toEqual([]);
    expect(last(harness.statusItems)?.text).toBe("Git: refresh required");
  });

  it("resets when the workspace changes even though the scope looks identical", async () => {
    const harness = activationHarness();
    await plugin.activate(harness.context);
    await harness.providers[0].runAction(
      { id: "refresh" },
      { capabilities: { git: new FakeGit(repositoryResponder()) } },
    );
    expect(last(harness.models)?.repository).toMatchObject({
      repositoryId: "vault",
      branch: "main",
      initialized: true,
    });

    // Two vaults with no project both scope to "vault". Only the flag
    // distinguishes them, and the plugin is never told which vault it is in.
    await harness.projectListeners[0]({
      previous: null,
      current: null,
      workspaceChanged: true,
    });

    expect(last(harness.models)?.repository).toMatchObject({
      repositoryId: "vault",
      label: "Vault · refresh required",
      initialized: false,
      branch: null,
      busy: false,
    });
    expect(last(harness.models)?.resourceGroups).toEqual([]);
    expect(last(harness.models)?.history).toEqual([]);
    expect(last(harness.statusItems)?.text).toBe("Git: refresh required");
  });

  it("keeps the model when an unchanged project context is repeated", async () => {
    const harness = activationHarness();
    await plugin.activate(harness.context);
    await harness.providers[0].runAction(
      { id: "refresh" },
      { capabilities: { git: new FakeGit(repositoryResponder()) } },
    );
    const published = harness.models.length;

    await harness.projectListeners[0]({
      previous: null,
      current: null,
      workspaceChanged: false,
    });

    expect(harness.models).toHaveLength(published);
    expect(last(harness.models)?.repository).toMatchObject({
      branch: "main",
      initialized: true,
    });
  });
});
