import { Fingerprint, LockKeyhole, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import {
  applyTheme,
  getThemePreference,
  observeSystemTheme,
  observeThemePreference,
  resolveTheme,
  saveThemePreference,
  systemTheme,
} from "../lib/theme";
import type { AppLockStatus } from "../types";

export function AppUnlockScreen({
  status,
  loading,
  loadError,
  onRetry,
  onPassword,
  onDevice,
}: {
  status: AppLockStatus | null;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onPassword: (password: string) => Promise<void>;
  onDevice: () => Promise<void>;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preference, setPreference] = useState(getThemePreference);
  const [system, setSystem] = useState(systemTheme);
  const theme = resolveTheme(preference, system);

  useEffect(() => observeSystemTheme(setSystem), []);
  useEffect(() => observeThemePreference(setPreference), []);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (!loading && !busy) {
      const target = loadError ? retryRef.current : passwordRef.current
        ?? (status?.deviceAuthentication.available ? deviceRef.current : retryRef.current);
      target?.focus();
    }
  }, [loading, busy, loadError, status?.passwordEnabled, status?.deviceAuthentication.available]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="vault-unlock" aria-labelledby="app-unlock-title">
      <div className="vault-unlock__toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            try {
              saveThemePreference(next);
              setPreference(next);
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
        >
          {theme === "dark" ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
        </button>
      </div>
      <form
        className="vault-unlock__card"
        aria-busy={busy || loading}
        onSubmit={(event) => {
          event.preventDefault();
          const password = passwordRef.current?.value ?? "";
          if (passwordRef.current) passwordRef.current.value = "";
          if (!password) {
            setError("Enter the app password.");
            passwordRef.current?.focus();
            return;
          }
          void run(() => onPassword(password));
        }}
      >
        <div className="vault-unlock__mark">
          <LockKeyhole aria-hidden="true" size={24} />
        </div>
        <span className="dialog-kicker">App lock</span>
        <h1 id="app-unlock-title">{loadError ? "App lock needs attention" : "Denote is locked"}</h1>
        {loading ? (
          <p role="status">Checking app lock…</p>
        ) : loadError ? (
          <>
            <p className="vault-unlock__error" role="alert">{loadError}</p>
            <button ref={retryRef} type="button" className="primary-button" onClick={onRetry}>Retry</button>
          </>
        ) : status ? (
          <>
            <p>Unlock Denote to open your workspace.</p>
            {status.passwordEnabled ? (
              <>
                <label>
                  <span>App password</span>
                  <input
                    ref={passwordRef}
                    type="password"
                    autoComplete="current-password"
                    maxLength={1024}
                    disabled={busy}
                  />
                </label>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? "Unlocking…" : "Unlock app"}
                </button>
              </>
            ) : null}
            {status.deviceAuthenticationEnabled ? (
              <>
                <button
                  ref={deviceRef}
                  type="button"
                  className={status.passwordEnabled ? "secondary-button" : "primary-button"}
                  disabled={busy || !status.deviceAuthentication.available}
                  onClick={() => {
                    if (passwordRef.current) passwordRef.current.value = "";
                    void run(onDevice);
                  }}
                >
                  <Fingerprint aria-hidden="true" size={16} />{" "}
                  {busy ? "Authenticating…" : `Unlock with ${status.deviceAuthentication.name}`}
                </button>
                {!status.deviceAuthentication.available ? (
                  <>
                    <p>{status.deviceAuthentication.unavailableReason}</p>
                    <button ref={retryRef} type="button" className="secondary-button" disabled={busy} onClick={onRetry}>
                      Check again
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {error ? <p className="vault-unlock__error" role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
