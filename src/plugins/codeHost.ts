import {
  MAX_CODE_SOURCE_BYTES, codeLanguageForPath,
  type PluginCodeDocument, type PluginCodeFeature, type PluginCodeLanguage,
  type PluginCodeOperation, type PluginCodePosition, type PluginCodeRequest,
  type PluginCodeResult, type PluginCodeScope, type PluginCodeTextEdit,
} from "@denote/plugin-sdk";
import { api, errorMessage } from "../lib/api";
import type { CodeToolEnvironment } from "../lib/codeTools";
import type { PluginCodeContribution } from "./codeIntelligence";

type Execute = (pluginId: string, providerId: string, request: PluginCodeRequest, workspaceScope: string, signal?: AbortSignal) => Promise<PluginCodeResult>;
interface EditorAdapter {
  apply: (source: string, edits: PluginCodeTextEdit[]) => void;
  readOnly: () => boolean;
}
interface OpenCodeDocument {
  cursor: PluginCodePosition;
  document: PluginCodeDocument;
  projectId: string | null;
  editors: Set<EditorAdapter>;
  timer: ReturnType<typeof setTimeout> | null;
}
interface Profile {
  scope: PluginCodeScope;
  language: PluginCodeLanguage;
  projectId: string | null;
  path: string | null;
  result: PluginCodeResult;
  fingerprint: string;
  polling: boolean;
}

const STOPPED: PluginCodeResult = { status: "Language server is not running.", capabilities: [], diagnostics: [] };

