import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const diagramRenderer = context.capabilities.diagramRenderer;
    if (!diagramRenderer) {
      throw new Error(
        "Mermaid diagrams requires the Diagram renderer permission.",
      );
    }
    context.subscriptions.add(
      diagramRenderer.register({
        id: "denote.mermaid.renderer",
        title: "Mermaid diagrams",
        languages: ["mermaid"],
      }),
    );
  },
};

export default plugin;
