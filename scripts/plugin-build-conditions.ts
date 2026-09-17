export function pluginEntrypointConditions(
  kind: "worker" | "diagram-renderer",
): string[] {
  return kind === "worker" ? ["worker"] : [];
}
