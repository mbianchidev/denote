import {
  parsePluginManifest,
  type DenotePlugin,
  type PluginAutomaticLocalCommitCapability,
  type PluginDisposable,
  type PluginSourceControlRegistration,
  type PluginStatusCapability,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { GitRepositoryController } from "./controller";
import {
  initialRemoteAccess,
  initialScope,
  scopesFor,
  statusText,
} from "./model";
import { readGitSettings } from "./settings";

const manifest = parsePluginManifest(manifestJson);

const PROVIDER_ID = "denote.git.repository";
const STATUS_ID = "denote.git.status";
const SCHEDULE_ID = "denote.git.automatic-commit";
const REFRESH_COMMAND_ID = "denote.git.refresh";
const INITIALIZE_COMMAND_ID = "denote.git.initialize";

const plugin: DenotePlugin = {
  manifest,
  async activate(context) {
    const {
      commands,
      status,
      sourceControl,
      projectContext,
      automaticLocalCommit,
    } = context.capabilities;
    if (!commands || !status || !sourceControl) {
      throw new Error(
        "Git vault versioning requires the Commands, Status, and Source control permissions.",
      );
    }

    let registration: PluginSourceControlRegistration | null = null;
    const statusItem = createStatusItem(status, STATUS_ID);
    // Activation registers the surface before its first bounded refresh. The
    // refresh reads repository state only; it never mutates the vault.
    const repositories = scopesFor(projectContext?.getRepositories() ?? []);
    const settings = readGitSettings(await context.settings.getAll());
    const selectedScope = initialScope(
      projectContext?.getCurrent() ?? null,
      repositories,
    );
    const controller = new GitRepositoryController(
      selectedScope,
      {
        publish: (model) => {
          registration?.update(model);
          statusItem.set(statusText(model));
        },
        readSettings: () => context.settings.getAll(),
        report: (message, details) => context.logger.info(message, details),
      },
      repositories.length > 0 ? repositories : [selectedScope],
      initialRemoteAccess(settings.authMode),
    );

    statusItem.set(statusText(controller.model));
    registration = sourceControl.register({
      id: PROVIDER_ID,
      title: "Git",
      initialModel: controller.model,
      runAction: (action, actionContext) =>
        controller.runAction(action, actionContext.capabilities.git),
    });
    context.subscriptions.add(registration);
    context.subscriptions.add(statusItem);

    if (projectContext) {
      context.subscriptions.add(
        projectContext.subscribe((event) => {
          // A different project is a different repository: the model resets and
          // asks for a refresh instead of reusing the previous scope's data. A
          // workspace switch reaches the same vault-scoped identity over a
          // different repository, so it resets even when the scope looks equal.
          controller.setRepositories(
            scopesFor(event.repositories ?? []),
            event.current,
            event.workspaceChanged,
          );
        }),
      );
    }

    context.subscriptions.add(
      commands.register({
        id: REFRESH_COMMAND_ID,
        title: "Git: Refresh repository",
        run: (actionContext) =>
          controller.runAction(
            { id: "refresh" },
            actionContext.capabilities.git,
          ),
      }),
    );
    context.subscriptions.add(
      commands.register({
        id: INITIALIZE_COMMAND_ID,
        title: "Git: Initialize repository",
        run: (actionContext) =>
          controller.runAction(
            { id: "initialize" },
            actionContext.capabilities.git,
          ),
      }),
    );

    // Settings are read here, at the end of activation, because a schedule is
    // the only thing this plugin contributes that acts on its own. Reading
    // them registers no Git work: the host owns the timer, the repository
    // scope, and the commit, and the first run is one interval away.
    // Reading them also seeds the authentication mode the surface shows, so
    // what is displayed is the host-persisted setting every remote operation
    // will use rather than a value this plugin keeps of its own.
    await controller.syncRemoteAccess();
    const schedule = await automaticCommitSchedule(
      context,
      automaticLocalCommit,
    );
    if (schedule) {
      context.subscriptions.add(schedule);
    }
  },
};

/**
 * Registers the standing automatic commit when the configured interval enables
 * it. A zero interval is the documented off switch, so nothing is registered
 * and the host holds no timer for this plugin at all.
 */
async function automaticCommitSchedule(
  context: Parameters<DenotePlugin["activate"]>[0],
  automaticLocalCommit: PluginAutomaticLocalCommitCapability | undefined,
): Promise<PluginDisposable | null> {
  if (!automaticLocalCommit) {
    return null;
  }
  const settings = readGitSettings(await context.settings.getAll());
  if (settings.autoCommitIntervalMinutes <= 0) {
    context.logger.info("Automatic local commits are disabled.");
    return null;
  }
  return automaticLocalCommit.register({
    id: SCHEDULE_ID,
    intervalMinutes: settings.autoCommitIntervalMinutes,
    message: settings.autoCommitMessage,
    includePatterns: settings.includePatterns,
    excludePatterns: settings.excludePatterns,
    ...(settings.identity
      ? {
          authorName: settings.identity.authorName,
          authorEmail: settings.identity.authorEmail,
        }
      : {}),
  });
}

interface StatusItemHandle extends PluginDisposable {
  set: (text: string) => void;
}

/**
 * Keeps one status item current. A status registration carries fixed text, so
 * new text replaces the previous registration under the same ID.
 */
function createStatusItem(
  status: PluginStatusCapability,
  id: string,
): StatusItemHandle {
  let current: PluginDisposable | null = null;
  let currentText: string | null = null;
  return {
    set(text: string) {
      if (text === currentText) {
        return;
      }
      current?.dispose();
      current = status.register({ id, text });
      currentText = text;
    },
    dispose() {
      current?.dispose();
      current = null;
      currentText = null;
    },
  };
}

export default plugin;
