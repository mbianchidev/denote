import {
  ChevronsUpDown,
  KeyRound,
  LockKeyhole,
  Moon,
  Sun,
} from "lucide-react";
import { useState } from "react";
import type { Theme } from "../lib/theme";

interface VaultUnlockScreenProps {
  vaultName: string;
  theme: Theme;
  onThemeToggle: () => void;
  onShowVaults: () => void;
  onUnlockWithPassword: (password: string) => Promise<void>;
  onUnlockWithRecoveryCode: (recoveryCode: string) => Promise<void>;
}

export function VaultUnlockScreen({
  vaultName,
  theme,
  onThemeToggle,
  onShowVaults,
  onUnlockWithPassword,
  onUnlockWithRecoveryCode,
}: VaultUnlockScreenProps) {
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!credential.trim()) {
      setError(
        useRecoveryCode ? "Enter a recovery code." : "Enter the vault password.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (useRecoveryCode) {
        await onUnlockWithRecoveryCode(credential);
      } else {
        await onUnlockWithPassword(credential);
      }
      setCredential("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="vault-unlock">
      <div className="vault-unlock__toolbar">
        <button
          type="button"
          className="icon-button"
          title="Switch vault"
          aria-label="Switch vault"
          disabled={busy}
          onClick={onShowVaults}
        >
          <ChevronsUpDown aria-hidden="true" size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onThemeToggle}
        >
          {theme === "dark" ? (
            <Sun aria-hidden="true" size={17} />
          ) : (
            <Moon aria-hidden="true" size={17} />
          )}
        </button>
      </div>
      <form
        className="vault-unlock__card"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <div className="vault-unlock__mark">
          <LockKeyhole aria-hidden="true" size={24} />
        </div>
        <span className="dialog-kicker">Encrypted vault</span>
        <h1>{vaultName} is locked</h1>
        <p>
          {useRecoveryCode
            ? "Enter one unused recovery code. It will be consumed after a successful unlock."
            : "Enter the vault password to decrypt files in memory while Denote is open."}
        </p>
        <label>
          <span>{useRecoveryCode ? "Recovery code" : "Password"}</span>
          <input
            type={useRecoveryCode ? "text" : "password"}
            value={credential}
            autoFocus
            autoComplete={useRecoveryCode ? "off" : "current-password"}
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setCredential(event.currentTarget.value)}
          />
        </label>
        {error ? (
          <p className="vault-unlock__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock vault"}
        </button>
        <button
          type="button"
          className="vault-unlock__alternate"
          disabled={busy}
          onClick={() => {
            setUseRecoveryCode((current) => !current);
            setCredential("");
            setError(null);
          }}
        >
          <KeyRound aria-hidden="true" size={14} />
          {useRecoveryCode ? "Use vault password" : "Use a recovery code"}
        </button>
      </form>
    </main>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Unable to unlock the vault.";
}
