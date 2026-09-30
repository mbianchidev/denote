import {
  MAX_CODE_RESULTS, codeDocumentUri, record,
  type PluginCodeProvider, type PluginCodeRequest, type PluginDebugModel,
} from "@denote/plugin-sdk";
import { pathFromUri } from "./protocol";

type Context = Parameters<PluginCodeProvider["run"]>[1];

export class DebugSession {
  model: PluginDebugModel = {
    state: "starting", capabilities: [], threads: [], frames: [], scopes: [],
    variables: [], breakpoints: [], output: [],
  };
  initialized = false;
  threadId: number | null = null;
  generation = 0;
  private mode: "launch" | "attach" = "launch";

  constructor(readonly id: string) {}
  get terminated(): boolean { return this.model.state === "terminated"; }

  async start(request: PluginCodeRequest, context: Context): Promise<void> {
    const capabilities = await context.transport.request(this.id, "initialize", {
      clientID: "denote", clientName: "Denote", adapterID: request.language,
      pathFormat: "path", linesStartAt1: true, columnsStartAt1: true,
      supportsVariablePaging: true, supportsRunInTerminalRequest: false,
      supportsStartDebuggingRequest: false, supportsProgressReporting: false,
      supportsTerminateDebuggee: true,
    });
    if (!record(capabilities)) throw new Error("The debugger returned invalid initialization capabilities.");
    this.model.capabilities = Object.entries(capabilities).filter(([, value]) => value === true).map(([key]) => key).slice(0, 64);
    this.mode = request.debug?.command === "attach" ? "attach" : "launch";
    const launch = context.transport.request(this.id, this.mode, {});
    // Some adapters hold launch until initialized/configurationDone. Keep its
    // rejection observed while configuration is being negotiated.
    let launchError: unknown;
    let launchSettled = false;
    void launch.then(() => { launchSettled = true; }, (error) => { launchError = error; launchSettled = true; });
    const deadline = Date.now() + 15_000;
    while (!this.initialized) {
      this.check(context);
      if (launchError) throw launchError;
      await this.poll(context);
      if (this.initialized) break;
      if (launchSettled && !this.model.capabilities.includes("supportsConfigurationDoneRequest")) break;
      if (Date.now() > deadline) throw new Error("Debugger initialization timed out. Check its adapter arguments and launch configuration.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const initial = request.debug?.arguments;
    if (record(initial) && Array.isArray(initial.breakpointGroups)) {
      for (const group of initial.breakpointGroups.slice(0, 100)) {
        if (!record(group) || !record(group.source) || !Array.isArray(group.breakpoints)) {
          throw new Error("Invalid debugger breakpoint group.");
        }
        await this.action({ ...request, debug: { command: "setBreakpoints", arguments: group } }, context);
      }
    }
    if (request.document && record(initial) && Array.isArray(initial.breakpoints) && initial.breakpoints.length) {
      await this.action({ ...request, debug: { command: "setBreakpoints", arguments: {
        source: { path: codeDocumentUri(request.document.path) }, breakpoints: initial.breakpoints,
      } } }, context);
    }
    if (record(initial) && Array.isArray(initial.exceptionFilters)) {
      await context.transport.request(this.id, "setExceptionBreakpoints", { filters: initial.exceptionFilters });
    }
    if (this.model.capabilities.includes("supportsConfigurationDoneRequest")) {
      await context.transport.request(this.id, "configurationDone", {});
    }
    await launch;
    this.check(context);
    if (this.model.state === "starting") this.model.state = "running";
  }

  async poll(context: Context): Promise<void> {
    for (const event of await context.transport.poll(this.id)) {
      this.check(context);
      if (event.kind === "exit") {
        this.model.state = "terminated";
        this.clearReferences();
        this.output(event.text ?? "Debugger stopped.");
      } else if (event.kind === "log") this.output(event.text ?? "");
      else if (record(event.message)) {
        const body = record(event.message.body) ? event.message.body : {};
        switch (event.message.event) {
          case "initialized": this.initialized = true; break;
          case "stopped":
            this.generation += 1;
            this.model.stopEpoch = this.generation;
            this.clearReferences();
            this.model.state = "stopped";
            this.threadId = typeof body.threadId === "number" ? body.threadId : null;
            if (body.reason === "exception") this.model.exception = String(body.description ?? body.text ?? "Exception").slice(0, 8192);
            break;
          case "continued":
            this.generation += 1;
            this.model.stopEpoch = this.generation;
            this.model.state = "running";
            this.clearReferences();
            break;
          case "terminated":
          case "exited":
            this.generation += 1;
            this.model.stopEpoch = this.generation;
            this.model.state = "terminated";
            this.clearReferences();
            break;
          case "output": this.output(String(body.output ?? "")); break;
          case "capabilities":
            if (record(body.capabilities)) this.model.capabilities = [...new Set([
              ...this.model.capabilities, ...Object.entries(body.capabilities).filter(([, value]) => value === true).map(([key]) => key),
            ])].slice(0, 64);
            break;
        }
      }
    }
  }

  async action(request: PluginCodeRequest, context: Context): Promise<void> {
    const command = request.debug?.command;
    if (!command) throw new Error("Choose a debugger action.");
    const args = { ...(request.debug?.arguments ?? {}) };
    if (command === "restart" && !this.model.capabilities.includes("supportsRestartRequest")) {
      throw new Error("This debugger does not support restart. Stop it and explicitly launch again.");
    }
    if (command === "setBreakpoints" && Array.isArray(args.breakpoints)) {
      for (const breakpoint of args.breakpoints) {
        if (!record(breakpoint) || !Number.isSafeInteger(breakpoint.line) || Number(breakpoint.line) < 1) throw new Error("Breakpoints need positive source lines.");
        if (breakpoint.condition && !this.model.capabilities.includes("supportsConditionalBreakpoints")) throw new Error("This debugger does not support conditional breakpoints.");
        if (breakpoint.logMessage && !this.model.capabilities.includes("supportsLogPoints")) throw new Error("This debugger does not support logpoints.");
      }
    }
    if (command === "exceptionInfo" && !this.model.capabilities.includes("supportsExceptionInfoRequest")) throw new Error("This debugger does not support exception details.");
    if (command === "evaluate" && args.context === "watch" &&
        !this.model.capabilities.includes("supportsEvaluateForHovers") && this.model.state !== "stopped") {
      throw new Error("Pause the debugger before evaluating a watch.");
    }
    if (["continue", "pause", "next", "stepIn", "stepOut", "stackTrace", "exceptionInfo"].includes(command)) {
      args.threadId ??= this.threadId ?? this.model.threads[0]?.id;
      if (args.threadId === undefined) throw new Error("Select a debugger thread first.");
    }
    if (["next", "stepIn", "stepOut", "stackTrace", "scopes", "variables", "evaluate", "exceptionInfo"].includes(command) &&
        this.model.state !== "stopped") throw new Error("Pause the debugger before inspecting or stepping.");
    if (command === "disconnect") {
      args.terminateDebuggee = this.mode === "launch";
      try { await context.transport.request(this.id, command, args); }
      finally { await context.transport.stop(this.id); this.model.state = "terminated"; this.clearReferences(); }
      return;
    }
    if (command === "stackTrace") { args.startFrame = 0; args.levels = 100; }
    if (command === "variables") { args.start = 0; args.count = MAX_CODE_RESULTS; }
    const generation = this.generation;
    const raw = await context.transport.request(this.id, command, args);
    const response = raw === null && ["continue", "pause", "next", "stepIn", "stepOut", "restart", "setExceptionBreakpoints"].includes(command) ? {} : raw;
    this.check(context);
    if (["stackTrace", "scopes", "variables", "evaluate", "exceptionInfo"].includes(command) && generation !== this.generation) {
      throw new Error("Debugger state changed; stale inspection results were discarded.");
    }
    if (!record(response)) throw new Error(`The debugger returned an invalid ${command} response.`);
    switch (command) {
      case "threads":
        this.model.threads = rows(response.threads).map((thread) => ({ id: number(thread.id), name: label(thread.name) }));
        break;
      case "stackTrace":
        this.model.frames = rows(response.stackFrames).map((frame) => {
          const line = Math.max(0, number(frame.line) - 1);
          const character = Math.max(0, number(frame.column) - 1);
          return { id: number(frame.id), name: label(frame.name),
            ...(record(frame.source) && typeof frame.source.path === "string" ? {
              location: { path: pathFromUri(frame.source.path), range: { start: { line, character }, end: { line, character } },
                language: request.language, project: request.scope.rootPath },
            } : {}) };
        });
        break;
      case "scopes":
        this.model.scopes = rows(response.scopes).map((scope) => ({ name: label(scope.name), variablesReference: number(scope.variablesReference) }));
        break;
      case "variables":
        this.model.variables = rows(response.variables).map((variable) => ({
          name: label(variable.name), value: label(variable.value, 8192), variablesReference: number(variable.variablesReference),
          ...(typeof variable.type === "string" ? { type: variable.type.slice(0, 128) } : {}),
        }));
        break;
      case "evaluate":
        if (args.context === "watch") {
          const expression = label(args.expression);
          this.model.watches = [...(this.model.watches ?? []).filter((watch) => watch.expression !== expression), {
            expression, value: label(response.result, 8192), variablesReference: number(response.variablesReference ?? 0),
            ...(typeof response.type === "string" ? { type: response.type.slice(0, 128) } : {}),
          }].slice(-20);
        }
        this.output(`${String(args.expression ?? "").slice(0, 1024)} = ${label(response.result, 8192)}`);
        break;
      case "exceptionInfo":
        this.model.exception = label(response.description ?? response.exceptionId, 8192);
        break;
      case "setBreakpoints":
        this.model.breakpoints = rows(response.breakpoints).map((breakpoint) => ({
          line: number(breakpoint.line ?? 1), verified: breakpoint.verified === true,
          ...(typeof breakpoint.message === "string" ? { message: breakpoint.message.slice(0, 4096) } : {}),
        }));
        break;
      case "continue":
      case "next":
      case "stepIn":
      case "stepOut":
      case "restart":
        this.generation += 1;
        this.model.stopEpoch = this.generation;
        this.model.state = "running";
        this.clearReferences();
        break;
    }
  }

  private check(context: Context): void {
    if (context.signal.aborted) throw new Error("Debugger request cancelled.");
  }
  private clearReferences(): void {
    this.model.frames = []; this.model.scopes = []; this.model.variables = [];
    delete this.model.exception;
    this.model.watches = (this.model.watches ?? []).map((watch) => ({ ...watch, value: "Unavailable while running", variablesReference: 0 }));
  }
  private output(text: string): void {
    if (text) this.model.output = [...this.model.output, text.slice(0, 8192)].slice(-200);
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(record)) throw new Error("The debugger returned an invalid inspection list.");
  return value.slice(0, MAX_CODE_RESULTS);
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("The debugger returned an invalid object reference.");
  return value;
}
function label(value: unknown, maximum = 1024): string {
  if (typeof value !== "string") throw new Error("The debugger returned an invalid display value.");
  return value.slice(0, maximum) || "(empty)";
}
