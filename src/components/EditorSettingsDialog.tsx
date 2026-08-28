import { RotateCcw, Settings2, X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import {
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";

interface EditorSettingsDialogProps {
  open: boolean;
  settings: EditorDisplaySettings;
  restoreTabs: boolean;
  onChange: (settings: EditorDisplaySettings) => void;
  onRestoreTabsChange: (enabled: boolean) => void;
  onClose: () => void;
}

export function EditorSettingsDialog({
  open,
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

  const update = (
    key: keyof EditorDisplaySettings,
    enabled: boolean,
  ) => {
    onChange({ ...settings, [key]: enabled });
  };
  const atDefaults = Object.values(settings).every((enabled) => !enabled);

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
          <h2 id="editor-settings-title">Display settings</h2>
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
        <p>
          These guides are visual only and never change saved content. Markdown
          uses source mode while any guide is enabled.
        </p>
        <div className="editor-settings-list">
          <SettingCheckbox
            inputRef={firstInputRef}
            checked={settings.showLineNumbers}
            label="Show line numbers"
            description="Display a numbered gutter beside each source line."
            onChange={(enabled) => update("showLineNumbers", enabled)}
          />
          <SettingCheckbox
            checked={settings.showWhitespace}
            label="Show spaces and tabs"
            description="Render spaces as dots and tabs as arrows."
            onChange={(enabled) => update("showWhitespace", enabled)}
          />
          <SettingCheckbox
            checked={settings.showLineEndings}
            label="Show line endings"
            description="Mark each displayed newline with LF, CRLF, or CR."
            onChange={(enabled) => update("showLineEndings", enabled)}
          />
          <SettingCheckbox
            checked={settings.highlightTrailingWhitespace}
            label="Highlight trailing whitespace"
            description="Emphasize spaces or tabs immediately before a line ending."
            onChange={(enabled) =>
              update("highlightTrailingWhitespace", enabled)
            }
          />
          <SettingCheckbox
            checked={restoreTabs}
            label="Reopen tabs from the last session"
            description="Restore this vault's open files, order, groups, collapsed state, and active file."
            onChange={onRestoreTabsChange}
          />
        </div>
      </div>

      <footer className="editor-settings-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={atDefaults}
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
  onChange: (enabled: boolean) => void;
}

function SettingCheckbox({
  inputRef,
  checked,
  label,
  description,
  onChange,
}: SettingCheckboxProps) {
  return (
    <label className="editor-setting">
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
