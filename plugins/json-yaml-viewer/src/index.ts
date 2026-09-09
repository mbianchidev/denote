import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { parseStructuredSource } from "./parser";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const structuredViewer = context.capabilities.structuredViewer;
    if (!structuredViewer) {
      throw new Error(
        "JSON and YAML viewer requires the Structured viewer permission.",
      );
    }
    context.subscriptions.add(
      structuredViewer.register({
        id: "denote.json-yaml-viewer.viewer",
        title: "JSON and YAML viewer",
        extensions: ["json", "yaml", "yml"],
        parse: parseStructuredSource,
      }),
    );
  },
};

export default plugin;
