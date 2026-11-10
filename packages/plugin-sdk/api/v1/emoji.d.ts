import type { PluginEmojiPicker, PluginEmojiPreferences, PluginManifest } from "./contracts";
export declare const EMOJI_MAX_ENTRIES = 5000;
export declare const EMOJI_MAX_RECENTS = 32;
export declare const EMOJI_MAX_FAVORITES = 128;
export declare function isEmojiSequence(value: unknown): value is string;
export declare function isPluginEmojiPicker(value: unknown): value is PluginEmojiPicker;
export declare function emojiPickerMatchesManifest(picker: PluginEmojiPicker, manifest: PluginManifest): boolean;
export declare function isPluginEmojiPreferences(value: unknown): value is PluginEmojiPreferences;
