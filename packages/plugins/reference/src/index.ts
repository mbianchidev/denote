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
    const secureStorage = context.capabilities.secureStorage;
    if (!commands) {
      throw new Error("Reference plugin requires the Commands permission.");
    }
    if (!secureStorage) {
      throw new Error("Reference plugin requires Secure storage permission.");
    }
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
