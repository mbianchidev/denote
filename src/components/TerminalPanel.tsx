import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PluginCodeLocation, PluginToolContribution } from "@denote/plugin-sdk";
import type { Terminal, Ghostty } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { api, errorMessage } from "../lib/api";
import { parseCodeJump } from "../lib/codeTools";
import type { ToolEnvironment } from "../lib/projectTools";
import { TerminalHost, type TerminalTab } from "../plugins/terminalHost";
import { ToolConfigurationForm } from "./ToolConfigurationForm";
import "./CodeToolPanel.css";
import "./TerminalPanel.css";

type Confirm = (options: { title: string; message: string; confirmLabel: string; dangerous: boolean }) => Promise<boolean>;
interface Props {
  provider: PluginToolContribution;
  host: TerminalHost;
  projectId: string | null;
  workspaceScope: string;
  encrypted: boolean;
  active: boolean;
  files: string[];
  confirmAction: Confirm;
  onNavigate: (location: PluginCodeLocation) => Promise<void>;
  onOpenExternal: (url: string) => Promise<unknown>;
}
let ghostty: Promise<Ghostty> | null = null;
async function loadGhostty(): Promise<Ghostty> {
  if (!ghostty) {
    ghostty = import("ghostty-web").then((module) => module.Ghostty.load(wasmUrl))
      .catch((error) => { ghostty = null; throw error; });
  }
  return ghostty;
}

export function terminalLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"']+|[\p{L}\p{N}_./-]+\.[\p{L}\p{N}_-]+(?::\d+){0,2}/gu) ?? [])]
    .map((link) => link.replace(/[),.;]+$/, "")).slice(0, 40);
}

