export interface EditorDisplaySettings {
  showLineNumbers: boolean;
  showWhitespace: boolean;
  showLineEndings: boolean;
  highlightTrailingWhitespace: boolean;
  fontSize: number;
}

export const MIN_EDITOR_FONT_SIZE = 12;
export const MAX_EDITOR_FONT_SIZE = 24;
export const DEFAULT_EDITOR_FONT_SIZE = 16;

export const DEFAULT_EDITOR_DISPLAY_SETTINGS: EditorDisplaySettings = {
  showLineNumbers: false,
  showWhitespace: false,
  showLineEndings: false,
  highlightTrailingWhitespace: false,
  fontSize: DEFAULT_EDITOR_FONT_SIZE,
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
      fontSize: normalizeEditorFontSize(parsed.fontSize),
    };
  } catch {
    return { ...DEFAULT_EDITOR_DISPLAY_SETTINGS };
  }
}

export function saveEditorDisplaySettings(
  settings: EditorDisplaySettings,
): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      fontSize: normalizeEditorFontSize(settings.fontSize),
    }),
  );
}

export function hasEditorDisplayGuides(
  settings: EditorDisplaySettings,
): boolean {
  return (
    settings.showLineNumbers ||
    settings.showWhitespace ||
    settings.showLineEndings ||
    settings.highlightTrailingWhitespace
  );
}

export function normalizeEditorFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return Math.min(
    MAX_EDITOR_FONT_SIZE,
    Math.max(MIN_EDITOR_FONT_SIZE, Math.round(value)),
  );
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
