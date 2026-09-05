import { vi } from "vitest";
import type { PluginEmojiPreferences } from "@denote/plugin-sdk";
import type { EmojiContribution } from "./emoji";
import { EmojiHost } from "./emojiHost";
import type { PluginView } from "../types";

export function syntheticEmojiPluginView(): PluginView {
  return {
    catalog: {
      manifest: {
        schemaVersion: 1, id: "test.emoji", name: "Synthetic emoji", version: "1.0.0",
        description: "Synthetic emoji fixture", publisher: { name: "Synthetic publisher" },
        license: "MIT", repository: "https://example.test/synthetic", icon: "icon.svg", category: "productivity",
        compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.3" },
        permissions: [{ capability: "emoji-picker" }], entrypoint: "dist/index.js", documentation: "guide.md",
      },
      artifact: { url: "https://example.test/synthetic.tgz", sha256: "a".repeat(64), sizeBytes: 100 },
      provenance: { publisherId: "test", sourceCommit: "b".repeat(40), trusted: false },
      guide: "Synthetic guide",
    },
    status: "enabled", enabled: true, error: null,
    approvedPermissions: [{ capability: "emoji-picker" }],
    settings: { recent: "[]", favorite: "[]", tone: 0 }, hasCredentials: false,
  };
}

export function syntheticEmojiPicker(): EmojiContribution {
  return {
    pluginId: "test.emoji",
    id: "picker",
    title: "Emoji picker",
    shortcodes: true,
    settingsKeys: { recents: "recent", favorites: "favorite", tone: "tone" },
    entries: [
      { id: "smile", name: "Smiling face", unicode: "😀", category: "Faces", keywords: ["happy"], shortcodes: ["smile"], variants: [] },
      { id: "wave", name: "Waving hand", unicode: "👋", category: "People", keywords: ["hello"], shortcodes: ["wave"], variants: [
        { name: "Waving hand light", unicode: "👋🏻", tone: 1 },
        { name: "Waving hand dark", unicode: "👋🏿", tone: 5 },
      ] },
      { id: "developer", name: "Technologist", unicode: "🧑‍💻", category: "People", keywords: ["computer"], shortcodes: ["technologist"], variants: [
        { name: "Woman technologist", unicode: "👩‍💻" },
      ] },
    ],
  };
}

export function syntheticEmojiHost(picker = syntheticEmojiPicker()) {
  const host = new EmojiHost();
  let preferences: PluginEmojiPreferences = { recents: [], favorites: [], tone: 0 };
  let allowed = true;
  const save = vi.fn((_picker, value: PluginEmojiPreferences) => { preferences = value; });
  const error = vi.fn();
  const config = {
    pickers: [picker],
    allowed: () => allowed,
    preferences: () => preferences,
    save,
    error,
  };
  host.configure(config);
  return {
    host, picker, save, error, config,
    binding: { host, scope: "synthetic-vault:pane:note.md" },
    block: () => { allowed = false; host.reconcile(); },
    disable: () => { host.configure({ ...config, pickers: [] }); host.reconcile(); },
  };
}