export class CodeIntelligenceHost {
  private provider: PluginCodeContribution | null = null;
  private execute: Execute | null = null;
  private workspace: string | null = null;
  private projectIdentity = "";
  private encrypted = false;
  private generation = 0;
  private version = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly documents = new Map<string, OpenCodeDocument>();
  private readonly environments = new Map<string, Promise<CodeToolEnvironment>>();
  private readonly profiles = new Map<string, Profile>();
  private readonly pending = new Map<string, Set<AbortController>>();
  private tooltipEntries: Array<{ id: string; element: HTMLElement; markdown: string }> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly reportError: (error: unknown) => void = (error) => console.error("Code intelligence:", error)) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getRevision = (): number => this.revision;
  context(): { workspaceScope: string } {
    if (!this.workspace || this.encrypted) throw new Error("Code tool context is unavailable.");
    return { workspaceScope: this.workspace };
  }

  configure(provider: PluginCodeContribution | null, execute: Execute, workspace: string | null, projectIdentity: string, encrypted: boolean): void {
    const changed = provider !== this.provider || workspace !== this.workspace ||
      projectIdentity !== this.projectIdentity || encrypted !== this.encrypted;
    const clearDocuments = workspace !== this.workspace || encrypted || provider === null;
    this.execute = execute;
    if (!changed) return;
    this.cancelAll();
    this.generation += 1;
    this.provider = provider; this.workspace = workspace; this.projectIdentity = projectIdentity; this.encrypted = encrypted;
    this.environments.clear(); this.profiles.clear();
    this.tooltipEntries = [];
    if (clearDocuments) {
      for (const entry of this.documents.values()) if (entry.timer) clearTimeout(entry.timer);
      this.documents.clear();
    }
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.publish();
  }

  attach(path: string, projectId: string | null, source: string, editor: EditorAdapter): () => Promise<void> {
    const language = codeLanguageForPath(path);
    if (!language || !this.provider || this.encrypted) return async () => {};
    if (new TextEncoder().encode(source).length > MAX_CODE_SOURCE_BYTES) {
      throw new Error("Code intelligence supports source files up to 4 MiB. The source editor remains available.");
    }
    let entry = this.documents.get(path);
    if (!entry) {
      if (this.documents.size >= 100) throw new Error("Close unused source files before adding more code-intelligence documents.");
      entry = { document: { path, language, version: ++this.version, text: source }, projectId, editors: new Set(), timer: null, cursor: { line: 0, character: 0 } };
      this.documents.set(path, entry);
    }
    entry.editors.add(editor);
    const attached = entry;
    if ([...this.profiles.values()].some((profile) => profile.projectId === projectId &&
        profile.language === language && this.active(profile.scope, language))) {
      const generation = this.generation;
      void this.environment(language, projectId, path).then((environment) => {
        if (generation !== this.generation || this.documents.get(path) !== attached || !this.active(environment.scope, language)) return;
        return this.run(language, projectId, path, "open");
      }).catch((error) => { if (generation === this.generation && !cancelled(error)) this.reportError(error); });
    }
    return async () => {
      attached.editors.delete(editor);
      if (attached.editors.size || this.documents.get(path) !== attached) return;
      this.documents.delete(path);
      if (attached.timer) clearTimeout(attached.timer);
      this.cancelPath(path);
      if (!this.provider || !this.workspace || this.encrypted) return;
      if (![...this.profiles.values()].some((profile) => profile.projectId === projectId &&
          profile.language === language && this.active(profile.scope, language))) return;
      const generation = this.generation;
      try {
        const environment = await this.environment(language, projectId, path);
        if (generation !== this.generation || this.documents.has(path) || !this.active(environment.scope, language)) return;
        await this.send({ operation: "close", language, scope: environment.scope, document: attached.document });
      } catch (error) {
        if (generation === this.generation && !cancelled(error)) this.reportError(error);
      }
    };
  }

  document(path: string): PluginCodeDocument | null {
    const document = this.documents.get(path)?.document;
    return document ? { ...document } : null;
  }

  cursor(path: string): PluginCodePosition {
    return this.documents.get(path)?.cursor ?? { line: 0, character: 0 };
  }
  setCursor(path: string, position: PluginCodePosition): void {
    const entry = this.documents.get(path);
    if (entry) entry.cursor = position;
  }
  canEdit(path: string): boolean {
    return [...(this.documents.get(path)?.editors ?? [])].some((editor) => !editor.readOnly());
  }
  addTooltip(element: HTMLElement, markdown: string): () => void {
    const id = crypto.randomUUID();
    this.tooltipEntries = [...this.tooltipEntries, { id, element, markdown }];
    this.publish();
    return () => { this.tooltipEntries = this.tooltipEntries.filter((entry) => entry.id !== id); this.publish(); };
  }
  tooltips(): typeof this.tooltipEntries { return this.tooltipEntries; }

  update(path: string, source: string): void {
    const entry = this.documents.get(path);
    if (!entry || entry.document.text === source) return;
    this.cancelPath(path);
    entry.document = { ...entry.document, version: ++this.version, text: source };
    for (const profile of this.profiles.values()) {
      if (profile.path === path) {
        profile.result = { ...profile.result, diagnostics: [] };
        profile.fingerprint = "";
      }
    }
    this.publish();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const generation = this.generation;
      void this.environment(entry.document.language, entry.projectId, path).then((environment) => {
        if (generation !== this.generation || !this.active(environment.scope, entry.document.language)) return;
        return this.run(entry.document.language, entry.projectId, path, "change");
      }).catch((error) => {
        if (generation === this.generation && !cancelled(error)) this.reportError(error);
      });
    }, 120);
  }

  async saved(path: string): Promise<void> {
    const entry = this.documents.get(path);
    if (!entry) return;
    const environment = await this.environment(entry.document.language, entry.projectId, path);
    if (this.active(environment.scope, entry.document.language)) await this.run(entry.document.language, entry.projectId, path, "save");
  }

  environment(language: PluginCodeLanguage, projectId: string | null, path: string | null, refresh = false): Promise<CodeToolEnvironment> {
    if (this.encrypted) return Promise.reject(new Error("Native code tools are unavailable in encrypted vaults. No plaintext project mirror is created."));
    const provider = this.provider;
    const workspace = this.workspace;
    if (!provider || !workspace || !provider.languages.some((adapter) => adapter.id === language)) {
      return Promise.reject(new Error("Enable a code intelligence provider for this language first."));
    }
    const key = `${language}\u0000${projectId ?? ""}\u0000${path ?? ""}`;
    const cached = this.environments.get(key);
    if (cached && !refresh) return cached;
    const generation = this.generation;
    const operation = api.codeToolEnvironment(provider.pluginId, {
      workspaceScope: workspace, projectId, documentPath: path, language,
    }).then((environment) => {
      if (generation !== this.generation) throw new DOMException("Code scope changed.", "AbortError");
      return environment;
    }).catch((error) => { if (this.environments.get(key) === operation) this.environments.delete(key); throw error; });
    this.environments.set(key, operation);
    return operation;
  }

  model(scope: PluginCodeScope, language: PluginCodeLanguage): PluginCodeResult {
    return this.profiles.get(profileKey(scope, language))?.result ?? STOPPED;
  }

  async modelForDocument(path: string): Promise<PluginCodeResult> {
    const entry = this.documents.get(path);
    if (!entry) return STOPPED;
    const environment = await this.environment(entry.document.language, entry.projectId, path);
    return this.model(environment.scope, entry.document.language);
  }

  async run(
    language: PluginCodeLanguage, projectId: string | null, path: string | null, operation: PluginCodeOperation,
    extras: Pick<PluginCodeRequest, "position" | "query" | "debug"> = {}, signal?: AbortSignal,
  ): Promise<PluginCodeResult> {
    const environment = await this.environment(language, projectId, path);
    const document = path ? this.document(path) : null;
    if (document && document.language !== language) throw new Error("Open a source file for the selected language first.");
    if (path && !document && !["poll", "stop", "workspace-symbols"].includes(operation)) {
      throw new Error("Open the supported source file before requesting code intelligence.");
    }
    const result = await this.send({
      operation, language, scope: environment.scope, ...(document ? { document } : {}), ...extras,
    }, signal);
    if (operation === "stop") this.profiles.delete(profileKey(environment.scope, language));
    else if (operation !== "close") this.updateProfile(environment, projectId, path, result);
    this.startPolling();
    return result;
  }

  async query(path: string, feature: PluginCodeFeature, position?: PluginCodePosition, signal?: AbortSignal): Promise<PluginCodeResult | null> {
    const entry = this.documents.get(path);
    if (!entry) return null;
    const environment = await this.environment(entry.document.language, entry.projectId, path);
    if (this.documents.get(path) !== entry) throw new DOMException("The source file closed.", "AbortError");
    if (!this.model(environment.scope, entry.document.language).capabilities?.includes(feature)) return null;
    return this.run(entry.document.language, entry.projectId, path, feature, position ? { position } : {}, signal);
  }

  async format(path: string): Promise<void> {
    const entry = this.documents.get(path);
    const editor = entry && [...entry.editors].find((adapter) => !adapter.readOnly());
    if (!entry || !editor) throw new Error("Formatting is unavailable in read mode or a closed source file.");
    const document = { ...entry.document };
    const result = await this.run(document.language, entry.projectId, path, "format");
    if (this.documents.get(path) !== entry || entry.document.version !== document.version ||
        entry.document.text !== document.text) throw new Error("The source changed; stale formatting was discarded.");
    if (editor.readOnly()) throw new Error("Read mode was enabled before formatting completed.");
    if (!result.edits) throw new Error(result.status);
    editor.apply(document.text, result.edits);
  }

  dispose(): void {
    this.cancelAll();
    this.generation += 1;
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const entry of this.documents.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pollTimer = null;
    this.documents.clear(); this.profiles.clear(); this.environments.clear(); this.listeners.clear();
    this.tooltipEntries = [];
    this.provider = null; this.workspace = null;
  }
  cancelPendingRequests(): void { this.cancelAll(); }

  private async send(request: PluginCodeRequest, signal?: AbortSignal): Promise<PluginCodeResult> {
    const provider = this.provider, execute = this.execute, workspace = this.workspace;
    if (!provider || !execute || !workspace || this.encrypted) throw new Error("Code intelligence is unavailable.");
    const generation = this.generation;
    const controller = new AbortController();
    const key = request.document?.path ?? `scope:${profileKey(request.scope, request.language)}`;
    let pending = this.pending.get(key);
    if (!pending) { pending = new Set(); this.pending.set(key, pending); }
    pending.add(controller);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await execute(provider.pluginId, provider.id, request, workspace, controller.signal);
      if (generation !== this.generation || controller.signal.aborted ||
          (request.document && request.operation !== "close" &&
            this.documents.get(request.document.path)?.document.version !== request.document.version)) {
        throw new DOMException("The document changed or the code request was cancelled.", "AbortError");
      }
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      pending.delete(controller);
      if (!pending.size) this.pending.delete(key);
    }
  }

  private updateProfile(environment: CodeToolEnvironment, projectId: string | null, path: string | null, result: PluginCodeResult): void {
    const key = profileKey(environment.scope, environment.language);
    const previous = this.profiles.get(key);
    const fingerprint = JSON.stringify(result);
    const profile = {
      scope: environment.scope, language: environment.language, projectId, path,
      result, fingerprint, polling: previous?.polling ?? false,
    };
    const changed = previous?.fingerprint !== fingerprint;
    if (previous) Object.assign(previous, profile);
    else this.profiles.set(key, profile);
    if (changed) this.publish();
  }
  private active(scope: PluginCodeScope, language: PluginCodeLanguage): boolean {
    const model = this.model(scope, language);
    return Boolean(model.capabilities?.length || (model.debug && model.debug.state !== "terminated"));
  }
  private startPolling(): void {
    if (this.pollTimer || ![...this.profiles.values()].some((profile) => this.active(profile.scope, profile.language))) return;
    this.pollTimer = setInterval(() => {
      for (const profile of this.profiles.values()) {
        if (profile.polling || !this.active(profile.scope, profile.language)) continue;
        profile.polling = true;
        void this.run(profile.language, profile.projectId, profile.path, "poll").catch((error) => {
          if (cancelled(error)) return;
          profile.result = { status: `${errorMessage(error)} Restart the tool.`, capabilities: [], diagnostics: [],
            ...(profile.result.debug ? { debug: { ...profile.result.debug, state: "terminated" } } : {}) };
          this.publish();
        }).finally(() => { profile.polling = false; });
      }
    }, 500);
  }
  private cancelPath(path: string): void {
    for (const controller of this.pending.get(path) ?? []) controller.abort();
  }
  private cancelAll(): void {
    for (const pending of this.pending.values()) for (const controller of pending) controller.abort();
    this.pending.clear();
  }
  private publish(): void { this.revision += 1; for (const listener of this.listeners) listener(); }
}

export function codeRequestCancelled(error: unknown): boolean {
  return cancelled(error);
}
function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
function profileKey(scope: PluginCodeScope, language: PluginCodeLanguage): string {
  return `${scope.projectId ? `project:${scope.projectId}` : `root:${scope.rootPath}`}\u0000${language}`;
}
