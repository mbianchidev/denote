import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type { AppLockConfigurationRequest, AppLockStatus } from "../types";

export function AppLockSettings({
  status,
  active = true,
  disabled,
  onConfigure,
  onLock,
}: {
  status: AppLockStatus;
  active?: boolean;
  disabled: boolean;
  onConfigure: (request: AppLockConfigurationRequest) => Promise<void>;
  onLock: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [passwordEnabled, setPasswordEnabled] = useState(status.passwordEnabled || !status.enabled);
  const [deviceEnabled, setDeviceEnabled] = useState(status.deviceAuthenticationEnabled);
  const [minutes, setMinutes] = useState(status.inactivityMinutes?.toString() ?? "");
  const [changePassword, setChangePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const newPasswordNeeded = enabled && passwordEnabled && (!status.passwordEnabled || changePassword);
  const clearPasswords = () => {
    for (const field of [currentRef.current, passwordRef.current, confirmationRef.current]) {
      if (field) field.value = "";
    }
  };

  useEffect(() => {
    setEnabled(status.enabled);
    setPasswordEnabled(status.passwordEnabled || !status.enabled);
    setDeviceEnabled(status.deviceAuthenticationEnabled);
    setMinutes(status.inactivityMinutes?.toString() ?? "");
    setChangePassword(false);
    clearPasswords();
  }, [active, status.enabled, status.passwordEnabled, status.deviceAuthenticationEnabled, status.inactivityMinutes]);
  useEffect(() => {
    setError(null);
    setSaved(false);
  }, [active]);

  const save = async () => {
    const value = passwordRef.current?.value ?? "";
    const confirmation = confirmationRef.current?.value ?? "";
    const currentPassword = currentRef.current?.value || null;
    clearPasswords();
    setError(null);
    setSaved(false);
    if (enabled && !passwordEnabled && !deviceEnabled) {
      setError("Choose at least one unlock method.");
      return;
    }
    if (newPasswordNeeded) {
      if ([...value].length < 12 || !value.trim() || new TextEncoder().encode(value).length > 1024) {
        setError("Use at least 12 characters, not only whitespace, and no more than 1,024 bytes.");
        return;
      }
      if (value !== confirmation) {
        setError("App passwords do not match.");
        return;
      }
    }
    if (status.passwordEnabled && !currentPassword) {
      setError("Enter the current app password to change app lock.");
      currentRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onConfigure({
        password: !enabled || !passwordEnabled
          ? { kind: "remove" }
          : newPasswordNeeded ? { kind: "set", value } : { kind: "keep" },
        currentPassword,
        deviceAuthenticationEnabled: enabled && deviceEnabled,
        inactivityMinutes: enabled && minutes ? Number(minutes) : null,
      });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="editor-settings-dialog__body app-lock-settings" aria-label="App lock settings"
      aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="editor-tab-setting" disabled={disabled || busy}>
        <legend>App lock</legend>
        <p>Lock Denote on startup. This hides the workspace, not files on disk. Vault encryption stays separate.</p>
        <label>
          <input type="checkbox" checked={enabled} onChange={(event) => {
            setEnabled(event.currentTarget.checked);
            clearPasswords();
            setSaved(false);
          }} />
          Enable app lock
        </label>
      </fieldset>
      {enabled ? (
        <>
          <fieldset className="editor-tab-setting" disabled={disabled || busy}>
            <legend>Unlock methods</legend>
            <label>
              <input type="checkbox" checked={passwordEnabled} onChange={(event) => {
                setPasswordEnabled(event.currentTarget.checked);
                clearPasswords();
                setSaved(false);
              }} />
              App password
            </label>
            <label>
              <input type="checkbox" checked={deviceEnabled}
                disabled={!status.deviceAuthentication.available && !deviceEnabled}
                onChange={(event) => { setDeviceEnabled(event.currentTarget.checked); setSaved(false); }} />
              {status.deviceAuthentication.name}
            </label>
            {!status.deviceAuthentication.available ? <p>{status.deviceAuthentication.unavailableReason}</p> : null}
            <p>Either enabled method can unlock the app. Device authentication is requested before enablement.</p>
          </fieldset>
          {passwordEnabled && status.passwordEnabled ? (
            <button type="button" className="secondary-button" disabled={disabled || busy}
              onClick={() => { setChangePassword((current) => !current); clearPasswords(); setSaved(false); }}>
              {changePassword ? "Keep current password" : "Change app password"}
            </button>
          ) : null}
          {newPasswordNeeded ? (
            <div className="app-lock-settings__fields">
              <label>
                <span>New app password</span>
                <input ref={passwordRef} type="password" autoComplete="new-password"
                  maxLength={1024} disabled={disabled || busy} />
              </label>
              <label>
                <span>Confirm app password</span>
                <input ref={confirmationRef} type="password" autoComplete="new-password"
                  maxLength={1024} disabled={disabled || busy} />
              </label>
            </div>
          ) : null}
          <label className="app-lock-settings__timeout">
            <span>Lock after inactivity</span>
            <select value={minutes} disabled={disabled || busy} onChange={(event) => {
              setMinutes(event.currentTarget.value);
              setSaved(false);
            }}>
              <option value="">Disabled</option>
              {[1, 5, 15, 30, 60, 120, 240].map((value) =>
                <option key={value} value={value}>{value} {value === 1 ? "minute" : "minutes"}</option>,
              )}
            </select>
          </label>
          <p>Locking stops terminal jobs and native tools. Inactivity locking is disabled until you choose a timeout.</p>
        </>
      ) : null}
      {status.passwordEnabled ? (
        <div className="app-lock-settings__fields">
          <label>
            <span>Current app password</span>
            <input ref={currentRef} type="password" autoComplete="current-password"
              maxLength={1024} disabled={disabled || busy} />
          </label>
          <p>The current app password is required to change or disable app lock. Denote cannot recover a forgotten password.</p>
        </div>
      ) : status.enabled ? <p>Confirm with {status.deviceAuthentication.name} to change or disable app lock.</p> : null}
      {error ? <p className="vault-unlock__error" role="alert">{error}</p> : null}
      {saved ? <p role="status">App lock saved.</p> : null}
      <div className="app-lock-settings__actions">
        {status.enabled ? (
          <button type="button" className="secondary-button" disabled={disabled || busy}
            onClick={() => { void onLock().catch((caught: unknown) => setError(errorMessage(caught))); }}>
            Lock app now
          </button>
        ) : null}
        <button type="submit" className="primary-button" disabled={disabled || busy || (!enabled && !status.enabled)}>
          {busy ? "Saving…" : "Save app lock"}
        </button>
      </div>
    </form>
  );
}
