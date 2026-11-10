import type { PluginDisposable } from "./contracts";
export declare const SENSITIVE_TOOL_FEATURES: readonly ["speech", "credential-store"];
export type PluginSensitiveToolFeature = (typeof SENSITIVE_TOOL_FEATURES)[number];
export interface PluginSensitiveToolRegistration {
    id: string;
    title: string;
    feature: PluginSensitiveToolFeature;
}
export interface PluginSensitiveToolsCapability {
    register: (tool: PluginSensitiveToolRegistration) => PluginDisposable;
}
export declare function isPluginSensitiveToolRegistration(value: unknown): value is PluginSensitiveToolRegistration;
