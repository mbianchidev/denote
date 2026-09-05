import {
  parsePluginManifest,
  type DenotePlugin,
  type PluginEmojiEntry,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";
import emojiJson from "./emoji.json";

const entries: PluginEmojiEntry[] = emojiJson;

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  async activate(context) {
    const emojiPicker = context.capabilities.emojiPicker;
    if (!emojiPicker) {
      throw new Error("Emoji picker requires the Emoji picker permission.");
    }
    const settings = await context.settings.getAll();
    context.subscriptions.add(
      emojiPicker.register({
        id: "denote.emoji-picker.catalog",
        title: "Emoji picker",
        entries,
        shortcodes: settings.autocomplete !== false,
        settingsKeys: {
          recents: "recents",
          favorites: "favorites",
          tone: "tone",
        },
      }),
    );
  },
};

export default plugin;
