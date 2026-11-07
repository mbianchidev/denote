import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import type { AppLockConfigurationRequest, AppLockStatus } from "../types";
import { AppUnlockScreen } from "./AppUnlockScreen";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

export interface AppLockActions {
  status: AppLockStatus;
  lock: () => Promise<void>;
  configure: (request: AppLockConfigurationRequest) => Promise<void>;
}

export function AppLockBoundary({
  children,
}: {
  children: (actions: AppLockActions) => ReactNode;
}) {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const workspaceVisible = !loading && !locking && !error && status !== null && !status.locked;

  useEffect(() => {
    if (workspaceVisible) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const close = async () => {
      try {
        await api.completeExit();
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    };
    const retain = (cleanup: () => void) => {
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    };
    const failed = (caught: unknown) => {
      if (!cancelled) setError(errorMessage(caught));
    };
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await close();
    }).then(retain).catch(failed);
    void listen("denote://exit-requested", close).then(retain).catch(failed);
    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [workspaceVisible]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.getAppLockStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      (caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught));
      },
    ).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [retry]);

  const lock = useCallback(async () => {
    setLocking(true);
    try {
      const next = await api.lockApp();
      if (!next.locked) throw new Error("The app could not be locked. Try again.");
      setStatus(next);
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setLocking(false);
    }
  }, []);
  const configure = useCallback(async (request: AppLockConfigurationRequest) => {
    const next = await api.configureAppLock(request);
    setStatus(next);
  }, []);
  const actions = useMemo(
    () => status ? { status, lock, configure } : null,
    [status, lock, configure],
  );
  const unlock = async (operation: () => Promise<AppLockStatus>) => {
    const next = await operation();
    if (next.locked) throw new Error("Authentication did not unlock the app.");
    setStatus(next);
  };

  if (workspaceVisible && actions) {
    return children(actions);
  }
  return (
    <AppUnlockScreen
      status={status}
      loading={loading || locking}
      loadError={error}
      onRetry={() => setRetry((current) => current + 1)}
      onPassword={(password) => unlock(() => api.unlockAppWithPassword(password))}
      onDevice={() => unlock(api.unlockAppWithDevice)}
    />
  );
}
