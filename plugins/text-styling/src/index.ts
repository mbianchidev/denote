import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { styleRequest } from "./styling";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    if (!context.capabilities.authoring) throw new Error("Text styling permission is required.");
    context.subscriptions.add(context.capabilities.authoring.register({
      id: "denote.text-styling.styles", title: "Text highlighting and coloring",
      feature: "text-styling", request: styleRequest,
    }));
  },
};

export default plugin;
