import {
  MAX_CODE_LOGS, MAX_CODE_RESULTS, codeDocumentUri, record,
  type PluginCodeDiagnostic, type PluginCodeDocument, type PluginCodeFeature,
  type PluginCodeProvider, type PluginCodeRequest, type PluginCodeResult,
} from "@denote/plugin-sdk";
import { DebugSession } from "./debugger";
import {
  FEATURE_METHODS, completions, diagnostics, documentation, languageId, locations, pathFromUri, serverFeatures, textEdits,
} from "./protocol";

type Context = Parameters<PluginCodeProvider["run"]>[1];
interface LanguageSession {
  running: boolean;
  id: string;
  capabilities: Record<string, unknown>;
  features: PluginCodeFeature[];
  documents: Map<string, PluginCodeDocument>;
  firstVersions: Map<string, number>;
  diagnostics: Map<string, PluginCodeDiagnostic[]>;
  logs: string[];
  notices: string[];
  status: string;
}

export class CodeIntelligenceController {
  private readonly languages = new Map<string, LanguageSession>();
  private readonly debuggers = new Map<string, DebugSession>();
  private readonly starts = new Map<string, Promise<LanguageSession>>();
  private generation = 0;

  clear(): void {
    this.generation += 1;
    this.languages.clear(); this.debuggers.clear(); this.starts.clear();
  }

  async run(request: PluginCodeRequest, context: Context): Promise<PluginCodeResult> {
    const key = `${request.scope.projectId ?? request.scope.rootPath}\u0000${request.language}`;
    if (request.operation === "restart" || request.operation === "stop") {
      const debuggerSession = this.debuggers.get(key);
      if (debuggerSession) { await context.transport.stop(debuggerSession.id); this.debuggers.delete(key); }
      const session = this.languages.get(key);
      if (session) { await context.transport.stop(session.id); this.languages.delete(key); }
      if (request.operation === "stop") return { status: "Language integration stopped.", diagnostics: [] };
    }
    if (request.operation === "start" || request.operation === "restart") {
      const session = await this.start(key, request, context);
      return this.model(session, request, this.debuggers.get(key));
    }
    if (request.operation === "debug") {
      await this.debug(key, request, context);
      return this.model(this.languages.get(key), request, this.debuggers.get(key));
    }
    const session = this.languages.get(key);
    if (request.operation === "poll") {
      if (session?.running) {
        if (request.document) await this.sync(session, request.document, context);
        await this.poll(session, context);
      }
      const debuggerSession = this.debuggers.get(key);
      if (debuggerSession && !debuggerSession.terminated) {
        await debuggerSession.poll(context);
        if (debuggerSession.terminated) {
          await context.transport.stop(debuggerSession.id);
        }
      }
      return this.model(session, request, debuggerSession);
    }
    if (request.operation === "close") {
      if (session && request.document && session.documents.has(request.document.path)) {
        session.documents.delete(request.document.path);
        session.firstVersions.delete(request.document.path);
        session.diagnostics.delete(request.document.path);
        await context.transport.notify(session.id, "textDocument/didClose", { textDocument: { uri: codeDocumentUri(request.document.path) } });
      }
      return this.model(session, request);
    }
    if (!session) {
      if (["open", "change", "save"].includes(request.operation)) return { status: "Start the language server to enable code intelligence." };
      throw new Error("Start the language server in Code intelligence before requesting this feature.");
    }
    if (request.document) await this.sync(session, request.document, context);
    if (request.operation === "save") {
      const sync = session.capabilities.textDocumentSync;
      const includeText = record(sync) && record(sync.save) && sync.save.includeText === true;
      if (request.document) await context.transport.notify(session.id, "textDocument/didSave", {
        textDocument: { uri: codeDocumentUri(request.document.path) }, ...(includeText ? { text: request.document.text } : {}),
      });
      return this.model(session, request);
    }
    if (request.operation === "change" || request.operation === "open") return this.model(session, request);
    const feature = request.operation as PluginCodeFeature;
    if (!session.features.includes(feature)) return {
      ...this.model(session, request), status: `This language server does not support ${feature.replaceAll("-", " ")}.`,
    };
    if (feature === "diagnostics" && !session.capabilities.diagnosticProvider) {
      await this.poll(session, context);
      return this.model(session, request);
    }
    const params = feature === "workspace-symbols" ? { query: request.query ?? "" } : {
      textDocument: { uri: codeDocumentUri(requiredDocument(request).path) },
      ...(request.position ? { position: request.position } : {}),
      ...(feature === "references" ? { context: { includeDeclaration: true } } : {}),
      ...(feature === "format" ? { options: { tabSize: 2, insertSpaces: true } } : {}),
      ...(feature === "completion" ? { context: { triggerKind: 1 } } : {}),
    };
    if (["completion", "hover", "signature", "definition", "declaration", "implementation", "type-definition", "references"].includes(feature) && !request.position) {
      throw new Error("Place the cursor in a source file before requesting code intelligence.");
    }
    const generation = this.generation;
    const response = await context.transport.request(session.id, FEATURE_METHODS[feature], params);
    this.check(context);
    if (generation !== this.generation || this.languages.get(key) !== session ||
        (request.document && session.documents.get(request.document.path)?.version !== request.document.version)) {
      throw new Error("The document changed or closed; stale code results were discarded.");
    }
    const model = this.model(session, request, this.debuggers.get(key));
    if (["definition", "declaration", "implementation", "type-definition", "references", "symbols", "workspace-symbols"].includes(feature)) {
      const found = locations(response, request);
      return { ...model, status: found.length ? `${found.length} result${found.length === 1 ? "" : "s"}.` : "No results.",
        locations: found, ...(found.length >= MAX_CODE_RESULTS ? { notices: ["Results are limited to 500. Narrow the symbol query."] } : {}) };
    }
    if (feature === "completion") return { ...model, completions: completions(response, requiredDocument(request), request.position!) };
    if (feature === "hover") return { ...model, hover: documentation(record(response) ? response.contents : response) };
    if (feature === "signature") {
      if (response === null) return { ...model, signatures: [] };
      if (!record(response) || !Array.isArray(response.signatures)) throw new Error("The server returned invalid signature help.");
      return { ...model, signatures: response.signatures.slice(0, 32).map((item) => {
        if (!record(item) || typeof item.label !== "string") throw new Error("The server returned an invalid signature label.");
        return item.label.slice(0, 4096);
      }) };
    }
    if (feature === "format") return { ...model, edits: textEdits(response) };
    if (feature === "diagnostics") {
      if (!record(response) || !Array.isArray(response.items)) throw new Error("The server returned invalid document diagnostics.");
      const found = diagnostics(response.items);
      if (request.document) session.diagnostics.set(request.document.path, found);
      return { ...model, diagnostics: found };
    }
    return model;
  }

