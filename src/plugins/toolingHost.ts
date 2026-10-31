import {
  codeLanguageForPath, isCodePath, isToolParseResultFor,
  type PluginCodeLocation, type PluginCodeRange, type PluginToolContribution, type PluginToolDiagnostic,
  type PluginToolDocument, type PluginToolFix, type PluginToolParseRequest, type PluginToolParseResult,
} from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { ToolConfiguration, ToolContext, ToolEnvironment, ToolPoll, ToolRun } from "../lib/projectTools";
import type { FileLineEnding } from "../types";

type Parse = (pluginId: string, providerId: string, request: PluginToolParseRequest, workspaceScope: string) => Promise<PluginToolParseResult>;
export interface ToolOpenDocument {
  path: string;
  content: string;
  savedContent: string;
  savedHash?: string;
  projectId: string | null;
  lineEnding?: FileLineEnding;
}
interface Document extends ToolOpenDocument { version: number }
interface Editor {
  readOnly: () => boolean;
  apply: (source: string, fix: PluginToolFix) => void;
}
export interface ToolDiagnostic extends PluginToolDiagnostic {
  runId: string;
  modelKey: string;
  memoryVersion: number | null;
  diskVersion: string;
  stdin: boolean;
}
export interface ToolModel {
  status: "idle" | ToolPoll["status"];
  runId: string | null;
  exitCode: number | null;
  error: string | null;
  stdout: string;
  stderr: string;
  diagnostics: ToolDiagnostic[];
  notices: string[];
}
interface RunState {
  model: ToolModel;
  provider: PluginToolContribution;
  context: ToolContext;
  configuration: ToolConfiguration;
  run: ToolRun;
}
interface PendingRun {
  controller: AbortController;
  provider: PluginToolContribution;
  versions: Map<string, number>;
  runId: string | null;
}
export interface ToolFixPreview {
  diagnostic: ToolDiagnostic;
  version: number;
  before: string;
  after: string;
  fix: PluginToolFix;
}

const EMPTY: ToolModel = { status: "idle", runId: null, exitCode: null, error: null, stdout: "", stderr: "", diagnostics: [], notices: [] };
function modelKey(id: string, projectId: string | null, language: string): string {
  return JSON.stringify([id, projectId, language]);
}
function inside(path: string, root: string): boolean { return root === "" || path.startsWith(`${root}/`); }
export function toolLanguage(path: string): string {
  return codeLanguageForPath(path) ?? (path.split(".").pop()?.toLowerCase().replace(/[^a-z0-9+-]/g, "").slice(0, 32) || "text");
}

export class ToolingHost {
  private providers: PluginToolContribution[] = [];
  private parse: Parse | null = null;
  private workspace: string | null = null;
  private projectIdentity = "";
  private encrypted = false;
  private generation = 0;
  private version = 0;
  private revision = 0;
  private files: string[] = [];
  private readonly documents = new Map<string, Document>();
  private readonly editors = new Map<string, Set<Editor>>();
  private readonly listeners = new Set<() => void>();
  private readonly previews = new WeakSet<ToolFixPreview>();
  private readonly environments = new Map<string, Promise<ToolEnvironment>>();
  private readonly models = new Map<string, ToolModel>();
  private readonly runs = new Map<string, RunState>();
  private readonly pending = new Map<string, PendingRun>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly automaticEpochs = new Map<string, number>();
  private automaticSequence = 0;
  private validationTimer: ReturnType<typeof setInterval> | null = null;
  private validating = false;

  constructor(private readonly reportError: (error: unknown) => void = (error) => console.error("External tooling:", error)) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getRevision = (): number => this.revision;

  configure(providers: PluginToolContribution[], parse: Parse, workspace: string | null, projectIdentity: string, encrypted: boolean): void {
    providers = providers.filter((provider) => provider.kind !== "terminal");
    this.parse = parse;
    if (workspace === this.workspace && projectIdentity === this.projectIdentity && encrypted === this.encrypted &&
        providers.length === this.providers.length && providers.every((provider, index) => provider === this.providers[index])) return;
    for (const [key] of this.pending) void this.cancelKey(key).catch(this.reportError);
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.environments.clear(); this.models.clear(); this.runs.clear();
    if (workspace !== this.workspace || encrypted || !providers.length) { this.documents.clear(); this.editors.clear(); }
    this.workspace = workspace; this.projectIdentity = projectIdentity; this.encrypted = encrypted;
    this.providers = providers;
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = !encrypted && workspace && this.providers.length
      ? setInterval(() => { void this.validateDiagnostics().catch(this.reportError); }, 1000) : null;
    this.publish();
  }