export function TerminalPanel({ provider, host, projectId, workspaceScope, encrypted, active, files, confirmAction, onNavigate, onOpenExternal }: Props) {
  useSyncExternalStore(host.subscribe, host.getRevision);
  const [scope, setScope] = useState<"project" | "vault">("project");
  const [environment, setEnvironment] = useState<ToolEnvironment | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"opening" | "closing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const tabs = host.tabs(provider.id);
  const selectedProject = scope === "vault" ? null : projectId;
  const selectedTab = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  useEffect(() => {
    const current = ++generation.current;
    setEnvironment(null); setError(null); setBusy(null);
    if (encrypted) return;
    void api.toolEnvironment(provider.pluginId, { workspaceScope, projectId: selectedProject, kind: "terminal", language: "shell" })
      .then((environment) => { if (current === generation.current) setEnvironment(environment); })
      .catch((caught) => { if (current === generation.current) setError(errorMessage(caught)); });
    return () => { generation.current += 1; };
  }, [provider, selectedProject, workspaceScope, encrypted]);
  const action = (operation: "opening" | "closing", run: () => Promise<unknown>) => {
    const current = generation.current;
    setBusy(operation); setError(null);
    void run().catch((caught) => { if (current === generation.current) setError(errorMessage(caught)); })
      .finally(() => { if (current === generation.current) setBusy(null); });
  };
  const open = async (tab: TerminalTab, text: string) => {
    if (/^https?:\/\//i.test(text)) { await onOpenExternal(text); return; }
    const location = parseCodeJump(text);
    if (!location || location.path.split("/").includes(".git")) throw new Error("Choose a project-relative source file.");
    if (tab.rootPath && !location.path.startsWith(`${tab.rootPath}/`)) location.path = `${tab.rootPath}/${location.path}`;
    if (!files.includes(location.path) || (tab.rootPath && !location.path.startsWith(`${tab.rootPath}/`))) {
      throw new Error("This file is not available in the terminal's starting project. Use a project-relative path.");
    }
    await onNavigate(location);
  };
  return <div className="sidebar-view code-tool-panel terminal-panel">
    <div className="sidebar-view__title"><h2>{provider.title}</h2></div>
    {encrypted ? <p role="note">Terminals are unavailable in encrypted vaults, including while unlocked. No plaintext tooling mirror is created.</p> : <>
      <label>Scope<select aria-label="Scope" value={scope} disabled={busy !== null} onChange={(event) => setScope(event.target.value as typeof scope)}>
        <option value="project">Active project</option><option value="vault">Entire vault</option>
      </select></label>
      <p className="code-tool-context">New terminal root: {environment?.scope.rootPath || "Vault"}</p>
      {environment?.limitation ? <p role="note">{environment.limitation}</p> : null}
      {environment ? <p className="code-tool-context">Platform: {environment.platform}. Interactive PTY {environment.terminalSupported ? "available" : "unavailable"}.</p> : null}
      {error ? <p role="alert" className="code-tool-error">{error}</p> : null}
      {environment ? <>
        <details open={!environment.configuration.enabled}><summary>Shell setup</summary>
          <ToolConfigurationForm pluginId={provider.pluginId} kind="terminal" formats={[]} configuration={environment.configuration}
            onSave={async (configuration) => {
              const openTabs = host.tabs(provider.id);
              if (openTabs.some((tab) => tab.status === "running") && !await confirmAction({
                title: "Close terminals before changing shell setup?",
                message: "This terminates every terminal shell and its jobs. Save work inside the terminal first.",
                confirmLabel: "Terminate terminals and save",
                dangerous: false,
              })) throw new Error("Shell setup was not changed.");
              await Promise.all(openTabs.map((tab) => host.close(tab.id, true)));
              const context = host.context(provider, selectedProject);
              await api.saveToolConfiguration(provider.pluginId, context, configuration);
              setEnvironment(await api.toolEnvironment(provider.pluginId, context));
            }} />
        </details>
        <div className="code-tool-actions">
          <button type="button" className="secondary-button" disabled={busy !== null || !environment.configuration.enabled || !environment.terminalSupported || tabs.length >= 8}
            onClick={() => action("opening", async () => {
              await loadGhostty();
              const tab = await host.start(provider, host.context(provider, selectedProject), environment.scope.rootPath);
              setSelected(tab.id);
            })}>{busy === "opening" ? "Opening…" : "New terminal"}</button>
          <button type="button" className="secondary-button" disabled={busy !== null || !selectedTab} onClick={() => action("closing", async () => {
            if (!selectedTab) return;
            const confirmed = selectedTab.status !== "running" || await confirmAction({
              title: `Close ${selectedTab.title}?`, message: "This terminates the shell and its running jobs. Save work inside the terminal first.",
              confirmLabel: "Terminate and close",
              dangerous: false,
            });
            if (confirmed) { await host.close(selectedTab.id, true); setSelected(null); }
          })}>{busy === "closing" ? "Closing…" : "Close terminal"}</button>
        </div>
      </> : null}
      <div role="tablist" aria-label="Terminal tabs" className="terminal-tabs">{tabs.map((tab, index) => <button
        key={tab.id} type="button" role="tab" id={`terminal-tab-${tab.id}`} aria-controls={`terminal-panel-${tab.id}`}
        aria-selected={tab.id === selectedTab?.id} tabIndex={tab.id === selectedTab?.id ? 0 : -1}
        className="secondary-button" onClick={() => setSelected(tab.id)} onKeyDown={(event) => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else return;
          event.preventDefault(); setSelected(tabs[next].id);
          document.getElementById(`terminal-tab-${tabs[next].id}`)?.focus();
        }}>{tab.title}</button>)}</div>
      {!tabs.length ? <p role="status">No terminal is running.</p> : null}
      {tabs.map((tab) => <div role="tabpanel" key={tab.id} id={`terminal-panel-${tab.id}`} aria-labelledby={`terminal-tab-${tab.id}`}
        hidden={tab.id !== selectedTab?.id}>
        <p role="status">{tab.status === "running" ? "Shell running." : `Shell ${tab.status}${tab.exitCode !== null ? ` (exit ${tab.exitCode})` : ""}.`} Root: {tab.rootPath || "Vault"}</p>
        {tab.error ? <p role="alert" className="code-tool-error">{tab.error}</p> : null}
        <TerminalViewport tab={tab} host={host} active={active && tab.id === selectedTab?.id} confirmAction={confirmAction}
          onOpen={(text) => open(tab, text)} onError={(caught) => setError(errorMessage(caught))} />
      </div>)}
    </>}
  </div>;
}

