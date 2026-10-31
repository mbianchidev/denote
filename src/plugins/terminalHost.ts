import type { PluginToolContribution } from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { ToolContext, ToolPoll } from "../lib/projectTools";

export interface TerminalOutputEvent { sequence: number; data: Uint8Array }
export interface TerminalTab {
  id: string;
  provider: PluginToolContribution;
  context: ToolContext;
  rootPath: string;
  title: string;
  status: ToolPoll["status"];
  exitCode: number | null;
  error: string | null;
  events: TerminalOutputEvent[];
  sequence: number;
  acknowledged: number;
  bytes: number;
  input: Promise<void>;
  queuedInputBytes: number;
}

export class TerminalHost {
  private providers: PluginToolContribution[] = [];
  private workspace: string | null = null;
  private encrypted = false;
  private generation = 0;
  private revision = 0;
  private sequence = 0;
  private starting = 0;
  private readonly sessions = new Map<string, TerminalTab>();
  private readonly listeners = new Set<() => void>();
  private readonly waits = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(private readonly reportError: (error: unknown) => void = (error) => console.error("Terminal:", error)) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getRevision = (): number => this.revision;

  configure(providers: PluginToolContribution[], workspace: string | null, _projectIdentity: string, encrypted: boolean): void {
    providers = providers.filter((provider) => provider.kind === "terminal");
    if (workspace === this.workspace && encrypted === this.encrypted &&
        providers.length === this.providers.length && providers.every((provider, index) => provider === this.providers[index])) return;
    this.clear();
    this.providers = providers; this.workspace = workspace; this.encrypted = encrypted;
  }

  context(provider: PluginToolContribution, projectId: string | null): ToolContext {
    if (this.encrypted) throw new Error("Native terminals are unavailable in encrypted vaults. No plaintext tooling mirror is created.");
    if (!this.workspace || !this.providers.includes(provider)) throw new Error("Enable this terminal plugin first.");
    return { workspaceScope: this.workspace, projectId, kind: "terminal", language: "shell" };
  }

  tabs(providerId: string): TerminalTab[] {
    return [...this.sessions.values()].filter((tab) => tab.provider.id === providerId);
  }
  events(id: string, after: number): TerminalOutputEvent[] {
    return this.sessions.get(id)?.events.filter((event) => event.sequence > after) ?? [];
  }

  async start(provider: PluginToolContribution, context: ToolContext, rootPath: string): Promise<TerminalTab> {
    const expected = this.context(provider, context.projectId);
    if (expected.workspaceScope !== context.workspaceScope || expected.kind !== context.kind ||
        expected.language !== context.language) throw new Error("Terminal scope does not match the active workspace.");
    if (this.sessions.size + this.starting >= 8) throw new Error("Close a terminal before opening more than eight tabs.");
    const generation = this.generation;
    this.starting += 1;
    try {
      const run = await api.startToolSession(provider.pluginId, context, {
        paths: [], documentPath: null, input: null, trigger: "manual", rows: 24, cols: 80,
      });
      if (generation !== this.generation) {
        await api.stopToolSession(provider.pluginId, run.runId);
        throw new DOMException("Terminal start cancelled after a scope change.", "AbortError");
      }
      if (run.scope.rootPath !== rootPath || run.scope.projectId !== context.projectId) {
        await api.stopToolSession(provider.pluginId, run.runId);
        throw new Error("Terminal started in a different project than the approved view.");
      }
      const tab: TerminalTab = {
        id: run.runId, provider, context, rootPath, title: `Terminal ${++this.sequence}`,
        status: "running", exitCode: null, error: null, events: [], sequence: 0, acknowledged: 0, bytes: 0, input: Promise.resolve(), queuedInputBytes: 0,
      };
      this.sessions.set(tab.id, tab); this.publish();
      void this.poll(tab, generation);
      return tab;
    } finally { this.starting -= 1; }
  }

