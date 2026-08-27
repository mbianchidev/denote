import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { HistoryRevision } from "../types";

interface HistoryDialogProps {
  open: boolean;
  title: string;
  revisions: HistoryRevision[];
  loading: boolean;
  onClose: () => void;
  onRestore: (revisionId: number) => void;
}

export function HistoryDialog({
  open,
  title,
  revisions,
  loading,
  onClose,
  onRestore,
}: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog history-dialog"
      aria-labelledby="history-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">
            <History aria-hidden="true" size={15} />
            History
          </span>
          <h2 id="history-title">{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="history-list">
        {loading ? (
          <p className="dialog-empty">Loading revisions…</p>
        ) : revisions.length > 0 ? (
          revisions.map((revision) => (
            <article className="history-item" key={revision.id}>
              <div>
                <time dateTime={revision.createdAt}>
                  {formatDate(revision.createdAt)}
                </time>
                <span>
                  {revision.reason} · {formatBytes(revision.byteCount)}
                </span>
                <p>{revision.preview || "Empty document"}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onRestore(revision.id)}
              >
                <RotateCcw aria-hidden="true" size={14} />
                Restore
              </button>
            </article>
          ))
        ) : (
          <p className="dialog-empty">
            Earlier content appears after the first changed autosave.
          </p>
        )}
      </div>
    </dialog>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KB`;
}
