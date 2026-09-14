import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { editKanbanBoard, parseKanbanBoard } from "./board";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const kanbanBoard = context.capabilities.kanbanBoard;
    if (!kanbanBoard) {
      throw new Error("Kanban boards requires the Kanban board permission.");
    }
    context.subscriptions.add(
      kanbanBoard.register({
        id: "denote.kanban.board",
        title: "Kanban boards",
        fileSuffixes: [".kanban.md", ".kanban.markdown"],
        defaultFileName: "Board.kanban.md",
        parse: parseKanbanBoard,
        edit: editKanbanBoard,
      }),
    );
  },
};

export default plugin;
