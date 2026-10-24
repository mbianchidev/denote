import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { CodeIntelligenceController } from "./controller";
import { LANGUAGE_ADAPTERS } from "./languages";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const capability = context.capabilities.codeIntelligence;
    const sidebar = context.capabilities.sidebar;
    if (!capability || !sidebar) throw new Error("Code intelligence requires its typed capability and Sidebar permission.");
    const controller = new CodeIntelligenceController();
    const id = `${context.pluginId}.tools`;
    context.subscriptions.add(capability.register({
      id, title: "Code intelligence", languages: LANGUAGE_ADAPTERS,
      run: (request, action) => controller.run(request, action),
    }));
    context.subscriptions.add(sidebar.register({ id, title: "Code intelligence", content: "" }));
    context.subscriptions.add({ dispose: () => controller.clear() });
    if (context.capabilities.projectContext) {
      context.subscriptions.add(context.capabilities.projectContext.subscribe((event) => {
        if (event.workspaceChanged || event.previous?.projectId !== event.current?.projectId ||
            event.previous?.rootPath !== event.current?.rootPath) controller.clear();
      }));
    }
  },
};

export default plugin;
