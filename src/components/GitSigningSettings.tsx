import { useEffect, useRef, useState } from "react";
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
  onError: (error: unknown) => void;
}

export function GitSigningSettings({
  settings, disabled, dirty, onInspect, onSave, onDelete, onError, contextKey, hasCredentials,
}: GitSigningSettingsProps) {
  const [status, setStatus] = useState<GitSigningStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const password = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const settingsKey = JSON.stringify(settings);

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

  const run = async (operation: () => Promise<GitSigningStatus>) => {
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
  };

  return (
    <section className="plugin-signing">
      <h6>Signing credentials</h6>
      <p>
        Leave Signing key empty to use Git configuration. Denote detects the signing
        format and program; OpenPGP uses an imported fingerprint, while SSH uses a
        key-file path or ssh-agent. Detection includes the focused project's Git
        configuration, or the vault repository when no project is focused.
      </p>
      {dirty ? <p role="status">Save plugin settings before detecting the signing key.</p> : null}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled || dirty || busy}
        onClick={() => void run(onInspect)}
      >
        {busy ? "Working..." : "Detect signing key"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {status ? (
        <>
          <dl>
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
              <label>
                <span>Save passphrase for this key</span>
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
      <details>
        <summary>Find your signing key</summary>
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
      </details>
    </section>
  );
}
