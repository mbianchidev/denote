import {
  isPluginEmojiPreferences,
  type PluginEmojiPicker,
  type PluginEmojiPreferences,
} from "@denote/plugin-sdk";

export interface PluginEmojiPickerContribution extends PluginEmojiPicker {
  pluginId: string;
}

export function readEmojiPreferences(
  picker: PluginEmojiPicker,
  settings: Record<string, unknown>,
): PluginEmojiPreferences {
  const preferences: unknown = {
    recents: parseList(settings[picker.settingsKeys.recents]),
    favorites: parseList(settings[picker.settingsKeys.favorites]),
    tone: settings[picker.settingsKeys.tone] ?? 0,
  };
  if (!isPluginEmojiPreferences(preferences)) {
    throw new Error("Invalid emoji preferences. Reset this plugin's settings.");
  }
  assertKnownEmoji(picker, preferences);
  return preferences;
}

export function emojiPreferenceSettings(
  picker: PluginEmojiPicker,
  preferences: PluginEmojiPreferences,
): Record<string, unknown> {
  if (!isPluginEmojiPreferences(preferences)) {
    throw new Error("Invalid emoji preferences.");
  }
  assertKnownEmoji(picker, preferences);
  return {
    [picker.settingsKeys.recents]: JSON.stringify(preferences.recents),
    [picker.settingsKeys.favorites]: JSON.stringify(preferences.favorites),
    [picker.settingsKeys.tone]: preferences.tone,
  };
}

function parseList(value: unknown): unknown {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "string" || value.length > 32_768) {
    throw new Error("Invalid emoji preferences. Reset this plugin's settings.");
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Invalid emoji preferences. Reset this plugin's settings.");
  }
}

function assertKnownEmoji(
  picker: PluginEmojiPicker,
  preferences: PluginEmojiPreferences,
): void {
  const known = new Set(
    picker.entries.flatMap((entry) => [
      entry.unicode,
      ...entry.variants.map((variant) => variant.unicode),
    ]),
  );
  if ([...preferences.recents, ...preferences.favorites].some((value) => !known.has(value))) {
    throw new Error("Emoji preferences contain an unavailable emoji. Reset this plugin's settings.");
  }
}
