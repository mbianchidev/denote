import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface ExternalLinkDialogProps {
  open: boolean;
  kind: "domain" | "protocol";
  subject: string;
  url: string;
  onAllow: () => void;
  onAllowAll: () => void;
  onCancel: () => void;
}

export function ExternalLinkDialog({
  open,
  kind,
  subject,
  url,
  onAllow,
  onAllowAll,
  onCancel,
}: ExternalLinkDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => firstActionRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog external-link-dialog"
      aria-labelledby="external-link-title"
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
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">
            <ExternalLink aria-hidden="true" size={15} />
            External link
          </span>
          <h2 id="external-link-title">
            {kind === "domain" ? `Allow ${subject}?` : `Open ${subject} link?`}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel external link"
          onClick={onCancel}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="external-link-dialog__body">
        <p>This link opens outside Denote:</p>
        <code>{url}</code>
      </div>
      <footer className="external-link-dialog__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          ref={firstActionRef}
          type="button"
          className="secondary-button"
          onClick={onAllow}
        >
          {kind === "domain" ? `Allow ${subject}` : `Open ${subject} link`}
        </button>
        {kind === "domain" ? (
          <button type="button" className="primary-button" onClick={onAllowAll}>
            Allow all external domains
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}
