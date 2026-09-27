import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { TaskListIndex } from "./taskList";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const taskList = context.capabilities.taskList;
    if (!taskList) {
      throw new Error("Advanced task lists requires the Task list permission.");
    }
    const index = new TaskListIndex();
    context.subscriptions.add(
      taskList.register({
        id: "denote.task-lists.tasks",
        title: "Advanced task lists",
        index: (request) => index.index(request),
        query: (request) => index.query(request),
        toggle: (request) => index.toggle(request),
      }),
    );
  },
};

export default plugin;