  context(provider: PluginToolContribution, projectId: string | null, language: string): ToolContext {
    if (this.encrypted) throw new Error("Native tooling is unavailable in encrypted vaults. No plaintext tooling mirror is created.");
    if (!this.workspace || !this.providers.includes(provider)) throw new Error("Enable this tooling plugin first.");
    return { workspaceScope: this.workspace, projectId, kind: provider.kind, language };
  }

  environment(provider: PluginToolContribution, projectId: string | null, language: string, refresh = false): Promise<ToolEnvironment> {
    const context = this.context(provider, projectId, language);
    const key = modelKey(provider.id, projectId, language);
    const previous = this.environments.get(key);
    if (previous && !refresh) return previous;
    const generation = this.generation;
    const operation = api.toolEnvironment(provider.pluginId, context).then((environment) => {
      if (generation !== this.generation) throw new DOMException("Tool context changed.", "AbortError");
      if (!provider.formats.includes(environment.configuration.format)) throw new Error("The configured output parser is not supported by this plugin.");
      return environment;
    }).catch((error) => { if (this.environments.get(key) === operation) this.environments.delete(key); throw error; });
    this.environments.set(key, operation);
    return operation;
  }

  setFiles(paths: string[], ignored: ReadonlySet<string> = new Set()): void {
    this.files = [...new Set(paths.filter((path) => {
      if (!isCodePath(path, false) || path.split("/").includes(".git")) return false;
      let candidate = path;
      while (candidate) {
        if (ignored.has(candidate)) return false;
        const separator = candidate.lastIndexOf("/");
        candidate = separator < 0 ? "" : candidate.slice(0, separator);
      }
      return true;
    }))];
    const pathsSet = new Set([...this.files, ...this.documents.keys()]);
    for (const model of this.models.values()) model.diagnostics = model.diagnostics.filter((entry) => pathsSet.has(entry.path));
  }

  syncDocuments(documents: ToolOpenDocument[]): void {
    if (this.encrypted || !this.workspace || !this.providers.length) return;
    const retained = new Set(documents.map((document) => document.path));
    for (const path of this.documents.keys()) if (!retained.has(path)) {
      this.invalidate(path); this.documents.delete(path);
    }
    for (const document of documents) {
      const current = this.documents.get(document.path);
      if (!current) this.documents.set(document.path, { ...document, version: ++this.version });
      else {
        if (current.lineEnding !== document.lineEnding) {
          this.invalidate(document.path); current.version = ++this.version;
        }
        this.update(document.path, document.content);
        Object.assign(current, document);
      }
    }
  }

  attach(path: string, editor: Editor): () => void {
    const editors = this.editors.get(path) ?? new Set<Editor>();
    editors.add(editor); this.editors.set(path, editors);
    return () => { editors.delete(editor); if (!editors.size) this.editors.delete(path); };
  }

  update(path: string, content: string): void {
    const entry = this.documents.get(path);
    if (!entry || entry.content === content) return;
    this.invalidate(path);
    entry.content = content; entry.version = ++this.version;
    this.scheduleAutomatic(entry, "change");
  }

  async saved(path: string, content: string, hash?: string): Promise<void> {
    const entry = this.documents.get(path);
    if (!entry || entry.content !== content) return;
    entry.savedContent = content;
    if (hash) entry.savedHash = hash;
    this.scheduleAutomatic(entry, "save");
  }

  unsaved(projectId: string | null): string[] {
    return [...this.documents.values()].filter((document) => (projectId === null || document.projectId === projectId) &&
      document.content !== document.savedContent).map((document) => document.path);
  }

  model(id: string, projectId: string | null, language: string): ToolModel {
    return this.models.get(modelKey(id, projectId, language)) ?? EMPTY;
  }

