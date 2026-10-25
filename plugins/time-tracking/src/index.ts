import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { TimeTrackingStore } from "./timeTracking";
import { ClockStore } from "./clocks";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    const timeTracking = context.capabilities.timeTracking;
    const clocks = context.capabilities.clocks;
    if (!timeTracking || !clocks) throw new Error("Time tracking requires Time tracking, Clocks, and Notifications permissions.");
    const store = new TimeTrackingStore(context.storage);
    context.subscriptions.add(timeTracking.register({
      id: "denote.time-tracking.main",
      title: "Time tracking",
      request: (request) => request.mutation ? store.mutate(request) : store.query(request),
    }));
    const clockStore = new ClockStore(context.storage);
    context.subscriptions.add(clocks.register({
      id: "denote.time-tracking.clocks",
      title: "Time tracking",
      request: (request) => clockStore.request(request),
    }));
  },
};

export default plugin;