  private async start(key: string, request: PluginCodeRequest, context: Context): Promise<LanguageSession> {
    const existing = this.languages.get(key);
    if (existing?.running) {
      if (request.document) await this.sync(existing, request.document, context);
      return existing;
    }
    if (existing) { this.languages.delete(key); await context.transport.stop(existing.id); }
    const pending = this.starts.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const operation = (async () => {
      const started = await context.transport.start("lsp");
      try {
        this.check(context);
        const response = await context.transport.request(started.sessionId, "initialize", {
          processId: null, clientInfo: { name: "Denote" },
          rootUri: `denote://vault/${started.rootPath.split("/").map(encodeURIComponent).join("/")}`,
          workspaceFolders: [{ uri: `denote://vault/${started.rootPath.split("/").map(encodeURIComponent).join("/")}`, name: started.rootPath || "Vault" }],
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: true },
              completion: { dynamicRegistration: false, completionItem: { snippetSupport: false } },
              hover: { contentFormat: ["plaintext", "markdown"] },
              signatureHelp: { signatureInformation: { documentationFormat: ["plaintext"] } },
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              definition: { linkSupport: true }, declaration: { linkSupport: true },
              implementation: { linkSupport: true }, typeDefinition: { linkSupport: true },
              publishDiagnostics: { versionSupport: true },
              diagnostic: { dynamicRegistration: false },
            },
          },
        });
        if (!record(response) || !record(response.capabilities)) throw new Error("Language server initialization returned invalid capabilities.");
        if (response.capabilities.positionEncoding && response.capabilities.positionEncoding !== "utf-16") {
          throw new Error("This server selected a non-UTF-16 position encoding. Configure a UTF-16-compatible adapter.");
        }
        this.check(context);
        if (generation !== this.generation) throw new Error("Code session start cancelled after a project change.");
        const session: LanguageSession = {
          running: true,
          id: started.sessionId, capabilities: response.capabilities, features: serverFeatures(response.capabilities),
          documents: new Map(), firstVersions: new Map(), diagnostics: new Map(), logs: [], notices: [], status: "Language server ready.",
        };
        await context.transport.notify(session.id, "initialized", {});
        if (request.document) await this.sync(session, request.document, context);
        this.languages.set(key, session);
        return session;
      } catch (error) { await context.transport.stop(started.sessionId); throw error; }
    })();
    this.starts.set(key, operation);
    try { return await operation; }
    finally { if (this.starts.get(key) === operation) this.starts.delete(key); }
  }

  private async sync(session: LanguageSession, document: PluginCodeDocument, context: Context): Promise<void> {
    this.check(context);
    const previous = session.documents.get(document.path);
    if (previous && document.version < previous.version) throw new Error("Stale source document version.");
    if (previous?.version === document.version) {
      if (previous.text !== document.text) throw new Error("A document version cannot represent different source bytes.");
      return;
    }
    const aggregate = [...session.documents.values()].reduce((sum, item) => sum + item.text.length, 0) - (previous?.text.length ?? 0) + document.text.length;
    if ((!previous && session.documents.size >= 100) || aggregate > 64 * 1024 * 1024) throw new Error("Language-server document memory limit reached. Close unused files.");
    session.documents.set(document.path, { ...document });
    session.diagnostics.delete(document.path);
    const uri = codeDocumentUri(document.path);
    if (!previous) {
      session.firstVersions.set(document.path, document.version);
      await context.transport.notify(session.id, "textDocument/didOpen", { textDocument: {
        uri, languageId: languageId(document), version: document.version, text: document.text,
      } });
    } else {
      const sync = session.capabilities.textDocumentSync;
      const kind = typeof sync === "number" ? sync : record(sync) ? sync.change : 1;
      const oldLines = previous.text.split("\n");
      await context.transport.notify(session.id, "textDocument/didChange", {
        textDocument: { uri, version: document.version },
        contentChanges: [{ ...(kind === 2 ? { range: { start: { line: 0, character: 0 },
          end: { line: oldLines.length - 1, character: oldLines.at(-1)?.length ?? 0 } } } : {}), text: document.text }],
      });
    }
  }

  private async poll(session: LanguageSession, context: Context): Promise<void> {
    for (const event of await context.transport.poll(session.id)) {
      this.check(context);
      if (event.kind === "exit") {
        session.running = false;
        session.status = event.text ?? "Language server exited. Restart it.";
        session.features = []; session.documents.clear(); session.diagnostics.clear();
      } else if (event.kind === "log") session.logs = [...session.logs, (event.text ?? "").slice(0, 8192)].slice(-MAX_CODE_LOGS);
      else if (record(event.message)) {
        const message = event.message;
        const params = record(message.params) ? message.params : {};
        if (message.method === "textDocument/publishDiagnostics") {
          const path = pathFromUri(params.uri);
          const document = session.documents.get(path);
          if (!document) continue;
          if (params.version !== document.version &&
              !(params.version === undefined && session.firstVersions.get(path) === document.version)) {
            if (params.version === undefined) session.notices = ["Diagnostic updates without document versions were discarded after edits."];
            continue;
          }
          session.diagnostics.set(path, diagnostics(params.diagnostics));
        } else if (message.id !== undefined && (typeof message.id === "number" || typeof message.id === "string")) {
          await context.transport.respond(session.id, message.id, message.method === "workspace/applyEdit" ?
            { applied: false, failureReason: "Denote applies only explicit, version-checked formatting actions." } :
            message.method === "workspace/configuration" && Array.isArray(params.items) ? params.items.map(() => null) : null);
        } else if (message.method === "window/logMessage" || message.method === "window/showMessage") {
          session.logs = [...session.logs, String(params.message ?? "").slice(0, 8192)].slice(-MAX_CODE_LOGS);
        }
      }
    }
  }

  private async debug(key: string, request: PluginCodeRequest, context: Context): Promise<void> {
    const command = request.debug?.command;
    if (command === "launch" || command === "attach") {
      if (this.debuggers.get(key)?.model.state !== "terminated" && this.debuggers.has(key)) throw new Error("Stop the current debugger before starting another.");
      const started = await context.transport.start("dap");
      const session = new DebugSession(started.sessionId);
      this.debuggers.set(key, session);
      try { await session.start(request, context); }
      catch (error) { await context.transport.stop(session.id); this.debuggers.delete(key); throw error; }
      return;
    }
    const session = this.debuggers.get(key);
    if (!session || session.model.state === "terminated") throw new Error("Launch or attach an approved debugger first.");
    await session.action(request, context);
  }

  private model(session: LanguageSession | undefined, request: PluginCodeRequest, debuggerSession?: DebugSession): PluginCodeResult {
    return {
      status: session?.status ?? "Language server is not running.",
      capabilities: session?.features ?? [],
      diagnostics: request.document ? session?.diagnostics.get(request.document.path) ?? [] : [],
      logs: [...(session?.logs ?? [])], notices: [...(session?.notices ?? [])],
      ...(debuggerSession ? { debug: structuredClone(debuggerSession.model) } : {}),
    };
  }
  private check(context: Context): void {
    if (context.signal.aborted) throw new Error("Code request cancelled.");
  }
}

function requiredDocument(request: PluginCodeRequest): PluginCodeDocument {
  if (!request.document) throw new Error("Open a source document first.");
  return request.document;
}