  async run(
    provider: PluginToolContribution, projectId: string | null, language: string, path: string | null,
    trigger: "manual" | "save" | "change" = "manual", useSaved = false,
  ): Promise<void> {
    const context = this.context(provider, projectId, language);
    const key = modelKey(provider.id, projectId, language);
    if (trigger === "manual") {
      this.automaticEpochs.set(`${key}:save`, ++this.automaticSequence);
      this.automaticEpochs.set(`${key}:change`, ++this.automaticSequence);
      const timer = this.timers.get(key);
      if (timer) clearTimeout(timer);
      this.timers.delete(key);
    }
    await this.cancelKey(key);
    const generation = this.generation;
    const pending: PendingRun = { controller: new AbortController(), provider, versions: new Map(), runId: null };
    this.pending.set(key, pending);
    const model: ToolModel = { ...EMPTY, status: "running", diagnostics: [], notices: [] };
    this.models.set(key, model); this.runs.delete(key); this.publish();
    const current = () => generation === this.generation && this.pending.get(key) === pending && !pending.controller.signal.aborted;
    try {
      const environment = await this.environment(provider, projectId, language);
      if (!current()) return;
      const configuration = environment.configuration;
      if (!configuration.enabled) throw new Error("Configure and approve this tool before running it.");
      const document = path ? this.documents.get(path) : undefined;
      if (provider.kind === "linter" && !document) throw new Error("Open a text source file before linting.");
      if (configuration.stdin && document && new TextEncoder().encode(document.content).length > 4 * 1024 * 1024) {
        throw new Error("Stdin linting supports source up to 4 MiB.");
      }
      if ((!configuration.stdin && this.unsaved(projectId).length) && !useSaved) {
        throw new Error("There are unsaved edits. Save all files or explicitly choose Run on saved files.");
      }
      const paths = [...new Set([...this.files, ...this.documents.keys()])].filter((file) => inside(file, environment.scope.rootPath));
      pending.versions = new Map([...this.documents.values()].filter((entry) => inside(entry.path, environment.scope.rootPath))
        .map((entry) => [entry.path, entry.version]));
      const run = await api.startToolSession(provider.pluginId, context, {
        paths, documentPath: path, input: configuration.stdin ? document?.content ?? null : null, trigger, rows: 24, cols: 80,
      });
      pending.runId = run.runId;
      if (!current()) return;
      model.runId = run.runId;
      const state: RunState = { provider, context, run, configuration, model };
      this.runs.set(key, state);
      let output;
      do {
        output = await api.pollToolSession(provider.pluginId, context, run.runId);
        if (!current()) return;
        for (const event of output.events) {
          if (event.stream === "stdout") model.stdout += event.data;
          else if (event.stream === "stderr") model.stderr += event.data;
          else throw new Error("A diagnostic run returned unexpected terminal output.");
        }
        if (new TextEncoder().encode(model.stdout + model.stderr).length > 8 * 1024 * 1024) throw new Error("Tool output exceeded 8 MiB.");
        model.exitCode = output.exitCode; model.error = output.error; this.publish();
        if (output.status === "running") await new Promise<void>((resolve) => setTimeout(resolve, 100));
      } while (output.status === "running" && current());
      if (!current()) return;
      model.status = output.status === "succeeded" && output.exitCode !== 0 ? "failed" : output.status;
      if (output.error || output.status === "cancelled") { this.publish(); return; }
      const documents = run.documents.map((snapshot) => ({
        ...snapshot, version: configuration.stdin && snapshot.path === path && document
          ? `memory-${pending.versions.get(path!)}` : snapshot.version,
      }));
      const request: PluginToolParseRequest = {
        runId: run.runId, scope: run.scope, format: configuration.format,
        stdout: model.stdout, stderr: model.stderr, documents,
      };
      const parsed = await this.parse!(provider.pluginId, provider.id, request, context.workspaceScope);
      if (!current()) return;
      if (!isToolParseResultFor(request, parsed)) throw new Error("Diagnostics belong to different files, versions, or execution run.");
      const changed = new Set(await api.validateToolDocuments(provider.pluginId, context,
        run.documents.filter((entry) => !(configuration.stdin && entry.path === path))));
      if (!current()) return;
      const diskVersions = new Map(run.documents.map((entry) => [entry.path, entry.version]));
      model.diagnostics = parsed.diagnostics.filter((diagnostic) => !changed.has(diagnostic.path)).map((diagnostic) => ({
        ...diagnostic, runId: run.runId, modelKey: key, memoryVersion: pending.versions.get(diagnostic.path) ?? null,
        diskVersion: diskVersions.get(diagnostic.path)!, stdin: configuration.stdin && diagnostic.path === path,
      })).filter((diagnostic) => this.diagnosticCurrent(diagnostic, true));
      model.notices = [...parsed.notices, ...(changed.size ? ["Source files changed during the run; their stale diagnostics were removed."] : [])];
      this.publish();
    } catch (error) {
      if (!current()) return;
      model.status = "failed"; model.error = errorMessage(error); model.diagnostics = []; this.publish();
      throw error;
    } finally {
      if (pending.runId) await api.stopToolSession(provider.pluginId, pending.runId);
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  diagnosticsForEditor(path: string): Array<PluginToolDiagnostic & { source: string }> {
    const document = this.documents.get(path);
    if (!document) return [];
    return [...this.runs.values()].flatMap((run) => run.model.diagnostics.filter((entry) =>
      entry.path === path && this.diagnosticCurrent(entry)).map((entry) => ({
        ...entry, range: normalizeToolRange(document.content, entry.range, run.configuration.columns),
        source: `${run.provider.title}${entry.rule ? ` (${entry.rule})` : ""}`,
      })));
  }

  async location(diagnostic: ToolDiagnostic): Promise<PluginCodeLocation> {
    const run = this.runs.get(diagnostic.modelKey);
    const generation = this.generation;
    if (!run || !this.diagnosticCurrent(diagnostic)) throw new Error("This diagnostic is stale. Run the tool again.");
    await this.checkDisk(diagnostic, run);
    const document = this.documents.get(diagnostic.path);
    let source = document?.content;
    if (source === undefined) {
      const saved = await api.readNote(diagnostic.path);
      if (saved.encoding !== "utf8" || saved.contentHash !== diagnostic.diskVersion) throw new Error("The diagnostic source changed. Run the tool again.");
      source = saved.content;
    }
    if (generation !== this.generation || !this.diagnosticCurrent(diagnostic)) throw new Error("The diagnostic context changed.");
    return { path: diagnostic.path, range: normalizeToolRange(source, diagnostic.range, run.configuration.columns) };
  }

  async previewFix(diagnostic: ToolDiagnostic): Promise<ToolFixPreview> {
    const run = this.runs.get(diagnostic.modelKey);
    const document = this.documents.get(diagnostic.path);
    if (!run || run.provider.kind !== "linter" || !document || !diagnostic.fix ||
        !this.diagnosticCurrent(diagnostic) || !this.editable(diagnostic.path)) {
      throw new Error("Open the current source in an editable Source view before previewing this fix.");
    }
    await this.checkDisk(diagnostic, run);
    if (!this.diagnosticCurrent(diagnostic)) throw new Error("Source changed before fix preview.");
    const raw = diagnostic.fix;
    if (raw.text.includes("\0") || /[\ud800-\udfff]/u.test(raw.text)) throw new Error("The fix contains invalid source text.");
    const fix = {
      from: diagnostic.stdin ? raw.from : normalizedFileOffset(document.content, raw.from, document.lineEnding),
      to: diagnostic.stdin ? raw.to : normalizedFileOffset(document.content, raw.to, document.lineEnding),
      text: raw.text.replace(/\r\n?/g, "\n"),
    };
    if (fix.to > document.content.length || splitSurrogate(document.content, fix.from) || splitSurrogate(document.content, fix.to)) {
      throw new Error("The linter proposed an invalid source range.");
    }
    const after = document.content.slice(0, fix.from) + fix.text + document.content.slice(fix.to);
    if (new TextEncoder().encode(after).length > 4 * 1024 * 1024) throw new Error("The proposed fix exceeds the 4 MiB source limit.");
    if (after === document.content) throw new Error("This fix makes no source change. Denote preserves the file's line-ending style.");
    const preview = Object.freeze({ diagnostic, version: document.version, before: document.content, after, fix: Object.freeze(fix) });
    this.previews.add(preview);
    return preview;
  }

  async applyFix(preview: ToolFixPreview): Promise<void> {
    const { diagnostic } = preview;
    const run = this.runs.get(diagnostic.modelKey);
    const document = this.documents.get(diagnostic.path);
    if (!this.previews.has(preview) || !run || !document || document.version !== preview.version || document.content !== preview.before ||
        !this.diagnosticCurrent(diagnostic) || !diagnostic.fix) throw new Error("Source or diagnostic run changed; this preview is stale.");
    await this.checkDisk(diagnostic, run);
    const editor = this.editable(diagnostic.path);
    if (!editor || document.version !== preview.version || !this.diagnosticCurrent(diagnostic)) {
      throw new Error("Source changed or became read-only; the fix was not applied.");
    }
    editor.apply(preview.before, preview.fix);
    this.previews.delete(preview);
  }

  async cancel(providerId: string, projectId: string | null, language: string): Promise<void> {
    await this.cancelKey(modelKey(providerId, projectId, language));
  }

  async resetProvider(providerId: string): Promise<void> {
    const prefix = `[${JSON.stringify(providerId)},`;
    for (const key of this.automaticEpochs.keys()) if (key.startsWith(prefix)) this.automaticEpochs.set(key, ++this.automaticSequence);
    await Promise.all([...this.pending].filter(([, pending]) => pending.provider.id === providerId)
      .map(([key]) => this.cancelKey(key)));
    for (const [key, timer] of this.timers) if (JSON.parse(key)[0] === providerId) { clearTimeout(timer); this.timers.delete(key); }
    for (const key of this.environments.keys()) if (JSON.parse(key)[0] === providerId) this.environments.delete(key);
    for (const [key, run] of this.runs) if (run.provider.id === providerId) { this.runs.delete(key); this.models.delete(key); }
    this.publish();
  }

  canApplyFix(preview: ToolFixPreview): boolean {
    return this.previews.has(preview) && this.documents.get(preview.diagnostic.path)?.version === preview.version &&
      this.diagnosticCurrent(preview.diagnostic) && Boolean(this.editable(preview.diagnostic.path));
  }

  private async cancelKey(key: string): Promise<void> {
    const pending = this.pending.get(key);
    if (!pending) return;
    pending.controller.abort();
    const model = this.models.get(key);
    if (model) { model.status = "cancelled"; model.error = "Tool cancelled."; model.diagnostics = []; this.publish(); }
    if (pending.runId) await api.stopToolSession(pending.provider.pluginId, pending.runId);
    else await api.stopToolSessions(pending.provider.pluginId);
  }

  private invalidate(path: string): void {
    for (const [key, pending] of this.pending) if (pending.versions.has(path)) void this.cancelKey(key).catch(this.reportError);
    for (const model of this.models.values()) model.diagnostics = model.diagnostics.filter((diagnostic) => diagnostic.path !== path);
    this.publish();
  }

  private diagnosticCurrent(diagnostic: ToolDiagnostic, unpublished = false): boolean {
    const run = this.runs.get(diagnostic.modelKey);
    if (!run || run.model.runId !== diagnostic.runId || (!unpublished && !run.model.diagnostics.includes(diagnostic))) return false;
    const document = this.documents.get(diagnostic.path);
    if (!document) return diagnostic.memoryVersion === null;
    if (diagnostic.memoryVersion !== null && document.version !== diagnostic.memoryVersion) return false;
    return diagnostic.stdin || (document.content === document.savedContent &&
      (document.savedHash === undefined || document.savedHash === diagnostic.diskVersion));
  }

  private editable(path: string): Editor | undefined {
    return [...(this.editors.get(path) ?? [])].find((editor) => !editor.readOnly());
  }

  private async checkDisk(diagnostic: ToolDiagnostic, run: RunState): Promise<void> {
    if (diagnostic.stdin) return;
    const changed = await api.validateToolDocuments(run.provider.pluginId, run.context, [{ path: diagnostic.path, version: diagnostic.diskVersion }]);
    if (changed.length) { this.invalidate(diagnostic.path); throw new Error("The saved source changed; the diagnostic and fix were discarded."); }
  }

  private scheduleAutomatic(document: Document, trigger: "save" | "change"): void {
    const generation = this.generation;
    for (const provider of this.providers) {
      const language = provider.kind === "build" ? "all" : toolLanguage(document.path);
      const key = modelKey(provider.id, document.projectId, language);
      const epochKey = `${key}:${trigger}`;
      const epoch = ++this.automaticSequence;
      this.automaticEpochs.set(epochKey, epoch);
      void (async () => {
        let projectId = document.projectId;
        let environment = await this.environment(provider, projectId, language);
        if (projectId !== null && !environment.configured) {
          projectId = null;
          environment = await this.environment(provider, projectId, language);
        }
        if (generation !== this.generation || this.automaticEpochs.get(epochKey) !== epoch ||
            !environment.configuration.enabled || environment.configuration.runOn !== trigger) return;
        const effectiveKey = modelKey(provider.id, projectId, language);
        const effectiveEpoch = `${effectiveKey}:${trigger}`;
        if ((this.automaticEpochs.get(effectiveEpoch) ?? 0) > epoch) return;
        this.automaticEpochs.set(effectiveEpoch, epoch);
        const old = this.timers.get(effectiveKey);
        if (old) clearTimeout(old);
        const timer = setTimeout(() => {
          this.timers.delete(effectiveKey);
          if (generation !== this.generation || this.documents.get(document.path) !== document) return;
          void this.run(provider, projectId, language, document.path, trigger).catch(this.reportError);
        }, trigger === "change" ? environment.configuration.debounceMs : 0);
        this.timers.set(effectiveKey, timer);
      })().catch((error) => { if (generation === this.generation) this.reportError(error); });
    }
  }

  private async validateDiagnostics(): Promise<void> {
    if (this.validating) return;
    this.validating = true;
    const generation = this.generation;
    try {
      for (const run of this.runs.values()) {
        const documents: PluginToolDocument[] = run.model.diagnostics.filter((diagnostic) => !diagnostic.stdin)
          .map((diagnostic) => ({ path: diagnostic.path, version: diagnostic.diskVersion }));
        if (!documents.length) continue;
        const changed = await api.validateToolDocuments(run.provider.pluginId, run.context, documents);
        if (generation !== this.generation) return;
        for (const path of changed) this.invalidate(path);
      }
    } finally { this.validating = false; }
  }

  dispose(): void {
    for (const key of this.pending.keys()) void this.cancelKey(key).catch(this.reportError);
    this.generation += 1;
    if (this.validationTimer) clearInterval(this.validationTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.automaticEpochs.clear(); this.documents.clear(); this.editors.clear(); this.models.clear(); this.runs.clear();
    this.environments.clear(); this.providers = []; this.workspace = null; this.parse = null; this.validationTimer = null;
  }
  private publish(): void { this.revision += 1; for (const listener of this.listeners) listener(); }
}

function splitSurrogate(source: string, offset: number): boolean {
  return offset > 0 && offset < source.length && /[\ud800-\udbff]/.test(source[offset - 1]) && /[\udc00-\udfff]/.test(source[offset]);
}

function normalizedFileOffset(source: string, offset: number, lineEnding: FileLineEnding = "lf"): number {
  if (lineEnding !== "crlf") return offset;
  let raw = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (raw === offset) return index;
    if (raw > offset || index === source.length) break;
    raw += source[index] === "\n" ? 2 : 1;
  }
  throw new Error("The fix range is outside the saved source or splits a CRLF line ending.");
}

export function normalizeToolRange(source: string, range: PluginCodeRange, encoding: ToolConfiguration["columns"]): PluginCodeRange {
  const lines = source.split("\n");
  const convert = (position: PluginCodeRange["start"]) => {
    const line = lines[position.line];
    if (line === undefined) throw new Error("Tool diagnostic line is outside the captured source.");
    if (encoding === "utf16") {
      if (position.character > line.length || splitSurrogate(line, position.character)) throw new Error("Tool diagnostic column is outside the source.");
      return position;
    }
    let units = 0;
    let offset = 0;
    for (const character of line) {
      if (units >= position.character) break;
      units += encoding === "utf8" ? new TextEncoder().encode(character).length : 1;
      offset += character.length;
    }
    if (units !== position.character) throw new Error("Tool diagnostic column is outside the source or splits a character.");
    return { line: position.line, character: offset };
  };
  return { start: convert(range.start), end: convert(range.end) };
}
