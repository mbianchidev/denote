import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { NoteGraphIndex } from "./noteGraph";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const noteGraph = context.capabilities.noteGraph;
    if (!noteGraph) {
      throw new Error("Note graph requires the Note graph permission.");
    }

    const index = new NoteGraphIndex();
    context.subscriptions.add(
      noteGraph.register({
        id: "denote.note-graph.graph",
        title: "Note graph",
        index: (request) => index.index(request),
        query: (request) => index.query(request),
      }),
    );
  },
};

export default plugin;
