import type { PluginGitResult, PluginSourceControlRemoteSyncRecovery } from "@denote/plugin-sdk";

export function remoteSyncReason(
  operation: "pull" | "push",
  result: PluginGitResult,
): PluginSourceControlRemoteSyncRecovery["reason"] | null {
  if (result.exitCode === 0 || result.cancelled) return null;
  if (operation === "pull") {
    return /(?:^|\n)fatal: (?:Not possible to fast-forward, aborting\.|Need to specify how to reconcile divergent branches\.)\s*(?:\n|$)/i.test(result.stderr)
      ? "diverged" : null;
  }
  for (const line of result.stdout.split("\n")) {
    const [flag, , summary] = line.replace(/\r$/, "").split("\t");
    if (flag === "!" && /^\[rejected\] \((?:fetch first|non-fast-forward)\)$/.test(summary ?? "")) {
      return "remote-ahead";
    }
  }
  // Older hosts report push status on stderr instead of --porcelain stdout.
  return /(?:^|\n)\s*!\s+\[rejected\]\s+[^\n]+\((?:fetch first|non-fast-forward)\)\s*(?:\n|$)/.test(result.stderr)
    ? "remote-ahead" : null;
}

export function remoteFailureDetail(result: PluginGitResult): string {
  const lines = result.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.find((line) => /^(?:fatal|error):/.test(line)) ?? lines[0] ??
    result.stdout.split(/\r?\n/).find((line) => line.startsWith("!\t")) ?? "Git reported no details.").slice(0, 1000);
}
