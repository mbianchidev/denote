import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { commentRequest } from "./anchors";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    if (!context.capabilities.authoring) throw new Error("Note comments permission is required.");
    context.subscriptions.add(context.capabilities.authoring.register({
      id: "denote.note-comments.anchors", title: "Note comments",
      feature: "note-comments", request: commentRequest,
    }));
  },
};

export default plugin;
