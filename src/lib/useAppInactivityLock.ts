import { useEffect, useRef } from "react";

export function useAppInactivityLock(
  minutes: number | null,
  lock: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  const lockRef = useRef(lock);
  const errorRef = useRef(onError);
  lockRef.current = lock;
  errorRef.current = onError;

  useEffect(() => {
    if (minutes === null) return;
    const interval = minutes * 60_000;
    let timer: number;
    let cancelled = false;
    let locking = false;
    let lastActivity = Date.now();
    let lastMonotonicActivity = performance.now();
    const elapsed = () => Math.max(0, Date.now() - lastActivity, performance.now() - lastMonotonicActivity);
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, Math.max(1, interval - elapsed()));
    };
    const check = async () => {
      if (cancelled || locking) return;
      if (elapsed() < interval) {
        schedule();
        return;
      }
      locking = true;
      try {
        await lockRef.current();
      } catch (error) {
        if (!cancelled) {
          errorRef.current(error);
          lastActivity = Date.now();
          lastMonotonicActivity = performance.now();
          schedule();
        }
      } finally {
        locking = false;
      }
    };
    const activity = () => {
      if (locking) return;
      lastActivity = Date.now();
      lastMonotonicActivity = performance.now();
    };
    const visibility = () => { void check(); };
    const events = ["keydown", "pointerdown", "pointermove", "wheel", "input"] as const;
    for (const event of events) document.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", visibility);
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const event of events) document.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", visibility);
    };
  }, [minutes]);
}
