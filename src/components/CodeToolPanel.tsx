import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { codeLanguageForPath, type PluginCodeFeature, type PluginCodeLanguage, type PluginCodeLocation } from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import { parseCodeJump, type CodeToolConfiguration, type CodeToolEnvironment } from "../lib/codeTools";
import { CodeIntelligenceHost, codeRequestCancelled } from "../plugins/codeHost";
import type { PluginCodeContribution } from "../plugins/codeIntelligence";
import { PluginMarkdown } from "./PluginGuide";
import { CodeToolConfigurationForm } from "./CodeToolConfigurationForm";
import { CodeDebuggerPanel } from "./CodeDebuggerPanel";
import "./CodeToolPanel.css";

interface Props {
  provider: PluginCodeContribution;
  host: CodeIntelligenceHost;
  projectId: string | null;
  documentPath: string | null;
  files: string[];
  encrypted: boolean;
  onNavigate: (location: PluginCodeLocation) => Promise<void>;
}

const NAVIGATION: Array<[PluginCodeFeature, string]> = [
  ["definition", "Definition"], ["declaration", "Declaration"], ["implementation", "Implementation"],
  ["type-definition", "Type definition"], ["references", "References"],
];

export function CodeToolPanel({ provider, host, projectId, documentPath, files, encrypted, onNavigate }: Props) {
  useSyncExternalStore(host.subscribe, host.getRevision);
  const [language, setLanguage] = useState<PluginCodeLanguage>(codeLanguageForPath(documentPath ?? "") ?? provider.languages[0].id);
  const [scopeMode, setScopeMode] = useState<"file" | "project" | "vault">("project");
  const [environment, setEnvironment] = useState<CodeToolEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const generation = useRef(0);
  const contextProject = scopeMode === "vault" ? null : projectId;
  const path = scopeMode !== "vault" && codeLanguageForPath(documentPath ?? "") === language ? documentPath : null;
  const adapter = provider.languages.find((entry) => entry.id === language) ?? provider.languages[0];
  const model = environment ? host.model(environment.scope, language) : null;
  useEffect(() => {
    const detected = codeLanguageForPath(documentPath ?? "");
    if (detected && provider.languages.some((entry) => entry.id === detected)) setLanguage(detected);
  }, [documentPath, provider]);
  useEffect(() => {
    const current = ++generation.current;
    setEnvironment(null); setError(null); setMessage(null); setBusy(false); setResultFilter("");
    if (encrypted) return;
    void host.environment(language, contextProject, path).then((environment) => {
      if (current === generation.current) setEnvironment(environment);
    }).catch((caught) => {
      if (current === generation.current && !codeRequestCancelled(caught)) setError(errorMessage(caught));
    });
    return () => { generation.current += 1; };
  }, [host, provider, language, contextProject, path, encrypted]);

  const action = useCallback((run: () => Promise<unknown>) => {
    const current = generation.current;
    setBusy(true); setError(null); setMessage(null);
    void run().catch((caught) => {
      if (current === generation.current && !codeRequestCancelled(caught)) setError(errorMessage(caught));
    }).finally(() => { if (current === generation.current) setBusy(false); });
  }, []);
  const run = (operation: Parameters<CodeIntelligenceHost["run"]>[3]) => host.run(language, contextProject, path, operation);
  const navigateResult = (location: PluginCodeLocation) => action(() => onNavigate(location));
  const save = async (kind: "lsp" | "dap", configuration: CodeToolConfiguration) => {
    if (kind === "lsp" && model?.capabilities?.length) await run("stop");
    if (kind === "dap" && model?.debug && model.debug.state !== "terminated") {
      await host.run(language, contextProject, path, "debug", { debug: { command: "disconnect" } });
    }
    await api.saveCodeToolConfiguration(provider.pluginId, {
      workspaceScope: (await host.context()).workspaceScope, projectId: contextProject, documentPath: path, language,
    }, kind, configuration);
    setEnvironment(await host.environment(language, contextProject, path, true));
    setMessage("Configuration approved. Start the tool when ready.");
  };
  const results = (model?.locations ?? []).filter((result) =>
    `${result.name ?? ""} ${result.container ?? ""} ${result.path} ${result.project ?? ""} ${result.language ?? ""}`
      .toLowerCase().includes(resultFilter.toLowerCase()));
  const fileResults = fileQuery.trim() ? files.filter((file) => file.toLowerCase().includes(fileQuery.trim().toLowerCase())).slice(0, 200) : [];

  return <div className="sidebar-view code-tool-panel">
    <div className="sidebar-view__title"><h2>{provider.title}</h2></div>
    {encrypted ? <p role="note">Native code tools are unavailable in encrypted vaults. Use an unencrypted code vault; Denote never creates plaintext project mirrors.</p> : <>
      <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value as PluginCodeLanguage)} disabled={busy}>
        {provider.languages.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
      </select></label>
      <label>Scope<select aria-label="Code intelligence scope" value={scopeMode} disabled={busy}
        onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}>
        <option value="file">Current file</option><option value="project">Active project</option><option value="vault">Entire vault</option>
      </select></label>
      <p className="code-tool-context">{environment ? `Root: ${environment.scope.rootPath || "Vault"}` : "Loading code context…"}</p>
      <p role="status">{busy ? "Working…" : message ?? model?.status ?? "Language server is not running."}</p>
      {busy ? <button type="button" className="secondary-button" onClick={() => host.cancelPendingRequests()}>Cancel code request</button> : null}
      {error ? <p role="alert" className="code-tool-error">{error}</p> : null}
      {environment ? <>
        <details open={!environment.lsp.enabled}><summary>Language server setup · {adapter.server}</summary>
          <PluginMarkdown markdown={adapter.setup} />
          <CodeToolConfigurationForm pluginId={provider.pluginId} kind="lsp" language={language} configuration={environment.lsp}
            onSave={(configuration) => save("lsp", configuration)} />
        </details>
        <div className="code-tool-actions">
          <button type="button" className="secondary-button" disabled={busy || !environment.lsp.enabled || Boolean(model?.capabilities?.length)}
            onClick={() => action(() => run("start"))}>Start language server</button>
          <button type="button" className="secondary-button" disabled={busy || !environment.lsp.enabled}
            onClick={() => action(() => run("restart"))}>Restart language server</button>
          <button type="button" className="secondary-button" disabled={busy || !model?.capabilities?.length}
            onClick={() => action(() => run("stop"))}>Stop language integration</button>
        </div>
        <details open><summary>Code navigation</summary>
          <div className="code-tool-actions">{NAVIGATION.map(([feature, title]) => <button key={feature} type="button"
            className="secondary-button" disabled={busy || !path || !model?.capabilities?.includes(feature)}
            title={!model?.capabilities?.includes(feature) ? `${title} is unavailable from this server.` : undefined}
            onClick={() => action(async () => {
              const result = await host.run(language, contextProject, path, feature, { position: host.cursor(path!) });
              if (result.locations?.length === 1) await onNavigate(result.locations[0]);
            })}>{title}</button>)}</div>
          <form className="code-tool-form" onSubmit={(event) => {
            event.preventDefault();
            action(() => host.run(language, contextProject, path, scopeMode === "file" ? "symbols" : "workspace-symbols", { query }));
          }}><label>Search symbols<input value={query} maxLength={1024} onChange={(event) => setQuery(event.target.value)} /></label>
            <button type="submit" className="secondary-button" disabled={busy ||
              !(scopeMode === "file" ? path && model?.capabilities?.includes("symbols") : model?.capabilities?.includes("workspace-symbols"))}>Find symbols</button></form>
          {model?.locations ? <>
            <label>Filter results<input value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} /></label>
            <ul className="code-tool-list">{results.map((result, index) => <li key={`${result.path}:${result.range.start.line}:${result.range.start.character}:${index}`}>
              <button type="button" className="code-result-button" disabled={busy} onClick={() => navigateResult(result)}>
                <strong>{result.name ?? result.path.split("/").pop()}</strong>
                <span>{result.container ? `${result.container} · ` : ""}{result.path}:{result.range.start.line + 1}:{result.range.start.character + 1}</span>
                <span>{result.project || "Vault"} · {result.language ?? language}</span>
              </button>
            </li>)}</ul>
            {!results.length ? <p>No matching results.</p> : null}
          </> : null}
          {model?.notices?.map((notice) => <p key={notice} role="note">{notice}</p>)}
        </details>
        <details open><summary>File, line and column</summary>
          <form className="code-tool-form" onSubmit={(event) => {
            event.preventDefault();
            action(async () => {
              const location = parseCodeJump(fileQuery, documentPath ?? undefined);
              if (!location || !files.includes(location.path)) throw new Error("Choose an existing file in this vault.");
              await onNavigate(location);
            });
          }}><label>File, line and column<input value={fileQuery} aria-label="File, line and column"
            placeholder="path:line:column" onChange={(event) => setFileQuery(event.target.value)} /></label>
            <button type="submit" className="secondary-button" disabled={busy || !fileQuery.trim()}>Go to location</button></form>
          <ul className="code-tool-list">{fileResults.map((file) => <li key={file}>
            <button type="button" className="code-result-button" disabled={busy}
              onClick={() => navigateResult({ path: file, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } })}>{file}</button>
          </li>)}</ul>
        </details>
        <details><summary>Documentation and formatting</summary>
          <div className="code-tool-actions">{(["hover", "signature"] as const).map((feature) => <button key={feature} type="button"
            className="secondary-button" disabled={busy || !path || !model?.capabilities?.includes(feature)}
            onClick={() => action(() => host.run(language, contextProject, path, feature, { position: host.cursor(path!) }))}>
            {feature === "hover" ? "Show documentation" : "Signature help"}</button>)}
            <button type="button" className="secondary-button" disabled={busy || !path || !host.canEdit(path) || !model?.capabilities?.includes("format")}
              onClick={() => action(() => host.format(path!))}>Format document</button>
          </div>
          {model?.hover ? <PluginMarkdown markdown={model.hover} /> : null}
          {model?.signatures?.map((signature, index) => <pre key={`${index}:${signature}`}><code>{signature}</code></pre>)}
        </details>
        <details open><summary>Diagnostics · {model?.diagnostics?.length ?? 0}</summary>
          <ul className="code-tool-list">{path ? model?.diagnostics?.map((diagnostic, index) => <li key={`${index}:${diagnostic.range.start.line}`}>
            <button type="button" className="code-result-button" disabled={busy} onClick={() => navigateResult({ path, range: diagnostic.range })}>
              <strong>{diagnostic.severity}: {diagnostic.message}</strong>
              <span>{path}:{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}{diagnostic.source ? ` · ${diagnostic.source}` : ""}</span>
            </button>
          </li>) : null}</ul>
        </details>
        <details><summary>Debugger setup · {adapter.debugger}</summary>
          <CodeToolConfigurationForm pluginId={provider.pluginId} kind="dap" language={language} configuration={environment.dap}
            onSave={(configuration) => save("dap", configuration)} />
        </details>
        <details open={Boolean(model?.debug)}><summary>Debugger</summary>
          <CodeDebuggerPanel host={host} environment={environment} language={language} projectId={contextProject} path={path}
            model={model?.debug} busy={busy} onAction={action} onNavigate={onNavigate} />
        </details>
        <details><summary>Language server log</summary>
          <pre className="code-tool-log" tabIndex={0} aria-label="Language server log">{model?.logs?.join("\n") || "No language-server output."}</pre>
        </details>
      </> : null}
    </>}
  </div>;
}
