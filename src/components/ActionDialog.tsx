import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ActionDialogProps {
  open: boolean;
  mode: "text" | "confirm";
  title: string;
  message: string;
  initialValue: string;
  confirmLabel: string;
  dangerous: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function ActionDialog({
  open,
  mode,
  title,
  message,
  initialValue,
  confirmLabel,
  dangerous,
  onConfirm,
  onCancel,
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      setValue(initialValue);
      dialog.showModal();
      window.setTimeout(() => inputRef.current?.select(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [initialValue, open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog action-dialog"
      aria-labelledby="action-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (open) {
          onCancel();
        }
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const nextValue = value.trim();
          if (mode === "text" && !nextValue) {
            inputRef.current?.focus();
            return;
          }
          onConfirm(nextValue);
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-kicker">Denote</span>
            <h2 id="action-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="action-dialog__body">
          <p>{message}</p>
          {mode === "text" ? (
            <label>
              <span className="sr-only">{title}</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
        </div>
        <footer className="action-dialog__actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={dangerous ? "danger-button" : "primary-button"}
            autoFocus={mode === "confirm"}
          >
            {confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
