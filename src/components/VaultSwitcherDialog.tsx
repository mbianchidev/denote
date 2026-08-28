import {
  AlertTriangle,
  Check,
  FolderOpen,
  FolderPlus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type { KnownVault } from "../types";

interface VaultSwitcherDialogProps {
  open: boolean;
  onLoad: () => Promise<KnownVault[]>;
  onSwitch: (vaultId: number) => Promise<void>;
  onDelete: (vaultId: number, trashFiles: boolean) => Promise<void>;
  onChooseFolder: () => void;
  onClose: () => void;
}

export function VaultSwitcherDialog({
  open,
  onLoad,
  onSwitch,
  onDelete,
  onChooseFolder,
  onClose,
}: VaultSwitcherDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const [vaults, setVaults] = useState<KnownVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KnownVault | null>(null);
  const [trashFiles, setTrashFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const reloadVaults = useCallback(async () => {
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const knownVaults = await onLoad();
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
    } catch (caught) {
      if (request === requestVersion.current) {
        setError(errorMessage(caught));
      }
    } finally {
      if (request === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [onLoad]);

  useEffect(() => {
    if (open) {
      setPendingDelete(null);
      setTrashFiles(false);
      void reloadVaults();
    }
  }, [open, reloadVaults]);

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

  const deleteVault = async () => {
    if (!pendingDelete) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete(pendingDelete.id, trashFiles);
      setPendingDelete(null);
      setTrashFiles(false);
      await reloadVaults();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const busy = loading || switchingId !== null || deleting;

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog vault-switcher-dialog"
      aria-labelledby="vault-switcher-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      onClose={() => {
        if (open && !busy) {
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
          disabled={busy}
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
        {pendingDelete ? (
          <section
            className="vault-delete-confirmation"
            aria-labelledby="vault-delete-title"
          >
            <div>
              <h3 id="vault-delete-title">
                Remove {pendingDelete.name}?
              </h3>
              <p>
                This removes the vault and its Denote metadata from the recent
                list.
              </p>
              <code>{pendingDelete.path}</code>
            </div>
            <label>
              <input
                type="checkbox"
                checked={trashFiles}
                disabled={!pendingDelete.available || deleting}
                onChange={(event) =>
                  setTrashFiles(event.currentTarget.checked)
                }
              />
              <span>
                <strong>Also move the vault folder to system Trash</strong>
                <small>
                  {pendingDelete.available
                    ? "The folder and all files can be recovered from the operating system Trash."
                    : "The folder is unavailable, so only the list entry can be removed."}
                </small>
              </span>
            </label>
            <div className="vault-delete-confirmation__actions">
              <button
                type="button"
                className="secondary-button"
                disabled={deleting}
                onClick={() => {
                  setPendingDelete(null);
                  setTrashFiles(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleting}
                onClick={() => void deleteVault()}
              >
                {deleting
                  ? "Removing…"
                  : trashFiles
                    ? "Move folder to Trash"
                    : "Remove from list"}
              </button>
            </div>
          </section>
        ) : loading ? (
          <p className="dialog-empty">Loading vaults…</p>
        ) : vaults.length === 0 ? (
          <p className="dialog-empty">No recent vaults yet.</p>
        ) : (
          <div className="vault-switcher-list">
            {vaults.map((vault) => (
              <div className="vault-switcher-row" key={vault.id}>
                <button
                  type="button"
                  className="vault-switcher-item"
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
                      {[
                        vault.current
                          ? "Current vault"
                          : vault.available
                            ? `Opened ${formatRelativeDate(vault.lastOpenedAt)}`
                            : "Folder unavailable",
                        vault.default ? "Built-in guide" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  {switchingId === vault.id ? (
                    <span className="vault-switcher-item__status">
                      Switching…
                    </span>
                  ) : null}
                </button>
                {!vault.current && !vault.default ? (
                  <button
                    type="button"
                    className="icon-button icon-button--danger vault-switcher-row__delete"
                    aria-label={`Remove ${vault.name} from vault list`}
                    title="Remove vault"
                    disabled={busy}
                    onClick={() => {
                      setPendingDelete(vault);
                      setTrashFiles(false);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="vault-switcher-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || pendingDelete !== null}
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
          disabled={busy || pendingDelete !== null}
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
