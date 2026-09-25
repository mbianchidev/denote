import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import { calendarQuery, readCalendarSettings } from "./calendar";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  async activate(context) {
    const calendar = context.capabilities.calendar;
    if (!calendar) {
      throw new Error("Calendar and daily notes requires the Calendar permission.");
    }
    const settings = readCalendarSettings(await context.settings.getAll());
    context.subscriptions.add(
      calendar.register({
        id: "denote.calendar.main",
        title: "Calendar",
        query: (request) => calendarQuery(request, settings),
      }),
    );
  },
};

export default plugin;
