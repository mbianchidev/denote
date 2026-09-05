import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const manifest = parsePluginManifest(manifestJson);

const plugin: DenotePlugin = {
  manifest,
  activate(context) {
    const commands = context.capabilities.commands;
    const sidebar = context.capabilities.sidebar;
    const status = context.capabilities.status;
    const editorDecoration = context.capabilities.editorDecoration;
    const noteEvents = context.capabilities.noteEvents;
    const secureStorage = context.capabilities.secureStorage;
    if (!commands) {
      throw new Error("Reference plugin requires the Commands permission.");
    }
    if (!secureStorage) {
      throw new Error("Reference plugin requires Secure storage permission.");
    }
    if (!sidebar || !status || !editorDecoration || !noteEvents) {
      throw new Error(
        "Reference plugin requires Sidebar, Status, Editor decoration, and Note events permissions.",
      );
    }
    context.subscriptions.add(
      sidebar.register({
        id: "denote.reference.status",
        title: "Plugin reference",
        content:
          "The reference plugin is active. Its code runs in an isolated worker and is removed when disabled.",
      }),
    );
    context.subscriptions.add(
      noteEvents.subscribe((event) => {
        context.logger.debug(`Note ${event.kind}.`, { path: event.path });
      }),
    );
    context.subscriptions.add(
      status.register({
        id: "denote.reference.active",
        text: "Reference plugin active",
      }),
    );
    context.subscriptions.add(
      editorDecoration.register({
        id: "denote.reference.marker",
        pattern: "reference",
        style: "highlight",
      }),
    );
    context.subscriptions.add(
      commands.register({
        id: "denote.reference.ping",
        title: "Plugin host: reference command",
        run: () => {
          context.logger.info("Reference plugin command completed.");
        },
      }),
    );
    context.subscriptions.add(
      commands.register({
        id: "denote.reference.verify-keychain",
        title: "Plugin host: verify keychain isolation",
        run: async () => {
          const key = "reference-health-check";
          await secureStorage.set(key, "verified");
          const value = await secureStorage.get(key);
          await secureStorage.delete(key);
          if (value !== "verified") {
            throw new Error("Plugin keychain verification failed.");
          }
          context.logger.info("Plugin keychain verification completed.");
        },
      }),
    );
  },
};

export default plugin;
