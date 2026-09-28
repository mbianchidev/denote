import { useCallback, useEffect, useRef, useState } from "react";
import type { GitSigningStatus } from "../types";
import { systemPathForDisplay } from "../lib/systemPath";

export interface GitSigningActions {
  contextKey?: string;
  onInspect: () => Promise<GitSigningStatus>;
  onSave: (credentialId: string, passphrase: string) => Promise<GitSigningStatus>;
  onDelete: (credentialId: string) => Promise<void>;
}

interface GitSigningSettingsProps extends GitSigningActions {
  settings: Record<string, unknown>;
  disabled: boolean;
  dirty: boolean;
  hasCredentials?: boolean;
  onSaveSettings: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function GitSigningSettings({
  settings,
  disabled,
  dirty,
  onInspect,
  onSave,
  onDelete,
  onError,
  contextKey,
  hasCredentials,
  onSaveSettings,
}: GitSigningSettingsProps) {
  const [status, setStatus] = useState<GitSigningStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [detectAfterSave, setDetectAfterSave] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const scopeGeneration = useRef(0);
  const settingsKey = JSON.stringify(settings);

  useEffect(() => {
    scopeGeneration.current += 1;
    setSavingSettings(false);
    setDetectAfterSave(false);
    return () => {
      scopeGeneration.current += 1;
    };
  }, [contextKey]);

  useEffect(() => {
    generation.current += 1;
    setStatus(null);
    setError(null);
    setBusy(false);
    if (password.current) password.current.value = "";
    return () => {
      generation.current += 1;
      if (password.current) password.current.value = "";
    };
  }, [settingsKey, dirty, contextKey]);

  useEffect(() => {
    if (hasCredentials === false) {
      setStatus((current) => current ? { ...current, hasSavedPassphrase: false } : null);
    }
  }, [hasCredentials]);

  useEffect(() => {
    if (disabled && password.current) password.current.value = "";
  }, [disabled]);

  const run = useCallback(async (operation: () => Promise<GitSigningStatus>) => {
    const current = ++generation.current;
    if (password.current) password.current.value = "";
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      if (generation.current === current) setStatus(next);
    } catch (failure) {
      if (generation.current === current) {
        setError(systemPathForDisplay(failure instanceof Error ? failure.message : String(failure)));
      }
      onError(failure);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }, [onError]);

  useEffect(() => {
    if (detectAfterSave && !dirty && !disabled && !savingSettings) {
      setDetectAfterSave(false);
      void run(onInspect);
    }
  }, [detectAfterSave, dirty, disabled, savingSettings, onInspect, run]);

  const saveAndDetect = async () => {
    const scope = scopeGeneration.current;
    generation.current += 1;
    setStatus(null);
    setError(null);
    setSavingSettings(true);
    if (password.current) password.current.value = "";
    try {
      await onSaveSettings();
      if (scope === scopeGeneration.current) setDetectAfterSave(true);
    } catch (failure) {
      if (scope === scopeGeneration.current) {
        setError(systemPathForDisplay(failure instanceof Error ? failure.message : String(failure)));
      }
      onError(failure);
    } finally {
      if (scope === scopeGeneration.current) setSavingSettings(false);
    }
  };

  return (
    <section className="plugin-signing">
      <h6>Signing credentials</h6>
      <p>
        Leave Signing key empty to use Git configuration. Detect the format,
        program, and key for the focused project or vault.
      </p>
      {dirty ? <p role="status">Detection will save your pending plugin settings first.</p> : null}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled || busy || savingSettings || detectAfterSave}
        onClick={() => dirty ? void saveAndDetect() : void run(onInspect)}
      >
        {savingSettings
          ? "Saving settings..."
          : busy || detectAfterSave
            ? "Detecting..."
            : dirty ? "Save settings and detect signing key" : "Detect signing key"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {status ? (
        <>
          <dl className="plugin-signing__metadata">
            <div><dt>Format</dt><dd>{status.format}</dd></div>
            <div><dt>Program</dt><dd><code>{systemPathForDisplay(status.program)}</code></dd></div>
            <div><dt>Key</dt><dd><code>{status.key ? systemPathForDisplay(status.key) : "System default"}</code></dd></div>
            <div><dt>Source</dt><dd>{status.keySource}</dd></div>
          </dl>
          <p>{status.guidance}</p>
          {status.credentialId ? (
            <>
              <p role="status">
                {status.hasSavedPassphrase
                  ? "Passphrase saved in the OS credential store."
                  : "No passphrase saved for this key."}
              </p>
              <label className="plugin-setting">
                <span><strong>Save passphrase for this key</strong></span>
                <input
                  ref={password}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={disabled || dirty || busy}
                />
              </label>
              <p>
                Optional. Saved until you delete it, in macOS Keychain, Windows
                Credential Manager, or Linux Secret Service. It never enters plugin
                settings, exports, or plugin code. Without it, your system agent
                handles unlocking. Anyone with access to your unlocked OS account
                may be able to use the saved credential.
              </p>
              <div className="plugin-card__settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || dirty || busy}
                  onClick={() => {
                    const input = password.current;
                    const value = input?.value ?? "";
                    if (input) input.value = "";
                    if (!value) {
                      setError("Enter a passphrase before saving.");
                      return;
                    }
                    const id = status.credentialId;
                    if (id) void run(() => onSave(id, value));
                  }}
                >
                  Save passphrase
                </button>
                {status.hasSavedPassphrase ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={disabled || dirty || busy}
                    onClick={() => {
                      if (password.current) password.current.value = "";
                      const id = status.credentialId;
                      if (id) void run(async () => {
                        await onDelete(id);
                        return { ...status, hasSavedPassphrase: false };
                      });
                    }}
                  >
                    Delete saved passphrase
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <details className="plugin-settings-json">
        <summary>Find your signing key</summary>
        <div className="plugin-signing__guide">
          <p>Run these in your repository. Use the GPG executable shown above if more than one is installed.</p>
          <strong>Windows (PowerShell)</strong>
          <pre><code>{`Get-Command gpg | Select-Object -ExpandProperty Source
gpg --list-secret-keys --keyid-format=long
git config --show-origin --get user.signingKey
git config --show-origin --get gpg.format
git config --show-origin --get-regexp '^gpg\\..*program$'
Get-ChildItem "$env:USERPROFILE\\.ssh" -Filter *.pub
ssh-add -L`}</code></pre>
          <strong>macOS / Linux</strong>
          <pre><code>{`command -v gpg
gpg --list-secret-keys --keyid-format=long
git config --show-origin --get user.signingKey
git config --show-origin --get gpg.format
git config --show-origin --get-regexp '^gpg\\..*program$'
ls -l ~/.ssh/*.pub
ssh-add -L`}</code></pre>
          <p>
            No output from a Git config query means that setting is not configured.
            GnuPG prints the fingerprint below each secret key. Copy the fingerprint,
            not an exported private-key file. For SSH file signing, select the matching
            private-key path, not the .pub path. Do not paste private keys or passwords
            into commands, logs, or bug reports.
          </p>
        </div>
      </details>
    </section>
  );
}
