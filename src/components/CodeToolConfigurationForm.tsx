import { useEffect, useId, useState } from "react";
import { record } from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { CodeToolConfiguration } from "../lib/codeTools";

interface Props {
  pluginId: string;
  kind: "lsp" | "dap";
  language: string;
  configuration: CodeToolConfiguration;
  onSave: (configuration: CodeToolConfiguration) => Promise<void>;
}

export function CodeToolConfigurationForm({ pluginId, kind, language, configuration, onSave }: Props) {
  const id = useId();
  const title = kind === "lsp" ? "language server" : "debugger";
  const [enabled, setEnabled] = useState(configuration.enabled);
  const [executable, setExecutable] = useState(configuration.executable);
  const [transport, setTransport] = useState(configuration.transport);
  const [argumentsText, setArguments] = useState(JSON.stringify(configuration.arguments));
  const [options, setOptions] = useState(JSON.stringify(configuration.options, null, 2));
  const [launch, setLaunch] = useState(JSON.stringify(configuration.launch, null, 2));
  const [attach, setAttach] = useState(JSON.stringify(configuration.attach, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEnabled(configuration.enabled); setExecutable(configuration.executable);
    setTransport(configuration.transport); setArguments(JSON.stringify(configuration.arguments));
    setOptions(JSON.stringify(configuration.options, null, 2));
    setLaunch(JSON.stringify(configuration.launch, null, 2)); setAttach(JSON.stringify(configuration.attach, null, 2));
    setError(null);
  }, [configuration]);

  return <form className="code-tool-form" onSubmit={(event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    void (async () => {
      const args: unknown = JSON.parse(argumentsText);
      if (!Array.isArray(args) || !args.every((argument) => typeof argument === "string")) throw new Error("Arguments must be a JSON array of strings.");
      await onSave({
        enabled, executable, transport, arguments: args, executableSha256: "",
        options: objectJson(options, "Initialization options"),
        launch: objectJson(launch, "Launch configuration"), attach: objectJson(attach, "Attach configuration"),
      });
    })().catch((caught) => setError(errorMessage(caught))).finally(() => setBusy(false));
  }}>
    <label className="code-tool-checkbox"><input type="checkbox" checked={enabled} disabled={busy}
      onChange={(event) => setEnabled(event.target.checked)} />Enable {title}</label>
    {kind === "dap" ? <label>Adapter transport<select aria-label="Adapter transport" value={transport} disabled={busy}
      onChange={(event) => setTransport(event.target.value as CodeToolConfiguration["transport"])}>
      <option value="stdio">Standard input/output</option><option value="tcp">Loopback TCP</option>
      {language === "java" ? <option value="java">Java language server</option> : null}
    </select></label> : null}
    {transport !== "java" ? <>
      <label htmlFor={`${id}-executable`}>Executable</label>
      <input id={`${id}-executable`} value={executable} readOnly aria-label={`${title} executable`} />
      <button type="button" className="secondary-button" disabled={busy}
        aria-label={`Choose ${title} executable`} onClick={() => {
          setBusy(true); setError(null);
          void api.chooseCodeToolExecutable(pluginId).then((path) => { if (path) setExecutable(path); })
            .catch((caught) => setError(errorMessage(caught))).finally(() => setBusy(false));
        }}>Choose executable</button>
      <label>Arguments (JSON)<textarea value={argumentsText} maxLength={65536} rows={3} disabled={busy}
        aria-label={`${title} arguments`} onChange={(event) => setArguments(event.target.value)} spellCheck={false} /></label>
    </> : <p>Uses the approved Java server's java-debug extension. Start that server first.</p>}
    {kind === "lsp" ? <label>Initialization options (JSON)<textarea value={options} maxLength={65536} rows={4}
      disabled={busy} aria-label="Language server initialization options" spellCheck={false}
      onChange={(event) => setOptions(event.target.value)} /></label> : <>
      <label>Launch configuration (JSON)<textarea value={launch} maxLength={65536} rows={5} disabled={busy}
        aria-label="Debugger launch configuration" spellCheck={false} onChange={(event) => setLaunch(event.target.value)} /></label>
      <label>Attach configuration (JSON)<textarea value={attach} maxLength={65536} rows={5} disabled={busy}
        aria-label="Debugger attach configuration" spellCheck={false} onChange={(event) => setAttach(event.target.value)} /></label>
    </>}
    <p className="code-tool-guidance">Native tools and project configurations have your operating-system permissions. Approve only trusted tools and projects. Keep secrets in the operating-system environment, not these fields.</p>
    {error ? <p role="alert" className="code-tool-error">{error}</p> : null}
    <button type="submit" className="primary-button" disabled={busy || (enabled && transport !== "java" && !executable)}
      aria-label={`Save and approve ${title}`}>{busy ? "Saving…" : "Save and approve"}</button>
  </form>;
}

function objectJson(text: string, title: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!record(value)) throw new Error(`${title} must be a JSON object.`);
  return value;
}
