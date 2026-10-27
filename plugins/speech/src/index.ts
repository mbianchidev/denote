import { parsePluginManifest, type DenotePlugin } from "@denote/plugin-sdk";
import manifest from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifest),
  activate(context) {
    if (!context.capabilities.sensitiveTools) throw new Error("The speech host capability is required.");
    context.subscriptions.add(context.capabilities.sensitiveTools.register({
      id: "denote.speech.local", title: "Speech", feature: "speech",
    }));
  },
};

export default plugin;
