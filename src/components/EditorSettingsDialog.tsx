import { RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  normalizeEditorFontSize,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";
import type {
  PluginBundleMetadata,
  PluginToolStatus,
  PluginView,
  ProjectRoot,
} from "../types";
import type { PluginPermissionRequest } from "@denote/plugin-sdk";
import { PluginSettingsPanel } from "./PluginSettingsPanel";

interface EditorSettingsDialogProps {
  open: boolean;
  disabled: boolean;
  settings: EditorDisplaySettings;
  restoreTabs: boolean;
  externalDomains: string[];
  allowAllExternalDomains: boolean;
  plugins: PluginView[];
  pluginBundles: PluginBundleMetadata[];
  pluginDevelopmentSupported?: boolean;
  activeProject: ProjectRoot | null;
  pluginsLoading: boolean;
  busyPluginIds: ReadonlySet<string>;
  onChange: (settings: EditorDisplaySettings) => void;
  onRestoreTabsChange: (enabled: boolean) => void;
  onRemoveExternalDomain: (domain: string) => void;
  onClearExternalDomains: () => void;
  onEnablePlugin: (
    pluginId: string,
    permissions: PluginPermissionRequest[],
  ) => Promise<void>;
  onDisablePlugin: (pluginId: string) => Promise<void>;
  onDisableAllPlugins: () => Promise<void>;
  onUpdateAllPlugins: () => Promise<void>;
  onLoadDevelopmentPlugin?: () => Promise<void>;
  onClearPluginData: (pluginId: string) => Promise<void>;
  onClearPluginCredentials: (pluginId: string) => Promise<void>;
  onUpdatePluginSettings: (
    pluginId: string,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  onImportPluginSettings: (
    pluginId: string,
    sourceVersion: number,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  onInspectPluginTools?: (pluginId: string) => Promise<PluginToolStatus[]>;
  onPickPluginExecutable?: (
    tool: "git" | "github-cli",
  ) => Promise<string | null>;
  onPluginError: (error: unknown) => void;
  onClose: () => void;
}

export function EditorSettingsDialog({
  open,
  disabled,
  settings,
  restoreTabs,
  externalDomains,
  allowAllExternalDomains,
  plugins,
  pluginBundles,
  pluginDevelopmentSupported = false,
  activeProject,
  pluginsLoading,
  busyPluginIds,
  onChange,
  onRestoreTabsChange,
  onRemoveExternalDomain,
  onClearExternalDomains,
  onEnablePlugin,
  onDisablePlugin,
  onDisableAllPlugins,
  onUpdateAllPlugins,
  onLoadDevelopmentPlugin = async () => {},
  onClearPluginData,
  onClearPluginCredentials,
  onUpdatePluginSettings,
  onImportPluginSettings,
  onInspectPluginTools,
  onPickPluginExecutable,
  onPluginError,
  onClose,
}: EditorSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const [section, setSection] = useState<"editor" | "plugins">("editor");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => firstControlRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const updateGuide = (
    key: Exclude<keyof EditorDisplaySettings, "fontSize" | "tabSize">,
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
    settings.fontSize === DEFAULT_EDITOR_DISPLAY_SETTINGS.fontSize &&
    settings.tabSize === DEFAULT_EDITOR_DISPLAY_SETTINGS.tabSize;

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
            Denote
          </span>
          <h2 id="editor-settings-title">Settings</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <nav className="editor-settings-dialog__sections" aria-label="Settings sections">
        <button
          ref={firstControlRef}
          type="button"
          aria-pressed={section === "editor"}
          onClick={() => setSection("editor")}
        >
          Editor
        </button>
        <button
          type="button"
          aria-pressed={section === "plugins"}
          onClick={() => setSection("plugins")}
        >
          Plugins
        </button>
      </nav>

      {section === "editor" ? (
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
          <fieldset className="editor-tab-setting" disabled={disabled}>
            <legend>Tab indentation</legend>
            <p>Choose how many spaces Tab inserts in source and code editors.</p>
            <div>
              {([2, 4] as const).map((size) => (
                <label key={size}>
                  <input
                    type="radio"
                    name="editor-tab-size"
                    value={size}
                    checked={settings.tabSize === size}
                    onChange={() =>
                      onChange({
                        ...settings,
                        tabSize: size,
                      })
                    }
                  />
                  {size} spaces
                </label>
              ))}
            </div>
          </fieldset>
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
          <section
          className="external-domain-settings"
          aria-labelledby="external-domain-settings-title"
        >
          <div>
            <h3 id="external-domain-settings-title">
              Allowed external domains
            </h3>
            <p>
              Unknown HTTP and HTTPS domains require confirmation before Denote
              opens them.
            </p>
          </div>
          {allowAllExternalDomains ? (
            <div className="external-domain-setting">
              <code>*</code>
              <span>All external domains</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove all-domain permission"
                disabled={disabled}
                onClick={() => onRemoveExternalDomain("*")}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          ) : externalDomains.length > 0 ? (
            <div className="external-domain-settings__list">
              {externalDomains.map((domain) => (
                <div className="external-domain-setting" key={domain}>
                  <code>{domain}</code>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove external domain ${domain}`}
                    disabled={disabled}
                    onClick={() => onRemoveExternalDomain(domain)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="external-domain-settings__empty">
              No external domains are allowed yet.
            </p>
          )}
          {(allowAllExternalDomains || externalDomains.length > 0) ? (
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={onClearExternalDomains}
            >
              Clear external domain permissions
            </button>
          ) : null}
          </section>
        </div>
      ) : (
        <PluginSettingsPanel
          plugins={plugins}
          bundles={pluginBundles}
          developmentSupported={pluginDevelopmentSupported}
          activeProject={activeProject}
          loading={pluginsLoading}
          busyPluginIds={busyPluginIds}
          onEnable={onEnablePlugin}
          onDisable={onDisablePlugin}
          onDisableAll={onDisableAllPlugins}
          onUpdateAll={onUpdateAllPlugins}
          onLoadDevelopment={onLoadDevelopmentPlugin}
          onClearData={onClearPluginData}
          onClearCredentials={onClearPluginCredentials}
          onUpdateSettings={onUpdatePluginSettings}
          onImportSettings={onImportPluginSettings}
          onInspectTools={onInspectPluginTools}
          onPickExecutable={onPickPluginExecutable}
          onError={onPluginError}
        />
      )}

      <footer className="editor-settings-dialog__actions">
        {section === "editor" ? (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || atDefaults}
            onClick={() =>
              onChange({ ...DEFAULT_EDITOR_DISPLAY_SETTINGS })
            }
          >
            <RotateCcw aria-hidden="true" size={14} />
            Reset editor
          </button>
        ) : (
          <span />
        )}
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
