import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { presentationRequest } from "./deck";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    if (!context.capabilities.authoring) throw new Error("Presentation permission is required.");
    context.subscriptions.add(context.capabilities.authoring.register({
      id: "denote.presentations.decks", title: "Markdown presentation slides",
      feature: "presentation", request: presentationRequest,
    }));
  },
};

export default plugin;