function TerminalViewport({ tab, host, active, confirmAction, onOpen, onError }: {
  tab: TerminalTab; host: TerminalHost; active: boolean; confirmAction: Confirm;
  onOpen: (text: string) => Promise<void>; onError: (error: unknown) => void;
}) {
  const revision = useSyncExternalStore(host.subscribe, host.getRevision);
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<(() => void) | null>(null);
  const consumed = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const callbacks = useRef({ onOpen, onError, confirmAction, active });
  callbacks.current = { onOpen, onError, confirmAction, active };
  const paste = async (value: string) => {
    if (!value) throw new Error("The clipboard contains no text.");
    if (new TextEncoder().encode(value).length > 64 * 1024) throw new Error("Terminal paste exceeds 64 KiB.");
    if (/[\u0000-\u001f\u007f]/.test(value) && !await callbacks.current.confirmAction({
      title: "Paste terminal input?", message: `This input includes line breaks or control characters and may execute commands:\n${JSON.stringify(value)}`,
      confirmLabel: "Paste input",
      dangerous: false,
    })) return;
    if (!callbacks.current.active || tab.status !== "running") throw new Error("Terminal paste expired after a tab switch or shutdown.");
    terminal.current?.paste(value);
  };
  const pasteRef = useRef(paste); pasteRef.current = paste;
  const refreshText = () => {
    const term = terminal.current;
    if (!term) return;
    const buffer = term.buffer.active;
    const rows: string[] = [];
    for (let line = Math.max(0, buffer.length - 1000); line < buffer.length; line += 1) {
      rows.push(buffer.getLine(line)?.translateToString(true) ?? "");
    }
    setText(rows.join("\n").slice(-65536));
  };
  useEffect(() => {
    const parent = element.current;
    if (!parent) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const [engine, { Terminal, FitAddon }] = await Promise.all([loadGhostty(), import("ghostty-web")]);
      if (disposed) return;
      const styles = getComputedStyle(parent);
      const term = new Terminal({ ghostty: engine, fontSize: 13, scrollback: 2000, cursorBlink: false, smoothScrollDuration: 0,
        fontFamily: "SFMono-Regular, Consolas, monospace",
        theme: { background: styles.getPropertyValue("--app-bg").trim() || "#121315",
          foreground: styles.getPropertyValue("--text-primary").trim() || "#e8e5de" } });
      terminal.current = term;
      const disposables: Array<() => void> = [];
      let cleaned = false;
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const dispose of disposables.reverse()) {
          try { dispose(); } catch (error) { callbacks.current.onError(error); }
        }
        fit.current = null; terminal.current = null;
        try { term.dispose(); } catch (error) { callbacks.current.onError(error); }
        parent.replaceChildren();
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) { event.stopImmediatePropagation(); return; }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault(); event.stopImmediatePropagation(); searchInput.current?.focus();
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && term.hasSelection()) {
          event.preventDefault(); event.stopImmediatePropagation();
          void api.copyFileContent(term.getSelection()).catch(callbacks.current.onError);
        }
      };
      const clipboard = (event: ClipboardEvent) => {
        event.preventDefault(); event.stopImmediatePropagation();
        void pasteRef.current(event.clipboardData?.getData("text/plain") ?? "").catch(callbacks.current.onError);
      };
      const modifiedMouse = (event: MouseEvent) => {
        if (!event.metaKey && !event.ctrlKey) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.type !== "click" || !term.renderer) return;
        const rect = term.renderer.getCanvas().getBoundingClientRect();
        const row = Math.floor((event.clientY - rect.top) / term.renderer.charHeight) + term.buffer.active.viewportY;
        const col = Math.floor((event.clientX - rect.left) / term.renderer.charWidth);
        const line = term.buffer.active.getLine(row);
        const prefix = line?.translateToString(false, 0, col) ?? "";
        const content = line?.translateToString(true) ?? "";
        const link = terminalLinks(content).find((link) => {
          const index = content.indexOf(link);
          return index <= prefix.length && index + link.length >= prefix.length;
        });
        if (link) void callbacks.current.onOpen(link).catch(callbacks.current.onError);
      };
      parent.addEventListener("keydown", key, true);
      parent.addEventListener("paste", clipboard, true);
      parent.addEventListener("mousedown", modifiedMouse, true);
      parent.addEventListener("click", modifiedMouse, true);
      disposables.push(() => {
        parent.removeEventListener("keydown", key, true); parent.removeEventListener("paste", clipboard, true);
        parent.removeEventListener("mousedown", modifiedMouse, true); parent.removeEventListener("click", modifiedMouse, true);
      });
      term.open(parent);
      parent.tabIndex = -1;
      parent.setAttribute("role", "group");
      parent.setAttribute("aria-label", "Terminal");
      parent.removeAttribute("aria-multiline");
      term.textarea?.setAttribute("aria-label", `${tab.title} input`);
      term.options.disableStdin = !callbacks.current.active || tab.status !== "running";
      const addon = new FitAddon(); term.loadAddon(addon);
      fit.current = () => { if (parent.clientWidth > 0 && parent.clientHeight > 0) addon.fit(); };
      const observer = new ResizeObserver(() => fit.current?.()); observer.observe(parent);
      disposables.push(() => observer.disconnect());
      const input = term.onData((data) => {
        if (data && tab.status === "running") void host.write(tab.id, data).catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) callbacks.current.onError(error);
        });
      });
      const resize = term.onResize(({ rows, cols }) => { void host.resize(tab.id, rows, cols).catch(callbacks.current.onError); });
      const render = term.onRender(refreshText);
      disposables.push(() => input.dispose(), () => resize.dispose(), () => render.dispose());
      for (const event of host.events(tab.id, 0)) { term.write(event.data.slice()); consumed.current = event.sequence; }
      host.acknowledge(tab.id, consumed.current);
      fit.current(); refreshText();
    })().catch((error) => {
      cleanup();
      callbacks.current.onError(error);
      void host.close(tab.id, true).catch(callbacks.current.onError);
    });
    return () => { disposed = true; cleanup(); };
  }, [host, tab.id]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    for (const event of host.events(tab.id, consumed.current)) { term.write(event.data.slice()); consumed.current = event.sequence; }
    host.acknowledge(tab.id, consumed.current);
    term.options.disableStdin = !active || tab.status !== "running";
    if (!active) term.blur();
    refreshText();
  }, [host, tab.id, revision, active, tab.status]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => fit.current?.());
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return <div className="terminal-viewport">
    <div className="code-tool-actions">
      <button type="button" className="secondary-button" onClick={() => {
        const selected = terminal.current?.getSelection() ?? "";
        if (selected) void api.copyFileContent(selected).catch(onError);
        else onError(new Error("Select terminal text before copying."));
      }}>Copy</button>
      <button type="button" className="secondary-button" disabled={tab.status !== "running"}
        onClick={() => { void api.readClipboardText().then(paste).catch(onError); }}>Paste</button>
      <button type="button" className="secondary-button" disabled={tab.status !== "running"}
        onClick={() => { void host.write(tab.id, "\t").catch(onError); terminal.current?.focus(); }}>Send Tab</button>
    </div>
    <p className="code-tool-guidance">Tab leaves terminal input. File links resolve from this tab's starting root.</p>
    <div ref={element} className="terminal-canvas" aria-label="Terminal input" />
    <form className="code-tool-form" onSubmit={(event) => {
      event.preventDefault();
      const term = terminal.current;
      if (!term || !search) { setSearchStatus("Enter text to search."); return; }
      let found = -1;
      let count = 0;
      for (let row = 0; row < term.buffer.active.length; row += 1) {
        const line = term.buffer.active.getLine(row)?.translateToString(true) ?? "";
        if (line.toLowerCase().includes(search.toLowerCase())) { if (found < 0) found = row; count += 1; }
      }
      if (found >= 0) { term.scrollToLine(found); term.selectLines(found, found); }
      setSearchStatus(count ? `${count} matching lines.` : "No matches.");
    }}>
      <label>Search terminal<input ref={searchInput} value={search} maxLength={1024} onChange={(event) => setSearch(event.target.value)} /></label>
      <button type="submit" className="secondary-button">Search output</button>
      <p role="status">{searchStatus}</p>
    </form>
    <details><summary>Text output and links</summary>
      <p>Latest 64 KiB. Terminal scrollback retains up to 2,000 lines.</p>
      <pre tabIndex={0} aria-label="Terminal text output">{text || "No output."}</pre>
      <ul className="code-tool-list">{terminalLinks(text).map((link) => <li key={link}>
        <button type="button" className="code-result-button" onClick={() => { void onOpen(link).catch(onError); }}>{link}</button>
      </li>)}</ul>
    </details>
    <form className="code-tool-form" onSubmit={(event) => { event.preventDefault(); void onOpen(file).catch(onError); }}>
      <label>Open file, line and column<input value={file} maxLength={4096} placeholder="src/example.ts:1:1"
        onChange={(event) => setFile(event.target.value)} /></label>
      <button type="submit" className="secondary-button" disabled={!file.trim()}>Open in Denote</button>
    </form>
  </div>;
}
