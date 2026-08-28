import { Check, Copy, KeyRound, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EncryptionStatus } from "../types";

type EncryptionView =
  | "overview"
  | "enable"
  | "change-password"
  | "regenerate"
  | "disable"
  | "recovery-codes";

interface EncryptionDialogProps {
  open: boolean;
  encryption: EncryptionStatus;
  onClose: () => void;
  onEnable: (password: string) => Promise<string[]>;
  onLock: () => Promise<void>;
  onChangePassword: (password: string) => Promise<void>;
  onRegenerateRecoveryCodes: () => Promise<string[]>;
  onDisable: () => Promise<void>;
}

export function EncryptionDialog({
  open,
  encryption,
  onClose,
  onEnable,
  onLock,
  onChangePassword,
  onRegenerateRecoveryCodes,
  onDisable,
}: EncryptionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<EncryptionView>("overview");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = (nextView: EncryptionView) => {
    setPassword("");
    setConfirmation("");
    setError(null);
    setCopied(false);
    setView(nextView);
  };

  const canClose = view !== "recovery-codes" || codesSaved;
  const clearSecrets = () => {
    setPassword("");
    setConfirmation("");
    setRecoveryCodes([]);
  };
  const close = () => {
    if (!busy && canClose) {
      clearSecrets();
      onClose();
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      resetForm("overview");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      clearSecrets();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(
      () =>
        dialogRef.current
          ?.querySelector<HTMLElement>("[data-encryption-initial-focus]")
          ?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [open, view]);

  const run = async (operation: () => Promise<void>) => {
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

  const submitPassword = async () => {
    if ([...password].length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (!password.trim()) {
      setError("Password cannot contain only whitespace.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    await run(async () => {
      if (view === "enable") {
        const codes = await onEnable(password);
        setRecoveryCodes(codes);
        setCodesSaved(false);
        resetForm("recovery-codes");
      } else {
        await onChangePassword(password);
        resetForm("overview");
      }
    });
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog encryption-dialog"
      aria-labelledby="encryption-dialog-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (open && canClose) {
          close();
        }
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">Vault security</span>
          <h2 id="encryption-dialog-title">{titleForView(view)}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close vault security"
          disabled={busy || !canClose}
          onClick={close}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="encryption-dialog__body">
        {error ? (
          <p className="encryption-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        {view === "overview" ? (
          encryption.enabled ? (
            <EncryptionOverview
              encryption={encryption}
              busy={busy}
              onLock={() => void run(onLock)}
              onChangePassword={() => resetForm("change-password")}
              onRegenerate={() => resetForm("regenerate")}
              onDisable={() => resetForm("disable")}
            />
          ) : (
            <div className="encryption-dialog__section">
              <ShieldCheck aria-hidden="true" size={30} />
              <p>
                Encrypt every file and saved revision with a vault password.
                Filenames and folders remain visible.
              </p>
              <button
                type="button"
                className="primary-button"
                data-encryption-initial-focus
                onClick={() => resetForm("enable")}
              >
                Enable encryption
              </button>
            </div>
          )
        ) : view === "enable" || view === "change-password" ? (
          <form
            className="encryption-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPassword();
            }}
          >
            <p>
              {view === "enable"
                ? "Choose a password. Denote cannot recover it without one of the recovery codes shown next."
                : "Choose a new password for this vault."}
            </p>
            <label>
              <span>New password</span>
              <input
                type="password"
                data-encryption-initial-focus
                value={password}
                minLength={12}
                autoComplete="new-password"
                autoFocus
                disabled={busy}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmation}
                minLength={12}
                autoComplete="new-password"
                disabled={busy}
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
            </label>
            <DialogActions
              busy={busy}
              confirmLabel={
                view === "enable" ? "Encrypt vault" : "Change password"
              }
              onBack={() => resetForm("overview")}
            />
          </form>
        ) : view === "regenerate" ? (
          <div className="encryption-dialog__section">
            <KeyRound aria-hidden="true" size={30} />
            <p>
              Generate ten new one-time recovery codes? Every unused old code
              will stop working.
            </p>
            <div className="encryption-dialog__actions">
              <button
                type="button"
                className="secondary-button"
                data-encryption-initial-focus
                disabled={busy}
                onClick={() => resetForm("overview")}
              >
                Back
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const codes = await onRegenerateRecoveryCodes();
                    setRecoveryCodes(codes);
                    setCodesSaved(false);
                    resetForm("recovery-codes");
                  })
                }
              >
                {busy ? "Generating…" : "Generate new codes"}
              </button>
            </div>
          </div>
        ) : view === "disable" ? (
          <div className="encryption-dialog__section">
            <Lock aria-hidden="true" size={30} />
            <p>
              Denote will decrypt every file and saved revision before
              encryption is disabled. Do not close the app during this
              operation.
            </p>
            <div className="encryption-dialog__actions">
              <button
                type="button"
                className="secondary-button"
                data-encryption-initial-focus
                disabled={busy}
                onClick={() => resetForm("overview")}
              >
                Back
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onDisable();
                    close();
                  })
                }
              >
                {busy ? "Decrypting…" : "Decrypt and disable"}
              </button>
            </div>
          </div>
        ) : (
          <div className="encryption-dialog__codes">
            <p>
              Save these codes now. Each code unlocks the vault once and is
              never shown again.
            </p>
            <ol aria-label="One-time recovery codes">
              {recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="secondary-button"
              data-encryption-initial-focus
              onClick={() => void copyRecoveryCodes()}
            >
              {copied ? (
                <Check aria-hidden="true" size={15} />
              ) : (
                <Copy aria-hidden="true" size={15} />
              )}
              {copied ? "Copied" : "Copy all"}
            </button>
            <label className="encryption-dialog__acknowledgement">
              <input
                type="checkbox"
                checked={codesSaved}
                onChange={(event) => setCodesSaved(event.currentTarget.checked)}
              />
              <span>I saved the recovery codes somewhere safe.</span>
            </label>
            <div className="encryption-dialog__actions">
              <button
                type="button"
                className="primary-button"
                disabled={!codesSaved}
                onClick={close}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

interface EncryptionOverviewProps {
  encryption: EncryptionStatus;
  busy: boolean;
  onLock: () => void;
  onChangePassword: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
}

function EncryptionOverview({
  encryption,
  busy,
  onLock,
  onChangePassword,
  onRegenerate,
  onDisable,
}: EncryptionOverviewProps) {
  return (
    <div className="encryption-dialog__overview">
      <div className="encryption-dialog__status">
        <ShieldCheck aria-hidden="true" size={30} />
        <div>
          <strong>Encryption is on</strong>
          <span>
            {encryption.remainingRecoveryCodes} one-time recovery code
            {encryption.remainingRecoveryCodes === 1 ? "" : "s"} remaining
          </span>
        </div>
      </div>
      <button
        type="button"
        className="secondary-button"
        data-encryption-initial-focus
        disabled={busy}
        onClick={onLock}
      >
        Lock now
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onChangePassword}
      >
        Change password
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onRegenerate}
      >
        Replace recovery codes
      </button>
      <button
        type="button"
        className="danger-button"
        disabled={busy}
        onClick={onDisable}
      >
        Disable encryption
      </button>
    </div>
  );
}

interface DialogActionsProps {
  busy: boolean;
  confirmLabel: string;
  onBack: () => void;
}

function DialogActions({ busy, confirmLabel, onBack }: DialogActionsProps) {
  return (
    <div className="encryption-dialog__actions">
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onBack}
      >
        Back
      </button>
      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}

function titleForView(view: EncryptionView): string {
  switch (view) {
    case "enable":
      return "Enable encryption";
    case "change-password":
      return "Change password";
    case "regenerate":
      return "Replace recovery codes";
    case "disable":
      return "Disable encryption";
    case "recovery-codes":
      return "Save recovery codes";
    default:
      return "Vault encryption";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Encryption operation failed.";
}
