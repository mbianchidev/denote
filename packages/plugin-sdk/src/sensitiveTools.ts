import type { PluginDisposable } from "./contracts";

export const SENSITIVE_TOOL_FEATURES = ["speech", "credential-store"] as const;
export type PluginSensitiveToolFeature = (typeof SENSITIVE_TOOL_FEATURES)[number];

export interface PluginSensitiveToolRegistration {
  id: string;
  title: string;
  feature: PluginSensitiveToolFeature;
}

export interface PluginSensitiveToolsCapability {
  register: (tool: PluginSensitiveToolRegistration) => PluginDisposable;
}

export function isPluginSensitiveToolRegistration(value: unknown): value is PluginSensitiveToolRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tool = value as Record<string, unknown>;
  return Object.keys(tool).every((key) => ["id", "title", "feature", "type"].includes(key)) &&
    (tool.type === undefined || tool.type === "register-sensitive-tool") &&
    typeof tool.id === "string" && /^[a-z0-9][a-z0-9.-]{0,159}$/.test(tool.id) &&
    typeof tool.title === "string" && tool.title.trim().length > 0 && tool.title.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(tool.title) &&
    SENSITIVE_TOOL_FEATURES.some((feature) => feature === tool.feature);
}
