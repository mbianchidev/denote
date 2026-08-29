import { RotateCcw, Settings2, X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import {
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  normalizeEditorFontSize,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";

interface EditorSettingsDialogProps {
  open: boolean;
  disabled: boolean;
  settings: EditorDisplaySettings;
  restoreTabs: boolean;
  onChange: (settings: EditorDisplaySettings) => void;
  onRestoreTabsChange: (enabled: boolean) => void;
  onClose: () => void;
}

export function EditorSettingsDialog({
  open,
  disabled,
  settings,
  restoreTabs,
  onChange,
  onRestoreTabsChange,
  onClose,
}: EditorSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => firstInputRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const updateGuide = (
    key: Exclude<keyof EditorDisplaySettings, "fontSize">,
    enabled: boolean,
  ) => {
    onChange({ ...settings, [key]: enabled });
  };
  const updateFontSize = (fontSize: number) => {
    onChange({
      ...settings,
      fontSize: normalizeEditorFontSize(fontSize),
    });
  };
  const atDefaults =
    settings.showLineNumbers ===
      DEFAULT_EDITOR_DISPLAY_SETTINGS.showLineNumbers &&
    settings.showWhitespace ===
      DEFAULT_EDITOR_DISPLAY_SETTINGS.showWhitespace &&
    settings.showLineEndings ===
      DEFAULT_EDITOR_DISPLAY_SETTINGS.showLineEndings &&
    settings.highlightTrailingWhitespace ===
      DEFAULT_EDITOR_DISPLAY_SETTINGS.highlightTrailingWhitespace &&
    settings.fontSize === DEFAULT_EDITOR_DISPLAY_SETTINGS.fontSize;

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog editor-settings-dialog"
      aria-labelledby="editor-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">
            <Settings2 aria-hidden="true" size={15} />
            Editor
          </span>
          <h2 id="editor-settings-title">Editor settings</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close editor settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="editor-settings-dialog__body">
        <div className="editor-font-setting">
          <label htmlFor="editor-font-size">
            <strong>Editor font size</strong>
            <small>Applies to rich text and source editors.</small>
          </label>
          <div className="editor-font-setting__controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Decrease editor font size"
              disabled={disabled || settings.fontSize <= MIN_EDITOR_FONT_SIZE}
              onClick={() => updateFontSize(settings.fontSize - 1)}
            >
              −
            </button>
            <input
              ref={firstInputRef}
              id="editor-font-size"
              type="range"
              min={MIN_EDITOR_FONT_SIZE}
              max={MAX_EDITOR_FONT_SIZE}
              step={1}
              value={settings.fontSize}
              disabled={disabled}
              aria-label="Editor font size"
              onChange={(event) =>
                updateFontSize(Number(event.currentTarget.value))
              }
            />
            <output htmlFor="editor-font-size" aria-live="polite">
              {settings.fontSize}px
            </output>
            <button
              type="button"
              className="icon-button"
              aria-label="Increase editor font size"
              disabled={disabled || settings.fontSize >= MAX_EDITOR_FONT_SIZE}
              onClick={() => updateFontSize(settings.fontSize + 1)}
            >
              +
            </button>
          </div>
        </div>
        <p>
          Display guides are visual only and never change saved content.
          Markdown uses source mode while any guide is enabled.
        </p>
        <div className="editor-settings-list">
          <SettingCheckbox
            checked={settings.showLineNumbers}
            label="Show line numbers"
            description="Display a numbered gutter beside each source line."
            disabled={disabled}
            onChange={(enabled) => updateGuide("showLineNumbers", enabled)}
          />
          <SettingCheckbox
            checked={settings.showWhitespace}
            label="Show spaces and tabs"
            description="Render spaces as dots and tabs as arrows."
            disabled={disabled}
            onChange={(enabled) => updateGuide("showWhitespace", enabled)}
          />
          <SettingCheckbox
            checked={settings.showLineEndings}
            label="Show line endings"
            description="Mark each displayed newline with LF, CRLF, or CR."
            disabled={disabled}
            onChange={(enabled) => updateGuide("showLineEndings", enabled)}
          />
          <SettingCheckbox
            checked={settings.highlightTrailingWhitespace}
            label="Highlight trailing whitespace"
            description="Emphasize spaces or tabs immediately before a line ending."
            disabled={disabled}
            onChange={(enabled) =>
              updateGuide("highlightTrailingWhitespace", enabled)
            }
          />
          <SettingCheckbox
            checked={restoreTabs}
            label="Reopen tabs from the last session"
            description="Restore this vault's open files, order, groups, collapsed state, and active file."
            disabled={disabled}
            onChange={onRestoreTabsChange}
          />
        </div>
      </div>

      <footer className="editor-settings-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || atDefaults}
          onClick={() =>
            onChange({ ...DEFAULT_EDITOR_DISPLAY_SETTINGS })
          }
        >
          <RotateCcw aria-hidden="true" size={14} />
          Reset
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}

interface SettingCheckboxProps {
  inputRef?: RefObject<HTMLInputElement | null>;
  checked: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}

function SettingCheckbox({
  inputRef,
  checked,
  label,
  description,
  disabled = false,
  onChange,
}: SettingCheckboxProps) {
  return (
    <label className="editor-setting">
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
