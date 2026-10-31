import { parsePluginManifest, type DenotePlugin } from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const terminal = context.capabilities.terminal;
    const sidebar = context.capabilities.sidebar;
    if (!terminal || !sidebar) throw new Error("Ghostty terminal requires Terminal and Sidebar permissions.");
    const id = `${context.pluginId}.sessions`;
    context.subscriptions.add(terminal.register({ id, title: "Ghostty terminal" }));
    context.subscriptions.add(sidebar.register({ id, title: "Ghostty terminal", content: "" }));
  },
};

export default plugin;
