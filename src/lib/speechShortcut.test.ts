import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDictationShortcut, isDictationTarget } from "./shortcuts";
import { DEFAULT_SPEECH_SHORTCUT, formatSpeechShortcut, loadSpeechShortcut, parseSpeechShortcut, saveSpeechShortcut } from "./speechShortcut";

beforeEach(() => localStorage.clear());

describe("speech shortcut preferences", () => {
  it("defaults to Control-Space on every platform and persists a normalized custom binding", () => {
    for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
      expect(formatSpeechShortcut(loadSpeechShortcut(platform))).toBe("Ctrl+Space");
      const shortcut = parseSpeechShortcut(" control + shift + d ", platform);
      saveSpeechShortcut(shortcut);
      expect(formatSpeechShortcut(loadSpeechShortcut(platform))).toBe("Ctrl+Shift+D");
      expect(isDictationShortcut({ ...shortcut, key: "D" }, shortcut)).toBe(true);
      expect(isDictationShortcut(DEFAULT_SPEECH_SHORTCUT, shortcut)).toBe(false);
      localStorage.clear();
    }
  });

  it("supports Command/Option aliases and exact modifier matching", () => {
    const shortcut = parseSpeechShortcut("Option+Command+J", "MacIntel");
    expect(formatSpeechShortcut(shortcut)).toBe("Alt+Cmd+J");
    expect(isDictationShortcut({ ...shortcut, shiftKey: true }, shortcut)).toBe(false);
    expect(isDictationShortcut({ ...shortcut, code: "KeyK" }, shortcut)).toBe(false);
  });

  it.each(["D", "Shift+D", "Ctrl", "Ctrl+Ctrl+D", "Ctrl+Escape", "Ctrl++", "Ctrl+unknown", "Ctrl+Alt+Shift+Meta+"])(
    "rejects unsafe or malformed binding %s",
    (value) => expect(() => parseSpeechShortcut(value, "MacIntel")).toThrow(),
  );

  it.each(["Ctrl+S", "Ctrl+Alt+W", "Ctrl+F", "Ctrl+P", "Ctrl+N", "Ctrl+Shift+O", "Ctrl+C", "Ctrl+Shift+H"])(
    "does not replace existing Windows/Linux action %s",
    (value) => expect(() => parseSpeechShortcut(value, "Win32")).toThrow(/already used/),
  );

  it.each(["Cmd+S", "Cmd+P", "Cmd+Shift+E", "Cmd+Option+M", "Cmd+Option+P", "Cmd+Q"])(
    "does not replace existing macOS action %s",
    (value) => expect(() => parseSpeechShortcut(value, "MacIntel")).toThrow(/already used/),
  );

  it("resets explicitly and surfaces corrupt preferences and storage failures", () => {
    saveSpeechShortcut(parseSpeechShortcut("Ctrl+Shift+D", "MacIntel"));
    saveSpeechShortcut(DEFAULT_SPEECH_SHORTCUT);
    expect(formatSpeechShortcut(loadSpeechShortcut("MacIntel"))).toBe("Ctrl+Space");
    localStorage.setItem("denote.speech-shortcut.v1", "invented invalid preference");
    expect(() => loadSpeechShortcut("MacIntel")).toThrow();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic storage failure"); });
    try { expect(() => saveSpeechShortcut(DEFAULT_SPEECH_SHORTCUT)).toThrow(/could not be saved/); }
    finally { write.mockRestore(); }
  });

  it("never authorizes capture while a shortcut setting is being edited", () => {
    const setting = document.createElement("form");
    setting.dataset.speechShortcutSetting = "";
    setting.innerHTML = '<section data-sensitive-tool="speech"><input><button>Save shortcut</button></section>';
    expect(isDictationTarget(setting.querySelector("input"))).toBe(false);
    expect(isDictationTarget(setting.querySelector("button"))).toBe(false);
  });
});
