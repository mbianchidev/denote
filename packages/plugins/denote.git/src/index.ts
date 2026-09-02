import {
  parsePluginManifest,
  type DenotePlugin,
  type PluginDisposable,
  type PluginSourceControlRegistration,
  type PluginStatusCapability,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { GitRepositoryController } from "./controller";
import { scopeFor, statusText } from "./model";

const manifest = parsePluginManifest(manifestJson);

const PROVIDER_ID = "denote.git.repository";
const STATUS_ID = "denote.git.status";
const REFRESH_COMMAND_ID = "denote.git.refresh";
const INITIALIZE_COMMAND_ID = "denote.git.initialize";

const plugin: DenotePlugin = {
  manifest,
  activate(context) {
    const { commands, status, sourceControl, projectContext } =
      context.capabilities;
    if (!commands || !status || !sourceControl) {
      throw new Error(
        "Git vault versioning requires the Commands, Status, and Source control permissions.",
      );
    }

    let registration: PluginSourceControlRegistration | null = null;
    const statusItem = createStatusItem(status, STATUS_ID);
    // Activation registers surfaces only. No Git command runs and no vault
    // content is touched until the user asks for one.
    const controller = new GitRepositoryController(
      scopeFor(projectContext?.getCurrent() ?? null),
      {
        publish: (model) => {
          registration?.update(model);
          statusItem.set(statusText(model));
        },
        readSettings: () => context.settings.getAll(),
        report: (message, details) => context.logger.info(message, details),
      },
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
          controller.setScope(scopeFor(event.current), event.workspaceChanged);
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
  },
};

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
