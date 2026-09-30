import { useEffect, useRef, useState } from "react";
import { codeDocumentUri, type PluginCodeLanguage, type PluginCodeLocation, type PluginDebugCommand, type PluginDebugModel } from "@denote/plugin-sdk";
import type { CodeToolEnvironment } from "../lib/codeTools";
import type { CodeIntelligenceHost } from "../plugins/codeHost";

interface Props {
  host: CodeIntelligenceHost;
  environment: CodeToolEnvironment;
  language: PluginCodeLanguage;
  projectId: string | null;
  path: string | null;
  model?: PluginDebugModel;
  busy: boolean;
  onAction: (action: () => Promise<unknown>) => void;
  onNavigate: (location: PluginCodeLocation) => Promise<void>;
}
interface Breakpoint { path: string; line: number; condition?: string; logMessage?: string }

export function CodeDebuggerPanel({ host, environment, language, projectId, path, model, busy, onAction, onNavigate }: Props) {
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [line, setLine] = useState(1);
  const [condition, setCondition] = useState("");
  const [logMessage, setLogMessage] = useState("");
  const [watch, setWatch] = useState("");
  const [watches, setWatches] = useState<string[]>([]);
  const [exceptionFilters, setExceptionFilters] = useState("");
  const [consoleExpression, setConsoleExpression] = useState("");
  const [threadId, setThreadId] = useState<number | null>(null);
  const scopeKey = `${environment.scope.projectId ?? environment.scope.rootPath}:${language}`;
  const loadedStop = useRef<string | null>(null);
  useEffect(() => {
    setBreakpoints([]); setCondition(""); setLogMessage(""); setWatch(""); setWatches([]);
    setExceptionFilters(""); setConsoleExpression(""); setThreadId(null);
    loadedStop.current = null;
  }, [scopeKey]);
  useEffect(() => { if (path) setLine(host.cursor(path).line + 1); }, [path, host]);
  const stopped = model?.state === "stopped";
  const active = model !== undefined && model.state !== "terminated";
  const action = (command: PluginDebugCommand, args?: Record<string, unknown>) =>
    host.run(language, projectId, path, "debug", { debug: { command, ...(args ? { arguments: args } : {}) } });
  const can = (capability: string) => model?.capabilities.includes(capability) === true;
  useEffect(() => {
    const key = `${scopeKey}:${model?.stopEpoch ?? 0}`;
    if (!stopped || busy || loadedStop.current === key) return;
    loadedStop.current = key;
    onAction(async () => {
      const result = await action("threads");
      const id = result.debug?.threads[0]?.id;
      if (id !== undefined) {
        setThreadId(id);
        const stack = await action("stackTrace", { threadId: id });
        for (const expression of watches) {
          await action("evaluate", { expression, context: "watch",
            ...(stack.debug?.frames[0] ? { frameId: stack.debug.frames[0].id } : {}) });
        }
      }
    });
  }, [stopped, model?.stopEpoch, scopeKey, busy]);

  return <section className="code-debugger-panel" aria-label="Debugger">
    <div className="code-tool-actions">
      <button className="secondary-button" type="button" disabled={busy || active || !environment.dap.enabled}
        onClick={() => onAction(() => action("launch", {
          breakpointGroups: groupBreakpoints(breakpoints),
          exceptionFilters: exceptionFilters.split(",").map((filter) => filter.trim()).filter(Boolean).slice(0, 32),
        }))}>Launch</button>
      <button className="secondary-button" type="button" disabled={busy || active || !environment.dap.enabled}
        onClick={() => onAction(() => action("attach", {
          breakpointGroups: groupBreakpoints(breakpoints),
          exceptionFilters: exceptionFilters.split(",").map((filter) => filter.trim()).filter(Boolean).slice(0, 32),
        }))}>Attach</button>
      {([
        ["continue", "Continue", !stopped], ["pause", "Pause", !active || stopped],
        ["next", "Step over", !stopped], ["stepIn", "Step into", !stopped], ["stepOut", "Step out", !stopped],
        ["restart", "Restart", !active || !can("supportsRestartRequest")], ["disconnect", "Stop debugger", !active],
      ] as const).map(([command, title, disabled]) => <button key={command} type="button" className="secondary-button"
        disabled={busy || disabled} onClick={() => onAction(() => action(command, threadId === null ? {} : { threadId }))}>{title}</button>)}
    </div>
    <p role="status">{model ? `Debugger: ${model.state}` : "Approve an installed adapter before launching or attaching. Language intelligence works without debugging."}</p>
    <details open><summary>Breakpoints</summary>
      <form className="code-tool-form" onSubmit={(event) => {
        event.preventDefault();
        if (!path) return;
        const breakpoint: Breakpoint = { path, line, ...(condition ? { condition } : {}), ...(logMessage ? { logMessage } : {}) };
        const next = [...breakpoints.filter((entry) => entry.path !== path || entry.line !== line), breakpoint].slice(0, 100);
        setBreakpoints(next);
        if (active) onAction(() => action("setBreakpoints", {
          source: { path: codeDocumentUri(path) }, breakpoints: next.filter((entry) => entry.path === path).map(({ path: _path, ...entry }) => entry),
        }));
      }}>
        <label>Line<input type="number" min={1} max={2147483647} value={line} aria-label="Breakpoint line"
          onChange={(event) => setLine(Number(event.target.value))} disabled={!path || busy} /></label>
        <label>Condition<input value={condition} maxLength={1024} aria-label="Breakpoint condition"
          onChange={(event) => setCondition(event.target.value)} disabled={!path || busy || (active && !can("supportsConditionalBreakpoints"))} /></label>
        <label>Log message<input value={logMessage} maxLength={4096} aria-label="Logpoint message"
          onChange={(event) => setLogMessage(event.target.value)} disabled={!path || busy || (active && !can("supportsLogPoints"))} /></label>
        <button type="submit" className="secondary-button" disabled={!path || busy || !Number.isSafeInteger(line) || line < 1}>Add breakpoint</button>
      </form>
      <ul className="code-tool-list">{breakpoints.map((entry) => <li key={`${entry.path}:${entry.line}`}>
        <span>{entry.path}:{entry.line}{entry.condition ? ` · if ${entry.condition}` : ""}{entry.logMessage ? " · Logpoint" : ""}</span>
        <button type="button" className="secondary-button" disabled={busy} aria-label={`Remove breakpoint at ${entry.path}:${entry.line}`}
          onClick={() => {
            const next = breakpoints.filter((item) => item !== entry); setBreakpoints(next);
            if (active) onAction(() => action("setBreakpoints", {
              source: { path: codeDocumentUri(entry.path) }, breakpoints: next.filter((item) => item.path === entry.path).map(({ path: _path, ...item }) => item),
            }));
          }}>Remove</button>
      </li>)}</ul>
      {model?.breakpoints.map((entry, index) => <p key={`${entry.line}:${index}`}>
        Line {entry.line}: {entry.verified ? "Verified" : "Unverified"}{entry.message ? ` · ${entry.message}` : ""}
      </p>)}
    </details>
    <details open><summary>Threads and call stack</summary>
      <button type="button" className="secondary-button" disabled={busy || !active} onClick={() => onAction(() => action("threads"))}>Refresh threads</button>
      <ul className="code-tool-list">{model?.threads.map((thread) => <li key={thread.id}>
        <button type="button" disabled={busy || !stopped} className="code-result-button"
          onClick={() => { setThreadId(thread.id); onAction(() => action("stackTrace", { threadId: thread.id })); }}>
          {thread.name} · Thread {thread.id}
        </button>
      </li>)}</ul>
      <ol className="code-tool-list">{model?.frames.map((frame) => <li key={frame.id}>
        <button type="button" disabled={busy} className="code-result-button" onClick={() => onAction(async () => {
          await action("scopes", { frameId: frame.id }); if (frame.location) await onNavigate(frame.location);
        })}>{frame.name}{frame.location ? ` · ${frame.location.path}:${frame.location.range.start.line + 1}` : ""}</button>
      </li>)}</ol>
    </details>
    <details open><summary>Scopes and variables</summary>
      <ul className="code-tool-list">{model?.scopes.map((scope, index) => <li key={`${scope.name}:${index}`}>
        <button type="button" disabled={busy || !stopped} className="code-result-button"
          onClick={() => onAction(() => action("variables", { variablesReference: scope.variablesReference }))}>{scope.name}</button>
      </li>)}</ul>
      <ul className="code-tool-list">{model?.variables.map((variable, index) => <li key={`${variable.name}:${index}`}>
        <code>{variable.name} = {variable.value}{variable.type ? ` (${variable.type})` : ""}</code>
        {variable.variablesReference > 0 ? <button type="button" className="secondary-button" disabled={busy || !stopped}
          aria-label={`Inspect ${variable.name}`} onClick={() => onAction(() => action("variables", { variablesReference: variable.variablesReference }))}>Inspect</button> : null}
      </li>)}</ul>
    </details>
    <form className="code-tool-form" onSubmit={(event) => {
      event.preventDefault();
      const expression = watch.trim();
      setWatches((previous) => [...new Set([...previous, expression])].slice(-20));
      if (stopped) onAction(() => action("evaluate", {
        expression, context: "watch", ...(model?.frames[0] ? { frameId: model.frames[0].id } : {}),
      }));
    }}><label>Watch expression<input value={watch} maxLength={1024} onChange={(event) => setWatch(event.target.value)} disabled={busy} /></label>
      <button type="submit" className="secondary-button" disabled={busy || !watch.trim()}>Add watch</button></form>
    <ul className="code-tool-list" aria-label="Watches">{watches.map((expression) => <li key={expression}>
      <code>{expression} = {model?.watches?.find((entry) => entry.expression === expression)?.value ?? "Awaiting evaluation"}</code>
      <button type="button" className="secondary-button" aria-label={`Remove watch ${expression}`}
        onClick={() => setWatches((previous) => previous.filter((entry) => entry !== expression))}>Remove</button>
    </li>)}</ul>
    <details><summary>Exceptions</summary>
      <label>Exception filters<input value={exceptionFilters} maxLength={1024} placeholder="Adapter filter IDs, comma-separated"
        disabled={busy} onChange={(event) => setExceptionFilters(event.target.value)} /></label>
      <div className="code-tool-actions">
        <button type="button" className="secondary-button" disabled={busy || !active}
          onClick={() => onAction(() => action("setExceptionBreakpoints", {
            filters: exceptionFilters.split(",").map((filter) => filter.trim()).filter(Boolean).slice(0, 32),
          }))}>Apply exception filters</button>
        <button type="button" className="secondary-button" disabled={busy || !active}
          onClick={() => onAction(() => action("setExceptionBreakpoints", { filters: [] }))}>Clear exception filters</button>
        <button type="button" className="secondary-button" disabled={busy || !stopped || !can("supportsExceptionInfoRequest")}
          onClick={() => onAction(() => action("exceptionInfo", threadId === null ? {} : { threadId }))}>Inspect exception</button>
      </div>{model?.exception ? <pre>{model.exception}</pre> : <p>No exception details.</p>}
    </details>
    <details open><summary>Debug console</summary>
      <pre className="code-tool-log" tabIndex={0} aria-label="Debug console output">{model?.output.join("\n") || "No debugger output."}</pre>
      <form className="code-tool-form" onSubmit={(event) => {
        event.preventDefault(); onAction(() => action("evaluate", {
          expression: consoleExpression, context: "repl", ...(model?.frames[0] ? { frameId: model.frames[0].id } : {}),
        }));
      }}><label>Console expression<input value={consoleExpression} maxLength={1024} disabled={busy}
        onChange={(event) => setConsoleExpression(event.target.value)} /></label>
        <button type="submit" className="secondary-button" disabled={busy || !stopped || !consoleExpression.trim()}>Evaluate</button></form>
    </details>
  </section>;
}

function groupBreakpoints(entries: Breakpoint[]): Array<{ source: { path: string }; breakpoints: Array<Omit<Breakpoint, "path">> }> {
  return [...new Set(entries.map((entry) => entry.path))].map((path) => ({
    source: { path: codeDocumentUri(path) },
    breakpoints: entries.filter((entry) => entry.path === path).map(({ path: _path, ...entry }) => entry),
  }));
}
