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
    if (!commands) {
      throw new Error("Reference plugin requires the Commands permission.");
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
  },
};

export default plugin;
