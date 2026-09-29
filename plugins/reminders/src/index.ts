import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { ReminderStore } from "./reminders";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  async activate(context) {
    const reminders = context.capabilities.reminders;
    if (!reminders) {
      throw new Error(
        "Reminders requires the Reminders and Notifications permissions.",
      );
    }
    const settings = await context.settings.getAll();
    const configured = settings.defaultSnoozeMinutes;
    const defaultSnoozeMinutes =
      typeof configured === "number" &&
      Number.isInteger(configured) &&
      configured >= 1 &&
      configured <= 24 * 60
        ? configured
        : 15;
    const store = new ReminderStore(context.storage);
    context.subscriptions.add(
      reminders.register({
        id: "denote.reminders.main",
        title: "Reminders",
        defaultSnoozeMinutes,
        targets: (request) => store.targets(request),
        query: (request) => store.query(request),
        mutate: (request) => store.mutate(request),
      }),
    );
  },
};

export default plugin;
