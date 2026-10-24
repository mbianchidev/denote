import { CODE_FEATURES, CODE_FEATURE_METHODS, record, type PluginCodeProvider, type PluginCodeRequest } from "@denote/plugin-sdk";

export interface PluginCodeContribution extends Omit<PluginCodeProvider, "run"> {
  pluginId: string;
}

export function codeProtocolAllowed(request: PluginCodeRequest, operation: string, method: string, params: unknown): boolean {
  if (operation === "start") {
    return method === "lsp" ? ["start", "restart"].includes(request.operation) :
      method === "dap" && request.operation === "debug" && ["launch", "attach"].includes(request.debug?.command ?? "");
  }
  if (operation === "poll" || operation === "respond" || operation === "stop" || operation === "cancel") return true;
  if (operation === "notify") {
    if (method === "textDocument/didClose") return request.operation === "close";
    if (method === "textDocument/didSave") return request.operation === "save";
    if (method === "initialized") return ["start", "restart"].includes(request.operation);
    return request.document !== undefined && ["textDocument/didOpen", "textDocument/didChange"].includes(method);
  }
  if (operation !== "request") return false;
  if (request.operation === "debug") {
    const command = request.debug?.command;
    if (command === "launch" || command === "attach") {
      if (method === "setBreakpoints") {
        const initial = request.debug?.arguments ?? {};
        if (!record(params)) return false;
        if (Array.isArray(initial.breakpointGroups)) return initial.breakpointGroups.some((group) =>
          record(group) && JSON.stringify(group.source) === JSON.stringify(params.source) &&
          JSON.stringify(group.breakpoints) === JSON.stringify(params.breakpoints));
        return JSON.stringify(initial.breakpoints) === JSON.stringify(params.breakpoints);
      }
      if (method === "setExceptionBreakpoints") return record(params) &&
        JSON.stringify(params.filters) === JSON.stringify(request.debug?.arguments?.exceptionFilters);
      return ["initialize", command, "configurationDone"].includes(method);
    }
    if (method !== command) return false;
    if (command === "evaluate") {
      const expected = request.debug?.arguments ?? {};
      return record(params) && params.expression === expected.expression &&
        params.context === expected.context && params.frameId === expected.frameId;
    }
    if (command === "setBreakpoints") {
      return record(params) && JSON.stringify(params.breakpoints) === JSON.stringify(request.debug?.arguments?.breakpoints) &&
        JSON.stringify(params.source) === JSON.stringify(request.debug?.arguments?.source);
    }
    if (command === "setExceptionBreakpoints") return record(params) &&
      JSON.stringify(params.filters) === JSON.stringify(request.debug?.arguments?.filters) &&
      params.filterOptions === undefined && params.exceptionOptions === undefined;
    return true;
  }
  if (method === "initialize") return ["start", "restart"].includes(request.operation);
  return CODE_FEATURES.some((feature) => feature === request.operation && method === CODE_FEATURE_METHODS[feature]);
}
