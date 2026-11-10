import type { PluginDisposable } from "./contracts";
import { type PluginCodeRange, type PluginCodeScope } from "./codeIntelligence";
export declare const TOOL_FORMATS: readonly ["unix", "msvc", "eslint-json", "cargo-json"];
export type PluginToolFormat = (typeof TOOL_FORMATS)[number];
export type PluginToolKind = "linter" | "build" | "terminal";
export declare const MAX_TOOL_OUTPUT_BYTES: number;
export declare const MAX_TOOL_DIAGNOSTICS = 1000;
export interface PluginToolDocument {
    path: string;
    version: string;
}
export interface PluginToolFix {
    from: number;
    to: number;
    text: string;
}
export interface PluginToolDiagnostic extends PluginToolDocument {
    range: PluginCodeRange;
    severity: "error" | "warning" | "info" | "hint";
    message: string;
    rule?: string;
    fix?: PluginToolFix;
}
export interface PluginToolParseRequest {
    runId: string;
    scope: PluginCodeScope;
    format: PluginToolFormat;
    stdout: string;
    stderr: string;
    documents: PluginToolDocument[];
}
export interface PluginToolParseResult {
    runId: string;
    diagnostics: PluginToolDiagnostic[];
    notices: string[];
}
export interface PluginToolRegistration {
    id: string;
    title: string;
    kind: PluginToolKind;
    formats: PluginToolFormat[];
}
export interface PluginToolingProvider extends PluginToolRegistration {
    kind: "linter" | "build";
    parse: (request: PluginToolParseRequest) => PluginToolParseResult | Promise<PluginToolParseResult>;
}
export interface PluginToolContribution extends PluginToolRegistration {
    pluginId: string;
}
export interface PluginToolingCapability {
    register: (provider: PluginToolingProvider) => PluginDisposable;
}
export interface PluginTerminalCapability {
    register: (terminal: {
        id: string;
        title: string;
    }) => PluginDisposable;
}
export declare function isToolRegistration(value: unknown): value is PluginToolRegistration;
export declare function isToolParseRequest(value: unknown): value is PluginToolParseRequest;
export declare function isToolParseResult(value: unknown): value is PluginToolParseResult;
export declare function isToolParseResultFor(request: PluginToolParseRequest, result: unknown): result is PluginToolParseResult;
export declare function parseToolDiagnostics(request: PluginToolParseRequest): PluginToolParseResult;
