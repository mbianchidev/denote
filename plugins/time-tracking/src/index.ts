import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { TimeTrackingStore } from "./timeTracking";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const timeTracking = context.capabilities.timeTracking;
    if (!timeTracking) throw new Error("Time tracking requires the Time tracking permission.");
    const store = new TimeTrackingStore(context.storage);
    context.subscriptions.add(timeTracking.register({
      id: "denote.time-tracking.main",
      title: "Time tracking",
      request: (request) => request.mutation ? store.mutate(request) : store.query(request),
    }));
  },
};

export default plugin;
