export interface EditorDisplaySettings {
  showLineNumbers: boolean;
  showWhitespace: boolean;
  showLineEndings: boolean;
  highlightTrailingWhitespace: boolean;
}

export const DEFAULT_EDITOR_DISPLAY_SETTINGS: EditorDisplaySettings = {
  showLineNumbers: false,
  showWhitespace: false,
  showLineEndings: false,
  highlightTrailingWhitespace: false,
};

const STORAGE_KEY = "denote-editor-display";

export function getEditorDisplaySettings(): EditorDisplaySettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_EDITOR_DISPLAY_SETTINGS };
    }
    const parsed = JSON.parse(stored) as Partial<EditorDisplaySettings>;
    return {
      showLineNumbers: parsed.showLineNumbers === true,
      showWhitespace: parsed.showWhitespace === true,
      showLineEndings: parsed.showLineEndings === true,
      highlightTrailingWhitespace: parsed.highlightTrailingWhitespace === true,
    };
  } catch {
    return { ...DEFAULT_EDITOR_DISPLAY_SETTINGS };
  }
}

export function saveEditorDisplaySettings(
  settings: EditorDisplaySettings,
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function hasEditorDisplayGuides(
  settings: EditorDisplaySettings,
): boolean {
  return Object.values(settings).some(Boolean);
}

export function editorDisplaySettingsKey(
  settings: EditorDisplaySettings,
): string {
  return [
    settings.showLineNumbers,
    settings.showWhitespace,
    settings.showLineEndings,
    settings.highlightTrailingWhitespace,
  ]
    .map((enabled) => (enabled ? "1" : "0"))
    .join("");
}
