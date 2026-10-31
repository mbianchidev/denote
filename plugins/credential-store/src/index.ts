import { parsePluginManifest, type DenotePlugin } from "@denote/plugin-sdk";
import manifest from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifest),
  activate(context) {
    if (!context.capabilities.sensitiveTools) throw new Error("The credential-store host capability is required.");
    context.subscriptions.add(context.capabilities.sensitiveTools.register({
      id: "denote.credential-store.entries", title: "Credential store", feature: "credential-store",
    }));
  },
};

export default plugin;