  async write(id: string, data: string): Promise<void> {
    const tab = this.sessions.get(id);
    const bytes = new TextEncoder().encode(data).length;
    if (!tab || tab.status !== "running" || this.encrypted || bytes === 0 || bytes > 64 * 1024) {
      throw new Error("Terminal input is unavailable or exceeds 64 KiB.");
    }
    if (tab.queuedInputBytes + bytes > 64 * 1024) throw new Error("Terminal input queue is full. Wait for pending input before retrying.");
    tab.queuedInputBytes += bytes;
    const generation = this.generation;
    const operation = tab.input.then(() => {
      if (generation !== this.generation || this.sessions.get(id) !== tab || tab.status !== "running") {
        throw new DOMException("Terminal input cancelled after shutdown.", "AbortError");
      }
      return api.writeToolInput(tab.provider.pluginId, tab.context, id, data);
    }).finally(() => { tab.queuedInputBytes -= bytes; });
    tab.input = operation.catch((error) => {
      if (generation === this.generation) { tab.error = errorMessage(error); this.publish(); }
    });
    return operation;
  }

  async resize(id: string, rows: number, cols: number): Promise<void> {
    const tab = this.sessions.get(id);
    if (!tab || tab.status !== "running") return;
    await api.resizeToolTerminal(tab.provider.pluginId, tab.context, id,
      Math.max(2, Math.min(500, rows)), Math.max(2, Math.min(500, cols)));
  }

  async close(id: string, confirmed: boolean): Promise<void> {
    const tab = this.sessions.get(id);
    if (!tab) return;
    if (tab.status === "running" && !confirmed) throw new Error("Confirm before closing a running terminal and terminating its jobs.");
    await api.stopToolSession(tab.provider.pluginId, id);
    this.sessions.delete(id);
    for (const event of tab.events) event.data.fill(0);
    tab.events = []; tab.bytes = 0; this.publish();
  }

  private async poll(tab: TerminalTab, generation: number): Promise<void> {
    const current = () => generation === this.generation && this.sessions.get(tab.id) === tab;
    try {
      while (current()) {
        const result = await api.pollToolSession(tab.provider.pluginId, tab.context, tab.id);
        if (!current()) return;
        for (const event of result.events) {
          if (event.stream !== "terminal") throw new Error("Terminal returned an unexpected output stream.");
          const bytes = Uint8Array.from(atob(event.data), (character) => character.charCodeAt(0));
          tab.events.push({ sequence: ++tab.sequence, data: bytes });
          tab.bytes += bytes.length;
          while (tab.bytes > 1024 * 1024 && tab.events.length > 1) {
            if (tab.events[0].sequence > tab.acknowledged) throw new Error("Terminal output was not rendered before the 1 MiB queue filled. The shell was stopped.");
            const removed = tab.events.shift()!;
            tab.bytes -= removed.data.length; removed.data.fill(0);
          }
        }
        tab.status = result.status; tab.exitCode = result.exitCode; tab.error = result.error; this.publish();
        if (result.status !== "running") {
          await api.stopToolSession(tab.provider.pluginId, tab.id);
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { this.waits.delete(timer); resolve(); }, 100);
          this.waits.set(timer, resolve);
        });
      }
    } catch (error) {
      if (!current()) return;
      tab.status = "failed"; tab.error = errorMessage(error); this.publish();
      try { await api.stopToolSession(tab.provider.pluginId, tab.id); }
      catch (cleanup) { this.reportError(new Error(`${errorMessage(error)}; terminal cleanup failed: ${errorMessage(cleanup)}`)); }
    }
  }

  private clear(): void {
    this.generation += 1;
    for (const provider of this.providers) void api.stopToolSessions(provider.pluginId).catch(this.reportError);
    for (const tab of this.sessions.values()) for (const event of tab.events) event.data.fill(0);
    this.sessions.clear();
    for (const [timer, resolve] of this.waits) { clearTimeout(timer); resolve(); }
    this.waits.clear(); this.publish();
  }
  dispose(): void { this.clear(); this.providers = []; this.workspace = null; }
  hasRunning(): boolean { return this.starting > 0 || [...this.sessions.values()].some((tab) => tab.status === "running"); }
  acknowledge(id: string, sequence: number): void {
    const tab = this.sessions.get(id);
    if (tab) tab.acknowledged = Math.max(tab.acknowledged, Math.min(sequence, tab.sequence));
  }
  private publish(): void { this.revision += 1; for (const listener of this.listeners) listener(); }
}
