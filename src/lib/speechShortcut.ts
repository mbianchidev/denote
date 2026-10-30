import {
  DEFAULT_DICTATION_SHORTCUT, editorZoomShortcut, isClosePaneShortcut, isCommandPaletteShortcut,
  isNewFileShortcut, isNewTabShortcut, isReplaceShortcut, isSearchShortcut, isSettingsShortcut,
  isSplitPaneShortcut, paneFocusShortcut, type ShortcutEvent,
} from "./shortcuts";

export const DEFAULT_SPEECH_SHORTCUT = DEFAULT_DICTATION_SHORTCUT;
const STORAGE_KEY = "denote.speech-shortcut.v1";
const INVALID_SHORTCUT = "Use Ctrl, Alt, or Command plus Space, a letter, a number, or F1-F12.";
const MODIFIERS = new Map<string, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">([
  ["ctrl", "ctrlKey"], ["control", "ctrlKey"], ["alt", "altKey"], ["option", "altKey"],
  ["shift", "shiftKey"], ["cmd", "metaKey"], ["command", "metaKey"], ["meta", "metaKey"],
]);

function shortcutKey(code: string): string {
  if (code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  throw new Error(INVALID_SHORTCUT);
}

export function formatSpeechShortcut(shortcut: ShortcutEvent): string {
  return [
    shortcut.ctrlKey ? "Ctrl" : "", shortcut.altKey ? "Alt" : "",
    shortcut.shiftKey ? "Shift" : "", shortcut.metaKey ? "Cmd" : "", shortcutKey(shortcut.code),
  ].filter(Boolean).join("+");
}

function reserved(shortcut: ShortcutEvent, platform: string): boolean {
  if ([isClosePaneShortcut, isCommandPaletteShortcut, isNewFileShortcut, isNewTabShortcut,
    isReplaceShortcut, isSearchShortcut, isSettingsShortcut, isSplitPaneShortcut]
    .some((matches) => matches(shortcut, platform)) ||
      editorZoomShortcut(shortcut, platform) || paneFocusShortcut(shortcut, platform)) return true;
  const modified = shortcut.ctrlKey || shortcut.metaKey;
  const primary = /Mac|iPhone|iPad|iPod/i.test(platform) ?
    shortcut.metaKey && !shortcut.ctrlKey : shortcut.ctrlKey && !shortcut.metaKey;
  if (modified && (["KeyS", "KeyW"].includes(shortcut.code) || shortcut.shiftKey && shortcut.code === "KeyO")) return true;
  if (primary && !shortcut.altKey && [
    "KeyA", "KeyB", "KeyC", "KeyI", "KeyK", "KeyL", "KeyQ", "KeyR", "KeyU", "KeyV", "KeyX", "KeyY", "KeyZ",
  ].includes(shortcut.code)) return true;
  return primary && (shortcut.shiftKey && !shortcut.altKey && ["KeyE", "KeyH"].includes(shortcut.code) ||
    shortcut.altKey && !shortcut.shiftKey && ["KeyM", "KeyP"].includes(shortcut.code));
}

export function parseSpeechShortcut(value: string, platform: string): ShortcutEvent {
  if (value.length > 80) throw new Error(INVALID_SHORTCUT);
  const parts = value.split("+").map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  const code = key === "space" ? "Space" : key && /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` :
    key && /^[0-9]$/.test(key) ? `Digit${key}` : key && /^f(?:[1-9]|1[0-2])$/.test(key) ? key.toUpperCase() : null;
  if (!code) throw new Error(INVALID_SHORTCUT);
  const shortcut: ShortcutEvent = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code, key: key === "space" ? " " : key };
  for (const part of parts) {
    const modifier = MODIFIERS.get(part);
    if (!modifier || shortcut[modifier]) throw new Error(INVALID_SHORTCUT);
    shortcut[modifier] = true;
  }
  if (!shortcut.ctrlKey && !shortcut.altKey && !shortcut.metaKey) throw new Error(INVALID_SHORTCUT);
  if (reserved(shortcut, platform)) throw new Error("This shortcut is already used by Denote. Choose another combination.");
  return shortcut;
}

export function loadSpeechShortcut(platform: string): ShortcutEvent {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? { ...DEFAULT_SPEECH_SHORTCUT } : parseSpeechShortcut(stored, platform);
}

export function saveSpeechShortcut(shortcut: ShortcutEvent): void {
  const value = formatSpeechShortcut(shortcut);
  try { localStorage.setItem(STORAGE_KEY, value); }
  catch { throw new Error("The dictation shortcut could not be saved. Check local storage access and try again."); }
}
