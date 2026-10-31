import { useEffect, useState } from "react";
import type { PluginToolFormat, PluginToolKind } from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { ToolConfiguration } from "../lib/projectTools";

interface Props {
  pluginId: string;
  kind: PluginToolKind;
  formats: PluginToolFormat[];
  configuration: ToolConfiguration;
  onSave: (configuration: ToolConfiguration) => Promise<void>;
}

export function ToolConfigurationForm({ pluginId, kind, formats, configuration, onSave }: Props) {
  const [draft, setDraft] = useState(configuration);
  const [argumentsText, setArguments] = useState(JSON.stringify(configuration.arguments));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminal = kind === "terminal";
  const title = terminal ? "shell" : kind === "build" ? "build tool" : "linter";
  useEffect(() => {
    setDraft(configuration); setArguments(JSON.stringify(configuration.arguments)); setError(null);
  }, [configuration]);
  return <form className="code-tool-form" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError(null);
    void (async () => {
      const args: unknown = JSON.parse(argumentsText);
      if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
        throw new Error("Arguments must be a JSON array of strings.");
      }
      await onSave({ ...draft, executableSha256: "", arguments: args });
    })().catch((caught) => setError(errorMessage(caught))).finally(() => setBusy(false));
  }}>
    <label className="code-tool-checkbox"><input type="checkbox" checked={draft.enabled} disabled={busy}
      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enable {title}</label>
    <label>Executable<input value={draft.executable} readOnly aria-label={`${title} executable`} /></label>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => {
      setBusy(true); setError(null);
      void api.chooseToolExecutable(pluginId, kind).then((path) => { if (path) setDraft((current) => ({ ...current, executable: path })); })
        .catch((caught) => setError(errorMessage(caught))).finally(() => setBusy(false));
    }}>Choose executable</button>
    <label>Arguments (JSON)<textarea value={argumentsText} disabled={busy} rows={3} maxLength={65536} spellCheck={false}
      onChange={(event) => setArguments(event.target.value)} aria-label={`${title} arguments`} /></label>
    {!terminal ? <>
      <p className="code-tool-guidance">Arguments run directly, without shell expansion. %FILE% is relative to the selected root.</p>
      <label>Output parser<select aria-label="Output parser" value={draft.format} disabled={busy} onChange={(event) => {
        const format = event.target.value as PluginToolFormat;
        setDraft({ ...draft, format, columns: format === "eslint-json" || format === "msvc" ? "utf16" : "unicode" });
      }}>{formats.map((format) => <option key={format} value={format}>{
        { unix: "Unix", msvc: "MSVC", "eslint-json": "ESLint JSON", "cargo-json": "Cargo JSON" }[format]
      }</option>)}</select></label>
      <label>Column units<select aria-label="Column units" value={draft.columns} disabled={busy}
        onChange={(event) => setDraft({ ...draft, columns: event.target.value as ToolConfiguration["columns"] })}>
        <option value="unicode">Unicode characters</option><option value="utf16">UTF-16 units</option><option value="utf8">UTF-8 bytes</option>
      </select></label>
      {kind === "linter" ? <label className="code-tool-checkbox"><input type="checkbox" checked={draft.stdin} disabled={busy}
        onChange={(event) => setDraft({ ...draft, stdin: event.target.checked,
          runOn: !event.target.checked && draft.runOn === "change" ? "manual" : draft.runOn })} />Send current source through stdin</label> : null}
      <label>Run automatically<select aria-label="Run automatically" value={draft.runOn} disabled={busy}
        onChange={(event) => setDraft({ ...draft, runOn: event.target.value as ToolConfiguration["runOn"] })}>
        <option value="manual">Never</option><option value="save">After saves</option>
        {kind === "linter" ? <option value="change" disabled={!draft.stdin}>After edits (requires stdin)</option> : null}
      </select></label>
      {draft.runOn === "change" ? <label>Debounce (milliseconds)<input type="number" min={100} max={30000} step={100}
        required value={draft.debounceMs} disabled={busy} onChange={(event) => setDraft({ ...draft, debounceMs: event.target.valueAsNumber })} /></label> : null}
      <label>Timeout (seconds)<input type="number" min={1} max={600} step={1} required value={draft.timeoutMs / 1000}
        disabled={busy} onChange={(event) => setDraft({ ...draft, timeoutMs: event.target.valueAsNumber * 1000 })} /></label>
    </> : null}
    <p className="code-tool-guidance">Approve only trusted executables, arguments and projects. Native tools have your operating-system access. Nothing is installed. Keep secrets out of these fields.</p>
    {kind === "linter" ? <p className="code-tool-guidance">Use read-only linter commands, not write/fix flags. Fix proposals require a separate preview.</p> : null}
    {error ? <p role="alert" className="code-tool-error">{error}</p> : null}
    <button type="submit" className="primary-button" disabled={busy || (draft.enabled && !draft.executable)}>
      {busy ? "Saving…" : "Save and approve"}
    </button>
  </form>;
}
