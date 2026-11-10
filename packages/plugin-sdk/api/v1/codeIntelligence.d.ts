import type { PluginDisposable } from "./contracts";
export declare const CODE_LANGUAGES: readonly ["rust", "go", "python", "java", "cpp", "typescript"];
export type PluginCodeLanguage = (typeof CODE_LANGUAGES)[number];
export declare const CODE_FEATURES: readonly ["completion", "hover", "signature", "diagnostics", "format", "definition", "declaration", "implementation", "type-definition", "references", "symbols", "workspace-symbols"];
export type PluginCodeFeature = (typeof CODE_FEATURES)[number];
export declare const CODE_FEATURE_METHODS: Record<PluginCodeFeature, string>;
export declare const DEBUG_COMMANDS: readonly ["launch", "attach", "setBreakpoints", "setExceptionBreakpoints", "continue", "pause", "next", "stepIn", "stepOut", "restart", "disconnect", "threads", "stackTrace", "scopes", "variables", "evaluate", "exceptionInfo"];
export type PluginDebugCommand = (typeof DEBUG_COMMANDS)[number];
export declare const MAX_CODE_SOURCE_BYTES: number;
export declare const MAX_CODE_RESULTS = 500;
export declare const MAX_CODE_LOGS = 200;
export interface PluginCodeScope {
    projectId: string | null;
    rootPath: string;
}
export interface PluginCodePosition {
    line: number;
    character: number;
}
export interface PluginCodeRange {
    start: PluginCodePosition;
    end: PluginCodePosition;
}
export interface PluginCodeDocument {
    path: string;
    language: PluginCodeLanguage;
    version: number;
    text: string;
}
export interface PluginCodeLocation {
    path: string;
    range: PluginCodeRange;
    name?: string;
    container?: string;
    language?: PluginCodeLanguage;
    project?: string;
}
export interface PluginCodeDiagnostic {
    range: PluginCodeRange;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    source?: string;
}
export interface PluginCodeTextEdit {
    range: PluginCodeRange;
    text: string;
}
export interface PluginCodeCompletion extends PluginCodeTextEdit {
    label: string;
    detail?: string;
}
export interface PluginDebugModel {
    stopEpoch?: number;
    state: "starting" | "running" | "stopped" | "terminated";
    capabilities: string[];
    threads: Array<{
        id: number;
        name: string;
    }>;
    frames: Array<{
        id: number;
        name: string;
        location?: PluginCodeLocation;
    }>;
    scopes: Array<{
        name: string;
        variablesReference: number;
    }>;
    variables: Array<{
        name: string;
        value: string;
        type?: string;
        variablesReference: number;
    }>;
    breakpoints: Array<{
        line: number;
        verified: boolean;
        message?: string;
    }>;
    output: string[];
    exception?: string;
    watches?: Array<{
        expression: string;
        value: string;
        type?: string;
        variablesReference: number;
    }>;
}
export interface PluginCodeResult {
    status: string;
    capabilities?: PluginCodeFeature[];
    locations?: PluginCodeLocation[];
    completions?: PluginCodeCompletion[];
    hover?: string;
    signatures?: string[];
    diagnostics?: PluginCodeDiagnostic[];
    edits?: PluginCodeTextEdit[];
    logs?: string[];
    notices?: string[];
    debug?: PluginDebugModel;
}
export type PluginCodeOperation = PluginCodeFeature | "start" | "stop" | "restart" | "poll" | "open" | "change" | "save" | "close" | "debug";
export interface PluginCodeRequest {
    operation: PluginCodeOperation;
    language: PluginCodeLanguage;
    scope: PluginCodeScope;
    document?: PluginCodeDocument;
    position?: PluginCodePosition;
    query?: string;
    debug?: {
        command: PluginDebugCommand;
        arguments?: Record<string, unknown>;
    };
}
export interface PluginCodeLanguageAdapter {
    id: PluginCodeLanguage;
    title: string;
    server: string;
    debugger: string;
    setup: string;
}
export interface PluginCodeProtocolEvent {
    kind: "message" | "log" | "exit";
    message?: Record<string, unknown>;
    text?: string;
}
export interface PluginCodeTransport {
    start: (kind: "lsp" | "dap") => Promise<{
        sessionId: string;
        rootPath: string;
    }>;
    request: (sessionId: string, method: string, params?: unknown) => Promise<unknown>;
    notify: (sessionId: string, method: string, params?: unknown) => Promise<void>;
    poll: (sessionId: string) => Promise<PluginCodeProtocolEvent[]>;
    respond: (sessionId: string, id: string | number, result: unknown) => Promise<void>;
    stop: (sessionId: string) => Promise<void>;
    cancel: () => Promise<void>;
}
export interface PluginCodeProvider {
    id: string;
    title: string;
    languages: PluginCodeLanguageAdapter[];
    run: (request: PluginCodeRequest, context: {
        transport: PluginCodeTransport;
        signal: AbortSignal;
    }) => Promise<PluginCodeResult>;
}
export interface PluginCodeIntelligenceCapability {
    register: (provider: PluginCodeProvider) => PluginDisposable;
}
export declare function codeDocumentUri(path: string): string;
export declare function codeLanguageForPath(path: string): PluginCodeLanguage | null;
export declare function isCodePath(value: unknown, allowRoot?: boolean): value is string;
export declare function isCodePosition(value: unknown): value is PluginCodePosition;
export declare function isCodeRange(value: unknown): value is PluginCodeRange;
export declare function isPluginCodeRequest(value: unknown): value is PluginCodeRequest;
export declare function isPluginCodeRegistration(value: unknown): value is Omit<PluginCodeProvider, "run">;
export declare function isCodeLocation(value: unknown): value is PluginCodeLocation;
export declare function isPluginCodeResult(value: unknown): value is PluginCodeResult;
export declare function record(value: unknown): value is Record<string, unknown>;
export declare function isCodeJson(value: unknown): boolean;
