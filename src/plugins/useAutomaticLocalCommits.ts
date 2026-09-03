import { useEffect, useMemo, useRef } from "react";
import type { PluginAutomaticLocalCommitContribution } from "./workerRuntime";

export interface AutomaticLocalCommitScheduling {
  /** Every schedule the plugin runtimes currently contribute. */
  schedules: PluginAutomaticLocalCommitContribution[];
  /**
   * Coarse readiness: a workspace is open, an encrypted vault is unlocked, and
   * its encryption phase is stable. Timers exist only while this holds, so a
   * locked or maintaining vault has no standing timer at all and unlocking
   * starts a fresh interval instead of firing a backlog.
   */
  enabled: boolean;
  /** Identifies the workspace a timer belongs to. */
  workspaceIdentity: string | null;
  /** Identifies the project scope a timer belongs to. */
  projectId: string | null;
  /**
   * Transient gate evaluated at tick time, for state that changes far too
   * often to rebuild timers around, such as a workspace lock held by another
   * operation.
   */
  canRun: () => boolean;
  run: (schedule: PluginAutomaticLocalCommitContribution) => Promise<void>;
  onError: (error: unknown) => void;
}

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Owns one host timer per plugin schedule for the current vault and project.
 *
 * No run happens when a timer is created: the first run is one whole interval
 * later. Every change that could invalidate a run, including a schedule
 * update, a vault or project switch, a lock, a plugin being disabled or
 * crashing, shutdown, and unmounting, clears the timers and recreates only the
 * ones that still apply.
 */
export function useAutomaticLocalCommits({
  schedules,
  enabled,
  workspaceIdentity,
  projectId,
  canRun,
  run,
  onError,
}: AutomaticLocalCommitScheduling): void {
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  const canRunRef = useRef(canRun);
  canRunRef.current = canRun;
  const runRef = useRef(run);
  runRef.current = run;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const activeRef = useRef(false);
  const signature = useMemo(() => scheduleSignature(schedules), [schedules]);

  useEffect(() => {
    if (!enabled || !workspaceIdentity || signature.length === 0) {
      return;
    }
    const timers = new Map<string, number>();
    for (const schedule of schedulesRef.current) {
      const key = timerKey(schedule);
      if (timers.has(key)) {
        continue;
      }
      timers.set(
        key,
        window.setInterval(() => {
          // A run still in flight owns the workspace lock, so a second one
          // would either deadlock behind it or commit a half-flushed tree.
          if (activeRef.current || !canRunRef.current()) {
            return;
          }
          activeRef.current = true;
          void (async () => {
            try {
              await runRef.current(schedule);
            } catch (error) {
              onErrorRef.current(error);
            } finally {
              activeRef.current = false;
            }
          })();
        }, schedule.intervalMinutes * MILLISECONDS_PER_MINUTE),
      );
    }
    return () => {
      for (const timer of timers.values()) {
        window.clearInterval(timer);
      }
      timers.clear();
    };
  }, [enabled, projectId, signature, workspaceIdentity]);
}

/** Timers are keyed by the plugin and the schedule it registered. */
function timerKey(schedule: PluginAutomaticLocalCommitContribution): string {
  return `${schedule.pluginId}\u0000${schedule.id}`;
}

/**
 * Collapses the published schedules into one comparable value, so a
 * republished but unchanged list keeps the running timers instead of silently
 * restarting every interval.
 */
function scheduleSignature(
  schedules: PluginAutomaticLocalCommitContribution[],
): string {
  return schedules
    .map((schedule) =>
      [
        timerKey(schedule),
        schedule.intervalMinutes,
        schedule.message,
        schedule.includePatterns.join("\u0003"),
        schedule.excludePatterns.join("\u0003"),
        schedule.authorName ?? "",
        schedule.authorEmail ?? "",
      ].join("\u0001"),
    )
    .join("\u0002");
}
