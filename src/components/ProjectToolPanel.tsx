import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PluginCodeLocation, PluginToolContribution } from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { ToolEnvironment } from "../lib/projectTools";
import { ToolingHost, toolLanguage, type ToolFixPreview } from "../plugins/toolingHost";
import { ToolConfigurationForm } from "./ToolConfigurationForm";
import "./CodeToolPanel.css";

interface Props {
  provider: PluginToolContribution;
  host: ToolingHost;
  projectId: string | null;
  documentPath: string | null;
  encrypted: boolean;
  onSaveAll: () => Promise<boolean>;
  onNavigate: (location: PluginCodeLocation) => Promise<void>;
}

export function ProjectToolPanel({ provider, host, projectId, documentPath, encrypted, onSaveAll, onNavigate }: Props) {
  useSyncExternalStore(host.subscribe, host.getRevision);
  const build = provider.kind === "build";
  const detected = documentPath ? toolLanguage(documentPath) : "text";
  const [language, setLanguage] = useState(build ? "all" : detected);
  const [scope, setScope] = useState<"project" | "vault">("project");
  const [environment, setEnvironment] = useState<ToolEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [severity, setSeverity] = useState("all");
  const [preview, setPreview] = useState<ToolFixPreview | null>(null);
  const generation = useRef(0);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const selectedProject = scope === "vault" ? null : projectId;
  const model = host.model(provider.id, selectedProject, language);
  const running = model.status === "running";
  const unsaved = host.unsaved(selectedProject, environment?.scope.rootPath);
  useEffect(() => { if (!build) setLanguage(detected); }, [build, detected]);
  useEffect(() => {
    const current = ++generation.current;
    setEnvironment(null); setError(null); setPreview(null); setBusy(false);
    if (encrypted) return;
    void host.environment(provider, selectedProject, language).then((value) => {
      if (current === generation.current) setEnvironment(value);
    }).catch((caught) => { if (current === generation.current) setError(errorMessage(caught)); });
    return () => { generation.current += 1; };
  }, [host, provider, selectedProject, language, encrypted]);
  const action = (run: () => Promise<unknown>) => {
    const current = generation.current;
    setBusy(true); setError(null);
    void run().catch((caught) => { if (current === generation.current) setError(errorMessage(caught)); })
      .finally(() => { if (current === generation.current) setBusy(false); });
  };
  const run = (saved = false) => host.run(provider, selectedProject, language, documentPath, "manual", saved);
  const requiresSaveChoice = unsaved.length > 0 && !environment?.configuration.stdin;
  const diagnostics = model.diagnostics.filter((entry) => (severity === "all" || entry.severity === severity) &&
    `${entry.path} ${entry.message} ${entry.rule ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const closePreview = () => { setPreview(null); returnFocus.current?.focus(); };
  const status = running ? `${build ? "Building" : "Linting"}…` :
    model.status === "succeeded" ? "Run finished." :
    model.status === "failed" ? `Run failed${model.exitCode !== null ? ` (exit ${model.exitCode})` : ""}.` :
    model.status === "cancelled" ? "Run cancelled." : "No runs yet.";
  return <div className="sidebar-view code-tool-panel">
    <div className="sidebar-view__title"><h2>{provider.title}</h2></div>
    {encrypted ? <p role="note">Native linters and builds are unavailable in encrypted vaults, including while unlocked. No plaintext tooling mirror is created.</p> : <>
      <label>Language profile<select aria-label="Language profile" value={language} disabled={busy || running}
        onChange={(event) => setLanguage(event.target.value)}>
        {[...new Set(["all", detected, "rust", "go", "python", "java", "cpp", "typescript", "md", "json", "text"])].map((value) =>
          <option value={value} key={value}>{value === "all" ? "All languages" : value}</option>)}
      </select></label>
      <label>Scope<select aria-label="Scope" value={scope} disabled={busy || running} onChange={(event) => setScope(event.target.value as typeof scope)}>
        <option value="project">Active project</option><option value="vault">Entire vault</option>
      </select></label>
      <p className="code-tool-context">Root: {environment?.scope.rootPath || "Vault"}</p>
      <p role="status">{status}{model.runId ? ` Run ${model.runId.slice(0, 8)}.` : ""}</p>
      {error || (model.error && model.status !== "cancelled") ? <p role="alert" className="code-tool-error">{error ?? model.error}</p> : null}
      {environment ? <>
        {selectedProject !== null && !environment.configured ? <p role="note">No project override. Approved vault-wide automatic settings apply until this profile is saved.</p> : null}
        <details open={!environment.configuration.enabled}><summary>{build ? "Build" : "Linter"} setup</summary>
          <ToolConfigurationForm pluginId={provider.pluginId} kind={provider.kind} formats={provider.formats}
            configuration={environment.configuration} onSave={async (configuration) => {
              await host.resetProvider(provider.id);
              await api.saveToolConfiguration(provider.pluginId, host.context(provider, selectedProject, language), configuration);
              setEnvironment(await host.environment(provider, selectedProject, language, true));
            }} />
        </details>
        {requiresSaveChoice ? <div role="note">
          <p>{unsaved.length} unsaved {unsaved.length === 1 ? "file" : "files"}. Choose which content to use.</p>
          <div className="code-tool-actions">
            <button type="button" className="secondary-button" disabled={busy || running || !environment.configuration.enabled}
              onClick={() => action(async () => {
                if (!await onSaveAll()) throw new Error("Save failed or was cancelled. No tool was started.");
                await run();
              })}>Save all and {build ? "build" : "lint"}</button>
            <button type="button" className="secondary-button" disabled={busy || running || !environment.configuration.enabled}
              onClick={() => action(() => run(true))}>Run on saved files</button>
          </div>
        </div> : null}
        <div className="code-tool-actions">
          <button type="button" className="secondary-button" disabled={busy || running || requiresSaveChoice ||
            !environment.configuration.enabled || (!build && !documentPath)} onClick={() => action(() => run())}>
            {build ? "Build" : "Run linter"}
          </button>
          <button type="button" className="secondary-button" disabled={!running}
            onClick={() => { void host.cancel(provider.id, selectedProject, language).catch((caught) => setError(errorMessage(caught))); }}>Cancel</button>
        </div>
      </> : null}
      {model.notices.map((notice, index) => <p role="note" key={`${index}:${notice}`}>{notice}</p>)}
      <details open><summary>Problems · {model.diagnostics.length}</summary>
        <label>Severity<select aria-label="Severity" value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="all">All severities</option><option value="error">Errors</option><option value="warning">Warnings</option>
          <option value="info">Information</option><option value="hint">Hints</option>
        </select></label>
        <label>Filter problems<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        <ul className="code-tool-list">{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.runId}:${diagnostic.path}:${index}`}>
          <button type="button" className="code-result-button" onClick={() => action(async () => onNavigate(await host.location(diagnostic)))}>
            <strong>{diagnostic.severity}: {diagnostic.message}</strong>
            <span>{diagnostic.path}:{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}{diagnostic.rule ? ` · ${diagnostic.rule}` : ""}</span>
          </button>
          {diagnostic.fix ? <button type="button" className="secondary-button" disabled={busy} onClick={(event) => {
            returnFocus.current = event.currentTarget;
            action(async () => setPreview(await host.previewFix(diagnostic)));
          }}>Preview fix</button> : null}
        </li>)}</ul>
        {!diagnostics.length ? <p>No current matching problems.</p> : null}
      </details>
      {preview ? <section aria-label="Fix preview">
        <h3>Fix preview: {preview.diagnostic.path}</h3>
        <p>Changes apply to the open source with normal undo. An intervening edit invalidates this preview.</p>
        <h4>Before</h4><pre tabIndex={0} aria-label="Source before fix"><code>{preview.before}</code></pre>
        <h4>After</h4><pre tabIndex={0} aria-label="Source after fix"><code>{preview.after}</code></pre>
        <div className="code-tool-actions">
          <button type="button" className="primary-button" disabled={busy || !host.canApplyFix(preview)}
            onClick={() => action(async () => { await host.applyFix(preview); closePreview(); })}>Apply fix</button>
          <button type="button" className="secondary-button" onClick={closePreview}>Cancel preview</button>
        </div>
      </section> : null}
      <details open><summary>{build ? "Build output" : "Linter output"}</summary>
        {model.stdout.length > 262144 || model.stderr.length > 262144 ? <p role="note">Showing the latest 256 KiB from each stream. Diagnostic parsing uses the complete bounded output.</p> : null}
        <h3>Standard output</h3><pre tabIndex={0} aria-label="Standard output">{model.stdout.slice(-262144) || "No output."}</pre>
        <h3>Standard error</h3><pre tabIndex={0} aria-label="Standard error">{model.stderr.slice(-262144) || "No error output."}</pre>
      </details>
    </>}
  </div>;
}
