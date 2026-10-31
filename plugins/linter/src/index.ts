import { parsePluginManifest, parseToolDiagnostics, type DenotePlugin } from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const tooling = context.capabilities.tooling;
    const sidebar = context.capabilities.sidebar;
    if (!tooling || !sidebar) throw new Error("Linter requires Tooling and Sidebar permissions.");
    const id = `${context.pluginId}.tools`;
    context.subscriptions.add(tooling.register({
      id, title: "Linter", kind: "linter", formats: ["unix", "msvc", "eslint-json", "cargo-json"],
      parse: parseToolDiagnostics,
    }));
    context.subscriptions.add(sidebar.register({ id, title: "Linter", content: "" }));
  },
};

export default plugin;
