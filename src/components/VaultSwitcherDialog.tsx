import {
  AlertTriangle,
  Check,
  FolderOpen,
  FolderPlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type { KnownVault } from "../types";

interface VaultSwitcherDialogProps {
  open: boolean;
  onLoad: () => Promise<KnownVault[]>;
  onSwitch: (vaultId: number) => Promise<void>;
  onChooseFolder: () => void;
  onClose: () => void;
}

export function VaultSwitcherDialog({
  open,
  onLoad,
  onSwitch,
  onChooseFolder,
  onClose,
}: VaultSwitcherDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const [vaults, setVaults] = useState<KnownVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      requestVersion.current += 1;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    void onLoad()
      .then((knownVaults) => {
        if (request === requestVersion.current) {
          setVaults(knownVaults);
          window.setTimeout(
            () =>
              dialogRef.current
                ?.querySelector<HTMLElement>("[data-vault-switch-target]")
                ?.focus(),
            0,
          );
        }
      })
      .catch((caught) => {
        if (request === requestVersion.current) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (request === requestVersion.current) {
          setLoading(false);
        }
      });
  }, [onLoad, open]);

  const switchVault = async (vaultId: number) => {
    setSwitchingId(vaultId);
    setError(null);
    try {
      await onSwitch(vaultId);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog vault-switcher-dialog"
      aria-labelledby="vault-switcher-title"
      aria-busy={loading || switchingId !== null}
      onCancel={(event) => {
        event.preventDefault();
        if (switchingId === null) {
          onClose();
        }
      }}
      onClose={() => {
        if (open && switchingId === null) {
          onClose();
        }
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">Vaults</span>
          <h2 id="vault-switcher-title">Switch vault</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close vault switcher"
          disabled={switchingId !== null}
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="vault-switcher-dialog__body">
        {error ? (
          <p className="vault-switcher-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="dialog-empty">Loading vaults…</p>
        ) : vaults.length === 0 ? (
          <p className="dialog-empty">No recent vaults yet.</p>
        ) : (
          <div className="vault-switcher-list">
            {vaults.map((vault) => (
              <button
                type="button"
                className="vault-switcher-item"
                key={vault.id}
                data-vault-switch-target={
                  !vault.current && vault.available ? "" : undefined
                }
                aria-current={vault.current ? "true" : undefined}
                disabled={
                  vault.current || !vault.available || switchingId !== null
                }
                onClick={() => void switchVault(vault.id)}
              >
                <span className="vault-switcher-item__icon" aria-hidden="true">
                  {vault.current ? (
                    <Check size={17} />
                  ) : vault.available ? (
                    <FolderOpen size={17} />
                  ) : (
                    <AlertTriangle size={17} />
                  )}
                </span>
                <span className="vault-switcher-item__details">
                  <strong>{vault.name}</strong>
                  <span>{vault.path}</span>
                  <small>
                    {vault.current
                      ? "Current vault"
                      : vault.available
                        ? `Opened ${formatRelativeDate(vault.lastOpenedAt)}`
                        : "Folder unavailable"}
                  </small>
                </span>
                {switchingId === vault.id ? (
                  <span className="vault-switcher-item__status">
                    Switching…
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="vault-switcher-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={switchingId !== null}
          onClick={() => {
            onClose();
            onChooseFolder();
          }}
        >
          <FolderPlus aria-hidden="true" size={15} />
          Open another folder
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={switchingId !== null}
          onClick={onClose}
        >
          Done
        </button>
      </footer>
    </dialog>
  );
}

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) {
    return "just now";
  }
  if (elapsed < 3_600_000) {
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    timestamp,
  );
}
